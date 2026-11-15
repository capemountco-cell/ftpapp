import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Browser, newTab, visibleEntries, type Tab } from "./components/Browser";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { PermissionsDialog, TrustDialog } from "./components/Dialogs";
import { Editor } from "./components/Editor";
import { Copy, Folder, FolderPlus, Home, Link, PanelRight, Plug, Plus, Refresh, SiteGlyph, Sliders, Star, Trash, Transfers as TransfersIcon, ArrowRight, KindIcon } from "./components/Icons";
import { Sidebar, type SiteStatus, type View } from "./components/Sidebar";
import { SiteSheet, blankSite } from "./components/SiteSheet";
import { TransfersView } from "./components/TransfersView";
import { Confirm, Dialog, Kbd, Menu, Prompt, Toasts, useToasts, type MenuEntry, type MenuState } from "./components/ui";
import { Welcome } from "./components/Welcome";
import { fileKind, parent, serverLabel, tilde } from "./lib/format";
import { api, copyText, demoMode, errorText, isNativeError, nativeAvailable, onTransfer, type Entry, type NativeError, type Site, type Transfer } from "./lib/native";
import { ServicesContext, type Services } from "./lib/services";

type Place = { kind: "home" } | { kind: "transfers" } | { kind: "site"; siteId: string; path: string | null };

const samePlace = (a: Place, b: Place) =>
  a.kind === b.kind && (a.kind !== "site" || (b.kind === "site" && a.siteId === b.siteId && a.path === b.path));

