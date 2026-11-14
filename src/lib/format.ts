/** Pure display helpers. No React, no native calls: all tested. */

import type { Entry, Site, Transfer } from "./native";

/** 1234 → "1.2 KB", like Finder (decimal units). */
export function bytes(n: number): string {
  if (n < 1000) return `${n} ${n === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let u = -1;
  do {
    v /= 1000;
    u++;
  } while (v >= 1000 && u < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[u]}`;
}

export function rate(bytesPerSecond: number): string {
  return `${bytes(Math.round(bytesPerSecond))}/s`;
}

/** Seconds → "12s", "4m", "1h 5m". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A modified time, relative when recent: "2m", "3h", "Yesterday", "Mar 4", "Mar 4, 2024". */
export function when(epoch: number | null, nowMs = Date.now()): string {
  if (epoch === null) return "—";
  const date = new Date(epoch * 1000);
  const ago = nowMs / 1000 - epoch;
  if (ago < 0) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (ago < 60) return "Just now";
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`;
  const now = new Date(nowMs);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(nowMs - 86400_000);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Full timestamp for the inspector. */
export function exact(epoch: number | null): string {
  if (epoch === null) return "Unknown";
  return new Date(epoch * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export type FileKind = "folder" | "code" | "image" | "archive" | "text" | "media" | "doc" | "file";

const KINDS: Record<string, FileKind> = {};
for (const e of "html htm css scss less js mjs cjs ts tsx jsx json php py rb go rs java c h cpp swift kt sh zsh bash yml yaml toml xml vue svelte sql env ini conf htaccess lock".split(" ")) KINDS[e] = "code";
for (const e of "png jpg jpeg gif webp svg ico bmp tiff heic avif".split(" ")) KINDS[e] = "image";
for (const e of "zip gz tgz tar bz2 xz 7z rar dmg pkg".split(" ")) KINDS[e] = "archive";
for (const e of "txt md markdown log csv tsv rtf".split(" ")) KINDS[e] = "text";
for (const e of "mp3 wav m4a aac flac ogg mp4 mov webm mkv avi woff woff2 ttf otf".split(" ")) KINDS[e] = "media";
for (const e of "pdf doc docx xls xlsx ppt pptx pages numbers key".split(" ")) KINDS[e] = "doc";

export function extension(name: string): string {
  const base = name.toLowerCase();
  if (base.startsWith(".") && base.indexOf(".", 1) === -1) return base.slice(1);
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1) : "";
}

export function fileKind(entry: Pick<Entry, "name" | "kind">): FileKind {
  if (entry.kind === "dir") return "folder";
  return KINDS[extension(entry.name)] ?? "file";
}

const LABELS: Record<FileKind, string> = {
  folder: "Folder",
  code: "Source",
  image: "Image",
  archive: "Archive",
  text: "Text",
  media: "Media",
  doc: "Document",
  file: "File",
};

export function kindLabel(entry: Pick<Entry, "name" | "kind">): string {
  const ext = extension(entry.name);
  const label = LABELS[fileKind(entry)];
  return entry.kind === "dir" || !ext ? label : `${ext.toUpperCase()} ${label.toLowerCase()}`;
}

/** Files Captain opens in its own editor: text-like and not huge. */
export function editable(entry: Entry): boolean {
  if (entry.kind === "dir" || entry.size > 2_000_000) return false;
  const k = fileKind(entry);
  return k === "code" || k === "text" || extension(entry.name) === "" || extension(entry.name) === "svg";
}

/** "deploy@example.com" (port shown when unusual). */
export function serverLabel(site: Site): string {
  const user = site.auth.kind === "anonymous" || !site.user ? "" : `${site.user}@`;
  const def = site.protocol === "sftp" ? 22 : 21;
  return `${user}${site.host}${site.port && site.port !== def ? `:${site.port}` : ""}`;
}

export function protocolLabel(p: Site["protocol"]): string {
  return p === "sftp" ? "SFTP" : p === "ftps" ? "FTPS" : "FTP";
}

/** The breadcrumb segments of a path: [{ name: "/", path: "/" }, { name: "var", path: "/var" }…]. */
export function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const out = [{ name: "/", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc += "/" + p;
    out.push({ name: p, path: acc });
  }
  return out;
}

export function parent(path: string): string | null {
  if (path === "/" || path === "") return null;
  const i = path.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export function join(dir: string, name: string): string {
  return (dir === "/" ? "" : dir.replace(/\/+$/, "")) + "/" + name;
}

/** Replace the home folder with "~" for display. */
export function tilde(path: string, home: string | null): string {
  if (!home || home === "/") return path;
  if (path === home) return "~";
  return path.startsWith(home + "/") ? "~" + path.slice(home.length) : path;
}

/** The progress line under a transfer. */
export function transferDetail(t: Transfer): string {
  switch (t.state) {
    case "queued":
      return "Waiting";
    case "running": {
      if (t.bytesTotal === 0) return "Preparing…";
      const parts = [`${bytes(t.bytesDone)} of ${bytes(t.bytesTotal)}`];
      if (t.rate > 0) {
        parts.push(rate(t.rate));
        parts.push(`${duration((t.bytesTotal - t.bytesDone) / t.rate)} left`);
      }
      return parts.join(" · ");
    }
    case "done": {
      const took = t.started && t.finished ? t.finished - t.started : 0;
      const size = bytes(Math.max(t.bytesTotal, t.bytesDone));
      const files = t.filesTotal > 1 ? `${t.filesTotal} files · ` : "";
      return `${files}${size}${took > 1 ? ` in ${duration(took)}` : ""}`;
    }
    case "failed":
      return t.error ?? "Failed";
    case "cancelled":
      return "Stopped";
  }
}

export function progress(t: Transfer): number {
  if (t.state === "done") return 1;
  if (t.bytesTotal === 0) return 0;
  return Math.min(1, t.bytesDone / t.bytesTotal);
}

/** Case-insensitive subsequence match; lower is better, null is no match. */
export function fuzzy(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return direct;
  let score = 100;
  let from = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    score += i - from;
    from = i + 1;
  }
  return score;
}

/** Octal mode ↔ "rwxr-xr-x". */
export function modeFrom(perms: string | null): number {
  if (!perms) return 0o644;
  const s = perms.length === 10 ? perms.slice(1) : perms;
  let mode = 0;
  for (const c of s) mode = (mode << 1) | (c === "-" ? 0 : 1);
  return mode;
}

export function permsFrom(mode: number): string {
  const chars = "rwxrwxrwx";
  let out = "";
  for (let i = 0; i < 9; i++) out += mode & (1 << (8 - i)) ? chars[i] : "-";
  return out;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}
