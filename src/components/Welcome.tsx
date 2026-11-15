import { useEffect, useMemo, useRef, useState } from "react";

import { protocolLabel, serverLabel, when } from "../lib/format";
import { api, errorText, isNativeError, type NativeError, type Protocol, type Site } from "../lib/native";
import { ArrowRight, Link, Lock, Plus, SiteGlyph, Warning, Wordmark } from "./Icons";
import { blankSite } from "./SiteSheet";
import { Kbd } from "./ui";

/** What the quick-connect box was given: a saved site's name, a host, or a link. */
type Parsed = { scheme: Protocol | null; user: string; pass: string; host: string; port: number | null; path: string };

const SCHEMES: Record<string, Protocol> = { sftp: "sftp", ssh: "sftp", scp: "sftp", ftp: "ftp", ftps: "ftps", ftpes: "ftps" };

export function parseQuick(text: string): Parsed {
  let rest = text.trim();
  let scheme: Protocol | null = null;
  const m = rest.match(/^([a-z]+):\/\//i);
  if (m) {
    scheme = SCHEMES[(m[1] ?? "").toLowerCase()] ?? null;
    rest = rest.slice(m[0].length);
  }
  const slash = rest.indexOf("/");
  const authority = slash >= 0 ? rest.slice(0, slash) : rest;
  const path = slash >= 0 ? rest.slice(slash) : "";
  const at = authority.lastIndexOf("@");
  const info = at >= 0 ? authority.slice(0, at) : "";
  const hostport = at >= 0 ? authority.slice(at + 1) : authority;
  const [user, ...passParts] = info ? info.split(":") : [""];
  const pm = hostport.match(/^(.*?)(?::(\d{1,5}))?$/);
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return {
    scheme,
    user: decode(user ?? ""),
    pass: decode(passParts.join(":")),
    host: (pm?.[1] ?? hostport).toLowerCase(),
    port: pm?.[2] ? Number(pm[2]) : null,
    path: decode(path),
  };
}

/** Saved sites that match what's typed: by name, or by server. */
export function matchSites(sites: Site[], text: string): Site[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const { host } = parseQuick(text);
  return sites.filter((s) => s.name.toLowerCase().includes(q) || (host && s.host.toLowerCase().includes(host)));
}

type Found = { protocol: Protocol; port: number };
type Phase = "typing" | "checking" | "details" | "connecting";

/** The start page: quick connect, and the sites used most recently. */
export function Welcome({
  sites,
  onOpen,
  onNewSite,
  onSaved,
  onTrust,
}: {
  sites: Site[];
  onOpen: (s: Site, path?: string | null) => void;
  onNewSite: () => void;
  /** A new site was logged into and saved: show it. */
  onSaved: (s: Site) => void;
  /** First contact with a server: ask to trust it, then `retry`. */
  onTrust: (error: NativeError, site: Site, retry: () => void) => void;
}) {
  const [text, setText] = useState("");
  const [hi, setHi] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [found, setFound] = useState<Found | null>(null);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [userError, setUserError] = useState(false);
  const [error, setError] = useState<{ text: string; field: "pass" | "box" } | null>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  const parsed = useMemo(() => parseQuick(text), [text]);
  const typing = phase === "typing";
  const matches = typing ? matchSites(sites, text) : [];
  const exact = matches.find((s) => s.host.toLowerCase() === parsed.host || s.name.toLowerCase() === text.trim().toLowerCase());
  // A plain word that already matches saved sites is a search, not a server.
  const looksLikeServer = /[.:]/.test(parsed.host) || parsed.host === "localhost" || !!parsed.scheme;
  const showNew = typing && !!parsed.host && !exact && (looksLikeServer || matches.length === 0);
  const rows = matches.length + (showNew ? 1 : 0);
  const sel = Math.min(hi, Math.max(rows - 1, 0));
  const recent = [...sites].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, 5);

  useEffect(() => {
    if (phase !== "details") return;
    (user ? passRef : userRef).current?.focus();
    // Focus once when the login fields appear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const reset = (value = text) => {
    run.current++;
    setText(value);
    setHi(0);
    setPhase("typing");
    setFound(null);
    setError(null);
    setUserError(false);
  };

  const startNew = async () => {
    const p = parsed;
    if (!p.host) return;
    const token = ++run.current;
    setError(null);
    setUserError(false);
    setUser(p.user);
    setPass(p.pass);
    setPhase("checking");
    let f: Found;
    if (p.scheme) f = { protocol: p.scheme, port: p.port ?? (p.scheme === "sftp" ? 22 : 21) };
    else {
      try {
        f = await api.detect(p.host, p.port);
      } catch (e) {
        if (token !== run.current) return;
        setPhase("typing");
        setError({ text: errorText(e), field: "box" });
        return;
      }
    }
    if (token !== run.current) return;
    setFound(f);
    // A link with the whole login in it connects straight away.
    if (p.user && p.pass) void login(false, f, p.user, p.pass);
    else setPhase("details");
  };

  const submit = () => {
    const picked = matches[sel];
    if (picked) return onOpen(picked, parsed.path || null);
    if (exact) return onOpen(exact, parsed.path || null);
    void startNew();
  };

  const login = async (anonymous: boolean, f = found, u = user, pw = pass) => {
    if (!f) return;
    const name = anonymous ? "" : u.trim();
    if (!anonymous && !name) {
      setUserError(true);
      userRef.current?.focus();
      return;
    }
    const site: Site = {
      ...blankSite(),
      name: parsed.host,
      protocol: f.protocol,
      host: parsed.host,
      port: f.port,
      user: name,
      auth: anonymous ? { kind: "anonymous" } : { kind: "password" },
      remotePath: parsed.path,
    };
    const secret = anonymous ? null : pw;
    const token = ++run.current;
    setError(null);
    setUserError(false);
    setPhase("connecting");
    try {
      await api.testSite(site, secret);
      if (token !== run.current) return;
      const saved = await api.saveSite(site, secret);
      if (token !== run.current) return;
      reset("");
      onSaved(saved);
    } catch (e) {
      if (token !== run.current) return;
      setPhase("details");
      if (isNativeError(e) && (e.kind === "unknownHost" || e.kind === "untrustedCertificate")) {
        onTrust(e, site, () => void login(anonymous, f, u, pw));
        return;
      }
      setError({ text: errorText(e), field: isNativeError(e) && e.kind === "auth" ? "pass" : "box" });
      if (isNativeError(e) && e.kind === "auth") passRef.current?.select();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (typing && text.trim()) submit();
      else if (phase === "details") void login(false);
    } else if (e.key === "ArrowDown" && typing && rows) {
      e.preventDefault();
      setHi(Math.min(sel + 1, rows - 1));
    } else if (e.key === "ArrowUp" && typing && rows) {
      e.preventDefault();
      setHi(Math.max(sel - 1, 0));
    } else if (e.key === "Escape" && !typing) {
      e.preventDefault();
      reset();
    }
  };

  const chip =
    phase === "checking" ? (
      <span className="qc-chip">Checking server…</span>
    ) : found && phase !== "typing" ? (
      found.protocol === "ftp" ? (
        <span className="qc-chip plain">FTP · not encrypted</span>
      ) : (
        <span className="qc-chip secure">
          <Lock /> {protocolLabel(found.protocol)} · {found.port}
        </span>
      )
    ) : null;

  return (
    <div className="welcome" data-tauri-drag-region>
      <Wordmark height={52} />
      <h1>{sites.length ? "Where to?" : "Connect to your first server"}</h1>
      <p>Type a saved site, a server, or a link like sftp://you@example.com. Captain works out the rest.</p>

      <section className={`qc${text.trim() && typing ? " active" : ""}`} aria-label="Quick connect" onKeyDown={onKey}>
        <div className="qc-bar">
          <Link />
          <input
            value={text}
            onChange={(e) => reset(e.target.value)}
            placeholder="Server, saved site or link"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Server, saved site or link"
            aria-autocomplete="list"
            aria-expanded={typing && rows > 0}
          />
          {chip}
          {typing && (
            <button type="button" className="btn primary" onClick={submit} disabled={!text.trim()}>
              {sel < matches.length || exact ? "Open" : "Connect"} <ArrowRight />
            </button>
          )}
        </div>

        {typing && rows > 0 && (
          <div className="qc-list" role="listbox" aria-label="Matches">
            {matches.map((s, i) => (
              <button key={s.id} type="button" role="option" aria-selected={i === sel} className={`qc-row${i === sel ? " on" : ""}`} onMouseEnter={() => setHi(i)} onClick={() => onOpen(s, parsed.path || null)}>
                <SiteGlyph />
                <span className="qc-name">
                  <span>{s.name}</span>
                  <span className="sub">
                    {protocolLabel(s.protocol)} · {serverLabel(s)}
                  </span>
                </span>
                <span className="sub">Saved login</span>
                {i === sel && <Kbd keys={["↵"]} />}
              </button>
            ))}
            {showNew && (
              <button type="button" role="option" aria-selected={sel === matches.length} className={`qc-row new${sel === matches.length ? " on" : ""}`} onMouseEnter={() => setHi(matches.length)} onClick={() => void startNew()}>
                <Plus />
                <span className="qc-name">
                  <span>
                    Connect to <b>{parsed.host}</b> as a new server
                  </span>
                </span>
                {sel === matches.length && <Kbd keys={["↵"]} />}
              </button>
            )}
          </div>
        )}

        {(phase === "details" || phase === "connecting") && found && (
          <div className="qc-login">
            <p className="qc-lead">
              {found.protocol === "ftp"
                ? `${parsed.host} only offers plain FTP, so the login and files travel unencrypted. Fine for public test servers, not for your own.`
                : `${parsed.host} is an ${protocolLabel(found.protocol)} server. Log in once and Captain remembers it.`}
            </p>
            <div className="qc-fields">
              <label className="qc-field">
                <span>Username</span>
                <input ref={userRef} className={userError ? "bad" : ""} value={user} onChange={(e) => (setUser(e.target.value), setUserError(false))} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={phase === "connecting"} />
                {userError && (
                  <span className="qc-error" role="alert">
                    Enter the username for this server.
                  </span>
                )}
              </label>
              <label className="qc-field">
                <span>Password</span>
                <input ref={passRef} type="password" className={error?.field === "pass" ? "bad" : ""} value={pass} onChange={(e) => (setPass(e.target.value), setError(null))} disabled={phase === "connecting"} />
              </label>
            </div>
            {error && (
              <p className="qc-error wide" role="alert">
                <Warning /> {error.text}
              </p>
            )}
            <div className="qc-actions">
              <span className="sub">Saved as a site, password in your Keychain</span>
              <span className="spacer" />
              {found.protocol !== "sftp" && (
                <button type="button" className="btn ghost" onClick={() => void login(true)} disabled={phase === "connecting"}>
                  Log in anonymously
                </button>
              )}
              <button type="button" className="btn primary" onClick={() => void login(false)} disabled={phase === "connecting"}>
                {phase === "connecting" ? "Logging in…" : "Log in"}
              </button>
            </div>
          </div>
        )}

        {typing && error && (
          <p className="qc-error box" role="alert">
            <Warning /> {error.text}
          </p>
        )}
      </section>

      {typing && recent.length > 0 && !text.trim() ? (
        <div className="recent">
          <h3>Recent</h3>
          {recent.map((s) => (
            <button key={s.id} className="recent-item" onClick={() => onOpen(s)}>
              <SiteGlyph />
              <span>{s.name}</span>
              <span className="sub">
                {protocolLabel(s.protocol)} · {serverLabel(s)}
                {s.lastUsed ? ` · ${when(s.lastUsed)}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : (
        !sites.length &&
        typing &&
        !text.trim() && (
          <button className="btn big" style={{ marginTop: 16 }} onClick={onNewSite}>
            Set up a site with all the details
          </button>
        )
      )}
      <div className="hints">
        <span>
          <Kbd keys={["⌘", "K"]} /> Search everything
        </span>
        <span>
          <Kbd keys={["⌘", "N"]} /> New site
        </span>
        <span>
          <Kbd keys={["⌘", "1"]} /> Transfers
        </span>
      </div>
    </div>
  );
}
