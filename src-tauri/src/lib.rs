//! The Tauri shell.
//!
//! No logic lives here. A command deserialises its arguments, calls one
//! method on `captain_core::App`, and returns the result. Anything that touches
//! the network runs on a blocking thread so the window never stalls.
//!
//! Events sent to the window:
//! - `captain://transfer`: a transfer changed (queued, progress, finished).

use std::sync::Arc;

use captain_core::edit::Watched;
use captain_core::{trust, App, Bookmark, Entry, Error, Opened, Request, Site, Transfer};
use tauri::{AppHandle, Emitter, Manager, State};

type Shared = Arc<App>;

/// Run blocking work off the main thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, Error> + Send + 'static,
) -> Result<T, Error> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| Error::local(e.to_string()))?
}

#[tauri::command]
fn sites(app: State<Shared>) -> Vec<Site> {
    app.sites()
}

#[tauri::command]
fn save_site(app: State<Shared>, site: Site, secret: Option<String>) -> Result<Site, Error> {
    app.save_site(site, secret)
}

#[tauri::command]
fn delete_site(app: State<Shared>, id: String) -> Result<(), Error> {
    app.delete_site(&id)
}

#[tauri::command]
fn reorder_sites(app: State<Shared>, ids: Vec<String>) -> Result<(), Error> {
    app.reorder_sites(&ids)
}

#[tauri::command]
fn has_secret(app: State<Shared>, id: String) -> bool {
    app.has_secret(&id)
}

#[tauri::command]
fn parse_url(app: State<Shared>, url: String) -> Result<(Site, Option<String>), Error> {
    app.parse_url(&url)
}

#[tauri::command]
fn url_for(app: State<Shared>, site_id: String, path: String) -> Result<String, Error> {
    app.url_for(&site_id, &path)
}

#[tauri::command]
fn set_bookmarks(
    app: State<Shared>,
    site_id: String,
    bookmarks: Vec<Bookmark>,
) -> Result<Site, Error> {
    app.set_bookmarks(&site_id, bookmarks)
}

#[tauri::command]
fn trust_server(
    app: State<Shared>,
    tls: bool,
    host: String,
    port: u16,
    fingerprint: String,
) -> Result<(), Error> {
    let kind = if tls {
        trust::Kind::Tls
    } else {
        trust::Kind::Ssh
    };
    app.trust(kind, &host, port, &fingerprint)
}

#[tauri::command]
async fn test_site(
    app: State<'_, Shared>,
    site: Site,
    secret: Option<String>,
) -> Result<String, Error> {
    let app = app.inner().clone();
    blocking(move || app.test(site, secret)).await
}

#[tauri::command]
async fn connect(app: State<'_, Shared>, site_id: String) -> Result<Opened, Error> {
    let app = app.inner().clone();
    blocking(move || app.connect(&site_id)).await
}

#[tauri::command]
fn disconnect(app: State<Shared>, site_id: String) {
    app.disconnect(&site_id)
}

#[tauri::command]
fn connected(app: State<Shared>) -> Vec<String> {
    app.connected()
}

#[tauri::command]
async fn list(app: State<'_, Shared>, site_id: String, path: String) -> Result<Vec<Entry>, Error> {
    let app = app.inner().clone();
    blocking(move || app.list(&site_id, &path)).await
}

#[tauri::command]
async fn mkdir(
    app: State<'_, Shared>,
    site_id: String,
    dir: String,
    name: String,
) -> Result<String, Error> {
    let app = app.inner().clone();
    blocking(move || app.mkdir(&site_id, &dir, &name)).await
}

#[tauri::command]
async fn touch(
    app: State<'_, Shared>,
    site_id: String,
    dir: String,
    name: String,
) -> Result<String, Error> {
    let app = app.inner().clone();
    blocking(move || app.touch(&site_id, &dir, &name)).await
}

#[tauri::command]
async fn rename(
    app: State<'_, Shared>,
    site_id: String,
    path: String,
    name: String,
) -> Result<String, Error> {
    let app = app.inner().clone();
    blocking(move || app.rename(&site_id, &path, &name)).await
}

#[tauri::command]
async fn move_to(
    app: State<'_, Shared>,
    site_id: String,
    paths: Vec<String>,
    dir: String,
) -> Result<(), Error> {
    let app = app.inner().clone();
    blocking(move || app.move_to(&site_id, &paths, &dir)).await
}

