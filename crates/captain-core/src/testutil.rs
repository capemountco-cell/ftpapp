//! Helpers for tests: a fresh, empty folder per test.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

pub fn temp_dir(label: &str) -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "captain-test-{label}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}
