//! The transfer queue. Uploads and downloads run on a few worker threads,
//! each with its own connection, so browsing never waits for a transfer and
//! a slow file never blocks the rest.
//!
//! Rules a user can rely on:
//! - Uploads replace files of the same name on the server (what deploying
//!   a site expects).
//! - Downloads never replace anything on this Mac: a clash becomes
//!   "name 2.ext", like Finder. A download is written to a ".teapdownload"
//!   file and renamed only when complete, so a half file never looks whole.
//! - A dropped connection is retried once with a fresh one.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::entry::Entry;
use crate::error::{Error, Result};
use crate::ops;
use crate::path;
use crate::remote::Remote;
use crate::site::now;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

/// What the user asked for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub site_id: String,
    pub direction: Direction,
    /// Upload: the file or folder on this Mac. Download: the folder to save into.
    pub local: String,
    /// Upload: the server folder to put it in. Download: the file or folder on the server.
    pub remote: String,
    /// Download only: whether `remote` is a folder.
    #[serde(default)]
    pub is_dir: bool,
}

/// A transfer as the window shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub id: u64,
    pub site_id: String,
    pub site_name: String,
    pub direction: Direction,
    pub name: String,
    pub state: State,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: u32,
    pub files_total: u32,
    /// The file being moved right now, for folders.
    pub current: Option<String>,
    /// Bytes per second, smoothed.
    pub rate: u64,
    pub error: Option<String>,
    pub started: Option<i64>,
    pub finished: Option<i64>,
    /// Where it ended up: the local path of a download, the remote path of
    /// an upload.
    pub result: Option<String>,
    pub request: Request,
}

pub type Connector = dyn Fn(&str) -> Result<Box<dyn Remote>> + Send + Sync;
pub type Notify = dyn Fn(&Transfer) + Send + Sync;

struct Book {
    transfers: Vec<Transfer>,
    pending: VecDeque<u64>,
    cancel: HashMap<u64, Arc<AtomicBool>>,
    next: u64,
    running: usize,
}

struct Shared {
    book: Mutex<Book>,
    wake: Condvar,
    idle: Condvar,
    connect: Box<Connector>,
    notify: Box<Notify>,
}

#[derive(Clone)]
pub struct Queue {
    shared: Arc<Shared>,
}

impl Queue {
    pub fn new(
        workers: usize,
        connect: impl Fn(&str) -> Result<Box<dyn Remote>> + Send + Sync + 'static,
        notify: impl Fn(&Transfer) + Send + Sync + 'static,
    ) -> Self {
        let shared = Arc::new(Shared {
            book: Mutex::new(Book {
                transfers: Vec::new(),
                pending: VecDeque::new(),
                cancel: HashMap::new(),
                next: 1,
                running: 0,
            }),
            wake: Condvar::new(),
            idle: Condvar::new(),
            connect: Box::new(connect),
            notify: Box::new(notify),
        });
        for i in 0..workers.max(1) {
            let shared = shared.clone();
            std::thread::Builder::new()
                .name(format!("teap-transfer-{i}"))
                .spawn(move || worker(shared))
                .expect("spawn transfer worker");
        }
        Queue { shared }
    }

