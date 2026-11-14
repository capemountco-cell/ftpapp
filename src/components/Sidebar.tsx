import { useState } from "react";

import type { Site, Transfer } from "../lib/native";
import { ArrowLeft, ArrowRight, Caret, Clock, Compose, Folder, Home, More, Plus, Question, Search, SiteGlyph, Transfers as TransfersIcon, Wordmark, ChevronDown, Star } from "./Icons";

export type View = { kind: "home" } | { kind: "transfers" } | { kind: "site"; siteId: string };

export type SiteStatus = "idle" | "connecting" | "open" | "error";

function ProgressRing({ value }: { value: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r={r} stroke="var(--line-strong)" strokeWidth="2" fill="none" />
      <circle
        cx="8"
        cy="8"
        r={r}
        stroke="var(--accent)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${Math.max(c * value, 1)} ${c}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  );
}

export function Sidebar(props: {
  sites: Site[];
  view: View;
  status: Record<string, SiteStatus>;
  transfers: Transfer[];
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onRecent: (e: React.MouseEvent) => void;
  onView: (v: View) => void;
  onNewSite: () => void;
  onSearch: () => void;
  onSiteMenu: (site: Site, e: React.MouseEvent) => void;
  onBookmark: (site: Site, path: string) => void;
  onWorkspaceMenu: (e: React.MouseEvent) => void;
  onHelp: (e: React.MouseEvent) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setCollapsed((c) => ({ ...c, [k]: !c[k] }));

  const active = props.transfers.filter((t) => t.state === "running" || t.state === "queued");
  const total = active.reduce((n, t) => n + t.bytesTotal, 0);
  const done = active.reduce((n, t) => n + t.bytesDone, 0);
  const failed = props.transfers.filter((t) => t.state === "failed").length;

  const bookmarks = props.sites.flatMap((s) => s.bookmarks.map((b) => ({ site: s, ...b })));
  const current = (v: View) =>
    props.view.kind === v.kind && (v.kind !== "site" || (props.view.kind === "site" && props.view.siteId === v.siteId));

  return (
    <aside className="sidebar">
      <div className="titlebar" data-tauri-drag-region>
        <button className="nav-btn" onClick={props.onBack} disabled={!props.canBack} title="Back (⌘[)">
          <ArrowLeft />
        </button>
        <button className="nav-btn" onClick={props.onForward} disabled={!props.canForward} title="Forward (⌘])">
          <ArrowRight />
        </button>
        <span style={{ width: 8 }} />
        <button className="nav-btn" onClick={props.onRecent} title="Recent places">
          <Clock />
        </button>
      </div>

      <div className="workspace">
        <button className="workspace-name" onClick={props.onWorkspaceMenu}>
          <Wordmark height={22} />
          <ChevronDown />
        </button>
        <span className="spacer" />
        <button className="nav-btn" onClick={props.onSearch} title="Search (⌘K)">
          <Search />
        </button>
        <button className="compose" onClick={props.onNewSite} title="New site (⌘N)">
          <Compose />
        </button>
      </div>

      <div className="side-scroll">
        <button className={`nav-item${current({ kind: "home" }) ? " current" : ""}`} onClick={() => props.onView({ kind: "home" })}>
          <Home />
          <span className="label">Start</span>
        </button>
        <button className={`nav-item${current({ kind: "transfers" }) ? " current" : ""}`} onClick={() => props.onView({ kind: "transfers" })}>
          {active.length > 0 && total > 0 ? <ProgressRing value={done / total} /> : <TransfersIcon />}
          <span className="label">Transfers</span>
          {active.length > 0 ? (
            <span className="count">{active.length}</span>
          ) : failed > 0 ? (
            <span className="count" style={{ color: "var(--bad)" }}>
              {failed}
            </span>
          ) : null}
        </button>

        <div className="section">
          <div className="section-head">
            <button className={collapsed.sites ? "collapsed" : ""} onClick={() => toggle("sites")}>
              Sites <Caret />
            </button>
            <button className="add" onClick={props.onNewSite} title="New site">
              <Plus />
            </button>
          </div>
          {!collapsed.sites &&
            (props.sites.length === 0 ? (
              <div className="section-empty">No sites yet</div>
            ) : (
              props.sites.map((site) => {
                const st = props.status[site.id] ?? "idle";
                return (
                  <button
                    key={site.id}
                    className={`nav-item${current({ kind: "site", siteId: site.id }) ? " current" : ""}`}
                    onClick={() => props.onView({ kind: "site", siteId: site.id })}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      props.onSiteMenu(site, e);
                    }}
                    title={site.host}
                  >
                    <SiteGlyph />
                    <span className="label">{site.name}</span>
                    <span
                      className="item-more"
                      role="button"
                      aria-label={`${site.name} options`}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onSiteMenu(site, e);
                      }}
                    >
                      <More />
                    </span>
                    {st === "open" && <span className="status-dot" title="Connected" />}
                    {st === "connecting" && <span className="status-dot busy" title="Connecting" />}
                  </button>
                );
              })
            ))}
        </div>

        <div className="section">
          <div className="section-head">
            <button className={collapsed.bookmarks ? "collapsed" : ""} onClick={() => toggle("bookmarks")}>
              Bookmarks <Caret />
            </button>
          </div>
          {!collapsed.bookmarks &&
            (bookmarks.length === 0 ? (
              <div className="section-empty" style={{ paddingLeft: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Press <Star className="i" /> on a folder to keep it here
                </span>
              </div>
            ) : (
              bookmarks.map((b) => (
                <button key={b.site.id + b.path} className="nav-item" onClick={() => props.onBookmark(b.site, b.path)} title={`${b.site.name} · ${b.path}`}>
                  <Folder />
                  <span className="label">{b.name}</span>
                  <span className="faint" style={{ fontSize: 11 }}>
                    {b.site.name.split(" ")[0]}
                  </span>
                </button>
              ))
            ))}
        </div>
      </div>

      <div className="side-foot">
        <button className="nav-btn" onClick={props.onHelp} title="Keyboard shortcuts">
          <Question />
        </button>
      </div>
    </aside>
  );
}
