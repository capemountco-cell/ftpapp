import { useEffect, useRef, useState } from "react";

import { protocolLabel } from "../lib/format";
import { api, choose, errorText, isNativeError, type NativeError, type Protocol, type Site } from "../lib/native";
import { CaretRight, Eye, Folder, Key, Lock, Server, Warning } from "./Icons";
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

/** "detect" lets Captain read the protocol from the server's greeting. */
type ProtocolChoice = Protocol | "detect";
type SftpAuth = "password" | "key" | "agent";

/**
 * Add or edit a site: server, username and password up front, everything
 * else behind "Advanced options". `onTrust` is called when connecting meets
 * a server Captain hasn't seen, so the same trust dialog as elsewhere is used.
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
  // New sites detect the protocol; pasting a link that names one picks it.
  const [choice, setChoice] = useState<ProtocolChoice>(editing ? initial.protocol : "detect");
  const [detected, setDetected] = useState<{ host: string; protocol: Protocol; port: number } | "checking" | null>(null);
  const [secret, setSecret] = useState<string>(initialSecret ?? "");
  const [secretTouched, setSecretTouched] = useState(initialSecret !== null);
  const [hasSaved, setHasSaved] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<{ text: string; field: "pass" | "foot" } | null>(null);
  const [busy, setBusy] = useState(false);
  const hostRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    hostRef.current?.focus();
    if (editing) void api.hasSecret(initial.id).then(setHasSaved);
  }, [editing, initial.id]);

  const host = site.host.trim();
  // Detect the protocol shortly after typing stops.
  useEffect(() => {
    if (choice !== "detect" || !/[.:]|^localhost$/.test(host)) {
      setDetected(null);
      return;
    }
    let stale = false;
    setDetected("checking");
    const t = window.setTimeout(() => {
      api
        .detect(host, site.port || null)
        .then((d) => !stale && setDetected({ host, ...d }))
        .catch(() => !stale && setDetected(null));
    }, 500);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [choice, host, site.port]);

  const protocol: Protocol = choice !== "detect" ? choice : detected && detected !== "checking" ? detected.protocol : "sftp";
  const defaultPort = protocol === "sftp" ? 22 : 21;
  const port = site.port || (choice === "detect" && detected && detected !== "checking" ? detected.port : defaultPort);
  const isSftp = protocol === "sftp";
  const sftpAuth: SftpAuth = site.auth.kind === "key" || site.auth.kind === "agent" ? site.auth.kind : "password";
  const anonymous = !isSftp && !site.user.trim();
  const secretOff = anonymous || (isSftp && sftpAuth === "agent");

  const set = (patch: Partial<Site>) => {
    setSite((s) => ({ ...s, ...patch }));
    setError(null);
  };
  const setSftpAuth = (kind: SftpAuth) =>
    set({ auth: kind === "key" ? { kind: "key", path: site.auth.kind === "key" ? site.auth.path : "~/.ssh/id_ed25519" } : { kind } });

  // Pasting a link into Server fills everything in.
  const onHostPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!/^\w+:\/\//.test(text.trim()) && !text.includes("@")) return;
    e.preventDefault();
    try {
      const [parsed, pw] = await api.parseUrl(text);
      setSite((s) => ({ ...s, host: parsed.host, port: parsed.port, user: parsed.user, auth: parsed.auth, remotePath: parsed.remotePath || s.remotePath }));
      if (/^\w+:\/\//.test(text.trim())) setChoice(parsed.protocol);
      if (pw) {
        setSecret(pw);
        setSecretTouched(true);
      }
    } catch {
      set({ host: text.trim() });
    }
  };

  /** The site as it will be saved: the detected protocol, and a password or anonymous login. */
  const finalSite = (): Site => {
    const auth: Site["auth"] = isSftp ? (sftpAuth === "password" ? { kind: "password" } : site.auth) : anonymous ? { kind: "anonymous" } : { kind: "password" };
    return { ...site, host, protocol, port: site.port || (port !== defaultPort ? port : 0), auth };
  };
  const secretToSend = () => (secretOff ? null : secretTouched ? secret : null);

  const submit = async (connect: boolean) => {
    if (!host) return;
    setBusy(true);
    setError(null);
    const draft = finalSite();
    try {
      // Connect checks the login first, so a mistake shows here, by its field.
      if (connect) await api.testSite(draft, secretToSend());
      await onSave(draft, secretToSend(), connect);
    } catch (e) {
      setBusy(false);
      if (isNativeError(e) && (e.kind === "unknownHost" || e.kind === "untrustedCertificate")) {
        onTrust(e, () => void submit(connect));
        return;
      }
      const auth = isNativeError(e) && e.kind === "auth";
      setError({ text: errorText(e), field: auth ? "pass" : "foot" });
      if (auth) passRef.current?.select();
    }
  };

  const chip =
    choice === "detect" && detected === "checking" ? (
      <span className="qc-chip">Checking…</span>
    ) : host && (choice !== "detect" || detected) ? (
      protocol === "ftp" ? (
        <span className="qc-chip plain">FTP · not encrypted</span>
      ) : (
        <span className="qc-chip secure">
          <Lock /> {protocolLabel(protocol)} · {port}
        </span>
      )
    ) : null;

  const summary = [
    choice === "detect" ? "Detect protocol" : protocolLabel(choice),
    `port ${port}`,
    isSftp && sftpAuth === "key" ? "key file" : isSftp && sftpAuth === "agent" ? "ssh-agent" : null,
    site.remotePath || "login folder",
    site.localPath || "~/Downloads",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog onClose={onClose} wide label={editing ? `Edit ${initial.name}` : "New site"}>
      <form
        className="sheet"
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
        <h2 className="sheet-title">{editing ? initial.name : "New site"}</h2>

        <div className="fields">
          <div className="field full">
            <label htmlFor="host">Server</label>
            <div className="input tall">
              <Server />
              <input id="host" ref={hostRef} value={site.host} onChange={(e) => set({ host: e.target.value })} onPaste={(e) => void onHostPaste(e)} placeholder="example.com, or paste a link" spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" />
              {chip}
            </div>
          </div>

          <div className="field">
            <label htmlFor="user">Username</label>
            <div className="input tall">
              <input id="user" value={site.user} onChange={(e) => set({ user: e.target.value })} placeholder={isSftp ? "deploy" : "anonymous if empty"} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="secret">{isSftp && sftpAuth === "key" ? "Key passphrase" : "Password"}</label>
            <div className={`input tall${error?.field === "pass" ? " bad" : ""}${secretOff ? " off" : ""}`}>
              <input
                id="secret"
                ref={passRef}
                type={reveal ? "text" : "password"}
                value={secretOff ? "" : secret}
                disabled={secretOff}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setSecretTouched(true);
                  setError(null);
                }}
                placeholder={anonymous ? "Not needed" : isSftp && sftpAuth === "agent" ? "From ssh-agent" : hasSaved && !secretTouched ? "Saved in Keychain" : isSftp && sftpAuth === "key" ? "If the key has one" : ""}
                autoComplete="off"
              />
              {!secretOff && (
                <button type="button" className="inline-btn" title={reveal ? "Hide password" : "Show password"} aria-label={reveal ? "Hide password" : "Show password"} onClick={() => setReveal((r) => !r)}>
                  <Eye />
                </button>
              )}
            </div>
          </div>

          {error?.field === "pass" && (
            <p className="sheet-error" role="alert">
              <Warning /> {error.text}
            </p>
          )}

          <button type="button" className="adv-toggle" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
            <CaretRight className={`i${advanced ? " open" : ""}`} />
            <span className="adv-title">Advanced options</span>
            {!advanced && <span className="adv-summary">{summary}</span>}
          </button>

          {advanced && (
            <div className="field full adv-panel">
              <div className="fields inner">
                <div className="field">
                  <label htmlFor="name">Name</label>
                  <div className="input">
                    <input id="name" value={site.name} onChange={(e) => set({ name: e.target.value })} placeholder={host || "Same as server"} spellCheck={false} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="port">Port</label>
                  <div className="input">
                    <input id="port" inputMode="numeric" value={site.port || ""} placeholder={String(port)} onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, "").slice(0, 5)) || 0 })} />
                  </div>
                </div>

                <div className="field full">
                  <span className="label" id="proto-label">
                    Protocol
                  </span>
                  <div className="segmented" role="radiogroup" aria-labelledby="proto-label">
                    {(["detect", "sftp", "ftps", "ftp"] as ProtocolChoice[]).map((p) => (
                      <button type="button" key={p} role="radio" aria-checked={choice === p} className={choice === p ? "on" : ""} onClick={() => setChoice(p)}>
                        {p === "detect" ? "Detect" : p === "sftp" ? "SFTP" : p === "ftps" ? "FTP with TLS" : "FTP"}
                      </button>
                    ))}
                  </div>
                  {choice === "sftp" && (site.port === 21 || /^ftp\./i.test(host)) && (
                    <p className="sheet-note">
                      <Warning /> {site.port === 21 ? "Port 21 is for FTP, not SFTP." : "This looks like an FTP server."} Choose Detect to let Captain check.
                    </p>
                  )}
                </div>

                {isSftp && (
                  <div className="field full">
                    <span className="label" id="auth-label">
                      Log in with
                    </span>
                    <div className="segmented" role="radiogroup" aria-labelledby="auth-label">
                      {(["password", "key", "agent"] as SftpAuth[]).map((a) => (
                        <button type="button" key={a} role="radio" aria-checked={sftpAuth === a} className={sftpAuth === a ? "on" : ""} onClick={() => setSftpAuth(a)}>
                          {a === "password" ? "Password" : a === "key" ? "Key file" : "ssh-agent"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isSftp && site.auth.kind === "key" && (
                  <div className="field full">
                    <label htmlFor="key">Private key</label>
                    <div className="input">
                      <Key />
                      <input id="key" value={site.auth.path} onChange={(e) => set({ auth: { kind: "key", path: e.target.value } })} spellCheck={false} />
                      <button
                        type="button"
                        className="inline-btn"
                        title="Choose…"
                        aria-label="Choose a private key"
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
                      aria-label="Choose the downloads folder"
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
            </div>
          )}
        </div>

        <div className="dialog-foot sheet-foot">
          <div className="left">
            {error?.field === "foot" ? (
              <span className="test-result bad" title={error.text}>
                <Warning /> <span>{error.text}</span>
              </span>
            ) : (
              <span className="sheet-hint">Password stays in your Keychain</span>
            )}
          </div>
          <button type="button" className="btn ghost big" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn big" onClick={() => void submit(false)} disabled={busy || !host}>
            Save
          </button>
          <button type="submit" className="btn primary big" disabled={busy || !host}>
            {busy ? "Connecting…" : editing ? "Save & Reconnect" : "Connect"} <Kbd keys={["⌘", "↩"]} />
          </button>
        </div>
      </form>
    </Dialog>
  );
}
