import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { bytes, crumbs, editable, fileKind, parent, plural, protocolLabel, serverLabel, when } from "../lib/format";
import { api, choose, copyText, errorText, isNativeError, onFileDrop, type Entry, type Site } from "../lib/native";
import { useServices } from "../lib/services";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Code,
  Copy,
  Download,
  External,
  FilePlus,
  Folder,
  FolderPlus,
  KindIcon,
  Link,
  Lock,
  More,
  PanelRight,
  Pencil,
  Plug,
  Refresh,
  Search,
  SiteGlyph,
  Sliders,
  Star,
  StarFill,
  Trash,
  Upload,
  Warning,
  Eye,
} from "./Icons";
import { Inspector } from "./Inspector";
import type { SiteStatus } from "./Sidebar";
import type { MenuEntry } from "./ui";

export type SortKey = "name" | "size" | "modified";

export interface Tab {
  status: SiteStatus;
  error: unknown;
  home: string | null;
  path: string;
  /** The path `entries` were listed from. */
  listed: string | null;
  entries: Entry[];
  loading: boolean;
  listError: unknown;
  selected: string[];
  anchor: string | null;
  sort: { key: SortKey; dir: 1 | -1 };
  filter: string;
  showHidden: boolean;
  refreshKey: number;
}

export function newTab(): Tab {
  return {
    status: "idle",
    error: null,
    home: null,
    path: "/",
    listed: null,
    entries: [],
    loading: false,
    listError: null,
    selected: [],
    anchor: null,
    sort: { key: "name", dir: 1 },
    filter: "",
    showHidden: true,
    refreshKey: 0,
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function visibleEntries(tab: Tab): Entry[] {
  const q = tab.filter.trim().toLowerCase();
  const list = tab.entries.filter((e) => (tab.showHidden || !e.name.startsWith(".")) && (!q || e.name.toLowerCase().includes(q)));
  const { key, dir } = tab.sort;
  return list.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    // Folders have no size to sort by; keep them in name order.
    if (a.kind === "dir" && key === "size") return collator.compare(a.name, b.name);
    let c = 0;
    if (key === "size") c = a.size - b.size;
    else if (key === "modified") c = (a.modified ?? 0) - (b.modified ?? 0);
    if (c === 0) c = collator.compare(a.name, b.name);
    return c * dir;
  });
}

const editableTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

