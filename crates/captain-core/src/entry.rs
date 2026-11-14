//! A file or folder in a listing, the same shape for SFTP, FTP and this Mac.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    File,
    Dir,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    /// What it behaves as. A link to a folder is a `Dir` with `link` set.
    pub kind: Kind,
    pub link: bool,
    pub size: u64,
    /// Seconds since 1970, when the server says.
    pub modified: Option<i64>,
    /// "rwxr-xr-x", when the server says.
    pub permissions: Option<String>,
}

impl Entry {
    pub fn is_dir(&self) -> bool {
        self.kind == Kind::Dir
    }
}

/// Folders first, then names in the order Finder uses: case-insensitive,
/// with numbers compared by value ("file 2" before "file 10").
pub fn sort(entries: &mut [Entry]) {
    entries.sort_by(|a, b| {
        b.is_dir()
            .cmp(&a.is_dir())
            .then_with(|| natural_cmp(&a.name, &b.name))
    });
}

pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut a = a.chars().peekable();
    let mut b = b.chars().peekable();
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut s = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        s.push(c);
                        it.next();
                    }
                    s
                };
                let (na, nb) = (take(&mut a), take(&mut b));
                let (ta, tb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                a.next();
                b.next();
            }
        }
    }
}

/// "rwxr-xr-x" from a Unix mode.
pub fn permissions(mode: u32) -> String {
    let bits = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];
    bits.iter()
        .map(|(bit, c)| if mode & bit != 0 { *c } else { '-' })
        .collect()
}

/// A Unix mode from "rwxr-xr-x" (or "drwxr-xr-x"); `None` if it isn't one.
pub fn mode_from(perms: &str) -> Option<u32> {
    let s = if perms.len() == 10 {
        &perms[1..]
    } else {
        perms
    };
    if s.len() != 9 {
        return None;
    }
    let mut mode = 0;
    for c in s.chars() {
        mode <<= 1;
        match c {
            '-' => {}
            'r' | 'w' | 'x' | 's' | 't' => mode |= 1,
            'S' | 'T' => {}
            _ => return None,
        }
    }
    Some(mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(name: &str, kind: Kind) -> Entry {
        Entry {
            name: name.into(),
            path: format!("/{name}"),
            kind,
            link: false,
            size: 0,
            modified: None,
            permissions: None,
        }
    }

    #[test]
    fn folders_first_then_natural_order() {
        let mut list = vec![
            e("file 10.txt", Kind::File),
            e("b", Kind::Dir),
            e("File 2.txt", Kind::File),
            e("A", Kind::Dir),
            e("file 1.txt", Kind::File),
        ];
        sort(&mut list);
        let names: Vec<_> = list.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["A", "b", "file 1.txt", "File 2.txt", "file 10.txt"]);
    }

    #[test]
    fn natural_handles_leading_zeros() {
        assert_eq!(natural_cmp("img007", "img7"), Ordering::Equal);
        assert_eq!(natural_cmp("img8", "img10"), Ordering::Less);
    }

    #[test]
    fn formats_and_parses_permissions() {
        assert_eq!(permissions(0o755), "rwxr-xr-x");
        assert_eq!(permissions(0o640), "rw-r-----");
        assert_eq!(mode_from("rwxr-xr-x"), Some(0o755));
        assert_eq!(mode_from("drw-r--r--"), Some(0o644));
        assert_eq!(mode_from("nope"), None);
    }
}
