//! Captain's logic: saved sites, connections, browsing and transfers.
//!
//! No Tauri and no UI here, so everything builds and tests on Linux. The
//! window talks to [`App`]; each Tauri command calls one of its methods.

pub mod edit;
pub mod entry;
pub mod error;
pub mod ftp;
pub mod ops;
pub mod path;
pub mod platform;
pub mod remote;
pub mod secret;
pub mod sftp;
pub mod site;
pub mod transfer;
pub mod trust;

#[cfg(test)]
mod testutil;

use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;

pub use entry::{Entry, Kind};
pub use error::{Error, Result};
pub use remote::Remote;
pub use site::{Auth, Bookmark, Protocol, Site};
pub use transfer::{Direction, Request, State, Transfer};

/// What the window needs after connecting.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// The login folder.
    pub home: String,
    /// Where to show first: the site's saved folder, or home.
    pub start: String,
}

type Slot = Arc<Mutex<Option<Box<dyn Remote>>>>;

struct Inner {
    support: Option<PathBuf>,
    cache: PathBuf,
    sites: Mutex<Vec<Site>>,
    trust: trust::Trust,
    /// The browsing connection for each open site. Transfers use their own.
    browsing: Mutex<HashMap<String, Slot>>,
    watched: Mutex<Vec<edit::Watched>>,
}

impl Inner {
    fn site(&self, id: &str) -> Result<Site> {
        self.sites
            .lock()
            .unwrap()
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| Error::invalid("That site no longer exists"))
    }

    fn connect(&self, site: &Site) -> Result<Box<dyn Remote>> {
        let secret = match site.auth {
            Auth::Password | Auth::Key { .. } => secret::get(&site.id)?,
            _ => None,
        };
        remote::connect(site, secret.as_deref(), &self.trust)
    }

    fn save_sites(&self) -> Result<()> {
        if let Some(dir) = &self.support {
            site::save(dir, &self.sites.lock().unwrap())?;
        }
        Ok(())
    }

    fn slot(&self, site_id: &str) -> Slot {
        self.browsing
            .lock()
            .unwrap()
            .entry(site_id.to_string())
            .or_default()
            .clone()
    }

    /// Run `op` on the site's browsing connection, connecting if needed and
    /// reconnecting once if the old connection has dropped.
    fn with<T>(
        &self,
        site_id: &str,
        mut op: impl FnMut(&mut dyn Remote) -> Result<T>,
    ) -> Result<T> {
        let slot = self.slot(site_id);
        let mut conn = slot.lock().unwrap();
        if conn.is_none() {
            *conn = Some(self.connect(&self.site(site_id)?)?);
        }
        match op(conn.as_mut().expect("connected").as_mut()) {
            Err(e) if e.is_connection() => {
                *conn = None;
                let mut fresh = self.connect(&self.site(site_id)?)?;
                let out = op(fresh.as_mut());
                *conn = Some(fresh);
                out
            }
            other => other,
        }
    }
}

pub struct App {
    inner: Arc<Inner>,
    queue: transfer::Queue,
}

impl App {
    /// `support`: where sites and trusted servers are saved (`None` keeps
    /// them in memory). `cache`: where "Edit in…" copies go. `notify` hears
    /// every change to a transfer.
    pub fn new(
        support: Option<PathBuf>,
        cache: PathBuf,
        notify: impl Fn(&Transfer) + Send + Sync + 'static,
    ) -> Self {
        let sites = support.as_deref().map(site::load).unwrap_or_default();
        let inner = Arc::new(Inner {
            trust: trust::Trust::open(support.as_deref()),
            support,
            cache,
            sites: Mutex::new(sites),
            browsing: Mutex::new(HashMap::new()),
            watched: Mutex::new(Vec::new()),
        });
        let for_queue = inner.clone();
        let queue = transfer::Queue::new(
            3,
            move |site_id| for_queue.connect(&for_queue.site(site_id)?),
            notify,
        );
        start_edit_watcher(inner.clone(), queue.clone());
        App { inner, queue }
    }

    // Sites

    pub fn sites(&self) -> Vec<Site> {
        self.inner.sites.lock().unwrap().clone()
    }

