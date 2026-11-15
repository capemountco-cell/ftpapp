//! FTP, and FTPS with explicit TLS (AUTH TLS), through suppaftp and rustls.
//!
//! Certificates are checked by the operating system's trust store, so a
//! certificate trusted in Keychain Access works. One it doesn't vouch for
//! (usually self-signed, common on shared hosting) stops with
//! `Error::UntrustedCertificate`; if the user trusts it, its fingerprint is
//! pinned for that host and port only.

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, ClientConfig, DigitallySignedStruct, SignatureScheme};
use suppaftp::list::{File, ListParser, PosixPexQuery};
use suppaftp::types::FileType;
use suppaftp::{FtpError, RustlsConnector, RustlsFtpStream, Status};

use crate::entry::{Entry, Kind};
use crate::error::{Error, Result};
use crate::path;
use crate::remote::{self, Progress, Remote};
use crate::site::{Auth, Protocol, Site};
use crate::trust::{self, Trust};

pub struct Ftp {
    stream: RustlsFtpStream,
    mlsd: bool,
    /// After an aborted transfer, servers differ in how many replies they
    /// send; rather than guess, the connection is replaced.
    dirty: bool,
}

/// A refused login, with the server's own reason when it gives one beyond a
/// bare "530 Login incorrect" (for example that it needs TLS).
fn login_refused(reply: &str) -> Error {
    let base = "The server didn't accept that username and password";
    let reason = reply
        .lines()
        .last()
        .unwrap_or("")
        .trim_start_matches(|c: char| c.is_ascii_digit() || c == '-' || c == ' ')
        .trim()
        .trim_end_matches('.');
    let lower = reason.to_lowercase();
    let generic = reason.is_empty()
        || [
            "login incorrect",
            "login authentication failed",
            "not logged in",
            "authentication failed",
            "login failed",
        ]
        .iter()
        .any(|g| lower == *g);
    Error::Auth {
        message: if generic {
            base.into()
        } else {
            format!("{base}. The server said: \u{201c}{reason}\u{201d}")
        },
    }
}

fn map(e: FtpError, p: &str) -> Error {
    match e {
        FtpError::ConnectionError(io) => Error::connection(io.to_string()),
        FtpError::SecureError(s) => Error::connection(format!("Secure connection failed: {s}")),
        FtpError::UnexpectedResponse(r) => {
            let text = String::from_utf8_lossy(&r.body).trim().to_string();
            // "550 /x: No such file or directory" → "No such file or directory"
            let message = text
                .split_once(' ')
                .map(|(_, rest)| rest.to_string())
                .unwrap_or(text.clone());
            match r.status {
                Status::NotLoggedIn => login_refused(&text),
                Status::NotAvailable => Error::connection(message),
                Status::FileUnavailable
                    if message.to_lowercase().contains("no such")
                        || message.to_lowercase().contains("not found") =>
                {
                    Error::NotFound { path: p.into() }
                }
                _ => Error::remote(message),
            }
        }
        FtpError::BadResponse => Error::connection("The server sent a reply Captain couldn't read"),
        FtpError::InvalidAddress(e) => {
            Error::connection(format!("The server gave a bad address: {e}"))
        }
        FtpError::DataConnectionAlreadyOpen => {
            Error::remote("Another transfer is still running on this connection")
        }
    }
}

/// The OS verifier, with one exception: a certificate whose fingerprint the
/// user pinned. On failure, it records the fingerprint and reason so the
/// interface can ask.
#[derive(Debug)]
struct Pinning {
    system: Arc<dyn ServerCertVerifier>,
    pinned: Option<String>,
    failure: Arc<Mutex<Option<(String, String)>>>,
    provider: Arc<CryptoProvider>,
}

fn fingerprint(cert: &CertificateDer<'_>) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, cert.as_ref());
    trust::hex_colons(digest.as_ref())
}

