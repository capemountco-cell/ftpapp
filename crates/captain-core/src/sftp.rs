//! SFTP over SSH, through libssh2.
//!
//! The server's host key is checked before any credential is sent: against
//! ~/.ssh/known_hosts first, then against keys trusted in Captain. An unknown
//! key stops with `Error::UnknownHost` so the user can decide; a changed key
//! stops with `Error::HostKeyChanged`, which the interface never bypasses.

use std::io::{Read, Write};
use std::path::Path;

use ssh2::{
    CheckResult, ErrorCode, HashType, HostKeyType, KeyboardInteractivePrompt, KnownHostFileKind,
    Prompt, Session,
};

use crate::entry::{self, Entry, Kind};
use crate::error::{Error, Result};
use crate::path;
use crate::remote::{self, Progress, Remote};
use crate::site::{Auth, Site};
use crate::trust::{self, Check, Trust};

pub struct Sftp {
    // Keep the session alive as long as the channel.
    session: Session,
    sftp: ssh2::Sftp,
}

// libssh2's SFTP status codes (LIBSSH2_FX_*).
const FX_NO_SUCH_FILE: i32 = 2;
const FX_PERMISSION_DENIED: i32 = 3;
const FX_FAILURE: i32 = 4;
// libssh2's session error for refused credentials.
const ERROR_AUTHENTICATION_FAILED: i32 = -18;
const ERROR_PUBLICKEY_UNVERIFIED: i32 = -19;

fn map(e: ssh2::Error, path: &str) -> Error {
    match e.code() {
        ErrorCode::SFTP(FX_NO_SUCH_FILE) => Error::NotFound { path: path.into() },
        ErrorCode::SFTP(FX_PERMISSION_DENIED) => {
            Error::remote(format!("You don't have permission to change {path}"))
        }
        ErrorCode::SFTP(FX_FAILURE) => Error::remote(format!("The server couldn't do that to {path}. It may already exist, or a folder may not be empty")),
        ErrorCode::SFTP(_) => Error::remote(e.message().to_string()),
        ErrorCode::Session(ERROR_AUTHENTICATION_FAILED | ERROR_PUBLICKEY_UNVERIFIED) => Error::Auth {
            message: "The server didn't accept those credentials".into(),
        },
        ErrorCode::Session(_) => Error::connection(e.message().to_string()),
    }
}

fn key_type(t: HostKeyType) -> &'static str {
    match t {
        HostKeyType::Rsa => "RSA",
        HostKeyType::Dss => "DSA",
        HostKeyType::Ecdsa256 | HostKeyType::Ecdsa384 | HostKeyType::Ecdsa521 => "ECDSA",
        HostKeyType::Ed25519 => "ED25519",
        _ => "unknown",
    }
}

/// An FTP server greets first with "220 ...", where an SSH server sends
/// "SSH-2.0-...". Peeking at that greeting turns a 30-second wait for SSH into
/// a clear "this is an FTP server" straight away.
fn refuse_ftp_greeting(tcp: &std::net::TcpStream, site: &Site) -> Result<()> {
    let mut buf = [0u8; 8];
    let _ = tcp.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let n = tcp.peek(&mut buf).unwrap_or(0);
    let _ = tcp.set_read_timeout(None);
    if looks_like_ftp(&buf[..n]) {
        return Err(Error::connection(format!(
            "{} is an FTP server on port {}, not SFTP. Edit the site and choose FTP with TLS, or FTP",
            site.host, site.port
        )));
    }
    Ok(())
}

fn looks_like_ftp(greeting: &[u8]) -> bool {
    greeting.starts_with(b"220") || greeting.starts_with(b"120") || greeting.starts_with(b"421")
}

/// Answers every keyboard-interactive prompt with the password: what servers
/// that disable plain "password" auth ask for, nine times out of ten.
struct PasswordPrompt<'a>(&'a str);

impl KeyboardInteractivePrompt for PasswordPrompt<'_> {
    fn prompt<'b>(
        &mut self,
        _user: &str,
        _instructions: &str,
        prompts: &[Prompt<'b>],
    ) -> Vec<String> {
        prompts.iter().map(|_| self.0.to_string()).collect()
    }
}