export function App() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ kind: "home" });
  const [tabs, setTabs] = useState<Record<string, Tab>>({});
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [inspector, setInspector] = useState(() => localStorage.getItem("captain.inspector") !== "0");
  const [downloadsDir, setDownloadsDir] = useState("~/Downloads");
  const [history, setHistory] = useState<{ back: Place[]; fwd: Place[]; recent: Place[] }>({ back: [], fwd: [], recent: [] });

  const [sheet, setSheet] = useState<{ site: Site; secret: string | null } | null>(null);
  const [trust, setTrust] = useState<{ error: NativeError; retry: () => void } | null>(null);
  const [confirm, setConfirm] = useState<Parameters<Services["confirm"]>[0] | null>(null);
  const [prompt, setPrompt] = useState<Parameters<Services["prompt"]>[0] | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [editor, setEditor] = useState<{ site: Site; entry: Entry; onSaved: () => void } | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const editorDirty = useRef(false);
  const [chmod, setChmod] = useState<{ site: Site; entry: Entry; onDone: () => void } | null>(null);
  const { toasts, push: toast } = useToasts();

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const placeRef = useRef<Place>({ kind: "home" });

  // ── Startup ─────────────────────────────────────────────

  useEffect(() => {
    if (!nativeAvailable() && !demoMode()) {
      setLoaded(true);
      return;
    }
    void api.sites().then((s) => {
      setSites(s);
      setLoaded(true);
    });
    void api.transfers().then(setTransfers);
    void api.downloadsDir().then(setDownloadsDir);
  }, []);

  useEffect(() => {
    localStorage.setItem("captain.inspector", inspector ? "1" : "0");
  }, [inspector]);

  // Transfers arrive as events; a finished upload refreshes the folder it went to.
  useEffect(() => {
    let off: (() => void) | undefined;
    void onTransfer((t) => {
      setTransfers((all) => {
        const i = all.findIndex((x) => x.id === t.id);
        if (i < 0) return [t, ...all];
        const next = all.slice();
        next[i] = t;
        return next;
      });
      if (t.state === "done" && t.direction === "upload") {
        setTabs((all) => {
          const tab = all[t.siteId];
          if (!tab || tab.path !== t.request.remote) return all;
          return { ...all, [t.siteId]: { ...tab, refreshKey: tab.refreshKey + 1 } };
        });
      }
      if (t.state === "failed") toast("bad", `${t.direction === "upload" ? "Upload" : "Download"} of “${t.name}” failed: ${t.error ?? ""}`);
    }).then((u) => (off = u));
    return () => off?.();
  }, [toast]);

  // ── Tabs and navigation ─────────────────────────────────

  const updateTab = useCallback((siteId: string, fn: (t: Tab) => Tab) => {
    setTabs((all) => ({ ...all, [siteId]: fn(all[siteId] ?? newTab()) }));
  }, []);

  const record = useCallback((place: Place) => {
    const prev = placeRef.current;
    if (samePlace(prev, place)) return;
    placeRef.current = place;
    setHistory((h) => ({
      back: [...h.back, prev].slice(-50),
      fwd: [],
      recent: [place, ...h.recent.filter((p) => !samePlace(p, place))].slice(0, 12),
    }));
  }, []);

  const connect = useCallback(
    (siteId: string, path?: string) => {
      updateTab(siteId, (t) => ({ ...t, status: "connecting", error: null }));
      api
        .connect(siteId)
        .then((opened) => {
          const target = path ?? opened.start;
          updateTab(siteId, (t) => ({ ...t, status: "open", home: opened.home, path: target, listed: null, selected: [] }));
          placeRef.current = { kind: "site", siteId, path: target };
          setSites((all) => all.map((s) => (s.id === siteId ? { ...s, lastUsed: Math.floor(Date.now() / 1000) } : s)));
        })
        .catch((e) => {
          if (isNativeError(e) && (e.kind === "unknownHost" || e.kind === "untrustedCertificate")) {
            updateTab(siteId, (t) => ({ ...t, status: "idle" }));
            const port = sitesRef.current.find((s) => s.id === siteId)?.port ?? 0;
            setTrust({
              error: e,
              retry: () =>
                void api
                  .trustServer(e.kind === "untrustedCertificate", sitesRef.current.find((s) => s.id === siteId)?.host ?? "", port, e.fingerprint)
                  .then(() => connect(siteId, path))
                  .catch((err) => toast("bad", errorText(err))),
            });
            return;
          }
          if (isNativeError(e) && e.kind === "hostKeyChanged") setTrust({ error: e, retry: () => undefined });
          updateTab(siteId, (t) => ({ ...t, status: "error", error: e }));
        });
    },
    [updateTab, toast],
  );
  const sitesRef = useRef(sites);
  sitesRef.current = sites;

  // Going anywhere closes the editor, after asking if it has unsaved edits.
  // (It covers the main area, so leaving it open hid every view behind it.)
  const leaveEditor = useCallback((then: () => void) => {
    const open = editorRef.current;
    if (!open) return then();
    if (!editorDirty.current) {
      setEditor(null);
      return then();
    }
    setConfirm({
      title: `Discard changes to “${open.entry.name}”?`,
      body: "Your edits haven't been saved to the server.",
      action: "Discard",
      danger: true,
      onConfirm: () => {
        editorDirty.current = false;
        setEditor(null);
        then();
      },
    });
  }, []);

  const goSiteNow = useCallback(
    (siteId: string, path?: string | null) => {
      setView({ kind: "site", siteId });
      const tab = tabsRef.current[siteId];
      if (!tab || tab.status === "idle" || tab.status === "error") {
        connect(siteId, path ?? undefined);
        record({ kind: "site", siteId, path: path ?? null });
      } else if (path && path !== tab.path) {
        updateTab(siteId, (t) => ({ ...t, path, selected: [], filter: "" }));
        record({ kind: "site", siteId, path });
      } else record({ kind: "site", siteId, path: tab.path });
    },
    [connect, record, updateTab],
  );
  const goSite = useCallback(
    (siteId: string, path?: string | null) => leaveEditor(() => goSiteNow(siteId, path)),
    [leaveEditor, goSiteNow],
  );

  const goView = useCallback(
    (v: View) => {
      if (v.kind === "site") return goSite(v.siteId);
      leaveEditor(() => {
        setView(v);
        record(v.kind === "home" ? { kind: "home" } : { kind: "transfers" });
      });
    },
    [goSite, leaveEditor, record],
  );

  const restore = (p: Place) => leaveEditor(() => restoreNow(p));
  const restoreNow = (p: Place) => {
    placeRef.current = p;
    if (p.kind === "site") {
      setView({ kind: "site", siteId: p.siteId });
      const tab = tabsRef.current[p.siteId];
      if (!tab || tab.status === "idle" || tab.status === "error") connect(p.siteId, p.path ?? undefined);
      else if (p.path) updateTab(p.siteId, (t) => ({ ...t, path: p.path!, selected: [] }));
    } else setView(p.kind === "home" ? { kind: "home" } : { kind: "transfers" });
  };

  const back = () => {
    const prev = history.back[history.back.length - 1];
    if (!prev) return;
    const here = placeRef.current;
    setHistory((h) => ({ ...h, back: h.back.slice(0, -1), fwd: [here, ...h.fwd] }));
    restore(prev);
  };
  const forward = () => {
    const next = history.fwd[0];
    if (!next) return;
    const here = placeRef.current;
    setHistory((h) => ({ ...h, back: [...h.back, here], fwd: h.fwd.slice(1) }));
    restore(next);
  };

  // ── Sites ───────────────────────────────────────────────

  const saveSite = async (draft: Site, secret: string | null, andConnect: boolean) => {
    const saved = await api.saveSite(draft, secret);
    setSites((all) => (all.some((s) => s.id === saved.id) ? all.map((s) => (s.id === saved.id ? saved : s)) : [...all, saved]));
    setSheet(null);
    if (andConnect) {
      setTabs((all) => ({ ...all, [saved.id]: { ...newTab(), sort: all[saved.id]?.sort ?? newTab().sort } }));
      tabsRef.current = { ...tabsRef.current, [saved.id]: newTab() };
      goSite(saved.id);
    } else toast("ok", `Saved “${saved.name}”`);
  };

  const deleteSite = (site: Site) =>
    setConfirm({
      title: `Delete “${site.name}”?`,
      body: "The site, its bookmarks and its saved password are removed from this Mac. Nothing on the server changes.",
      action: "Delete Site",
      danger: true,
      onConfirm: () =>
        void api.deleteSite(site.id).then(() => {
          setSites((all) => all.filter((s) => s.id !== site.id));
          setTabs((all) => {
            const next = { ...all };
            delete next[site.id];
            return next;
          });
          if (view.kind === "site" && view.siteId === site.id) setView({ kind: "home" });
        }),
    });

  const toggleBookmark = async (site: Site, path: string) => {
    const exists = site.bookmarks.some((b) => b.path === path);
    const bookmarks = exists ? site.bookmarks.filter((b) => b.path !== path) : [...site.bookmarks, { name: path.split("/").pop() || "/", path }];
    try {
      const saved = await api.setBookmarks(site.id, bookmarks);
      setSites((all) => all.map((s) => (s.id === saved.id ? saved : s)));
      toast("ok", exists ? "Removed bookmark" : `Bookmarked “${path.split("/").pop() || "/"}”`);
    } catch (e) {
      toast("bad", errorText(e));
    }
  };

  const disconnect = (site: Site) => {
    void api.disconnect(site.id);
    updateTab(site.id, (t) => ({ ...newTab(), sort: t.sort, showHidden: t.showHidden }));
  };

  const siteMenu = (site: Site): MenuEntry[] => {
    const open = tabs[site.id]?.status === "open";
    return [
      { label: open ? "Open" : "Connect", icon: <ArrowRight />, run: () => goSite(site.id) },
      { label: "Edit Site…", icon: <Sliders />, run: () => setSheet({ site, secret: null }) },
      { label: "Duplicate", icon: <Copy />, run: () => setSheet({ site: { ...site, id: "", name: `${site.name} copy`, bookmarks: [] }, secret: null }) },
      { label: "Copy Link", icon: <Link />, run: () => void api.urlFor(site.id, site.remotePath || "/").then(copyText).then(() => toast("ok", "Copied link")) },
      ...(open ? [{ label: "Disconnect", icon: <Plug />, run: () => disconnect(site) }] : []),
      { separator: true },
      { label: "Delete Site…", icon: <Trash />, danger: true, run: () => deleteSite(site) },
    ];
  };

  const quickConnect = async (url: string) => {
    try {
      const [site, secret] = await api.parseUrl(url);
      const existing = sites.find((s) => s.host === site.host && s.user === site.user && s.protocol === site.protocol && s.port === site.port);
      if (existing) return goSite(existing.id, site.remotePath || null);
      setSheet({ site: { ...blankSite(), ...site, color: blankSite().color }, secret });
    } catch (e) {
      toast("bad", errorText(e));
    }
  };

  // ── Services for the views ──────────────────────────────

  const showMenu = useCallback((at: { x: number; y: number }, items: MenuEntry[]) => setMenu({ ...at, items }), []);
  const services: Services = useMemo(
    () => ({
      toast,
      confirm: setConfirm,
      prompt: setPrompt,
      menu: showMenu,
      editSite: (site) => setSheet({ site, secret: null }),
      chmod: (site, entry, onDone) => setChmod({ site, entry, onDone }),
      openEditor: (site, entry, onSaved) => setEditor({ site, entry, onSaved }),
      showTransfers: () => goView({ kind: "transfers" }),
      downloadsDir,
    }),
    [toast, showMenu, downloadsDir, goView],
  );

  // ── Global shortcuts ────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || document.querySelector(".scrim")) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette(true);
      } else if (k === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSheet({ site: blankSite(), secret: null });
      } else if (k === "[") {
        e.preventDefault();
        back();
      } else if (k === "]") {
        e.preventDefault();
        forward();
      } else if (k === "i") {
        e.preventDefault();
        setInspector((v) => !v);
      } else if (k === "1") {
        e.preventDefault();
        goView({ kind: "transfers" });
      } else if (k === "0") {
        e.preventDefault();
        goView({ kind: "home" });
      } else if (k === "/" || (e.shiftKey && k === "?")) {
        e.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Command palette ─────────────────────────────────────

  const activeSite = view.kind === "site" ? sites.find((s) => s.id === view.siteId) : undefined;
  const activeTab = activeSite ? tabs[activeSite.id] : undefined;

  const commands: PaletteCommand[] = useMemo(() => {
    const list: PaletteCommand[] = [];
    for (const s of sites)
      list.push({ id: `site-${s.id}`, group: "Sites", label: s.name, sub: serverLabel(s), icon: <SiteGlyph />, run: () => goSite(s.id) });
    for (const s of sites)
      for (const b of s.bookmarks)
        list.push({ id: `bm-${s.id}-${b.path}`, group: "Bookmarks", label: b.name, sub: `${s.name} · ${b.path}`, icon: <Star />, run: () => goSite(s.id, b.path) });
    if (activeSite && activeTab?.status === "open") {
      for (const e of visibleEntries(activeTab).slice(0, 200))
        list.push({
          id: `entry-${e.path}`,
          group: "In this folder",
          label: e.name,
          icon: <KindIcon kind={fileKind(e)} />,
          run: () => (e.kind === "dir" ? goSite(activeSite.id, e.path) : updateTab(activeSite.id, (t) => ({ ...t, selected: [e.path], anchor: e.path }))),
        });
      const up = parent(activeTab.path);
      if (up) list.push({ id: "up", group: "Go", label: "Enclosing folder", sub: tilde(up, activeTab.home), keys: ["⌘", "↑"], icon: <Folder />, run: () => goSite(activeSite.id, up) });
      if (activeTab.home) list.push({ id: "home-dir", group: "Go", label: "Login folder", sub: activeTab.home, icon: <Home />, run: () => goSite(activeSite.id, activeTab.home!) });
    }
    list.push(
      { id: "new-site", group: "Actions", label: "New site", keys: ["⌘", "N"], icon: <Plus />, run: () => setSheet({ site: blankSite(), secret: null }) },
      { id: "transfers", group: "Actions", label: "Show transfers", keys: ["⌘", "1"], icon: <TransfersIcon />, run: () => goView({ kind: "transfers" }) },
      { id: "start", group: "Actions", label: "Start page", keys: ["⌘", "0"], icon: <Home />, run: () => goView({ kind: "home" }) },
      { id: "inspector", group: "Actions", label: inspector ? "Hide inspector" : "Show inspector", keys: ["⌘", "I"], icon: <PanelRight />, run: () => setInspector((v) => !v) },
    );
    if (activeSite) {
      list.push(
        { id: "refresh", group: "Actions", label: "Refresh folder", keys: ["⌘", "R"], icon: <Refresh />, run: () => updateTab(activeSite.id, (t) => ({ ...t, refreshKey: t.refreshKey + 1 })) },
        { id: "edit-site", group: "Actions", label: `Edit “${activeSite.name}”`, icon: <Sliders />, run: () => setSheet({ site: activeSite, secret: null }) },
        { id: "disconnect", group: "Actions", label: `Disconnect from “${activeSite.name}”`, icon: <Plug />, run: () => disconnect(activeSite) },
      );
    }
    list.push({ id: "help", group: "Actions", label: "Keyboard shortcuts", keys: ["⌘", "/"], icon: <Kbd keys={["?"]} />, run: () => setHelp(true) });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, activeSite, activeTab, inspector]);

  const dynamicCommands = useCallback(
    (q: string): PaletteCommand[] => {
      const out: PaletteCommand[] = [];
      if (/^(s?ftps?|ssh):\/\//i.test(q.trim()) || /^[^\s@]+@[^\s@]+$/.test(q.trim()))
        out.push({ id: "quick", group: "Connect", label: `Connect to ${q.trim()}`, icon: <Link />, run: () => void quickConnect(q.trim()) });
      if (activeSite && activeTab?.status === "open" && q.startsWith("/"))
        out.push({ id: "goto", group: "Go", label: `Go to ${q}`, icon: <FolderPlus />, run: () => goSite(activeSite.id, q) });
      return out;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSite, activeTab, sites],
  );

  // ── Render ──────────────────────────────────────────────

  const status: Record<string, SiteStatus> = {};
  for (const [id, t] of Object.entries(tabs)) status[id] = t.status;

  const placeLabel = (p: Place) => {
    if (p.kind === "home") return { label: "Start", icon: <Home /> };
    if (p.kind === "transfers") return { label: "Transfers", icon: <TransfersIcon /> };
    const s = sites.find((x) => x.id === p.siteId);
    return { label: `${s?.name ?? "Site"}${p.path ? ` · ${tilde(p.path, tabs[p.siteId]?.home ?? null)}` : ""}`, icon: <SiteGlyph /> };
  };

  let main: React.ReactNode;
  if (!loaded) main = null;
  else if (!nativeAvailable() && !demoMode()) {
    main = (
      <div className="empty">
        <h2>Captain's window isn't running</h2>
        <p>
          Start the app with <span className="code">npm run dev</span>, or open this page with <span className="code">?demo</span> to try the interface with sample data.
        </p>
      </div>
    );
  } else if (view.kind === "transfers") main = <TransfersView transfers={transfers} />;
  else if (view.kind === "site" && activeSite) {
    main = (
      <Browser
        key={activeSite.id}
        site={activeSite}
        tab={tabs[activeSite.id] ?? newTab()}
        update={(fn) => updateTab(activeSite.id, fn)}
        navigate={(path) => {
          updateTab(activeSite.id, (t) => ({ ...t, path, selected: [], filter: "" }));
          record({ kind: "site", siteId: activeSite.id, path });
        }}
        connect={() => connect(activeSite.id, tabs[activeSite.id]?.path)}
        inspector={inspector}
        onToggleInspector={() => setInspector((v) => !v)}
        onToggleBookmark={(path) => void toggleBookmark(activeSite, path)}
      />
    );
  } else {
    main = <Welcome sites={sites} onQuickConnect={(u) => void quickConnect(u)} onOpen={(s) => goSite(s.id)} onNewSite={() => setSheet({ site: blankSite(), secret: null })} />;
  }

  return (
    <ServicesContext.Provider value={services}>
      <div className="window">
        <Sidebar
          sites={sites}
          view={view}
          status={status}
          transfers={transfers}
          canBack={history.back.length > 0}
          canForward={history.fwd.length > 0}
          onBack={back}
          onForward={forward}
          onRecent={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const items: MenuEntry[] = history.recent.length
              ? [{ heading: "Recent places" }, ...history.recent.map((p) => ({ ...placeLabel(p), run: () => (p.kind === "site" ? goSite(p.siteId, p.path) : goView(p)) }))]
              : [{ heading: "Places you visit show up here" }];
            showMenu({ x: r.left, y: r.bottom + 4 }, items);
          }}
          onView={goView}
          onNewSite={() => setSheet({ site: blankSite(), secret: null })}
          onSearch={() => setPalette(true)}
          onSiteMenu={(site, e) => showMenu({ x: e.clientX, y: e.clientY }, siteMenu(site))}
          onBookmark={(site, path) => goSite(site.id, path)}
          onWorkspaceMenu={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenu({ x: r.left, y: r.bottom + 4 }, [
              { label: "New Site", icon: <Plus />, keys: ["⌘", "N"], run: () => setSheet({ site: blankSite(), secret: null }) },
              { label: "Search", icon: <Kbd keys={["⌘"]} />, keys: ["⌘", "K"], run: () => setPalette(true) },
              { label: "Transfers", icon: <TransfersIcon />, keys: ["⌘", "1"], run: () => goView({ kind: "transfers" }) },
              { separator: true },
              { label: "Keyboard Shortcuts", icon: <Kbd keys={["?"]} />, keys: ["⌘", "/"], run: () => setHelp(true) },
            ]);
          }}
          onHelp={() => setHelp(true)}
        />
        <main className="main">
          {main}
          {editor && (
            <Editor
              site={editor.site}
              entry={editor.entry}
              onSaved={editor.onSaved}
              onDirty={(d) => {
                editorDirty.current = d;
              }}
              onClose={() => {
                editorDirty.current = false;
                setEditor(null);
              }}
            />
          )}
        </main>
      </div>

      {sheet && (
        <SiteSheet
          key={sheet.site.id || "new"}
          initial={sheet.site}
          initialSecret={sheet.secret}
          onSave={saveSite}
          onClose={() => setSheet(null)}
          onTrust={(error, retry) =>
            setTrust({
              error,
              retry: () =>
                void api
                  .trustServer(error.kind === "untrustedCertificate", sheet.site.host || ("host" in error ? error.host : ""), sheet.site.port || (sheet.site.protocol === "sftp" ? 22 : 21), "fingerprint" in error ? error.fingerprint : "")
                  .then(retry),
            })
          }
        />
      )}
      {trust && <TrustDialog error={trust.error} onTrust={trust.retry} onClose={() => setTrust(null)} />}
      {confirm && <Confirm {...confirm} onClose={() => setConfirm(null)} />}
      {prompt && <Prompt {...prompt} onClose={() => setPrompt(null)} />}
      {chmod && (
        <PermissionsDialog
          entry={chmod.entry}
          onClose={() => setChmod(null)}
          onSave={(mode) =>
            void api
              .chmod(chmod.site.id, chmod.entry.path, mode)
              .then(() => {
                toast("ok", `Changed permissions of “${chmod.entry.name}”`);
                updateTab(chmod.site.id, (t) => ({ ...t, refreshKey: t.refreshKey + 1 }));
                chmod.onDone();
              })
              .catch((e) => toast("bad", errorText(e)))
          }
        />
      )}
      {palette && <CommandPalette commands={commands} dynamic={dynamicCommands} onClose={() => setPalette(false)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <Toasts toasts={toasts} />
    </ServicesContext.Provider>
  );
}

const SHORTCUTS: [string, string[]][] = [
  ["Search everything", ["⌘", "K"]],
  ["New site", ["⌘", "N"]],
  ["Back / forward", ["⌘", "[", "]"]],
  ["Enclosing folder", ["⌘", "↑"]],
  ["Open folder or file", ["⌘", "↓"]],
  ["Rename", ["↩"]],
  ["Edit in Captain", ["⌘", "E"]],
  ["Download", ["⌘", "D"]],
  ["Upload files", ["⌘", "U"]],
  ["New folder", ["⇧", "⌘", "N"]],
  ["New file", ["⌥", "⌘", "N"]],
  ["Delete", ["⌘", "⌫"]],
  ["Refresh", ["⌘", "R"]],
  ["Filter this folder", ["⌘", "F"]],
  ["Show hidden files", ["⇧", "⌘", "."]],
  ["Copy path", ["⇧", "⌘", "C"]],
  ["Inspector", ["⌘", "I"]],
  ["Transfers", ["⌘", "1"]],
  ["Save in editor", ["⌘", "S"]],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <Dialog onClose={onClose} label="Keyboard shortcuts">
      <div className="dialog-body" style={{ paddingBottom: 20 }}>
        <h2>Keyboard shortcuts</h2>
        <div style={{ marginTop: 12 }}>
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", height: 30, color: "var(--secondary)" }}>
              <span>{label}</span>
              <span className="spacer" />
              <Kbd keys={keys} />
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