fn describe(e: &rustls::Error) -> String {
    match e {
        rustls::Error::InvalidCertificate(c) => match c {
            CertificateError::UnknownIssuer => {
                "it's self-signed, or signed by an authority this Mac doesn't know".into()
            }
            CertificateError::Expired | CertificateError::ExpiredContext { .. } => {
                "it has expired".into()
            }
            CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. } => {
                "it was issued for a different server name".into()
            }
            CertificateError::Revoked => "it has been revoked".into(),
            other => {
                let text = format!("{other:?}");
                if text.contains("CaUsedAsEndEntity") || text.contains("SelfSigned") {
                    "it's self-signed".into()
                } else {
                    "this Mac doesn't trust it".into()
                }
            }
        },
        other => other.to_string(),
    }
}

impl ServerCertVerifier for Pinning {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        let fp = fingerprint(end_entity);
        if self.pinned.as_deref() == Some(fp.as_str()) {
            return Ok(ServerCertVerified::assertion());
        }
        self.system
            .verify_server_cert(end_entity, intermediates, server_name, ocsp, now)
            .inspect_err(|e| {
                let mut reason = describe(e);
                if self.pinned.is_some() {
                    reason = format!("{reason}, and it's not the certificate you trusted before");
                }
                *self.failure.lock().unwrap() = Some((fp, reason));
            })
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

impl Ftp {
    pub fn connect(site: &Site, secret: Option<&str>, trust: &Trust) -> Result<Self> {
        let tcp = remote::tcp(&site.host, site.port)?;
        let mut stream = RustlsFtpStream::connect_with_stream(tcp).map_err(|e| match e {
            FtpError::ConnectionError(_) | FtpError::BadResponse => Error::connection(format!(
                "{} isn't answering like an FTP server on port {}",
                site.host, site.port
            )),
            other => map(other, ""),
        })?;
        // Servers behind NAT often announce a private address for passive
        // mode; connect to the address we already reached instead.
        stream.set_passive_nat_workaround(true);

        if site.protocol == Protocol::Ftps {
            let provider = Arc::new(rustls::crypto::ring::default_provider());
            let failure = Arc::new(Mutex::new(None));
            let system =
                rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|e| {
                    Error::connection(format!("Couldn't load the system's certificates: {e}"))
                })?;
            let verifier = Pinning {
                system: Arc::new(system),
                pinned: trust.pinned(trust::Kind::Tls, &site.host, site.port),
                failure: failure.clone(),
                provider: provider.clone(),
            };
            let config = ClientConfig::builder_with_provider(provider)
                .with_safe_default_protocol_versions()
                .map_err(|e| Error::connection(e.to_string()))?
                .dangerous()
                .with_custom_certificate_verifier(Arc::new(verifier))
                .with_no_client_auth();
            stream = stream
                .into_secure(RustlsConnector::from(Arc::new(config)), &site.host)
                .map_err(|e| {
                    if let Some((fingerprint, reason)) = failure.lock().unwrap().take() {
                        return Error::UntrustedCertificate {
                            host: site.host.clone(),
                            fingerprint,
                            reason,
                        };
                    }
                    match e {
                        FtpError::UnexpectedResponse(_) => Error::connection(
                            "This server doesn't support FTPS. Edit the site and choose FTP if you're sure the network is private",
                        ),
                        other => map(other, ""),
                    }
                })?;
        }

        let (user, pass) = match site.auth {
            Auth::Anonymous => ("anonymous".to_string(), "captain@".to_string()),
            _ => (site.user.clone(), secret.unwrap_or("").to_string()),
        };
        stream
            .login(user.as_str(), pass.as_str())
            .map_err(|e| match e {
                FtpError::UnexpectedResponse(r) if r.status == Status::NotLoggedIn => {
                    login_refused(String::from_utf8_lossy(&r.body).trim())
                }
                other => map(other, ""),
            })?;
        stream
            .transfer_type(FileType::Binary)
            .map_err(|e| map(e, ""))?;
        let mlsd = stream
            .feat()
            .map(|f| {
                f.keys()
                    .any(|k| k.eq_ignore_ascii_case("MLSD") || k.eq_ignore_ascii_case("MLST"))
            })
            .unwrap_or(false);
        Ok(Ftp {
            stream,
            mlsd,
            dirty: false,
        })
    }
}

