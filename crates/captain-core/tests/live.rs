//! Against real servers. Skipped unless CAPTAIN_LIVE_HOST is set:
//!
//!   CAPTAIN_LIVE_HOST=127.0.0.1 CAPTAIN_LIVE_USER=me CAPTAIN_LIVE_PASS=secret \
//!   CAPTAIN_LIVE_SFTP_PORT=22 CAPTAIN_LIVE_FTP_PORT=21 CAPTAIN_LIVE_FTPS_PORT=21 \
//!   cargo test -p captain-core --test live -- --nocapture
//!
//! Any port left unset skips that protocol. The test works in a fresh folder
//! in the login folder and removes it afterwards.

use std::time::Duration;

use captain_core::{trust, App, Auth, Direction, Error, Protocol, Request, Site, State};

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn exercise(protocol: Protocol, port: u16) {
    let host = env("CAPTAIN_LIVE_HOST").unwrap();
    let base = std::env::temp_dir().join(format!(
        "captain-live-{:?}-{}",
        protocol,
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(base.join("upload/sub")).unwrap();
    std::fs::write(base.join("upload/a.txt"), "hello").unwrap();
    std::fs::write(base.join("upload/sub/b.bin"), vec![7u8; 300_000]).unwrap();

    let app = App::new(Some(base.join("support")), base.join("cache"), |_| {});
    let site = app
        .save_site(
            Site {
                id: String::new(),
                name: format!("{protocol:?}"),
                protocol,
                host: host.clone(),
                port,
                user: env("CAPTAIN_LIVE_USER").unwrap(),
                auth: Auth::Password,
                remote_path: String::new(),
                local_path: String::new(),
                color: "blue".into(),
                bookmarks: vec![],
                last_used: None,
            },
            env("CAPTAIN_LIVE_PASS"),
        )
        .unwrap();

    // First contact asks to trust the server; trusting it lets us in.
    let opened = match app.connect(&site.id) {
        Ok(o) => o,
        Err(Error::UnknownHost { fingerprint, .. }) => {
            println!("{protocol:?}: trusting host key {fingerprint}");
            app.trust(trust::Kind::Ssh, &host, port, &fingerprint)
                .unwrap();
            app.connect(&site.id).unwrap()
        }
        Err(Error::UntrustedCertificate {
            fingerprint,
            reason,
            ..
        }) => {
            println!("{protocol:?}: trusting certificate {fingerprint} ({reason})");
            app.trust(trust::Kind::Tls, &host, port, &fingerprint)
                .unwrap();
            app.connect(&site.id).unwrap()
        }
        Err(e) => panic!("{protocol:?}: {e:?}"),
    };
    println!("{protocol:?}: home {}", opened.home);

    let dir = app
        .mkdir(
            &site.id,
            &opened.home,
            &format!("captain live {}", std::process::id()),
        )
        .unwrap();
    app.transfer(vec![Request {
        site_id: site.id.clone(),
        direction: Direction::Upload,
        local: base.join("upload").to_string_lossy().into(),
        remote: dir.clone(),
        is_dir: false,
    }])
    .unwrap();
    wait(&app);

    let listing = app.list(&site.id, &format!("{dir}/upload")).unwrap();
    let names: Vec<_> = listing.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["sub", "a.txt"], "{protocol:?}");
    assert_eq!(listing[1].size, 5);

    let renamed = app
        .rename(&site.id, &format!("{dir}/upload/a.txt"), "renamed file.txt")
        .unwrap();
    assert_eq!(
        app.read_text(&site.id, &renamed, 1 << 20)
            .unwrap()
            .as_deref(),
        Some("hello")
    );
    app.write_text(&site.id, &renamed, "edited").unwrap();
    assert_eq!(
        app.read_text(&site.id, &renamed, 1 << 20)
            .unwrap()
            .as_deref(),
        Some("edited")
    );
    assert_eq!(
        app.read_text(&site.id, &format!("{dir}/upload/sub/b.bin"), 1000)
            .unwrap(),
        None
    );

    app.transfer(vec![Request {
        site_id: site.id.clone(),
        direction: Direction::Download,
        local: base.join("down").to_string_lossy().into(),
        remote: format!("{dir}/upload"),
        is_dir: true,
    }])
    .unwrap();
    wait(&app);
    assert_eq!(
        std::fs::read(base.join("down/upload/sub/b.bin"))
            .unwrap()
            .len(),
        300_000
    );

    app.delete(&site.id, std::slice::from_ref(&dir)).unwrap();
    assert!(!app
        .list(&site.id, &opened.home)
        .unwrap()
        .iter()
        .any(|e| e.path == dir));
    println!("{protocol:?}: ok");
}

fn wait(app: &App) {
    for _ in 0..300 {
        let all = app.transfers();
        if all
            .iter()
            .all(|t| !matches!(t.state, State::Queued | State::Running))
        {
            for t in &all {
                assert_eq!(t.state, State::Done, "{:?}", t.error);
            }
            app.clear_transfers();
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("transfers didn't finish");
}

#[test]
fn live_servers() {
    if env("CAPTAIN_LIVE_HOST").is_none() {
        eprintln!("CAPTAIN_LIVE_HOST not set; skipping");
        return;
    }
    for (var, protocol) in [
        ("CAPTAIN_LIVE_SFTP_PORT", Protocol::Sftp),
        ("CAPTAIN_LIVE_FTP_PORT", Protocol::Ftp),
        ("CAPTAIN_LIVE_FTPS_PORT", Protocol::Ftps),
    ] {
        if let Some(port) = env(var).and_then(|p| p.parse().ok()) {
            exercise(protocol, port);
        }
    }
}