    /// Add or update a site. `secret`: `Some("")` removes a saved password,
    /// `None` leaves it as it was.
    pub fn save_site(&self, draft: Site, secret: Option<String>) -> Result<Site> {
        let site = site::normalize(draft)?;
        match secret.as_deref() {
            Some("") => secret::delete(&site.id)?,
            Some(s) => secret::set(&site.id, s)?,
            None => {}
        }
        {
            let mut sites = self.inner.sites.lock().unwrap();
            match sites.iter_mut().find(|s| s.id == site.id) {
                Some(existing) => {
                    let changed_server = existing.host != site.host
                        || existing.port != site.port
                        || existing.user != site.user
                        || existing.protocol != site.protocol
                        || existing.auth != site.auth;
                    *existing = site.clone();
                    if changed_server {
                        self.inner.browsing.lock().unwrap().remove(&site.id);
                    }
                }
                None => sites.push(site.clone()),
            }
        }
        if secret.is_some() {
            self.inner.browsing.lock().unwrap().remove(&site.id);
        }
        self.inner.save_sites()?;
        Ok(site)
    }

    pub fn delete_site(&self, id: &str) -> Result<()> {
        self.inner.sites.lock().unwrap().retain(|s| s.id != id);
        self.inner.browsing.lock().unwrap().remove(id);
        secret::delete(id)?;
        self.inner.save_sites()
    }

    /// Put the sites in this order (ids not listed keep their place at the end).
    pub fn reorder_sites(&self, ids: &[String]) -> Result<()> {
        {
            let mut sites = self.inner.sites.lock().unwrap();
            sites.sort_by_key(|s| ids.iter().position(|i| *i == s.id).unwrap_or(usize::MAX));
        }
        self.inner.save_sites()
    }

    pub fn has_secret(&self, id: &str) -> bool {
        secret::get(id).ok().flatten().is_some()
    }

    pub fn parse_url(&self, url: &str) -> Result<(Site, Option<String>)> {
        site::parse_url(url)
    }

    pub fn url_for(&self, site_id: &str, remote: &str) -> Result<String> {
        Ok(site::url_for(&self.inner.site(site_id)?, remote))
    }

    pub fn set_bookmarks(&self, site_id: &str, bookmarks: Vec<Bookmark>) -> Result<Site> {
        let site = {
            let mut sites = self.inner.sites.lock().unwrap();
            let site = sites
                .iter_mut()
                .find(|s| s.id == site_id)
                .ok_or_else(|| Error::invalid("That site no longer exists"))?;
            site.bookmarks = bookmarks;
            site.clone()
        };
        self.inner.save_sites()?;
        Ok(site)
    }

    // Trust

    /// The user looked at the fingerprint and chose to trust this server.
    pub fn trust(&self, kind: trust::Kind, host: &str, port: u16, fingerprint: &str) -> Result<()> {
        self.inner.trust.add(kind, host, port, fingerprint)
    }

    // Connections

    /// Check a site's details without saving it.
    pub fn test(&self, draft: Site, secret: Option<String>) -> Result<String> {
        let site = site::normalize(draft)?;
        let secret = match secret {
            Some(s) => Some(s),
            None => secret::get(&site.id)?,
        };
        let mut conn = remote::connect(&site, secret.as_deref(), &self.inner.trust)?;
        conn.home()
    }

    pub fn connect(&self, site_id: &str) -> Result<Opened> {
        let site = self.inner.site(site_id)?;
        let slot = self.inner.slot(site_id);
        let mut conn = slot.lock().unwrap();
        let alive = conn.as_mut().is_some_and(|c| c.alive());
        if !alive {
            *conn = Some(self.inner.connect(&site)?);
        }
        let remote = conn.as_mut().expect("connected");
        let home = remote.home()?;
        let start = if site.remote_path.is_empty() {
            home.clone()
        } else {
            path::join(&home, &site.remote_path)
        };
        drop(conn);
        if let Some(s) = self
            .inner
            .sites
            .lock()
            .unwrap()
            .iter_mut()
            .find(|s| s.id == site_id)
        {
            s.last_used = Some(site::now());
        }
        let _ = self.inner.save_sites();
        Ok(Opened { home, start })
    }

    pub fn disconnect(&self, site_id: &str) {
        self.inner.browsing.lock().unwrap().remove(site_id);
    }