impl Sftp {
    pub fn connect(site: &Site, secret: Option<&str>, trust: &Trust) -> Result<Self> {
        let tcp = remote::tcp(&site.host, site.port)?;
        refuse_ftp_greeting(&tcp, site)?;
        let mut session = Session::new().map_err(|e| map(e, ""))?;
        session.set_tcp_stream(tcp);
        session.set_timeout(30_000);
        session.handshake().map_err(|e| {
            Error::connection(format!(
                "{} isn't speaking SSH on port {} ({})",
                site.host,
                site.port,
                e.message()
            ))
        })?;

        verify_host(&session, site, trust)?;
        authenticate(&session, site, secret)?;

        let sftp = session.sftp().map_err(|e| {
            Error::remote(format!(
                "Logged in, but the server doesn't offer SFTP ({})",
                e.message()
            ))
        })?;
        Ok(Sftp { session, sftp })
    }
}

/// The key's SHA-256 fingerprint, as `ssh-keygen -l` prints it.
fn fingerprint(session: &Session) -> Result<(String, &'static str, Vec<u8>)> {
    let (key, kind) = session
        .host_key()
        .ok_or_else(|| Error::connection("The server sent no host key"))?;
    let hash = session
        .host_key_hash(HashType::Sha256)
        .ok_or_else(|| Error::connection("Couldn't fingerprint the host key"))?;
    Ok((
        format!("SHA256:{}", trust::base64(hash)),
        key_type(kind),
        key.to_vec(),
    ))
}

fn verify_host(session: &Session, site: &Site, trust: &Trust) -> Result<()> {
    let (fp, kind, key) = fingerprint(session)?;
    let host = if site.port == 22 {
        site.host.clone()
    } else {
        format!("[{}]:{}", site.host, site.port)
    };

    if let (Ok(mut known), Some(home)) = (session.known_hosts(), std::env::var_os("HOME")) {
        let file = Path::new(&home).join(".ssh/known_hosts");
        if file.exists() && known.read_file(&file, KnownHostFileKind::OpenSSH).is_ok() {
            match known.check_port(&site.host, site.port, &key) {
                CheckResult::Match => return Ok(()),
                CheckResult::Mismatch => {
                    return Err(Error::HostKeyChanged {
                        host,
                        fingerprint: fp,
                        expected: "the key in ~/.ssh/known_hosts".into(),
                    })
                }
                CheckResult::NotFound | CheckResult::Failure => {}
            }
        }
    }

    match trust.check(trust::Kind::Ssh, &site.host, site.port, &fp) {
        Check::Trusted => Ok(()),
        Check::Unknown => Err(Error::UnknownHost {
            host,
            key_type: kind.into(),
            fingerprint: fp,
        }),
        Check::Changed { expected } => Err(Error::HostKeyChanged {
            host,
            fingerprint: fp,
            expected,
        }),
    }
}

fn authenticate(session: &Session, site: &Site, secret: Option<&str>) -> Result<()> {
    let refused = |what: &str| Error::Auth {
        message: format!("The server didn't accept {what}"),
    };
    match &site.auth {
        Auth::Password => {
            let pw = secret.unwrap_or("");
            let methods = session.auth_methods(&site.user).unwrap_or("password");
            if methods.contains("password") && session.userauth_password(&site.user, pw).is_ok() {
                return Ok(());
            }
            if methods.contains("keyboard-interactive") {
                let _ = session.userauth_keyboard_interactive(&site.user, &mut PasswordPrompt(pw));
                if session.authenticated() {
                    return Ok(());
                }
            }
            if !methods.contains("password") && !methods.contains("keyboard-interactive") {
                return Err(Error::Auth {
                    message: "This server only accepts SSH keys. Edit the site to use a key".into(),
                });
            }
            Err(refused("that username and password"))
        }
        Auth::Key { path } => {
            let path = expand_home(path);
            if !Path::new(&path).exists() {
                return Err(Error::invalid(format!("There's no key file at {path}")));
            }
            session
                .userauth_pubkey_file(&site.user, None, Path::new(&path), secret.filter(|s| !s.is_empty()))
                .map_err(|e| match e.code() {
                    ErrorCode::Session(-16) => Error::Auth {
                        message: "Couldn't open the key. If it has a passphrase, enter it in the site's settings".into(),
                    },
                    _ => refused("that key"),
                })
        }
        Auth::Agent => session
            .userauth_agent(&site.user)
            .map_err(|_| refused("any key in ssh-agent")),
        Auth::Anonymous => Err(Error::invalid("SFTP needs a username")),
    }
}

