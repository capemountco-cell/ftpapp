//! Remote paths are POSIX strings ("/var/www/site"), whatever the server.
//! These helpers never touch the network.

use crate::error::{Error, Result};

/// Collapse "//", "." and ".." so every path has one spelling. Relative
/// paths stay relative; ".." never climbs above "/".
pub fn normalize(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|p| *p != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else if joined.is_empty() {
        ".".into()
    } else {
        joined
    }
}

/// `dir` + `name`, normalised. An absolute `name` replaces `dir`.
pub fn join(dir: &str, name: &str) -> String {
    if name.starts_with('/') {
        normalize(name)
    } else {
        normalize(&format!("{dir}/{name}"))
    }
}

/// The folder holding `path`; `None` at the root.
pub fn parent(path: &str) -> Option<String> {
    let path = normalize(path);
    if path == "/" || path == "." {
        return None;
    }
    match path.rfind('/') {
        Some(0) => Some("/".into()),
        Some(i) => Some(path[..i].to_string()),
        None => Some(".".into()),
    }
}

/// The last component: "/a/b.txt" → "b.txt", "/" → "/".
pub fn name(path: &str) -> String {
    let path = normalize(path);
    match path.rfind('/') {
        Some(i) if path.len() > 1 => path[i + 1..].to_string(),
        _ => path,
    }
}

/// A file or folder name the user typed: rejected if it would escape the
/// current folder or can't exist.
pub fn validate_name(name: &str) -> Result<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(Error::invalid("A name can't be empty"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(Error::invalid("That name is reserved"));
    }
    if trimmed.contains('/') {
        return Err(Error::invalid("A name can't contain “/”"));
    }
    if trimmed.contains('\0') || trimmed.contains('\n') || trimmed.contains('\r') {
        return Err(Error::invalid("A name can't contain line breaks"));
    }
    Ok(trimmed)
}

/// Finder's way to avoid a clash: "report.pdf" → "report 2.pdf", "report 3.pdf"…
pub fn numbered(name: &str, n: u32) -> String {
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{} {n}{}", &name[..i], &name[i..]),
        _ => format!("{name} {n}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes() {
        assert_eq!(normalize("/a//b/./c/"), "/a/b/c");
        assert_eq!(normalize("/a/b/../c"), "/a/c");
        assert_eq!(normalize("/../.."), "/");
        assert_eq!(normalize(""), ".");
        assert_eq!(normalize("a/../.."), "..");
        assert_eq!(normalize("/"), "/");
    }

    #[test]
    fn joins_and_splits() {
        assert_eq!(join("/var/www", "index.html"), "/var/www/index.html");
        assert_eq!(join("/", "etc"), "/etc");
        assert_eq!(join("/var", "/tmp"), "/tmp");
        assert_eq!(join("/var/www", ".."), "/var");
        assert_eq!(parent("/var/www"), Some("/var".into()));
        assert_eq!(parent("/var"), Some("/".into()));
        assert_eq!(parent("/"), None);
        assert_eq!(name("/var/www/"), "www");
        assert_eq!(name("/"), "/");
    }

    #[test]
    fn validates_names() {
        assert_eq!(validate_name("  new folder ").unwrap(), "new folder");
        assert!(validate_name("").is_err());
        assert!(validate_name("..").is_err());
        assert!(validate_name("a/b").is_err());
    }

    #[test]
    fn numbers_like_finder() {
        assert_eq!(numbered("report.pdf", 2), "report 2.pdf");
        assert_eq!(numbered("archive", 3), "archive 3");
        assert_eq!(numbered(".htaccess", 2), ".htaccess 2");
    }
}