    pub fn connected(&self) -> Vec<String> {
        self.inner
            .browsing
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, slot)| slot.try_lock().map(|c| c.is_some()).unwrap_or(true))
            .map(|(id, _)| id.clone())
            .collect()
    }

    // Browsing

    pub fn list(&self, site_id: &str, dir: &str) -> Result<Vec<Entry>> {
        let dir = path::normalize(dir);
        let mut entries = self.inner.with(site_id, |r| r.list(&dir))?;
        entry::sort(&mut entries);
        Ok(entries)
    }

    pub fn mkdir(&self, site_id: &str, dir: &str, name: &str) -> Result<String> {
        let target = path::join(dir, path::validate_name(name)?);
        self.inner.with(site_id, |r| r.mkdir(&target))?;
        Ok(target)
    }

    /// Create an empty file, for "New File".
    pub fn touch(&self, site_id: &str, dir: &str, name: &str) -> Result<String> {
        let target = path::join(dir, path::validate_name(name)?);
        self.inner.with(site_id, |r| {
            if r.stat(&target).is_ok() {
                return Err(Error::remote(format!(
                    "{} already exists",
                    path::name(&target)
                )));
            }
            r.upload(&target, &mut Cursor::new(Vec::new()), &mut |_| true)
                .map(|_| ())
        })?;
        Ok(target)
    }

    pub fn rename(&self, site_id: &str, from: &str, new_name: &str) -> Result<String> {
        let parent =
            path::parent(from).ok_or_else(|| Error::invalid("Can't rename the top folder"))?;
        let target = path::join(&parent, path::validate_name(new_name)?);
        if target == path::normalize(from) {
            return Ok(target);
        }
        self.inner.with(site_id, |r| {
            if r.stat(&target).is_ok() {
                return Err(Error::remote(format!(
                    "There's already an item called “{}”",
                    path::name(&target)
                )));
            }
            r.rename(from, &target)
        })?;
        Ok(target)
    }

    /// Move items into another folder on the same server.
    pub fn move_to(&self, site_id: &str, paths: &[String], dir: &str) -> Result<()> {
        self.inner.with(site_id, |r| {
            for p in paths {
                let target = path::join(dir, &path::name(p));
                if target != path::normalize(p)
                    && !target.starts_with(&format!("{}/", path::normalize(p)))
                {
                    r.rename(p, &target)?;
                }
            }
            Ok(())
        })
    }

    pub fn delete(&self, site_id: &str, paths: &[String]) -> Result<()> {
        self.inner.with(site_id, |r| {
            for p in paths {
                let e = r.stat(p)?;
                ops::remove_all(r, &e)?;
            }
            Ok(())
        })
    }

    pub fn chmod(&self, site_id: &str, target: &str, mode: u32) -> Result<()> {
        self.inner.with(site_id, |r| r.chmod(target, mode))
    }

    /// A text file's contents, for the preview and the built-in editor.
    /// `None` for binary files and files over `limit` bytes.
    pub fn read_text(&self, site_id: &str, target: &str, limit: u64) -> Result<Option<String>> {
        let bytes = self.inner.with(site_id, |r| {
            let mut buf = Vec::new();
            match r.download(target, &mut buf, &mut |n| n <= limit) {
                Ok(_) => Ok(Some(buf)),
                Err(Error::Cancelled) => Ok(None),
                Err(e) => Err(e),
            }
        })?;
        Ok(bytes.and_then(|b| {
            if b.contains(&0) {
                None
            } else {
                String::from_utf8(b).ok()
            }
        }))
    }

    pub fn write_text(&self, site_id: &str, target: &str, text: &str) -> Result<()> {
        self.inner.with(site_id, |r| {
            r.upload(target, &mut Cursor::new(text.as_bytes()), &mut |_| true)
                .map(|_| ())
        })
    }

    /// Download a file privately, open it in its default app, and upload it
    /// again whenever it's saved.
    pub fn edit_external(&self, site_id: &str, target: &str) -> Result<edit::Watched> {
        let local = edit::local_copy(&self.inner.cache, site_id, target);
        if let Some(dir) = local.parent() {
            std::fs::create_dir_all(dir)?;
        }
        self.inner.with(site_id, |r| {
            let mut file = std::fs::File::create(&local)?;
            r.download(target, &mut file, &mut |_| true).map(|_| ())
        })?;
        let watched = edit::Watched {
            site_id: site_id.to_string(),
            remote: path::normalize(target),
            local: local.to_string_lossy().into_owned(),
            mtime: edit::mtime(&local),
        };
        {
            let mut list = self.inner.watched.lock().unwrap();
            list.retain(|w| !(w.site_id == watched.site_id && w.remote == watched.remote));
            list.push(watched.clone());
        }
        platform::open(&local)?;
        Ok(watched)
    }

    pub fn watched(&self) -> Vec<edit::Watched> {
        self.inner.watched.lock().unwrap().clone()
    }

    pub fn stop_watching(&self, site_id: &str, target: &str) {
        self.inner
            .watched
            .lock()
            .unwrap()
            .retain(|w| !(w.site_id == site_id && w.remote == target));
    }

    // Transfers

    pub fn transfer(&self, requests: Vec<Request>) -> Result<Vec<Transfer>> {
        let mut out = Vec::new();
        for r in requests {
            let site = self.inner.site(&r.site_id)?;
            out.push(self.queue.add(r, &site.name));
        }
        Ok(out)
    }

    pub fn transfers(&self) -> Vec<Transfer> {
        self.queue.list()
    }

    pub fn cancel_transfer(&self, id: u64) {
        self.queue.cancel(id)
    }

    pub fn retry_transfer(&self, id: u64) -> Option<Transfer> {
        self.queue.retry(id)
    }

    pub fn clear_transfers(&self) {
        self.queue.clear_finished()
    }

    // This Mac

    pub fn downloads_dir(&self) -> String {
        platform::downloads_dir().to_string_lossy().into_owned()
    }

    pub fn list_local(&self, dir: &str) -> Result<Vec<Entry>> {
        let mut out = Vec::new();
        for item in std::fs::read_dir(dir)? {
            let item = item?;
            let p = item.path();
            if let Ok(e) = remote::local_entry(&p, &p.to_string_lossy()) {
                out.push(e);
            }
        }
        entry::sort(&mut out);
        Ok(out)
    }

    pub fn reveal(&self, local: &str) -> Result<()> {
        platform::reveal(Path::new(local))
    }

    pub fn open_local(&self, local: &str) -> Result<()> {
        platform::open(Path::new(local))
    }
}

