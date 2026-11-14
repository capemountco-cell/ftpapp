import { useState } from "react";

import { protocolLabel, serverLabel, when } from "../lib/format";
import type { Site } from "../lib/native";
import { ArrowRight, Link, Mark, SiteGlyph } from "./Icons";
import { Kbd } from "./ui";

/** The start page: quick connect, and the sites used most recently. */
export function Welcome({ sites, onQuickConnect, onOpen, onNewSite }: { sites: Site[]; onQuickConnect: (url: string) => void; onOpen: (s: Site) => void; onNewSite: () => void }) {
  const [url, setUrl] = useState("");
  const recent = [...sites].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, 5);
  return (
    <div className="welcome" data-tauri-drag-region>
      <Mark size={40} />
      <h1>{sites.length ? "Where to?" : "Connect to your first server"}</h1>
      <p>SFTP, FTP and FTP with TLS. Passwords stay in your Keychain, and Teap checks every server's identity before it sends one.</p>
      <form
        className="quick"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onQuickConnect(url.trim());
        }}
      >
        <Link />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="sftp://user@example.com" spellCheck={false} autoCapitalize="off" aria-label="Server address" />
        <button type="submit" className="btn primary" disabled={!url.trim()}>
          Connect <ArrowRight />
        </button>
      </form>
      {recent.length > 0 ? (
        <div className="recent">
          <h3>Recent</h3>
          {recent.map((s) => (
            <button key={s.id} className="recent-item" onClick={() => onOpen(s)}>
              <SiteGlyph color={s.color} />
              <span>{s.name}</span>
              <span className="sub">
                {protocolLabel(s.protocol)} · {serverLabel(s)}
                {s.lastUsed ? ` · ${when(s.lastUsed)}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <button className="btn big" style={{ marginTop: 16 }} onClick={onNewSite}>
          Set up a site with all the details
        </button>
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
