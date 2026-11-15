import { useEffect, useRef, useState } from "react";

import { api, choose, errorText, isNativeError, type NativeError, type Protocol, type Site } from "../lib/native";
import { CheckCircle, Eye, Folder, Key, Lock, Refresh, Server, SiteGlyph, Warning } from "./Icons";
import { Dialog, Kbd } from "./ui";

const COLORS = ["indigo", "blue", "teal", "green", "yellow", "orange", "red", "pink", "gray"];

export function blankSite(): Site {
  return {
    id: "",
    name: "",
    protocol: "sftp",
    host: "",
    port: 0,
    user: "",
    auth: { kind: "password" },
    remotePath: "",
    localPath: "",
    color: COLORS[Math.floor(Math.random() * 6)] ?? "indigo",
    bookmarks: [],
    lastUsed: null,
  };
}

type AuthChoice = "password" | "key" | "agent" | "anonymous";

/**
 * Add or edit a site. `onTrust` is called when testing meets a server
 * Captain hasn't seen, so the same trust dialog as connecting is used.
 */
export function SiteSheet({
  initial,
  initialSecret,
  onSave,
  onClose,
  onTrust,
}: {
  initial: Site;
  initialSecret: string | null;
  onSave: (site: Site, secret: string | null, connect: boolean) => Promise<void>;
  onClose: () => void;
  onTrust: (err: NativeError, retry: () => void) => void;
}) {
  const editing = initial.id !== "";
  const [site, setSite] = useState<Site>(initial);
  const [secret, setSecret] = useState<string>(initialSecret ?? "");
  const [secretTouched, setSecretTouched] = useState(initialSecret !== null);
  const [hasSaved, setHasSaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "bad"; text?: string }>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (editing ? nameRef : hostRef).current?.focus();
    if (editing) void api.hasSecret(initial.id).then(setHasSaved);
  }, [editing, initial.id]);

  const set = (patch: Partial<Site>) => {
    setSite((s) => ({ ...s, ...patch }));
    setTest({ state: "idle" });
    setError(null);
  };
  const authKind = site.auth.kind as AuthChoice;
  // SFTP on FTP's port, or an ftp.* server name: almost always the wrong protocol.
  const looksLikeFtp = site.protocol === "sftp" && (site.port === 21 || /^ftp\./i.test(site.host.trim()));
  const setAuth = (kind: AuthChoice) =>
    set({ auth: kind === "key" ? { kind: "key", path: site.auth.kind === "key" ? site.auth.path : "~/.ssh/id_ed25519" } : { kind } });
  const setProtocol = (protocol: Protocol) => {
    const auth = protocol !== "sftp" && (site.auth.kind === "key" || site.auth.kind === "agent") ? { kind: "password" as const } : protocol === "sftp" && site.auth.kind === "anonymous" ? { kind: "password" as const } : site.auth;
    set({ protocol, auth });
  };

  // Pasting a URL into the server field fills everything in.
  const onHostPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/^\w+:\/\//.test(text.trim()) && !text.includes("@")) return;
    e.preventDefault();
    try {
      const [parsed, pw] = await api.parseUrl(text);
      setSite((s) => ({ ...s, protocol: parsed.protocol, host: parsed.host, port: parsed.port, user: parsed.user, auth: parsed.auth, remotePath: parsed.remotePath || s.remotePath }));
      if (pw) {
        setSecret(pw);
        setSecretTouched(true);
      }
    } catch {
      set({ host: text.trim() });
    }
  };

  const secretToSend = () => (secretTouched ? secret : null);
  const needsSecret = authKind === "password" || authKind === "key";
  const defaultPort = site.protocol === "sftp" ? 22 : 21;

  const runTest = async () => {
    setTest({ state: "busy" });
    try {
      const home = await api.testSite(site, secretToSend());
      setTest({ state: "ok", text: `Connected · login folder ${home}` });
    } catch (e) {
      if (isNativeError(e) && (e.kind === "unknownHost" || e.kind === "untrustedCertificate")) {
        setTest({ state: "idle" });
        onTrust(e, () => void runTest());
        return;
      }
      setTest({ state: "bad", text: errorText(e) });
    }
  };

  const submit = async (connect: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(site, secretToSend(), connect);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog onClose={onClose} wide label={editing ? "Edit site" : "New site"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit(true);
          }
        }}
      >
        <div className="composer-top">
          <span className="pill">
            <SiteGlyph />
            {editing ? initial.name : "New site"}
          </span>
        </div>

        <input
          ref={nameRef}
          className="composer-name"
          value={site.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={site.host || "Site name"}
          aria-label="Site name"
          spellCheck={false}
        />
        <div className="composer-hint">Paste a link like sftp://user@example.com into Server to fill everything in.</div>

        <div className="fields">
          <div className="field full">
            <span className="label">Protocol</span>
            <div className="segmented" role="radiogroup">
              {(["sftp", "ftps", "ftp"] as Protocol[]).map((p) => (
                <button type="button" key={p} role="radio" aria-checked={site.protocol === p} className={site.protocol === p ? "on" : ""} onClick={() => setProtocol(p)}>
                  {p === "sftp" ? "SFTP" : p === "ftps" ? "FTP with TLS" : "FTP"}
                </button>
              ))}
            </div>
          </div>

          {looksLikeFtp && (
            <div className="field full protocol-hint" role="note">
              <Warning />
              <span>{site.port === 21 ? "Port 21 is for FTP, not SFTP." : "This looks like an FTP server."}</span>
              <button type="button" className="btn" onClick={() => setProtocol("ftps")}>Use FTP with TLS</button>
              <button type="button" className="btn" onClick={() => setProtocol("ftp")}>Use FTP</button>
            </div>
          )}

          <div className="field full split">
            <div className="field">
              <label htmlFor="host">Server</label>
              <div className="input">
                <Server />
                <input id="host" ref={hostRef} value={site.host} onChange={(e) => set({ host: e.target.value })} onPaste={(e) => void onHostPaste(e)} placeholder="example.com" spellCheck={false} autoComplete="off" autoCapitalize="off" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="port">Port</label>
              <div className="input">
                <input id="port" inputMode="numeric" value={site.port || ""} placeholder={String(defaultPort)} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="user">Username</label>
            <div className="input">
              <input id="user" value={site.user} onChange={(e) => set({ user: e.target.value })} placeholder={site.protocol === "sftp" ? "deploy" : "anonymous if empty"} spellCheck={false} autoComplete="off" autoCapitalize="off" disabled={authKind === "anonymous"} />
            </div>
          </div>

          <div className="field">
            <span className="label">Log in with</span>
            <div className="segmented">
              {(site.protocol === "sftp" ? (["password", "key", "agent"] as AuthChoice[]) : (["password", "anonymous"] as AuthChoice[])).map((a) => (
                <button type="button" key={a} className={authKind === a ? "on" : ""} onClick={() => setAuth(a)}>
                  {a === "password" ? "Password" : a === "key" ? "Key file" : a === "agent" ? "ssh-agent" : "Anonymous"}
                </button>
              ))}
            </div>
          </div>

          {authKind === "key" && site.auth.kind === "key" && (
            <div className="field">
              <label htmlFor="key">Private key</label>
              <div className="input">
                <Key />
                <input id="key" value={site.auth.path} onChange={(e) => set({ auth: { kind: "key", path: e.target.value } })} spellCheck={false} />
                <button
                  type="button"
                  className="inline-btn"
                  title="Choose…"
                  onClick={async () => {
                    const [p] = await choose({ title: "Choose a private key", defaultPath: "~/.ssh" });
                    if (p) set({ auth: { kind: "key", path: p } });
                  }}
                >
                  <Folder />
                </button>
              </div>
            </div>
          )}

          {needsSecret && (
            <div className={`field${authKind === "password" ? " full" : ""}`}>
              <label htmlFor="secret">{authKind === "key" ? "Key passphrase" : "Password"}</label>
              <div className="input">
                <Lock />
                <input
                  id="secret"
                  type={reveal ? "text" : "password"}
                  value={secret}
                  onChange={(e) => {
                    setSecret(e.target.value);
                    setSecretTouched(true);
                    setTest({ state: "idle" });
                  }}
                  placeholder={hasSaved && !secretTouched ? "Saved in Keychain" : authKind === "key" ? "None" : ""}
                  autoComplete="off"
                />
                <button type="button" className="inline-btn" title={reveal ? "Hide" : "Show"} onClick={() => setReveal((r) => !r)}>
                  <Eye />
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="rpath">Start in</label>
            <div className="input">
              <input id="rpath" value={site.remotePath} onChange={(e) => set({ remotePath: e.target.value })} placeholder="Login folder" spellCheck={false} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="lpath">Downloads go to</label>
            <div className="input">
              <input id="lpath" value={site.localPath} onChange={(e) => set({ localPath: e.target.value })} placeholder="~/Downloads" spellCheck={false} />
              <button
                type="button"
                className="inline-btn"
                title="Choose…"
                onClick={async () => {
                  const [p] = await choose({ directory: true, title: "Downloads go to" });
                  if (p) set({ localPath: p });
                }}
              >
                <Folder />
              </button>
            </div>
          </div>
        </div>

        <div className="dialog-foot">
          <div className="left">
            <button type="button" className="btn big" onClick={() => void runTest()} disabled={!site.host.trim() || test.state === "busy"}>
              <Refresh className={`i${test.state === "busy" ? " spin" : ""}`} /> Test
            </button>
            {error ? (
              <span className="test-result bad">
                <Warning /> <span>{error}</span>
              </span>
            ) : test.state === "ok" ? (
              <span className="test-result ok">
                <CheckCircle /> <span>{test.text}</span>
              </span>
            ) : test.state === "bad" ? (
              <span className="test-result bad" title={test.text}>
                <Warning /> <span>{test.text}</span>
              </span>
            ) : null}
          </div>
          <button type="button" className="btn ghost big" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn big" onClick={() => void submit(false)} disabled={busy || !site.host.trim()}>
            Save
          </button>
          <button type="submit" className="btn primary big" disabled={busy || !site.host.trim()}>
            {editing ? "Save & Reconnect" : "Connect"} <Kbd keys={["⌘", "↩"]} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