fn perms(f: &File) -> String {
    let mut s = String::with_capacity(9);
    for who in [
        PosixPexQuery::Owner,
        PosixPexQuery::Group,
        PosixPexQuery::Others,
    ] {
        s.push(if f.can_read(who) { 'r' } else { '-' });
        s.push(if f.can_write(who) { 'w' } else { '-' });
        s.push(if f.can_execute(who) { 'x' } else { '-' });
    }
    s
}

/// One line of a listing in whichever format the server uses.
pub fn parse_line(dir: &str, line: &str, mlsx: bool) -> Option<Entry> {
    let file = if mlsx {
        ListParser::parse_mlsd(line).ok()?
    } else {
        ListParser::parse_posix(line)
            .or_else(|_| ListParser::parse_dos(line))
            .ok()?
    };
    let name = file.name().to_string();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }
    // A link's target type is unknown without another round trip; a target
    // without an extension is most often a folder ("public_html -> www").
    let link = file.is_symlink();
    let dir_like = file.is_directory()
        || (link
            && file
                .symlink()
                .map(|t| !path::name(&t.to_string_lossy()).contains('.'))
                .unwrap_or(false));
    let modified = file
        .modified()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
        .filter(|s| *s > 0);
    let permissions = if mlsx && perms(&file) == "---------" {
        None
    } else {
        Some(perms(&file))
    };
    Some(Entry {
        path: path::join(dir, &name),
        name,
        kind: if dir_like { Kind::Dir } else { Kind::File },
        link,
        size: if dir_like { 0 } else { file.size() as u64 },
        modified,
        permissions,
    })
}

fn io_map(e: std::io::Error) -> Error {
    if remote::is_cancel(&e) {
        Error::Cancelled
    } else {
        Error::connection(e.to_string())
    }
}

impl Remote for Ftp {
    fn home(&mut self) -> Result<String> {
        self.ready()?;
        let p = self.stream.pwd().map_err(|e| map(e, ""))?;
        Ok(path::normalize(if p.is_empty() { "/" } else { &p }))
    }

    fn list(&mut self, dir: &str) -> Result<Vec<Entry>> {
        self.ready()?;
        // Change into the folder first: LIST with a path that has spaces is
        // handled inconsistently, CWD is not.
        self.stream.cwd(dir).map_err(|e| map(e, dir))?;
        let (lines, mlsx) = if self.mlsd {
            match self.stream.mlsd(None) {
                Ok(l) => (l, true),
                Err(_) => (self.posix_list()?, false),
            }
        } else {
            (self.posix_list()?, false)
        };
        Ok(lines
            .iter()
            .filter_map(|l| parse_line(dir, l, mlsx))
            .collect())
    }

    fn mkdir(&mut self, p: &str) -> Result<()> {
        self.ready()?;
        self.stream.mkdir(p).map_err(|e| map(e, p))
    }

    fn rename(&mut self, from: &str, to: &str) -> Result<()> {
        self.ready()?;
        self.stream.rename(from, to).map_err(|e| map(e, from))
    }

    fn remove_file(&mut self, p: &str) -> Result<()> {
        self.ready()?;
        self.stream.rm(p).map_err(|e| map(e, p))
    }

    fn remove_dir(&mut self, p: &str) -> Result<()> {
        self.ready()?;
        self.stream.rmdir(p).map_err(|e| map(e, p))
    }

    fn chmod(&mut self, p: &str, mode: u32) -> Result<()> {
        self.ready()?;
        self.stream
            .site(format!("CHMOD {mode:o} {p}"))
            .map(|_| ())
            .map_err(|e| map(e, p))
    }

    fn download(&mut self, p: &str, out: &mut dyn Write, progress: Progress) -> Result<u64> {
        self.ready()?;
        let mut data = self.stream.retr_as_stream(p).map_err(|e| map(e, p))?;
        match remote::copy(&mut data, out, progress) {
            Ok(n) => {
                data.finish().map_err(|e| map(e, p))?;
                Ok(n)
            }
            Err(e) => {
                let _ = self.stream.abort(data);
                self.dirty = true;
                Err(io_map(e))
            }
        }
    }

