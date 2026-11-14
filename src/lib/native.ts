/**
 * Every call from the UI to Rust goes through this file, so the command
 * surface is visible in one place and argument shapes cannot drift.
 *
 * The types mirror captain-core's serialised structs (camelCase). Opened with
 * `?demo` in a plain browser, calls are answered by `mock.ts` instead, so
 * the interface can be designed and screenshotted without a server.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { mock } from "./mock";

export type Protocol = "sftp" | "ftp" | "ftps";
export type Auth = { kind: "password" } | { kind: "key"; path: string } | { kind: "agent" } | { kind: "anonymous" };

export interface Bookmark {
  name: string;
  path: string;
}

export interface Site {
  id: string;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  user: string;
  auth: Auth;
  remotePath: string;
  localPath: string;
  color: string;
  bookmarks: Bookmark[];
  lastUsed: number | null;
}

export interface Entry {
  name: string;
  path: string;
  kind: "file" | "dir";
  link: boolean;
  size: number;
  modified: number | null;
  permissions: string | null;
}

export interface Opened {
  home: string;
  start: string;
}

export type Direction = "upload" | "download";
export type TransferState = "queued" | "running" | "done" | "failed" | "cancelled";

export interface TransferRequest {
  siteId: string;
  direction: Direction;
  local: string;
  remote: string;
  isDir?: boolean;
}

export interface Transfer {
  id: number;
  siteId: string;
  siteName: string;
  direction: Direction;
  name: string;
  state: TransferState;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  current: string | null;
  rate: number;
  error: string | null;
  started: number | null;
  finished: number | null;
  result: string | null;
  request: TransferRequest;
}

export interface Watched {
  siteId: string;
  remote: string;
  local: string;
}

/** Mirrors captain_core::Error. */
export type NativeError =
  | { kind: "unknownHost"; host: string; keyType: string; fingerprint: string }
  | { kind: "hostKeyChanged"; host: string; fingerprint: string; expected: string }
  | { kind: "untrustedCertificate"; host: string; fingerprint: string; reason: string }
  | { kind: "auth"; message: string }
  | { kind: "connection"; message: string }
  | { kind: "notFound"; path: string }
  | { kind: "remote"; message: string }
  | { kind: "local"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "cancelled" };

export function isNativeError(e: unknown): e is NativeError {
  return typeof e === "object" && e !== null && "kind" in e;
}

/** A sentence for any error, native or not. */
export function errorText(e: unknown): string {
  if (isNativeError(e)) {
    switch (e.kind) {
      case "unknownHost":
        return `${e.host} is a server Captain hasn't seen before.`;
      case "hostKeyChanged":
        return `The identity of ${e.host} has changed.`;
      case "untrustedCertificate":
        return `The certificate for ${e.host} isn't trusted: ${e.reason}.`;
      case "notFound":
        return `${e.path} doesn't exist.`;
      case "cancelled":
        return "Cancelled.";
      default:
        return e.message;
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** True inside the Tauri window; false in a plain browser tab. */
export function nativeAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function demoMode(): boolean {
  return !nativeAvailable() && typeof location !== "undefined" && location.search.includes("demo");
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (demoMode()) return mock.call<T>(command, args ?? {});
  if (!nativeAvailable()) {
    throw new Error("The native side is not running. Start the app with `npm run dev`.");
  }
  return invoke<T>(command, args);
}

export const api = {
  sites: () => call<Site[]>("sites"),
  saveSite: (site: Site, secret: string | null) => call<Site>("save_site", { site, secret }),
  deleteSite: (id: string) => call<void>("delete_site", { id }),
  reorderSites: (ids: string[]) => call<void>("reorder_sites", { ids }),
  hasSecret: (id: string) => call<boolean>("has_secret", { id }),
  parseUrl: (url: string) => call<[Site, string | null]>("parse_url", { url }),
  urlFor: (siteId: string, path: string) => call<string>("url_for", { siteId, path }),
  setBookmarks: (siteId: string, bookmarks: Bookmark[]) => call<Site>("set_bookmarks", { siteId, bookmarks }),
  trustServer: (tls: boolean, host: string, port: number, fingerprint: string) =>
    call<void>("trust_server", { tls, host, port, fingerprint }),
  testSite: (site: Site, secret: string | null) => call<string>("test_site", { site, secret }),
  connect: (siteId: string) => call<Opened>("connect", { siteId }),
  disconnect: (siteId: string) => call<void>("disconnect", { siteId }),
  connected: () => call<string[]>("connected"),
  list: (siteId: string, path: string) => call<Entry[]>("list", { siteId, path }),
  mkdir: (siteId: string, dir: string, name: string) => call<string>("mkdir", { siteId, dir, name }),
  touch: (siteId: string, dir: string, name: string) => call<string>("touch", { siteId, dir, name }),
  rename: (siteId: string, path: string, name: string) => call<string>("rename", { siteId, path, name }),
  moveTo: (siteId: string, paths: string[], dir: string) => call<void>("move_to", { siteId, paths, dir }),
  delete: (siteId: string, paths: string[]) => call<void>("delete", { siteId, paths }),
  chmod: (siteId: string, path: string, mode: number) => call<void>("chmod", { siteId, path, mode }),
  readText: (siteId: string, path: string, limit: number) => call<string | null>("read_text", { siteId, path, limit }),
  writeText: (siteId: string, path: string, text: string) => call<void>("write_text", { siteId, path, text }),
  editExternal: (siteId: string, path: string) => call<Watched>("edit_external", { siteId, path }),
  watched: () => call<Watched[]>("watched"),
  stopWatching: (siteId: string, path: string) => call<void>("stop_watching", { siteId, path }),
  transfer: (requests: TransferRequest[]) => call<Transfer[]>("transfer", { requests }),
  transfers: () => call<Transfer[]>("transfers"),
  cancelTransfer: (id: number) => call<void>("cancel_transfer", { id }),
  retryTransfer: (id: number) => call<Transfer | null>("retry_transfer", { id }),
  clearTransfers: () => call<void>("clear_transfers"),
  downloadsDir: () => call<string>("downloads_dir"),
  reveal: (path: string) => call<void>("reveal", { path }),
  openLocal: (path: string) => call<void>("open_local", { path }),
};

/** Hear every change to a transfer. Returns a function that stops listening. */
export async function onTransfer(handler: (t: Transfer) => void): Promise<UnlistenFn> {
  if (demoMode()) return mock.onTransfer(handler);
  if (!nativeAvailable()) return () => {};
  return listen<Transfer>("captain://transfer", (e) => handler(e.payload));
}

/** Files dragged in from Finder. `position` is in CSS pixels. */
export type DropEvent =
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

export async function onFileDrop(handler: (e: DropEvent) => void): Promise<UnlistenFn> {
  if (!nativeAvailable()) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload;
    const scale = window.devicePixelRatio || 1;
    if (p.type === "enter" || p.type === "over") {
      handler({ type: "over", position: { x: p.position.x / scale, y: p.position.y / scale } });
    } else if (p.type === "drop") {
      handler({ type: "drop", paths: p.paths, position: { x: p.position.x / scale, y: p.position.y / scale } });
    } else {
      handler({ type: "leave" });
    }
  });
}

/** The native open panel. Returns the chosen paths, or [] if cancelled. */
export async function choose(options: { directory?: boolean; multiple?: boolean; title?: string; defaultPath?: string }): Promise<string[]> {
  if (!nativeAvailable()) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ ...options, recursive: options.directory });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
