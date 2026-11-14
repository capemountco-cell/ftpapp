//! What a connection can do, whatever the protocol. SFTP, FTP and the local
//! disk (used by tests) all implement `Remote`, so browsing and transfers are
//! written once.

use std::io::{Read, Write};

use crate::entry::{self, Entry, Kind};
use crate::error::{Error, Result};
use crate::path;
use crate::site::{Protocol, Site};
use crate::trust::Trust;

/// Called with the bytes moved so far in this file; return `false` to stop.
pub type Progress<'a> = &'a mut dyn FnMut(u64) -> bool;

pub trait Remote: Send {
    /// The folder the server puts you in after logging in.
    fn home(&mut self) -> Result<String>;
    /// The folder's contents, unsorted, without "." and "..".
    fn list(&mut self, dir: &str) -> Result<Vec<Entry>>;
    fn mkdir(&mut self, path: &str) -> Result<()>;
    fn rename(&mut self, from: &str, to: &str) -> Result<()>;
    fn remove_file(&mut self, path: &str) -> Result<()>;
    /// Remove an empty folder. See `ops::remove_all` for full ones.
    fn remove_dir(&mut self, path: &str) -> Result<()>;
    fn chmod(&mut self, path: &str, mode: u32) -> Result<()>;
    /// Stream a file from the server into `out`.
    fn download(&mut self, path: &str, out: &mut dyn Write, progress: Progress) -> Result<u64>;
    /// Stream `input` to a file on the server, replacing it.
    fn upload(&mut self, path: &str, input: &mut dyn Read, progress: Progress) -> Result<u64>;
    /// Still connected? Cheap: a no-op round trip.
    fn alive(&mut self) -> bool;

    /// One file or folder's details. The default looks it up in its parent,
    /// which every server supports.
    fn stat(&mut self, target: &str) -> Result<Entry> {
        let target = path::normalize(target);
        let Some(parent) = path::parent(&target) else {
            return Ok(Entry {
                name: "/".into(),
                path: "/".into(),
                kind: Kind::Dir,
                link: false,
                size: 0,
                modified: None,
                permissions: None,
            });
        };
        let name = path::name(&target);
        self.list(&parent)?
            .into_iter()
            .find(|e| e.name == name)
            .ok_or(Error::NotFound { path: target })
    }
}

/// Copy with a 256 KiB buffer, reporting after every chunk.
pub fn copy(input: &mut dyn Read, out: &mut dyn Write, progress: Progress) -> std::io::Result<u64> {
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = match input.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        out.write_all(&buf[..n])?;
        total += n as u64;
        if !progress(total) {
            return Err(std::io::Error::other(CANCELLED));
        }
    }
    out.flush()?;
    Ok(total)
}

/// The message `copy` fails with when the progress callback says stop.
pub const CANCELLED: &str = "captain: cancelled";

pub fn is_cancel(e: &std::io::Error) -> bool {
    e.to_string() == CANCELLED
}

/// What a connection needs besides the site: its secret (password or key
/// passphrase), and the trust store for host keys and certificates.
pub fn connect(site: &Site, secret: Option<&str>, trust: &Trust) -> Result<Box<dyn Remote>> {
    match site.protocol {
        Protocol::Sftp => Ok(Box::new(crate::sftp::Sftp::connect(site, secret, trust)?)),
        Protocol::Ftp | Protocol::Ftps => {
            Ok(Box::new(crate::ftp::Ftp::connect(site, secret, trust)?))
        }
    }
}

/// Resolve "host:port" with a timeout on each address, so an unreachable
/// server fails in seconds, not minutes.
pub fn tcp(host: &str, port: u16) -> Result<std::net::TcpStream> {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|_| Error::connection(format!("Can't find a server called {host}")))?
        .collect();
    let mut last = None;
    for addr in addrs {
        match TcpStream::connect_timeout(&addr, Duration::from_secs(15)) {
            Ok(s) => {
                let _ = s.set_nodelay(true);
                let _ = s.set_read_timeout(Some(Duration::from_secs(60)));
                let _ = s.set_write_timeout(Some(Duration::from_secs(60)));
                return Ok(s);
            }
            Err(e) => last = Some(e),
        }
    }
    Err(match last {
        Some(e) if e.kind() == std::io::ErrorKind::TimedOut => {
            Error::connection(format!("{host} didn't answer on port {port}"))
        }
        Some(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {
            Error::connection(format!("{host} refused the connection on port {port}"))
        }
        Some(e) => Error::connection(format!("Couldn't reach {host}: {e}")),
        None => Error::connection(format!("Can't find a server called {host}")),
    })
}

