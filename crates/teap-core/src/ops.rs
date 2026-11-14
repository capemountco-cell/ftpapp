//! Operations built from `Remote`'s primitives: whole folders at a time.

use std::path::{Path, PathBuf};

use crate::entry::Entry;
use crate::error::{Error, Result};
use crate::path;
use crate::remote::Remote;

/// Delete a file, or a folder and everything in it.
pub fn remove_all(remote: &mut dyn Remote, target: &Entry) -> Result<()> {
    if target.is_dir() && !target.link {
        for child in remote.list(&target.path)? {
            remove_all(remote, &child)?;
        }
        remote.remove_dir(&target.path)
    } else {
        remote.remove_file(&target.path)
    }
}

/// Make sure `dir` exists on the server. Fine if it already does.
pub fn ensure_dir(remote: &mut dyn Remote, dir: &str) -> Result<()> {
    match remote.mkdir(dir) {
        Ok(()) => Ok(()),
        Err(e) => match remote.stat(dir) {
            Ok(entry) if entry.is_dir() => Ok(()),
            Ok(_) => Err(Error::remote(format!("{dir} exists and isn't a folder"))),
            Err(_) => Err(e),
        },
    }
}

/// Every file and folder under a server folder, parents before children.
pub fn walk_remote(remote: &mut dyn Remote, dir: &str, out: &mut Vec<Entry>) -> Result<()> {
    let mut children = remote.list(dir)?;
    crate::entry::sort(&mut children);
    for child in children {
        let recurse = child.is_dir() && !child.link;
        let p = child.path.clone();
        out.push(child);
        if recurse {
            walk_remote(remote, &p, out)?;
        }
    }
    Ok(())
}

/// One item of a local folder: its path relative to the folder, its size,
/// and whether it's a folder. Parents before children; links not followed.
pub fn walk_local(root: &Path) -> Result<Vec<(PathBuf, u64, bool)>> {
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        let mut items: Vec<_> =
            std::fs::read_dir(root.join(&rel))?.collect::<std::io::Result<_>>()?;
        items.sort_by_key(|i| i.file_name());
        for item in items.into_iter().rev() {
            let name = item.file_name();
            // Finder's bookkeeping never belongs on a server.
            if name == ".DS_Store" {
                continue;
            }
            let meta = std::fs::symlink_metadata(item.path())?;
            let child = rel.join(&name);
            if meta.is_dir() {
                out.push((child.clone(), 0, true));
                stack.push(child);
            } else if meta.is_file() {
                out.push((child, meta.len(), false));
            }
        }
    }
    // Stack order visits deepest-last; make parents strictly precede children.
    out.sort_by(|a, b| {
        a.0.components()
            .count()
            .cmp(&b.0.components().count())
            .then(a.0.cmp(&b.0))
    });
    Ok(out)
}

/// A relative local path as a remote one under `base`.
pub fn remote_child(base: &str, rel: &Path) -> String {
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    path::join(base, &parts.join("/"))
}

/// `dir/name`, or `dir/name 2`, `dir/name 3`… whichever doesn't exist yet.
pub fn unique_local(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(path::numbered(name, n)))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::LocalFs;
    use std::fs;

    #[test]
    fn walks_and_removes() {
        let root = crate::testutil::temp_dir("ops");
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::write(root.join("a/b/c.txt"), "x").unwrap();
        fs::write(root.join("a/d.txt"), "yy").unwrap();
        fs::write(root.join("a/.DS_Store"), "").unwrap();

        let local = walk_local(&root.join("a")).unwrap();
        let names: Vec<_> = local
            .iter()
            .map(|(p, _, _)| p.to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["b", "d.txt", "b/c.txt"]);

        let mut fsr = LocalFs::new(&root);
        let mut all = Vec::new();
        walk_remote(&mut fsr, "/a", &mut all).unwrap();
        assert_eq!(all.len(), 4, "includes .DS_Store on the 'server'");

        ensure_dir(&mut fsr, "/a/b").unwrap();
        assert!(ensure_dir(&mut fsr, "/a/d.txt").is_err());

        let a = fsr.stat("/a").unwrap();
        remove_all(&mut fsr, &a).unwrap();
        assert!(!root.join("a").exists());
    }

    #[test]
    fn picks_unique_names() {
        let root = crate::testutil::temp_dir("unique");
        assert_eq!(unique_local(&root, "f.txt"), root.join("f.txt"));
        fs::write(root.join("f.txt"), "").unwrap();
        fs::write(root.join("f 2.txt"), "").unwrap();
        assert_eq!(unique_local(&root, "f.txt"), root.join("f 3.txt"));
        assert_eq!(remote_child("/www", Path::new("a/b.txt")), "/www/a/b.txt");
    }
}