    fn upload(&mut self, p: &str, input: &mut dyn Read, progress: Progress) -> Result<u64> {
        self.ready()?;
        let mut data = self.stream.put_with_stream(p).map_err(|e| map(e, p))?;
        match remote::copy(input, &mut data, progress) {
            Ok(n) => {
                data.finish().map_err(|e| map(e, p))?;
                Ok(n)
            }
            Err(e) => {
                let _ = self.stream.abort(data);
                self.dirty = true;
                Err(io_map(e))
            }
        }
    }

    fn alive(&mut self) -> bool {
        !self.dirty && self.stream.noop().is_ok()
    }
}

impl Ftp {
    fn ready(&self) -> Result<()> {
        if self.dirty {
            Err(Error::connection(
                "The connection was reset after a stopped transfer",
            ))
        } else {
            Ok(())
        }
    }

    /// LIST -a shows dotfiles (.htaccess) on the servers that support it;
    /// plain LIST for the ones that don't.
    fn posix_list(&mut self) -> Result<Vec<String>> {
        match self.stream.list(Some("-a")) {
            Ok(l) if !l.is_empty() => Ok(l),
            _ => self.stream.list(None).map_err(|e| map(e, "")),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn login_refusal_keeps_the_server_reason() {
        let msg = |r: &str| match super::login_refused(r) {
            crate::error::Error::Auth { message } => message,
            _ => unreachable!(),
        };
        assert_eq!(
            msg("530 Login incorrect."),
            "The server didn't accept that username and password"
        );
        assert_eq!(
            msg("530 "),
            "The server didn't accept that username and password"
        );
        assert!(msg("530 TLS is required for this user")
            .ends_with("\u{201c}TLS is required for this user\u{201d}"));
    }

    use super::*;

    #[test]
    fn parses_unix_listing() {
        let e = parse_line(
            "/www",
            "-rw-r--r--    1 1000     1000         1234 Mar 04 12:00 index.html",
            false,
        )
        .unwrap();
        assert_eq!(
            (e.name.as_str(), e.path.as_str(), e.kind, e.size),
            ("index.html", "/www/index.html", Kind::File, 1234)
        );
        assert_eq!(e.permissions.as_deref(), Some("rw-r--r--"));
        let d = parse_line(
            "/",
            "drwxr-xr-x    2 1000     1000         4096 Jan 01  2024 my site",
            false,
        )
        .unwrap();
        assert_eq!((d.name.as_str(), d.kind), ("my site", Kind::Dir));
        assert!(parse_line("/", "drwxr-xr-x    2 0 0 4096 Jan 01  2024 ..", false).is_none());
    }

    #[test]
    fn parses_links_and_dos() {
        let l = parse_line(
            "/",
            "lrwxrwxrwx 1 0 0 3 Jan 01 2024 public_html -> www",
            false,
        )
        .unwrap();
        assert!(l.link);
        assert_eq!(l.kind, Kind::Dir);
        let f = parse_line(
            "/",
            "01-16-24  02:15PM                 1024 notes.txt",
            false,
        )
        .unwrap();
        assert_eq!((f.name.as_str(), f.size), ("notes.txt", 1024));
        let d = parse_line("/", "01-16-24  02:15PM       <DIR>          Backups", false).unwrap();
        assert_eq!(d.kind, Kind::Dir);
    }

    #[test]
    fn parses_mlsd() {
        let e = parse_line(
            "/",
            "type=file;size=42;modify=20240304120000;perm=r; a b.txt",
            true,
        )
        .unwrap();
        assert_eq!(
            (e.name.as_str(), e.size, e.kind),
            ("a b.txt", 42, Kind::File)
        );
        assert!(e.modified.is_some());
        let d = parse_line("/", "type=dir;modify=20240304120000; logs", true).unwrap();
        assert_eq!(d.kind, Kind::Dir);
        assert!(parse_line("/", "type=cdir; .", true).is_none());
    }
}