/// "~/.ssh/id_ed25519" → "/Users/me/.ssh/id_ed25519".
pub fn expand_home(p: &str) -> String {
    match (p.strip_prefix("~/"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}/{rest}"),
        _ => p.to_string(),
    }
}

fn to_entry(dir: &str, name: &str, stat: &ssh2::FileStat) -> Entry {
    Entry {
        name: name.to_string(),
        path: path::join(dir, name),
        kind: if stat.is_dir() { Kind::Dir } else { Kind::File },
        link: false,
        size: if stat.is_dir() {
            0
        } else {
            stat.size.unwrap_or(0)
        },
        modified: stat.mtime.map(|t| t as i64),
        permissions: stat.perm.map(entry::permissions),
    }
}

fn io_map(e: std::io::Error) -> Error {
    if remote::is_cancel(&e) {
        Error::Cancelled
    } else {
        Error::connection(e.to_string())
    }
}

impl Remote for Sftp {
    fn home(&mut self) -> Result<String> {
        let p = self
            .sftp
            .realpath(Path::new("."))
            .map_err(|e| map(e, "."))?;
        Ok(path::normalize(&p.to_string_lossy()))
    }

    fn list(&mut self, dir: &str) -> Result<Vec<Entry>> {
        let items = self.sftp.readdir(Path::new(dir)).map_err(|e| map(e, dir))?;
        let mut out = Vec::with_capacity(items.len());
        for (p, stat) in items {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            let mut e = to_entry(dir, &name, &stat);
            // readdir reports links themselves; show what they point to.
            if stat.file_type().is_symlink() {
                e.link = true;
                if let Ok(target) = self.sftp.stat(Path::new(&e.path)) {
                    e.kind = if target.is_dir() {
                        Kind::Dir
                    } else {
                        Kind::File
                    };
                    e.size = if target.is_dir() {
                        0
                    } else {
                        target.size.unwrap_or(0)
                    };
                }
            }
            out.push(e);
        }
        Ok(out)
    }

    fn stat(&mut self, target: &str) -> Result<Entry> {
        let target = path::normalize(target);
        let stat = self
            .sftp
            .stat(Path::new(&target))
            .map_err(|e| map(e, &target))?;
        let dir = path::parent(&target).unwrap_or_else(|| "/".into());
        Ok(Entry {
            path: target.clone(),
            ..to_entry(&dir, &path::name(&target), &stat)
        })
    }

    fn mkdir(&mut self, p: &str) -> Result<()> {
        self.sftp.mkdir(Path::new(p), 0o755).map_err(|e| map(e, p))
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        self.sftp
            .rename(
                Path::new(from),
                Path::new(to),
                Some(ssh2::RenameFlags::empty()),
            )
            .or_else(|_| self.sftp.rename(Path::new(from), Path::new(to), None))
            .map_err(|e| map(e, from))
    }

    fn remove_file(&mut self, p: &str) -> Result<()> {
        self.sftp.unlink(Path::new(p)).map_err(|e| map(e, p))
    }

    fn remove_dir(&mut self, p: &str) -> Result<()> {
        self.sftp.rmdir(Path::new(p)).map_err(|e| map(e, p))
    }

    fn chmod(&mut self, p: &str, mode: u32) -> Result<()> {
        let stat = ssh2::FileStat {
            size: None,
            uid: None,
            gid: None,
            perm: Some(mode),
            atime: None,
            mtime: None,
        };
        self.sftp.setstat(Path::new(p), stat).map_err(|e| map(e, p))
    }

    fn download(&mut self, p: &str, out: &mut dyn Write, progress: Progress) -> Result<u64> {
        let mut file = self.sftp.open(Path::new(p)).map_err(|e| map(e, p))?;
        remote::copy(&mut file, out, progress).map_err(io_map)
    }

    fn upload(&mut self, p: &str, input: &mut dyn Read, progress: Progress) -> Result<u64> {
        let mut file = self.sftp.create(Path::new(p)).map_err(|e| map(e, p))?;
        let n = remote::copy(input, &mut file, progress).map_err(io_map)?;
        file.close().map_err(|e| map(e, p))?;
        Ok(n)
    }

    fn alive(&mut self) -> bool {
        self.session.keepalive_send().is_ok() && self.sftp.realpath(Path::new(".")).is_ok()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn spots_an_ftp_greeting() {
        assert!(super::looks_like_ftp(b"220 Welc"));
        assert!(!super::looks_like_ftp(b"SSH-2.0-"));
        assert!(!super::looks_like_ftp(b""));
    }
}
