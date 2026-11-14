//! "Edit in…": download a server file to a private folder, open it in the
//! user's editor, and upload it again every time it's saved there.
//!
//! The copy lives at <cache>/edit/<site id>/<remote path>, so two files with
//! the same name in different folders never collide, and the editor's
//! window title shows the real file name.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::path;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Watched {
    pub site_id: String,
    pub remote: String,
    pub local: String,
    #[serde(skip)]
    pub mtime: Option<SystemTime>,
}

/// Where the editable copy of `remote` lives.
pub fn local_copy(cache: &Path, site_id: &str, remote: &str) -> PathBuf {
    let safe_site: String = site_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let rel = path::normalize(&format!("/{remote}"));
    cache
        .join("edit")
        .join(safe_site)
        .join(rel.trim_start_matches('/'))
}

pub fn mtime(p: &Path) -> Option<SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// The files saved since the last look, with their new times recorded.
pub fn changed(watched: &mut [Watched]) -> Vec<Watched> {
    let mut out = Vec::new();
    for w in watched.iter_mut() {
        let now = mtime(Path::new(&w.local));
        if now.is_some() && now != w.mtime {
            w.mtime = now;
            out.push(w.clone());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_stay_inside_the_cache() {
        let cache = Path::new("/c");
        assert_eq!(
            local_copy(cache, "s1", "/var/www/a.php"),
            PathBuf::from("/c/edit/s1/var/www/a.php")
        );
        assert_eq!(
            local_copy(cache, "../x", "/../../etc/passwd"),
            PathBuf::from("/c/edit/x/etc/passwd")
        );
    }

    #[test]
    fn notices_saves() {
        let dir = crate::testutil::temp_dir("edit");
        let f = dir.join("a.txt");
        std::fs::write(&f, "1").unwrap();
        let mut w = vec![Watched {
            site_id: "s".into(),
            remote: "/a.txt".into(),
            local: f.to_string_lossy().into(),
            mtime: mtime(&f),
        }];
        assert!(changed(&mut w).is_empty());
        let later = SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options()
            .write(true)
            .open(&f)
            .unwrap()
            .set_modified(later)
            .unwrap();
        assert_eq!(changed(&mut w).len(), 1);
        assert!(changed(&mut w).is_empty());
    }
}