export function Browser({
  site,
  tab,
  update,
  navigate,
  connect,
  inspector,
  onToggleInspector,
  onToggleBookmark,
}: {
  site: Site;
  tab: Tab;
  update: (fn: (t: Tab) => Tab) => void;
  navigate: (path: string) => void;
  connect: () => void;
  inspector: boolean;
  onToggleInspector: () => void;
  onToggleBookmark: (path: string) => void;
}) {
  const services = useServices();
  const rowsRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ target: string } | null>(null);
  const typeahead = useRef({ text: "", at: 0 });

  const entries = useMemo(() => visibleEntries(tab), [tab]);
  const selected = useMemo(() => tab.entries.filter((e) => tab.selected.includes(e.path)), [tab.entries, tab.selected]);
  const bookmarked = site.bookmarks.some((b) => b.path === tab.path);
  const downloadTo = site.localPath || services.downloadsDir;

  // Load the listing whenever the folder changes or a refresh is asked for.
  useEffect(() => {
    if (tab.status !== "open") return;
    let stale = false;
    const path = tab.path;
    update((t) => ({ ...t, loading: true, listError: null }));
    api
      .list(site.id, path)
      .then((list) => {
        if (stale) return;
        update((t) => {
          const keep = t.listed === path ? t.selected.filter((p) => list.some((e) => e.path === p)) : [];
          return { ...t, entries: list, listed: path, loading: false, listError: null, selected: keep };
        });
      })
      .catch((e) => {
        if (stale) return;
        update((t) => ({ ...t, loading: false, listError: e, listed: path, entries: [] }));
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, tab.status, tab.path, tab.refreshKey]);

  useEffect(() => {
    if (tab.status === "open" && !renaming) rowsRef.current?.focus({ preventScroll: true });
  }, [tab.status, tab.path, renaming]);

  const refresh = useCallback(() => update((t) => ({ ...t, refreshKey: t.refreshKey + 1 })), [update]);

  const select = (paths: string[], anchor: string | null = paths[paths.length - 1] ?? null) =>
    update((t) => ({ ...t, selected: paths, anchor }));

  // ── Actions ─────────────────────────────────────────────

  const open = useCallback(
    (e: Entry) => {
      if (e.kind === "dir") navigate(e.path);
      else if (editable(e)) services.openEditor(site, e, refresh);
      else services.confirm({ title: `Download “${e.name}”?`, body: `Captain can't show this kind of file. It'll be saved to ${downloadTo.replace(/^\/Users\/[^/]+/, "~")}.`, action: "Download", onConfirm: () => download([e]) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, services, site, refresh, downloadTo],
  );

  const download = useCallback(
    async (items: Entry[]) => {
      if (items.length === 0) return;
      try {
        await api.transfer(items.map((e) => ({ siteId: site.id, direction: "download", local: downloadTo, remote: e.path, isDir: e.kind === "dir" })));
        services.toast("info", `Downloading ${items.length === 1 ? `“${items[0]!.name}”` : plural(items.length, "item")}`, { label: "Show", run: services.showTransfers });
      } catch (e) {
        services.toast("bad", errorText(e));
      }
    },
    [site.id, downloadTo, services],
  );

  const upload = useCallback(
    async (paths: string[], dir: string) => {
      if (paths.length === 0) return;
      try {
        await api.transfer(paths.map((p) => ({ siteId: site.id, direction: "upload", local: p, remote: dir })));
        const name = paths.length === 1 ? `“${paths[0]!.split("/").pop()}”` : plural(paths.length, "item");
        services.toast("info", `Uploading ${name} to ${dir === tab.path ? "this folder" : dir.split("/").pop()}`, { label: "Show", run: services.showTransfers });
      } catch (e) {
        services.toast("bad", errorText(e));
      }
    },
    [site.id, services, tab.path],
  );

  const pickUpload = async (directory: boolean) => {
    const paths = await choose({ multiple: true, directory, title: directory ? "Upload folders" : "Upload files" });
    void upload(paths, tab.path);
  };

  const mkdir = () =>
    services.prompt({
      title: "New folder",
      label: `In ${tab.path}`,
      initial: "untitled folder",
      action: "Create",
      onSubmit: async (name) => {
        try {
          const p = await api.mkdir(site.id, tab.path, name);
          update((t) => ({ ...t, selected: [p], anchor: p, refreshKey: t.refreshKey + 1 }));
        } catch (e) {
          services.toast("bad", errorText(e));
        }
      },
    });

  const newFile = () =>
    services.prompt({
      title: "New file",
      label: `In ${tab.path}`,
      initial: "untitled.txt",
      action: "Create",
      onSubmit: async (name) => {
        try {
          const p = await api.touch(site.id, tab.path, name);
          update((t) => ({ ...t, selected: [p], anchor: p, refreshKey: t.refreshKey + 1 }));
        } catch (e) {
          services.toast("bad", errorText(e));
        }
      },
    });

  const commitRename = async (entry: Entry, name: string) => {
    setRenaming(null);
    if (!name.trim() || name.trim() === entry.name) return;
    try {
      const p = await api.rename(site.id, entry.path, name.trim());
      update((t) => ({ ...t, selected: [p], anchor: p, refreshKey: t.refreshKey + 1 }));
    } catch (e) {
      services.toast("bad", errorText(e));
    }
  };

  const remove = (items: Entry[]) => {
    if (items.length === 0) return;
    const folders = items.filter((e) => e.kind === "dir").length;
    services.confirm({
      title: items.length === 1 ? `Delete “${items[0]!.name}”?` : `Delete ${items.length} items?`,
      body: `${folders ? "Folders are deleted with everything inside them. " : ""}This removes ${items.length === 1 ? "it" : "them"} from ${site.name} and can't be undone.`,
      action: "Delete",
      danger: true,
      onConfirm: async () => {
        try {
          await api.delete(site.id, items.map((e) => e.path));
          services.toast("ok", items.length === 1 ? `Deleted “${items[0]!.name}”` : `Deleted ${items.length} items`);
          update((t) => ({ ...t, selected: [], refreshKey: t.refreshKey + 1 }));
        } catch (e) {
          services.toast("bad", errorText(e));
          refresh();
        }
      },
    });
  };

  const editExternal = async (e: Entry) => {
    try {
      await api.editExternal(site.id, e.path);
      services.toast("ok", `Opened “${e.name}”. Saves upload automatically.`);
    } catch (err) {
      services.toast("bad", errorText(err));
    }
  };

  const copyPath = (items: Entry[]) => {
    const text = items.length ? items.map((e) => e.path).join("\n") : tab.path;
    void copyText(text).then(() => services.toast("ok", "Copied path"));
  };

  const copyUrl = async (e: Entry | null) => {
    const url = await api.urlFor(site.id, e?.path ?? tab.path);
    await copyText(url);
    services.toast("ok", "Copied link");
  };

  const entryMenu = (e: Entry, items: Entry[]): MenuEntry[] => {
    const one = items.length === 1;
    return [
      ...(one && e.kind === "dir" ? [{ label: "Open", icon: <Folder />, keys: ["⌘", "↓"], run: () => navigate(e.path) }] : []),
      ...(one && editable(e) ? [{ label: "Edit in Captain", icon: <Code />, keys: ["⌘", "E"], run: () => services.openEditor(site, e, refresh) }] : []),
      ...(one && e.kind === "file" ? [{ label: "Open in Default App", icon: <External />, run: () => void editExternal(e) }] : []),
      { label: one ? "Download" : `Download ${items.length} Items`, icon: <Download />, keys: ["⌘", "D"], run: () => void download(items) },
      { separator: true },
      ...(one ? [{ label: "Rename", icon: <Pencil />, keys: ["↩"], run: () => setRenaming(e.path) }] : []),
      ...(one ? [{ label: "Permissions…", icon: <Lock />, run: () => services.chmod(site, e, refresh) }] : []),
      { label: one ? "Copy Path" : "Copy Paths", icon: <Copy />, keys: ["⇧", "⌘", "C"], run: () => copyPath(items) },
      ...(one ? [{ label: "Copy Link", icon: <Link />, run: () => void copyUrl(e) }] : []),
      ...(one && e.kind === "dir"
        ? [{ label: site.bookmarks.some((b) => b.path === e.path) ? "Remove Bookmark" : "Bookmark", icon: <Star />, run: () => onToggleBookmark(e.path) }]
        : []),
      { separator: true },
      { label: one ? "Delete" : `Delete ${items.length} Items`, icon: <Trash />, keys: ["⌘", "⌫"], danger: true, run: () => remove(items) },
    ];
  };

  const folderMenu = (): MenuEntry[] => [
    { label: "New Folder", icon: <FolderPlus />, keys: ["⇧", "⌘", "N"], run: mkdir },
    { label: "New File", icon: <FilePlus />, keys: ["⌥", "⌘", "N"], run: newFile },
    { separator: true },
    { label: "Upload Files…", icon: <Upload />, keys: ["⌘", "U"], run: () => void pickUpload(false) },
    { label: "Upload Folder…", icon: <Upload />, run: () => void pickUpload(true) },
    { separator: true },
    { label: tab.showHidden ? "Hide Hidden Files" : "Show Hidden Files", icon: <Eye />, keys: ["⇧", "⌘", "."], run: () => update((t) => ({ ...t, showHidden: !t.showHidden })) },
    { label: "Refresh", icon: <Refresh />, keys: ["⌘", "R"], run: refresh },
    { label: "Copy Path", icon: <Copy />, run: () => copyPath([]) },
    { label: "Copy Link", icon: <Link />, run: () => void copyUrl(null) },
  ];

  const siteMenu = (): MenuEntry[] => [
    { heading: `${protocolLabel(site.protocol)} · ${serverLabel(site)}` },
    { label: "Edit Site…", icon: <Sliders />, run: () => services.editSite(site) },
    { label: "Copy Link to Folder", icon: <Link />, run: () => void copyUrl(null) },
    { label: "Reconnect", icon: <Refresh />, run: () => connect() },
    { separator: true },
    {
      label: "Disconnect",
      icon: <Plug />,
      run: () => {
        void api.disconnect(site.id);
        update((t) => ({ ...newTab(), sort: t.sort, showHidden: t.showHidden }));
      },
    },
  ];

  // ── Drag and drop from Finder ───────────────────────────

  useEffect(() => {
    if (tab.status !== "open") return;
    const targetAt = (x: number, y: number): string => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
      return el?.dataset.drop ?? tab.path;
    };
    let unlisten: (() => void) | undefined;
    void onFileDrop((e) => {
      if (e.type === "over") setDrop({ target: targetAt(e.position.x, e.position.y) });
      else if (e.type === "leave") setDrop(null);
      else {
        setDrop(null);
        void upload(e.paths, targetAt(e.position.x, e.position.y));
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [tab.status, tab.path, upload]);

  // ── Keyboard ────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".scrim, .menu, .editor")) return;
      if (editableTarget(e.target) && e.target !== filterRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key;
      if (e.target === filterRef.current) {
        if (k === "Escape") {
          update((t) => ({ ...t, filter: "" }));
          rowsRef.current?.focus();
        } else if (k === "ArrowDown" || k === "Enter") {
          e.preventDefault();
          rowsRef.current?.focus();
          if (entries[0]) select([entries[0].path]);
        }
        return;
      }
      if (tab.status !== "open") return;

      const index = entries.findIndex((x) => x.path === (tab.anchor ?? tab.selected[tab.selected.length - 1]));
      const move = (to: number, extend: boolean) => {
        const target = entries[Math.max(0, Math.min(entries.length - 1, to))];
        if (!target) return;
        if (extend && tab.anchor) {
          const a = entries.findIndex((x) => x.path === tab.selected[0]);
          const lo = Math.min(a, to);
          const hi = Math.max(a, to);
          update((t) => ({ ...t, selected: entries.slice(lo, hi + 1).map((x) => x.path), anchor: target.path }));
        } else select([target.path]);
        rowsRef.current?.querySelector(`[data-path="${CSS.escape(target.path)}"]`)?.scrollIntoView({ block: "nearest" });
      };

      if (mod && k === "ArrowUp") {
        e.preventDefault();
        const up = parent(tab.path);
        if (up) navigate(up);
      } else if (mod && k === "ArrowDown") {
        e.preventDefault();
        if (selected[0] && selected.length === 1) open(selected[0]);
      } else if (k === "ArrowDown") {
        e.preventDefault();
        move(index < 0 ? 0 : index + 1, e.shiftKey);
      } else if (k === "ArrowUp") {
        e.preventDefault();
        move(index < 0 ? entries.length - 1 : index - 1, e.shiftKey);
      } else if (k === "Home") {
        e.preventDefault();
        move(0, false);
      } else if (k === "End") {
        e.preventDefault();
        move(entries.length - 1, false);
      } else if (k === "Enter" && !mod) {
        e.preventDefault();
        if (selected[0] && selected.length === 1) setRenaming(selected[0].path);
      } else if (mod && k === "Backspace") {
        e.preventDefault();
        remove(selected);
      } else if (mod && k.toLowerCase() === "a" && !e.shiftKey) {
        e.preventDefault();
        select(entries.map((x) => x.path));
      } else if (mod && k.toLowerCase() === "r") {
        e.preventDefault();
        refresh();
      } else if (mod && e.shiftKey && k.toLowerCase() === "n") {
        e.preventDefault();
        mkdir();
      } else if (mod && e.altKey && (k.toLowerCase() === "n" || e.code === "KeyN")) {
        e.preventDefault();
        newFile();
      } else if (mod && k.toLowerCase() === "u") {
        e.preventDefault();
        void pickUpload(false);
      } else if (mod && k.toLowerCase() === "d") {
        e.preventDefault();
        void download(selected);
      } else if (mod && k.toLowerCase() === "e") {
        e.preventDefault();
        if (selected[0] && selected.length === 1 && editable(selected[0])) services.openEditor(site, selected[0], refresh);
      } else if (mod && k.toLowerCase() === "f") {
        e.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      } else if (mod && e.shiftKey && k.toLowerCase() === "c") {
        e.preventDefault();
        copyPath(selected);
      } else if (mod && e.shiftKey && (k === "." || k === ">")) {
        e.preventDefault();
        update((t) => ({ ...t, showHidden: !t.showHidden }));
      } else if (k === "Escape") {
        if (tab.filter) update((t) => ({ ...t, filter: "" }));
        else select([]);
      } else if (!mod && !e.altKey && k.length === 1 && /\S/.test(k)) {
        // Type to select, like Finder.
        const ta = typeahead.current;
        const now = Date.now();
        ta.text = now - ta.at > 800 ? k.toLowerCase() : ta.text + k.toLowerCase();
        ta.at = now;
        const hit = entries.find((x) => x.name.toLowerCase().startsWith(ta.text));
        if (hit) move(entries.indexOf(hit), false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Render ──────────────────────────────────────────────

  const segs = crumbs(tab.path);
  const home = tab.home;
  const onRowClick = (e: React.MouseEvent, entry: Entry) => {
    if (e.metaKey || e.ctrlKey) {
      const has = tab.selected.includes(entry.path);
      update((t) => ({ ...t, selected: has ? t.selected.filter((p) => p !== entry.path) : [...t.selected, entry.path], anchor: entry.path }));
    } else if (e.shiftKey && tab.anchor) {
      const a = entries.findIndex((x) => x.path === tab.anchor);
      const b = entries.findIndex((x) => x.path === entry.path);
      update((t) => ({ ...t, selected: entries.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path) }));
    } else if (tab.selected.length === 1 && tab.selected[0] === entry.path && !renaming) {
      // Click on an already-selected row's name: rename after a pause, like Finder.
      const target = e.target as HTMLElement;
      if (target.closest(".name span")) {
        const path = entry.path;
        window.setTimeout(() => setRenaming((r) => (r === null && tabSelectedRef.current.length === 1 && tabSelectedRef.current[0] === path ? path : r)), 550);
      }
    } else select([entry.path]);
  };
  const tabSelectedRef = useRef(tab.selected);
  tabSelectedRef.current = tab.selected;

  const sortBy = (key: SortKey) =>
    update((t) => ({ ...t, sort: { key, dir: t.sort.key === key ? (t.sort.dir === 1 ? -1 : 1) : key === "name" ? 1 : -1 } }));

  const SortMark = ({ k }: { k: SortKey }) => (tab.sort.key === k ? tab.sort.dir === 1 ? <ArrowUp /> : <ArrowDown /> : null);

  let body: React.ReactNode;
  if (tab.status === "idle") {
    body = (
      <div className="empty">
        <Plug className="i empty-icon" />
        <h2>Not connected</h2>
        <p>
          {protocolLabel(site.protocol)} · {serverLabel(site)}
        </p>
        <div className="actions">
          <button className="btn big" onClick={() => services.editSite(site)}>
            <Sliders /> Edit site
          </button>
          <button className="btn primary big" onClick={connect} autoFocus>
            Connect
          </button>
        </div>
      </div>
    );
  } else if (tab.status === "connecting" || (tab.loading && tab.listed !== tab.path)) {
    body = (
      <div className="rows skeleton" aria-busy>
        {Array.from({ length: 9 }, (_, i) => (
          <div className="row" key={i}>
            <div className="name">
              <span className="sk icon" />
              <span className="sk" style={{ width: `${30 + ((i * 37) % 40)}%` }} />
            </div>
            <span className="sk" style={{ width: 40, justifySelf: "end", marginRight: 24 }} />
            <span className="sk" style={{ width: 70 }} />
          </div>
        ))}
      </div>
    );
  } else if (tab.status === "error") {
    const err = tab.error;
    const auth = isNativeError(err) && err.kind === "auth";
    body = (
      <div className="empty">
        <Warning className="i empty-icon error-icon" />
        <h2>{auth ? "Couldn't log in" : "Couldn't connect"}</h2>
        <p>{errorText(err)}</p>
        <div className="actions">
          <button className="btn big" onClick={() => services.editSite(site)}>
            <Sliders /> Edit site
          </button>
          <button className="btn primary big" onClick={connect}>
            Try again
          </button>
        </div>
      </div>
    );
  } else if (tab.listError) {
    body = (
      <div className="empty">
        <Warning className="i empty-icon" />
        <h2>Can't open this folder</h2>
        <p>{errorText(tab.listError)}</p>
        <div className="actions">
          {parent(tab.path) && (
            <button className="btn big" onClick={() => navigate(parent(tab.path)!)}>
              Go up
            </button>
          )}
          <button className="btn big" onClick={refresh}>
            Try again
          </button>
        </div>
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <div
        className="empty"
        onContextMenu={(e) => {
          e.preventDefault();
          services.menu({ x: e.clientX, y: e.clientY }, folderMenu());
        }}
      >
        {tab.filter ? (
          <>
            <Search className="i empty-icon" />
            <h2>No matches</h2>
            <p>Nothing here is called “{tab.filter}”.</p>
          </>
        ) : (
          <>
            <Folder className="i empty-icon" />
            <h2>This folder is empty</h2>
            <p>Drop files from Finder to upload them here.</p>
            <div className="actions">
              <button className="btn big" onClick={mkdir}>
                <FolderPlus /> New folder
              </button>
              <button className="btn big" onClick={() => void pickUpload(false)}>
                <Upload /> Upload files
              </button>
            </div>
          </>
        )}
      </div>
    );
  } else {
    body = (
      <div
        className="rows"
        ref={rowsRef}
        tabIndex={0}
        role="listbox"
        aria-multiselectable
        aria-label={`Contents of ${tab.path}`}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) select([]);
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          select([]);
          services.menu({ x: e.clientX, y: e.clientY }, folderMenu());
        }}
      >
        {entries.map((entry) => {
          const isSel = tab.selected.includes(entry.path);
          return (
            <div
              key={entry.path}
              data-path={entry.path}
              data-drop={entry.kind === "dir" ? entry.path : undefined}
              role="option"
              aria-selected={isSel}
              className={`row${isSel ? " selected" : ""}${drop?.target === entry.path ? " drop" : ""}${entry.name.startsWith(".") ? " dim" : ""}`}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                onRowClick(e, entry);
              }}
              onDoubleClick={() => open(entry)}
              onContextMenu={(e) => {
                e.preventDefault();
                const items = isSel ? selected : [entry];
                if (!isSel) select([entry.path]);
                services.menu({ x: e.clientX, y: e.clientY }, entryMenu(entry, items));
              }}
            >
              <div className="name">
                <KindIcon kind={fileKind(entry)} />
                {renaming === entry.path ? (
                  <RenameInput entry={entry} onDone={(name) => void commitRename(entry, name)} onCancel={() => setRenaming(null)} />
                ) : (
                  <span>{entry.name}</span>
                )}
                {entry.link && <span className="link-badge">↗</span>}
              </div>
              <span className="size">{entry.kind === "dir" ? "—" : bytes(entry.size)}</span>
              <span className="date">{when(entry.modified)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  const totalSize = entries.reduce((n, e) => n + (e.kind === "file" ? e.size : 0), 0);
  const selSize = selected.reduce((n, e) => n + (e.kind === "file" ? e.size : 0), 0);

  return (
    <>
      <header className="header" data-tauri-drag-region>
        <nav className="crumbs" aria-label="Path">
          <button className="crumb root" data-drop={home ?? "/"} onClick={() => home && navigate(home)} title={`${site.name} — go to login folder`}>
            <SiteGlyph />
            {site.name}
          </button>
          {segs.slice(1).map((c, i, all) => {
            // Collapse the middle of deep paths: "… › parent › current".
            if (all.length > 4 && i > 0 && i < all.length - 3) {
              return i === 1 ? (
                <span key="gap" style={{ display: "contents" }}>
                  <ChevronRight className="i crumb-sep" />
                  <button
                    className="crumb"
                    onClick={(e) =>
                      services.menu(
                        { x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 },
                        all.slice(1, all.length - 3).map((x) => ({ label: x.name, icon: <Folder />, run: () => navigate(x.path) })),
                      )
                    }
                  >
                    …
                  </button>
                </span>
              ) : null;
            }
            const last = i === all.length - 1;
            return (
              <span key={c.path} style={{ display: "contents" }}>
                <ChevronRight className="i crumb-sep" />
                <button className={`crumb${last ? " last" : ""}${drop?.target === c.path ? " drop" : ""}`} data-drop={c.path} onClick={() => navigate(c.path)}>
                  {c.name}
                </button>
              </span>
            );
          })}
        </nav>
        <button className="icon-btn" title="Site options" onClick={(e) => services.menu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 }, siteMenu())}>
          <More />
        </button>
        {tab.status === "open" && (
          <button className={`icon-btn${bookmarked ? " starred" : ""}`} title={bookmarked ? "Remove bookmark" : "Bookmark this folder"} onClick={() => onToggleBookmark(tab.path)}>
            {bookmarked ? <StarFill /> : <Star />}
          </button>
        )}
        <span className="spacer" data-tauri-drag-region />
        {tab.status === "open" && (
          <>
            <label className="filter">
              <Search />
              <input ref={filterRef} value={tab.filter} onChange={(e) => update((t) => ({ ...t, filter: e.target.value }))} placeholder="Filter" spellCheck={false} aria-label="Filter this folder" />
            </label>
            <button className="btn" onClick={(e) => services.menu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 }, [
              { label: "Upload Files…", icon: <Upload />, keys: ["⌘", "U"], run: () => void pickUpload(false) },
              { label: "Upload Folder…", icon: <Upload />, run: () => void pickUpload(true) },
            ])}>
              <Upload /> Upload
            </button>
            <button className="icon-btn" title="New folder (⇧⌘N)" onClick={mkdir}>
              <FolderPlus />
            </button>
            <button className="icon-btn" title="Refresh (⌘R)" onClick={refresh}>
              <Refresh className={`i${tab.loading ? " spin" : ""}`} />
            </button>
            <span className="divider" />
          </>
        )}
        <button className={`icon-btn${inspector ? " on" : ""}`} title="Inspector (⌘I)" onClick={onToggleInspector}>
          <PanelRight />
        </button>
      </header>

      <div className="body">
        <section className="listing">
          {tab.status === "open" && !tab.listError && (entries.length > 0 || tab.loading) && (
            <div className="cols">
              <button className={tab.sort.key === "name" ? "on" : ""} onClick={() => sortBy("name")}>
                Name <SortMark k="name" />
              </button>
              <button className={`right${tab.sort.key === "size" ? " on" : ""}`} style={{ paddingRight: 12 }} onClick={() => sortBy("size")}>
                Size <SortMark k="size" />
              </button>
              <button className={tab.sort.key === "modified" ? "on" : ""} onClick={() => sortBy("modified")}>
                Modified <SortMark k="modified" />
              </button>
            </div>
          )}
          {body}
          {drop && drop.target === tab.path && (
            <div className="dropzone">
              <div>
                <Upload /> Drop to upload to {tab.path === home ? "your login folder" : `“${tab.path.split("/").pop() || "/"}”`}
              </div>
            </div>
          )}
          <footer className="statusbar">
            <span className="conn">
              <span className={`dot${tab.status === "open" ? "" : " off"}`} />
              {protocolLabel(site.protocol)} · {serverLabel(site)}
            </span>
            <span className="spacer" />
            {tab.status === "open" && (
              <span>
                {selected.length > 0
                  ? `${selected.length} of ${plural(entries.length, "item")} selected${selSize ? ` · ${bytes(selSize)}` : ""}`
                  : `${plural(entries.length, "item")}${totalSize ? ` · ${bytes(totalSize)}` : ""}`}
              </span>
            )}
          </footer>
        </section>
        {inspector && (
          <Inspector
            site={site}
            tab={tab}
            selected={selected}
            onOpen={open}
            onDownload={(items) => void download(items)}
            onRename={(e) => setRenaming(e.path)}
            onDelete={remove}
            onEditExternal={(e) => void editExternal(e)}
            onCopyPath={copyPath}
            onCopyUrl={(e) => void copyUrl(e)}
          />
        )}
      </div>
    </>
  );
}

function RenameInput({ entry, onDone, onCancel }: { entry: Entry; onDone: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(entry.name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = entry.kind === "file" ? entry.name.lastIndexOf(".") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : entry.name.length);
  }, [entry]);
  return (
    <input
      ref={ref}
      className="rename"
      value={value}
      spellCheck={false}
      aria-label="New name"
      onChange={(e) => setValue(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          done.current = true;
          onDone(value);
        } else if (e.key === "Escape") {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (!done.current) onDone(value);
      }}
    />
  );
}