#[tauri::command]
async fn delete(app: State<'_, Shared>, site_id: String, paths: Vec<String>) -> Result<(), Error> {
    let app = app.inner().clone();
    blocking(move || app.delete(&site_id, &paths)).await
}

#[tauri::command]
async fn chmod(
    app: State<'_, Shared>,
    site_id: String,
    path: String,
    mode: u32,
) -> Result<(), Error> {
    let app = app.inner().clone();
    blocking(move || app.chmod(&site_id, &path, mode)).await
}

#[tauri::command]
async fn read_text(
    app: State<'_, Shared>,
    site_id: String,
    path: String,
    limit: u64,
) -> Result<Option<String>, Error> {
    let app = app.inner().clone();
    blocking(move || app.read_text(&site_id, &path, limit)).await
}

/// Raw bytes for an image preview, sent as binary rather than JSON. Empty when
/// the file is over `limit`.
#[tauri::command]
async fn read_bytes(
    app: State<'_, Shared>,
    site_id: String,
    path: String,
    limit: u64,
) -> Result<tauri::ipc::Response, Error> {
    let app = app.inner().clone();
    let bytes = blocking(move || app.read_bytes(&site_id, &path, limit)).await?;
    Ok(tauri::ipc::Response::new(bytes.unwrap_or_default()))
}

#[tauri::command]
async fn write_text(
    app: State<'_, Shared>,
    site_id: String,
    path: String,
    text: String,
) -> Result<(), Error> {
    let app = app.inner().clone();
    blocking(move || app.write_text(&site_id, &path, &text)).await
}

#[tauri::command]
async fn edit_external(
    app: State<'_, Shared>,
    site_id: String,
    path: String,
) -> Result<Watched, Error> {
    let app = app.inner().clone();
    blocking(move || app.edit_external(&site_id, &path)).await
}

#[tauri::command]
fn watched(app: State<Shared>) -> Vec<Watched> {
    app.watched()
}

#[tauri::command]
fn stop_watching(app: State<Shared>, site_id: String, path: String) {
    app.stop_watching(&site_id, &path)
}

#[tauri::command]
fn transfer(app: State<Shared>, requests: Vec<Request>) -> Result<Vec<Transfer>, Error> {
    app.transfer(requests)
}

#[tauri::command]
fn transfers(app: State<Shared>) -> Vec<Transfer> {
    app.transfers()
}

#[tauri::command]
fn cancel_transfer(app: State<Shared>, id: u64) {
    app.cancel_transfer(id)
}

#[tauri::command]
fn retry_transfer(app: State<Shared>, id: u64) -> Option<Transfer> {
    app.retry_transfer(id)
}

#[tauri::command]
fn clear_transfers(app: State<Shared>) {
    app.clear_transfers()
}

#[tauri::command]
fn downloads_dir(app: State<Shared>) -> String {
    app.downloads_dir()
}

#[tauri::command]
async fn list_local(app: State<'_, Shared>, path: String) -> Result<Vec<Entry>, Error> {
    let app = app.inner().clone();
    blocking(move || app.list_local(&path)).await
}

#[tauri::command]
fn reveal(app: State<Shared>, path: String) -> Result<(), Error> {
    app.reveal(&path)
}

#[tauri::command]
fn open_local(app: State<Shared>, path: String) -> Result<(), Error> {
    app.open_local(&path)
}

fn setup(handle: &AppHandle) -> Result<Shared, Box<dyn std::error::Error>> {
    let paths = handle.path();
    let support = paths.app_data_dir()?;
    let cache = paths.app_cache_dir()?;
    let emitter = handle.clone();
    Ok(Arc::new(App::new(Some(support), cache, move |t| {
        let _ = emitter.emit("captain://transfer", t);
    })))
}

/// Build and run the application.
pub fn run() {
    tauri::Builder::default()
        // Native open panels: Upload…, choosing a key file or a download folder.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let shared = setup(app.handle())?;
            app.manage(shared);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sites,
            save_site,
            delete_site,
            reorder_sites,
            has_secret,
            parse_url,
            url_for,
            set_bookmarks,
            trust_server,
            test_site,
            connect,
            disconnect,
            connected,
            list,
            mkdir,
            touch,
            rename,
            move_to,
            delete,
            chmod,
            read_text,
            read_bytes,
            write_text,
            edit_external,
            watched,
            stop_watching,
            transfer,
            transfers,
            cancel_transfer,
            retry_transfer,
            clear_transfers,
            downloads_dir,
            list_local,
            reveal,
            open_local,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the application");
}