    pub fn add(&self, request: Request, site_name: &str) -> Transfer {
        let name = match request.direction {
            Direction::Upload => Path::new(&request.local)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| request.local.clone()),
            Direction::Download => path::name(&request.remote),
        };
        let mut book = self.shared.book.lock().unwrap();
        let id = book.next;
        book.next += 1;
        let t = Transfer {
            id,
            site_id: request.site_id.clone(),
            site_name: site_name.to_string(),
            direction: request.direction,
            name,
            state: State::Queued,
            bytes_done: 0,
            bytes_total: 0,
            files_done: 0,
            files_total: 0,
            current: None,
            rate: 0,
            error: None,
            started: None,
            finished: None,
            result: None,
            request,
        };
        book.transfers.push(t.clone());
        book.pending.push_back(id);
        book.cancel.insert(id, Arc::new(AtomicBool::new(false)));
        drop(book);
        self.shared.wake.notify_one();
        (self.shared.notify)(&t);
        t
    }

    pub fn list(&self) -> Vec<Transfer> {
        self.shared.book.lock().unwrap().transfers.clone()
    }

    pub fn cancel(&self, id: u64) {
        let mut book = self.shared.book.lock().unwrap();
        if let Some(flag) = book.cancel.get(&id) {
            flag.store(true, Ordering::SeqCst);
        }
        let was_queued = book.pending.iter().any(|p| *p == id);
        book.pending.retain(|p| *p != id);
        if was_queued {
            if let Some(t) = book.transfers.iter_mut().find(|t| t.id == id) {
                t.state = State::Cancelled;
                t.finished = Some(now());
                let t = t.clone();
                drop(book);
                (self.shared.notify)(&t);
                self.shared.idle.notify_all();
            }
        }
    }

    /// Run a failed or cancelled transfer again, from the start.
    pub fn retry(&self, id: u64) -> Option<Transfer> {
        let (request, site_name) = {
            let book = self.shared.book.lock().unwrap();
            let t = book
                .transfers
                .iter()
                .find(|t| t.id == id && matches!(t.state, State::Failed | State::Cancelled))?;
            (t.request.clone(), t.site_name.clone())
        };
        self.shared
            .book
            .lock()
            .unwrap()
            .transfers
            .retain(|t| t.id != id);
        Some(self.add(request, &site_name))
    }

    /// Forget finished transfers (done, failed, cancelled).
    pub fn clear_finished(&self) {
        let mut book = self.shared.book.lock().unwrap();
        book.transfers
            .retain(|t| matches!(t.state, State::Queued | State::Running));
        let live: Vec<u64> = book.transfers.iter().map(|t| t.id).collect();
        book.cancel.retain(|id, _| live.contains(id));
    }

    /// Block until nothing is queued or running, or the timeout passes.
    pub fn wait_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut book = self.shared.book.lock().unwrap();
        while !book.pending.is_empty() || book.running > 0 {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return false;
            }
            book = self.shared.idle.wait_timeout(book, left).unwrap().0;
        }
        true
    }
}

fn worker(shared: Arc<Shared>) {
    // One connection per site, reused across this worker's jobs.
    let mut conns: HashMap<String, Box<dyn Remote>> = HashMap::new();
    loop {
        let (id, request, cancel) = {
            let mut book = shared.book.lock().unwrap();
            let id = loop {
                if let Some(id) = book.pending.pop_front() {
                    break id;
                }
                book = shared.wake.wait(book).unwrap();
            };
            book.running += 1;
            let cancel = book.cancel.get(&id).cloned().unwrap_or_default();
            let t = book
                .transfers
                .iter_mut()
                .find(|t| t.id == id)
                .expect("queued transfer exists");
            t.state = State::Running;
            t.started = Some(now());
            let snapshot = t.clone();
            drop(book);
            (shared.notify)(&snapshot);
            (id, snapshot.request, cancel)
        };

        let mut reporter = Reporter::new(&shared, id, &cancel);
        let mut result = run_with(&shared, &mut conns, &request, &mut reporter);
        // Retry once on a dropped connection, with a fresh one.
        if matches!(&result, Err(e) if e.is_connection()) && !cancel.load(Ordering::SeqCst) {
            conns.remove(&request.site_id);
            reporter.reset();
            result = run_with(&shared, &mut conns, &request, &mut reporter);
        }
        if result.is_err() {
            // After a failure or cancel the connection may be mid-command.
            conns.remove(&request.site_id);
        }

        let mut book = shared.book.lock().unwrap();
        book.running -= 1;
        if let Some(t) = book.transfers.iter_mut().find(|t| t.id == id) {
            t.finished = Some(now());
            t.current = None;
            t.rate = 0;
            match result {
                Ok(final_path) => {
                    t.state = State::Done;
                    t.result = Some(final_path);
                    t.bytes_done = t.bytes_done.max(t.bytes_total);
                }
                Err(Error::Cancelled) => t.state = State::Cancelled,
                Err(e) => {
                    t.state = if cancel.load(Ordering::SeqCst) {
                        State::Cancelled
                    } else {
                        State::Failed
                    };
                    t.error = Some(e.to_string());
                }
            }
            let snapshot = t.clone();
            drop(book);
            (shared.notify)(&snapshot);
        } else {
            drop(book);
        }
        shared.idle.notify_all();
    }
}

