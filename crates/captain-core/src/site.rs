//! Saved connections. Stored as JSON in Application Support; passwords are
//! never in this file (see `secret`).

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Protocol {
    Sftp,
    Ftp,
    /// FTP with explicit TLS (AUTH TLS), the kind hosting companies offer.
    Ftps,
}

impl Protocol {
    pub fn default_port(self) -> u16 {
        match self {
            Protocol::Sftp => 22,
            Protocol::Ftp | Protocol::Ftps => 21,
        }
    }
    pub fn scheme(self) -> &'static str {
        match self {
            Protocol::Sftp => "sftp",
            Protocol::Ftp => "ftp",
            Protocol::Ftps => "ftps",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Auth {
    /// The password lives in the keychain under the site's id.
    Password,
    /// A private key file; its passphrase, if any, is in the keychain.
    Key { path: String },
    /// Keys loaded in ssh-agent.
    Agent,
    /// FTP's anonymous login.
    Anonymous,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub id: String,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: Auth,
    /// Where to start on the server; the login folder if empty.
    #[serde(default)]
    pub remote_path: String,
    /// The folder on this Mac that downloads go to; ~/Downloads if empty.
    #[serde(default)]
    pub local_path: String,
    /// One of the sidebar's colour names.
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub bookmarks: Vec<Bookmark>,
    /// Seconds since 1970 of the last successful connection.
    #[serde(default)]
    pub last_used: Option<i64>,
}

fn default_color() -> String {
    "indigo".into()
}

pub const COLORS: &[&str] = &[
    "indigo", "blue", "teal", "green", "yellow", "orange", "red", "pink", "gray",
];

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A short unique id: time plus a counter, no randomness library needed.
pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("s{:x}{:x}", nanos, n)
}

/// Tidy what the user typed and fill sensible defaults, or say what's wrong.
pub fn normalize(mut site: Site) -> Result<Site> {
    site.host = site.host.trim().to_string();
    // People paste "sftp://example.com" or "example.com/" into the host field.
    if let Some(rest) = site.host.split_once("://").map(|(_, r)| r.to_string()) {
        site.host = rest;
    }
    site.host = site.host.trim_end_matches('/').to_string();
    if site.host.is_empty() {
        return Err(Error::invalid("Enter the server's address"));
    }
    if site.host.contains(char::is_whitespace) || site.host.contains('/') {
        return Err(Error::invalid(
            "The server address can't contain spaces or “/”",
        ));
    }
    site.user = site.user.trim().to_string();
    if site.user.is_empty() && site.auth != Auth::Anonymous {
        if site.protocol == Protocol::Sftp {
            return Err(Error::invalid("Enter a username"));
        }
        site.auth = Auth::Anonymous;
    }
    if site.auth == Auth::Anonymous && site.protocol == Protocol::Sftp {
        return Err(Error::invalid("SFTP needs a username"));
    }
    if matches!(site.auth, Auth::Agent | Auth::Key { .. }) && site.protocol != Protocol::Sftp {
        return Err(Error::invalid("Keys only work with SFTP"));
    }
    if let Auth::Key { path } = &site.auth {
        if path.trim().is_empty() {
            return Err(Error::invalid("Choose a private key file"));
        }
    }
    if site.port == 0 {
        site.port = site.protocol.default_port();
    }
    site.name = site.name.trim().to_string();
    if site.name.is_empty() {
        site.name = site.host.clone();
    }
    site.remote_path = site.remote_path.trim().to_string();
    if !site.remote_path.is_empty() {
        site.remote_path = path::normalize(&site.remote_path);
    }
    site.local_path = site.local_path.trim().to_string();
    if !COLORS.contains(&site.color.as_str()) {
        site.color = default_color();
    }
    if site.id.trim().is_empty() {
        site.id = new_id();
    }
    Ok(site)
}

/// "sftp://deploy@example.com:2222/var/www" → a site ready to connect. The
/// password, if the URL has one, is returned separately.
pub fn parse_url(url: &str) -> Result<(Site, Option<String>)> {
    let url = url.trim();
    let (scheme, rest) = url.split_once("://").unwrap_or(("sftp", url));
    let protocol = match scheme.to_ascii_lowercase().as_str() {
        "sftp" | "ssh" | "scp" => Protocol::Sftp,
        "ftp" => Protocol::Ftp,
        "ftps" | "ftpes" => Protocol::Ftps,
        other => return Err(Error::invalid(format!("Captain doesn't speak {other}://"))),
    };
    let (authority, remote_path) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let (userinfo, hostport) = match authority.rfind('@') {
        Some(i) => (Some(&authority[..i]), &authority[i + 1..]),
        None => (None, authority),
    };
    let (user, password) = match userinfo {
        Some(info) => match info.split_once(':') {
            Some((u, p)) => (percent_decode(u), Some(percent_decode(p))),
            None => (percent_decode(info), None),
        },
        None => (String::new(), None),
    };
    let (host, port) = split_host_port(hostport)?;
    let auth = if user.is_empty() && protocol != Protocol::Sftp {
        Auth::Anonymous
    } else {
        Auth::Password
    };
    let site = normalize(Site {
        id: String::new(),
        name: String::new(),
        protocol,
        host,
        port,
        user,
        auth,
        remote_path: percent_decode(remote_path),
        local_path: String::new(),
        color: default_color(),
        bookmarks: Vec::new(),
        last_used: None,
    })?;
    Ok((site, password))
}

fn split_host_port(s: &str) -> Result<(String, u16)> {
    // [::1]:22
    if let Some(rest) = s.strip_prefix('[') {
        let (host, after) = rest
            .split_once(']')
            .ok_or_else(|| Error::invalid("That address isn't valid"))?;
        let port = match after.strip_prefix(':') {
            Some(p) => p
                .parse()
                .map_err(|_| Error::invalid("That port isn't a number"))?,
            None => 0,
        };
        return Ok((host.to_string(), port));
    }
    match s.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => Ok((
            host.to_string(),
            port.parse()
                .map_err(|_| Error::invalid("That port isn't a number"))?,
        )),
        _ => Ok((s.to_string(), 0)),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// "sftp://user@host:port/path", for copying a link to a file.
pub fn url_for(site: &Site, remote: &str) -> String {
    let user = if site.auth == Auth::Anonymous || site.user.is_empty() {
        String::new()
    } else {
        format!("{}@", site.user)
    };
    let port = if site.port == site.protocol.default_port() {
        String::new()
    } else {
        format!(":{}", site.port)
    };
    format!(
        "{}://{user}{}{port}{remote}",
        site.protocol.scheme(),
        site.host
    )
}

#[derive(Serialize, Deserialize)]
struct SitesFile {
    version: u32,
    sites: Vec<Site>,
}

const FILE: &str = "sites.json";

/// The saved sites, or none if there's no file yet. A damaged file is kept
/// aside rather than overwritten, so nothing is lost silently.
pub fn load(dir: &Path) -> Vec<Site> {
    let file = dir.join(FILE);
    let Ok(text) = fs::read_to_string(&file) else {
        return Vec::new();
    };
    match serde_json::from_str::<SitesFile>(&text) {
        Ok(f) => f.sites,
        Err(_) => {
            let _ = fs::rename(&file, dir.join(format!("sites.damaged-{}.json", now())));
            Vec::new()
        }
    }
}

/// Write atomically: a crash mid-write leaves the previous file intact.
pub fn save(dir: &Path, sites: &[Site]) -> Result<()> {
    fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(&SitesFile {
        version: 1,
        sites: sites.to_vec(),
    })
    .map_err(|e| Error::local(e.to_string()))?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, text)?;
    fs::rename(&tmp, dir.join(FILE))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> Site {
        Site {
            id: String::new(),
            name: String::new(),
            protocol: Protocol::Sftp,
            host: " sftp://example.com/ ".into(),
            port: 0,
            user: " deploy ".into(),
            auth: Auth::Password,
            remote_path: "/var//www/".into(),
            local_path: String::new(),
            color: "nope".into(),
            bookmarks: vec![],
            last_used: None,
        }
    }

    #[test]
    fn normalizes_input() {
        let s = normalize(draft()).unwrap();
        assert_eq!(s.host, "example.com");
        assert_eq!(s.user, "deploy");
        assert_eq!(s.port, 22);
        assert_eq!(s.name, "example.com");
        assert_eq!(s.remote_path, "/var/www");
        assert_eq!(s.color, "indigo");
        assert!(!s.id.is_empty());
    }

    #[test]
    fn rejects_what_cannot_work() {
        let mut s = draft();
        s.host = "  ".into();
        assert!(normalize(s).is_err());
        let mut s = draft();
        s.user = String::new();
        assert!(normalize(s).is_err(), "SFTP needs a user");
        let mut s = draft();
        s.protocol = Protocol::Ftp;
        s.auth = Auth::Agent;
        assert!(normalize(s).is_err(), "agent is SSH only");
    }

    #[test]
    fn ftp_without_user_is_anonymous() {
        let mut s = draft();
        s.protocol = Protocol::Ftp;
        s.user = String::new();
        let s = normalize(s).unwrap();
        assert_eq!(s.auth, Auth::Anonymous);
        assert_eq!(s.port, 21);
    }

    #[test]
    fn parses_urls() {
        let (s, pw) = parse_url("sftp://deploy@example.com:2222/var/www").unwrap();
        assert_eq!(
            (s.protocol, s.host.as_str(), s.port),
            (Protocol::Sftp, "example.com", 2222)
        );
        assert_eq!(s.user, "deploy");
        assert_eq!(s.remote_path, "/var/www");
        assert_eq!(pw, None);

        let (s, pw) = parse_url("ftp://me:p%40ss@ftp.example.com").unwrap();
        assert_eq!((s.protocol, s.port), (Protocol::Ftp, 21));
        assert_eq!(pw.as_deref(), Some("p@ss"));

        let (s, _) = parse_url("ftp://ftp.gnu.org/gnu").unwrap();
        assert_eq!(s.auth, Auth::Anonymous);

        let (s, _) = parse_url("root@[::1]:22").unwrap();
        assert_eq!(s.host, "::1");

        assert!(parse_url("gopher://x").is_err());
    }

    #[test]
    fn builds_urls() {
        let (s, _) = parse_url("sftp://deploy@example.com:2222").unwrap();
        assert_eq!(url_for(&s, "/a b"), "sftp://deploy@example.com:2222/a b");
    }

    #[test]
    fn saves_and_loads() {
        let dir = crate::testutil::temp_dir("sites");
        let s = normalize(draft()).unwrap();
        save(&dir, std::slice::from_ref(&s)).unwrap();
        assert_eq!(load(&dir), vec![s]);
        fs::write(dir.join(FILE), "{broken").unwrap();
        assert!(load(&dir).is_empty());
        assert!(!dir.join(FILE).exists(), "damaged file moved aside");
    }
}