/// Once a second, upload every "Edit in…" copy that was saved since the last look.
fn start_edit_watcher(inner: Arc<Inner>, queue: transfer::Queue) {
    let _ = std::thread::Builder::new()
        .name("captain-edit-watch".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            let changed = edit::changed(&mut inner.watched.lock().unwrap());
            for w in changed {
                let Ok(site) = inner.site(&w.site_id) else {
                    continue;
                };
                queue.add(
                    Request {
                        site_id: w.site_id,
                        direction: Direction::Upload,
                        local: w.local,
                        remote: path::parent(&w.remote).unwrap_or_else(|| "/".into()),
                        is_dir: false,
                    },
                    &site.name,
                );
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> App {
        let dir = testutil::temp_dir("app");
        App::new(Some(dir.join("support")), dir.join("cache"), |_| {})
    }

    fn site() -> Site {
        Site {
            id: String::new(),
            name: "Staging".into(),
            protocol: Protocol::Sftp,
            host: "127.0.0.1".into(),
            port: 1,
            user: "deploy".into(),
            auth: Auth::Password,
            remote_path: String::new(),
            local_path: String::new(),
            color: "teal".into(),
            bookmarks: vec![],
            last_used: None,
        }
    }

    #[test]
    fn manages_sites_and_secrets() {
        let app = app();
        let s = app.save_site(site(), Some("pw".into())).unwrap();
        assert!(app.has_secret(&s.id));
        assert_eq!(app.sites().len(), 1);

        let mut renamed = s.clone();
        renamed.name = "Production".into();
        app.save_site(renamed, None).unwrap();
        assert_eq!(app.sites()[0].name, "Production");
        assert!(app.has_secret(&s.id), "None keeps the password");

        let b = app
            .set_bookmarks(
                &s.id,
                vec![Bookmark {
                    name: "www".into(),
                    path: "/var/www".into(),
                }],
            )
            .unwrap();
        assert_eq!(b.bookmarks.len(), 1);

        let other = app.save_site(site(), None).unwrap();
        app.reorder_sites(&[other.id.clone(), s.id.clone()])
            .unwrap();
        assert_eq!(app.sites()[0].id, other.id);

        app.delete_site(&s.id).unwrap();
        assert!(!app.has_secret(&s.id));
        assert_eq!(app.sites().len(), 1);
    }

    #[test]
    fn connection_errors_are_clear() {
        let app = app();
        let s = app.save_site(site(), Some("pw".into())).unwrap();
        // Port 1 on localhost: nothing listens there.
        match app.connect(&s.id) {
            Err(Error::Connection { message }) => {
                assert!(message.contains("127.0.0.1"), "{message}")
            }
            other => panic!("expected a connection error, got {other:?}"),
        }
        assert!(matches!(
            app.list("missing", "/"),
            Err(Error::Invalid { .. })
        ));
    }
}
