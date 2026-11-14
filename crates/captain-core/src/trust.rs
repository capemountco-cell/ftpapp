//! Servers the user has chosen to trust: SSH host keys, and FTPS
//! certificates the system doesn't vouch for. Both are pinned by SHA-256
//! fingerprint, per host and port, in Application Support.
//!
//! SSH also honours ~/.ssh/known_hosts (checked in `sftp`), so servers
//! already trusted in Terminal connect without asking.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct Pins {
    #[serde(default)]
    ssh: BTreeMap<String, String>,
    #[serde(default)]
    tls: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Ssh,
    Tls,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Check {
    Trusted,
    Unknown,
    Changed { expected: String },
}

pub struct Trust {
    file: Option<PathBuf>,
    pins: Mutex<Pins>,
}

fn key(host: &str, port: u16) -> String {
    format!("{}:{port}", host.to_ascii_lowercase())
}

impl Trust {
    /// Pins saved in `dir`, or nothing saved when `dir` is `None` (tests).
    pub fn open(dir: Option<&Path>) -> Self {
        let file = dir.map(|d| d.join("trusted.json"));
        let pins = file
            .as_ref()
            .and_then(|f| fs::read_to_string(f).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Trust {
            file,
            pins: Mutex::new(pins),
        }
    }

    pub fn check(&self, kind: Kind, host: &str, port: u16, fingerprint: &str) -> Check {
        let pins = self.pins.lock().unwrap();
        let map = match kind {
            Kind::Ssh => &pins.ssh,
            Kind::Tls => &pins.tls,
        };
        match map.get(&key(host, port)) {
            None => Check::Unknown,
            Some(fp) if fp == fingerprint => Check::Trusted,
            Some(fp) => Check::Changed {
                expected: fp.clone(),
            },
        }
    }

    pub fn pinned(&self, kind: Kind, host: &str, port: u16) -> Option<String> {
        let pins = self.pins.lock().unwrap();
        let map = match kind {
            Kind::Ssh => &pins.ssh,
            Kind::Tls => &pins.tls,
        };
        map.get(&key(host, port)).cloned()
    }

    /// Trust this fingerprint from now on, replacing any earlier one.
    pub fn add(&self, kind: Kind, host: &str, port: u16, fingerprint: &str) -> Result<()> {
        let snapshot = {
            let mut pins = self.pins.lock().unwrap();
            let map = match kind {
                Kind::Ssh => &mut pins.ssh,
                Kind::Tls => &mut pins.tls,
            };
            map.insert(key(host, port), fingerprint.to_string());
            pins.clone()
        };
        if let Some(file) = &self.file {
            if let Some(dir) = file.parent() {
                fs::create_dir_all(dir)?;
            }
            let text =
                serde_json::to_string_pretty(&snapshot).map_err(|e| Error::local(e.to_string()))?;
            let tmp = file.with_extension("json.tmp");
            fs::write(&tmp, text)?;
            fs::rename(&tmp, file)?;
        }
        Ok(())
    }
}

/// Standard base64 without padding, as OpenSSH prints fingerprints.
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// "AB:CD:…", as certificate fingerprints are usually shown.
pub fn hex_colons(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pins_and_detects_changes() {
        let dir = crate::testutil::temp_dir("trust");
        let t = Trust::open(Some(&dir));
        assert_eq!(
            t.check(Kind::Ssh, "Example.com", 22, "SHA256:a"),
            Check::Unknown
        );
        t.add(Kind::Ssh, "example.com", 22, "SHA256:a").unwrap();
        let t = Trust::open(Some(&dir));
        assert_eq!(
            t.check(Kind::Ssh, "EXAMPLE.com", 22, "SHA256:a"),
            Check::Trusted
        );
        assert_eq!(
            t.check(Kind::Ssh, "example.com", 22, "SHA256:b"),
            Check::Changed {
                expected: "SHA256:a".into()
            }
        );
        assert_eq!(
            t.check(Kind::Ssh, "example.com", 2222, "SHA256:a"),
            Check::Unknown
        );
        assert_eq!(
            t.check(Kind::Tls, "example.com", 22, "SHA256:a"),
            Check::Unknown
        );
    }

    #[test]
    fn encodes_base64_like_openssh() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg");
        assert_eq!(base64(b"fo"), "Zm8");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(hex_colons(&[0xab, 0x01]), "AB:01");
    }
}