fn run_with(
    shared: &Shared,
    conns: &mut HashMap<String, Box<dyn Remote>>,
    request: &Request,
    reporter: &mut Reporter,
) -> Result<String> {
    if let Some(conn) = conns.get_mut(&request.site_id) {
        if !conn.alive() {
            conns.remove(&request.site_id);
        }
    }
    if !conns.contains_key(&request.site_id) {
        let conn = (shared.connect)(&request.site_id)?;
        conns.insert(request.site_id.clone(), conn);
    }
    let remote = conns
        .get_mut(&request.site_id)
        .expect("just inserted")
        .as_mut();
    run(remote, request, reporter)
}

/// Moves counters into the shared book and tells the window, at most ten
/// times a second.
struct Reporter<'a> {
    shared: &'a Shared,
    id: u64,
    cancel: &'a AtomicBool,
    base: u64,
    last: Instant,
    last_bytes: u64,
    rate: f64,
}

impl<'a> Reporter<'a> {
    fn new(shared: &'a Shared, id: u64, cancel: &'a AtomicBool) -> Self {
        Reporter {
            shared,
            id,
            cancel,
            base: 0,
            last: Instant::now(),
            last_bytes: 0,
            rate: 0.0,
        }
    }

    fn reset(&mut self) {
        self.base = 0;
        self.last_bytes = 0;
        self.update(|t| {
            t.bytes_done = 0;
            t.files_done = 0;
        });
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    fn update(&mut self, f: impl FnOnce(&mut Transfer)) {
        let snapshot = {
            let mut book = self.shared.book.lock().unwrap();
            let Some(t) = book.transfers.iter_mut().find(|t| t.id == self.id) else {
                return;
            };
            f(t);
            t.clone()
        };
        (self.shared.notify)(&snapshot);
    }

    fn plan(&mut self, files: u32, bytes: u64) {
        self.update(|t| {
            t.files_total = files;
            t.bytes_total = bytes;
        });
    }

    fn start_file(&mut self, name: &str) {
        let name = name.to_string();
        self.update(|t| t.current = Some(name));
    }

    /// `n` bytes of the current file are done. False means stop.
    fn bytes(&mut self, n: u64) -> bool {
        if self.cancelled() {
            return false;
        }
        let elapsed = self.last.elapsed();
        if elapsed >= Duration::from_millis(100) {
            let total = self.base + n;
            let instant = (total.saturating_sub(self.last_bytes)) as f64 / elapsed.as_secs_f64();
            self.rate = if self.rate == 0.0 {
                instant
            } else {
                self.rate * 0.7 + instant * 0.3
            };
            self.last = Instant::now();
            self.last_bytes = total;
            let rate = self.rate as u64;
            self.update(|t| {
                t.bytes_done = total;
                t.rate = rate;
            });
        }
        true
    }

    fn file_done(&mut self, size: u64) {
        self.base += size;
        let base = self.base;
        self.update(|t| {
            t.files_done += 1;
            t.bytes_done = base;
        });
    }
}

fn run(remote: &mut dyn Remote, request: &Request, rep: &mut Reporter) -> Result<String> {
    match request.direction {
        Direction::Upload => upload(remote, request, rep),
        Direction::Download => download(remote, request, rep),
    }
}

fn upload(remote: &mut dyn Remote, request: &Request, rep: &mut Reporter) -> Result<String> {
    let source = PathBuf::from(&request.local);
    let meta = fs::metadata(&source)
        .map_err(|e| Error::local(format!("Can't read {}: {e}", source.display())))?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| Error::invalid("Can't upload that"))?;
    let dest = path::join(&request.remote, &name);