/// The local disk behind the same interface, rooted at a folder: paths are
/// "/" relative to `root`. Tests use it as a server; it never escapes `root`.
pub struct LocalFs {
    root: std::path::PathBuf,
}

impl LocalFs {
    pub fn new(root: impl Into<std::path::PathBuf>) -> Self {
        LocalFs { root: root.into() }
    }
    fn real(&self, p: &str) -> std::path::PathBuf {
        let p = path::normalize(&format!("/{p}"));
        self.root.join(p.trim_start_matches('/'))
    }
}

fn io_err(e: std::io::Error, p: &str) -> Error {
    match e.kind() {
        std::io::ErrorKind::NotFound => Error::NotFound { path: p.into() },
        _ => Error::remote(e.to_string()),
    }
}

impl Remote for LocalFs {
    fn home(&mut self) -> Result<String> {
        Ok("/".into())
    }
    fn list(&mut self, dir: &str) -> Result<Vec<Entry>> {
        let mut out = Vec::new();
        for item in std::fs::read_dir(self.real(dir)).map_err(|e| io_err(e, dir))? {
            let item = item?;
            out.push(local_entry(
                &item.path(),
                &path::join(dir, &item.file_name().to_string_lossy()),
            )?);
        }
        Ok(out)
    }
    fn mkdir(&mut self, p: &str) -> Result<()> {
        std::fs::create_dir(self.real(p)).map_err(|e| io_err(e, p))
    }
    fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        std::fs::rename(self.real(from), self.real(to)).map_err(|e| io_err(e, from))
    }
    fn remove_file(&mut self, p: &str) -> Result<()> {
        std::fs::remove_file(self.real(p)).map_err(|e| io_err(e, p))
    }
    fn remove_dir(&mut self, p: &str) -> Result<()> {
        std::fs::remove_dir(self.real(p)).map_err(|e| io_err(e, p))
    }
    fn chmod(&mut self, p: &str, mode: u32) -> Result<()> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(self.real(p), std::fs::Permissions::from_mode(mode))
                .map_err(|e| io_err(e, p))
        }
        #[cfg(not(unix))]
        {
            let _ = (p, mode);
            Ok(())
        }
    }
    fn download(&mut self, p: &str, out: &mut dyn Write, progress: Progress) -> Result<u64> {
        let mut f = std::fs::File::open(self.real(p)).map_err(|e| io_err(e, p))?;
        copy(&mut f, out, progress).map_err(|e| {
            if is_cancel(&e) {
                Error::Cancelled
            } else {
                e.into()
            }
        })
    }
    fn upload(&mut self, p: &str, input: &mut dyn Read, progress: Progress) -> Result<u64> {
        let mut f = std::fs::File::create(self.real(p)).map_err(|e| io_err(e, p))?;
        copy(input, &mut f, progress).map_err(|e| {
            if is_cancel(&e) {
                Error::Cancelled
            } else {
                e.into()
            }
        })
    }
    fn alive(&mut self) -> bool {
        self.root.exists()
    }
}

/// An `Entry` for a file on this Mac. `display` is the path to report.
pub fn local_entry(real: &std::path::Path, display: &str) -> Result<Entry> {
    let link = std::fs::symlink_metadata(real)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);
    // Follow links; a broken one is shown as a plain file.
    let meta = std::fs::metadata(real).or_else(|_| std::fs::symlink_metadata(real))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    #[cfg(unix)]
    let permissions = {
        use std::os::unix::fs::PermissionsExt;
        Some(entry::permissions(meta.permissions().mode()))
    };
    #[cfg(not(unix))]
    let permissions = None;
    Ok(Entry {
        name: real
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "/".into()),
        path: display.to_string(),
        kind: if meta.is_dir() { Kind::Dir } else { Kind::File },
        link,
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified,
        permissions,
    })
}
