# Teap

A clean, fast file transfer app for macOS: SFTP, FTP and FTP with TLS.
It has a Linear-style sidebar of your sites, a list that behaves like
Finder, and transfers that never get in the way of browsing.

## What it does

- **Sites in the sidebar.** Each one keeps its own connection and place,
  so switching between production and staging is instant. Paste
  `sftp://user@host:port/path` anywhere (the Start page, ⌘K, or the
  Server field) to fill everything in.
- **Safe by default.** Passwords and key passphrases live in the macOS
  Keychain, never in a file. SSH host keys are checked against
  `~/.ssh/known_hosts` and Teap's own list *before* any password is sent.
  A new server asks you to confirm its fingerprint, and a changed key is
  refused. FTPS certificates are checked by the system. A self-signed one
  can be trusted once, and that exact certificate is pinned.
- **Browse like Finder.** Folders come first, names sort the way Finder
  sorts them, and you can type to select. Return renames, ⌘↓ opens, ⌘↑
  goes up, ⌘⌫ deletes, ⌘F filters, and ⇧⌘. shows hidden files.
- **Drag and drop.** Drop files or folders from Finder onto the list to
  upload them there, or onto a folder row or a breadcrumb to upload into
  that folder.
- **Transfers queue.** Three workers run in parallel, each on its own
  connection, with progress, speed and time left. You can stop or retry
  a transfer. Uploads replace files on the server. Downloads never
  overwrite anything on your Mac ("name 2.ext") and are written to a
  `.teapdownload` file until they're complete.
- **Edit in place.** ⌘E opens a text file in Teap's editor and ⌘S saves it
  to the server. "Open in default app" opens a synced copy in your own
  editor and uploads it every time you save.
- **Inspector** (⌘I) shows properties and permissions, a preview of text
  files, and the actions for the selection. **Bookmarks** keep the
  folders you use most in the sidebar. **⌘K** reaches every site,
  bookmark, file in view and action.

## Develop

```sh
npm install
npm run dev        # the app, with live reload
npm run dev:web    # just the interface; open http://localhost:1420/?demo for sample data
npm run check      # type check, tests, Rust format, lint and tests. Run before every push
npm run dmg        # build and verify a .dmg (on a Mac)
```

Protocol tests against real servers are skipped unless you point them at
some:

```sh
TEAP_LIVE_HOST=127.0.0.1 TEAP_LIVE_USER=me TEAP_LIVE_PASS=secret \
TEAP_LIVE_SFTP_PORT=22 TEAP_LIVE_FTP_PORT=21 TEAP_LIVE_FTPS_PORT=21 \
cargo test -p teap-core --test live -- --nocapture
```

## Layout

```
crates/teap-core/      Everything Teap does. No Tauri, so it tests on Linux.
  src/site.rs          Saved sites, URL parsing, the sites file.
  src/secret.rs        Keychain.
  src/trust.rs         Trusted host keys and pinned certificates.
  src/remote.rs        The Remote trait every protocol implements.
  src/sftp.rs          SFTP (libssh2), with host key checks.
  src/ftp.rs           FTP and FTPS (suppaftp + rustls), with certificate pinning.
  src/transfer.rs      The transfer queue.
  src/edit.rs          "Open in default app" sync.
  src/lib.rs           App: the one object the window talks to.
src-tauri/             The native shell: window, commands (one App call each), bundling.
src/                   The React interface.
  lib/native.ts        Every call from the UI to Rust, in one place.
  lib/mock.ts          Sample data for ?demo in a browser.
  components/          Sidebar, Browser, Inspector, Editor, Transfers, dialogs.
scripts/, docs/        From the Mac App Template: dmg build, verify, signing.
```

Teap started from the Mac App Template; `docs/dmg.md` and
`docs/signing.md` cover packaging and releases. Push a tag like
`v1.0.0` after `npm run set-version -- 1.0.0` to build a release.
