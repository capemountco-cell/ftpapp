//! The few things that ask the operating system to act: open a file in its
//! default app, show it in Finder, and find the Downloads folder.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{Error, Result};

#[cfg(target_os = "macos")]
const OPENER: &str = "/usr/bin/open";
#[cfg(not(target_os = "macos"))]
const OPENER: &str = "xdg-open";

pub fn open(p: &Path) -> Result<()> {
    run(Command::new(OPENER).arg(p))
}

/// Select the item in a Finder window.
pub fn reveal(p: &Path) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        run(Command::new(OPENER).arg("-R").arg(p))
    }
    #[cfg(not(target_os = "macos"))]
    {
        run(Command::new(OPENER).arg(p.parent().unwrap_or(p)))
    }
}

fn run(cmd: &mut Command) -> Result<()> {
    let status = cmd
        .status()
        .map_err(|e| Error::local(format!("Couldn't open it: {e}")))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::local("Couldn't open it"))
    }
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn downloads_dir() -> PathBuf {
    home().join("Downloads")
}