    if meta.is_dir() {
        let plan = ops::walk_local(&source)?;
        let files = plan.iter().filter(|(_, _, d)| !d).count() as u32;
        let bytes = plan.iter().map(|(_, s, _)| s).sum();
        rep.plan(files, bytes);
        ops::ensure_dir(remote, &dest)?;
        for (rel, size, is_dir) in plan {
            if rep.cancelled() {
                return Err(Error::Cancelled);
            }
            let target = ops::remote_child(&dest, &rel);
            if is_dir {
                ops::ensure_dir(remote, &target)?;
            } else {
                upload_file(remote, &source.join(&rel), &target, size, rep)?;
            }
        }
    } else {
        rep.plan(1, meta.len());
        upload_file(remote, &source, &dest, meta.len(), rep)?;
    }
    Ok(dest)
}

fn upload_file(
    remote: &mut dyn Remote,
    local: &Path,
    target: &str,
    size: u64,
    rep: &mut Reporter,
) -> Result<()> {
    rep.start_file(&path::name(target));
    let mut file = fs::File::open(local)
        .map_err(|e| Error::local(format!("Can't read {}: {e}", local.display())))?;
    remote.upload(target, &mut file, &mut |n| rep.bytes(n))?;
    rep.file_done(size);
    Ok(())
}

fn download(remote: &mut dyn Remote, request: &Request, rep: &mut Reporter) -> Result<String> {
    let into = PathBuf::from(&request.local);
    fs::create_dir_all(&into)?;
    let name = path::name(&request.remote);
    let dest = ops::unique_local(&into, &name);

    if request.is_dir {
        let mut all = Vec::new();
        ops::walk_remote(remote, &request.remote, &mut all)?;
        let files: Vec<&Entry> = all.iter().filter(|e| !e.is_dir()).collect();
        rep.plan(files.len() as u32, files.iter().map(|e| e.size).sum());
        fs::create_dir_all(&dest)?;
        let prefix = path::normalize(&request.remote);
        for entry in &all {
            if rep.cancelled() {
                return Err(Error::Cancelled);
            }
            let rel = entry
                .path
                .strip_prefix(&prefix)
                .unwrap_or(&entry.name)
                .trim_start_matches('/');
            let target = dest.join(rel);
            if entry.is_dir() {
                fs::create_dir_all(&target)?;
            } else {
                download_file(remote, &entry.path, &target, entry.size, rep)?;
            }
        }
    } else {
        let size = remote.stat(&request.remote).map(|e| e.size).unwrap_or(0);
        rep.plan(1, size);
        download_file(remote, &request.remote, &dest, size, rep)?;
    }
    Ok(dest.to_string_lossy().into_owned())
}

fn download_file(
    remote: &mut dyn Remote,
    source: &str,
    target: &Path,
    size: u64,
    rep: &mut Reporter,
) -> Result<()> {
    rep.start_file(&path::name(source));
    let partial = target.with_file_name(format!(
        "{}.teapdownload",
        target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default()
    ));
    let mut file = fs::File::create(&partial)?;
    let result = remote.download(source, &mut file, &mut |n| rep.bytes(n));
    drop(file);
    match result {
        Ok(_) => {
            fs::rename(&partial, target)?;
            rep.file_done(size);
            Ok(())
        }
        Err(e) => {
            let _ = fs::remove_file(&partial);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::LocalFs;

    fn queue(server: PathBuf) -> (Queue, Arc<Mutex<Vec<Transfer>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        let q = Queue::new(
            2,
            move |site| {
                if site == "down" {
                    Err(Error::connection("unreachable"))
                } else {
                    Ok(Box::new(LocalFs::new(server.clone())) as Box<dyn Remote>)
                }
            },
            move |t| log.lock().unwrap().push(t.clone()),
        );
        (q, seen)
    }

    #[test]
    fn uploads_and_downloads_folders() {
        let base = crate::testutil::temp_dir("transfer");
        let (mac, server) = (base.join("mac"), base.join("server"));
        fs::create_dir_all(mac.join("site/css")).unwrap();
        fs::create_dir_all(&server).unwrap();
        fs::write(mac.join("site/index.html"), "<h1>hi</h1>").unwrap();
        fs::write(mac.join("site/css/app.css"), "body{}").unwrap();
        let (q, seen) = queue(server.clone());

        q.add(
            Request {
                site_id: "s".into(),
                direction: Direction::Upload,
                local: mac.join("site").to_string_lossy().into(),
                remote: "/".into(),
                is_dir: false,
            },
            "Server",
        );
        assert!(q.wait_idle(Duration::from_secs(10)));
        let t = &q.list()[0];
        assert_eq!(t.state, State::Done, "{:?}", t.error);
        assert_eq!((t.files_done, t.files_total), (2, 2));
        assert_eq!(t.bytes_done, 17);
        assert_eq!(t.result.as_deref(), Some("/site"));
        assert_eq!(
            fs::read_to_string(server.join("site/css/app.css")).unwrap(),
            "body{}"
        );

        // Download it back twice: the second copy must not overwrite the first.
        let downloads = base.join("Downloads");
        for _ in 0..2 {
            q.add(
                Request {
                    site_id: "s".into(),
                    direction: Direction::Download,
                    local: downloads.to_string_lossy().into(),
                    remote: "/site".into(),
                    is_dir: true,
                },
                "Server",
            );
            assert!(q.wait_idle(Duration::from_secs(10)));
        }
        assert_eq!(
            fs::read_to_string(downloads.join("site/index.html")).unwrap(),
            "<h1>hi</h1>"
        );
        assert!(downloads.join("site 2/css/app.css").exists());
        assert!(q.list().iter().all(|t| t.state == State::Done));

        // A single file, and no partial file left behind.
        q.add(
            Request {
                site_id: "s".into(),
                direction: Direction::Download,
                local: downloads.to_string_lossy().into(),
                remote: "/site/index.html".into(),
                is_dir: false,
            },
            "Server",
        );
        assert!(q.wait_idle(Duration::from_secs(10)));
        assert!(downloads.join("index.html").exists());
        assert!(!downloads.join("index.html.teapdownload").exists());
        assert!(!seen.lock().unwrap().is_empty());

        q.clear_finished();
        assert!(q.list().is_empty());
    }

    #[test]
    fn reports_failures_and_retries() {
        let base = crate::testutil::temp_dir("transfer-fail");
        let (q, _) = queue(base.clone());
        let t = q.add(
            Request {
                site_id: "down".into(),
                direction: Direction::Download,
                local: base.to_string_lossy().into(),
                remote: "/x".into(),
                is_dir: false,
            },
            "Down",
        );
        assert!(q.wait_idle(Duration::from_secs(10)));
        let failed = &q.list()[0];
        assert_eq!(failed.state, State::Failed);
        assert_eq!(failed.error.as_deref(), Some("unreachable"));
        let again = q.retry(t.id).unwrap();
        assert_ne!(again.id, t.id);
        assert!(q.wait_idle(Duration::from_secs(10)));
        assert_eq!(q.list().len(), 1);

        // A missing file fails with a clear message.
        q.add(
            Request {
                site_id: "s".into(),
                direction: Direction::Upload,
                local: base.join("nope.txt").to_string_lossy().into(),
                remote: "/".into(),
                is_dir: false,
            },
            "S",
        );
        assert!(q.wait_idle(Duration::from_secs(10)));
        assert!(q
            .list()
            .iter()
            .any(|t| t.state == State::Failed
                && t.error.as_deref().unwrap_or("").contains("Can't read")));
    }
}
