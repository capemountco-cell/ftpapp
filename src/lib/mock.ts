/**
 * A pretend backend for `?demo` in a plain browser: a few sites, a website
 * on a server, and transfers that progress on a timer. Nothing here runs in
 * the app.
 */

import type { Entry, Site, Transfer, TransferRequest } from "./native";

type Node = { dir: true; children: Record<string, Node>; modified: number } | { dir: false; size: number; modified: number; text?: string };

const day = 86400;
const now = Math.floor(Date.now() / 1000);

const file = (size: number, ago: number, text?: string): Node => ({ dir: false, size, modified: now - ago, text });
const dir = (children: Record<string, Node>, ago = day): Node => ({ dir: true, children, modified: now - ago });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Northwind Coffee</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <main>
      <h1>Small-batch coffee, roasted Tuesdays.</h1>
      <p>Order by Monday night for Wednesday delivery.</p>
    </main>
    <script src="/assets/app.js"></script>
  </body>
</html>
`;

const tree: Node = dir({
  var: dir({
    www: dir({
      "northwind.coffee": dir(
        {
          assets: dir({
            "app.css": file(18_204, 3600 * 5, "main { max-width: 42rem; margin: 0 auto; }\n"),
            "app.js": file(52_118, 3600 * 5, "document.documentElement.dataset.ready = '1';\n"),
            "hero@2x.jpg": file(1_482_330, day * 4),
            "logo.svg": file(3_120, day * 30),
            fonts: dir({ "Inter.woff2": file(98_220, day * 90) }, day * 90),
          }, 3600 * 5),
          blog: dir({
            "2026-10-roasting-notes.md": file(6_310, day * 12, "# Roasting notes\n\nThis month: Ethiopia Guji.\n"),
            "2026-11-holiday-hours.md": file(1_904, day * 2, "# Holiday hours\n"),
          }, day * 2),
          ".htaccess": file(612, day * 120, "RewriteEngine On\nRewriteRule ^shop$ /shop.html [L]\n"),
          "index.html": file(html.length, 3600 * 2, html),
          "shop.html": file(9_884, day * 3, "<h1>Shop</h1>\n"),
          "robots.txt": file(64, day * 200, "User-agent: *\nAllow: /\n"),
          "sitemap.xml": file(2_210, day * 3, "<urlset></urlset>\n"),
          "backup-2026-10-01.tar.gz": file(48_331_920, day * 44),
        },
        3600 * 2,
      ),
      staging: dir({ "index.html": file(1_120, day * 6, "<h1>Staging</h1>\n") }, day * 6),
    }),
    log: dir({ "access.log": file(12_884_100, 60), "error.log": file(40_112, 3600) }, 60),
  }),
  home: dir({ deploy: dir({ ".bashrc": file(3_771, day * 300, "export PATH=$HOME/bin:$PATH\n"), "deploy.sh": file(1_204, day * 9, "#!/bin/sh\nrsync -a dist/ /var/www/\n") }) }),
});

let sites: Site[] = [
  {
    id: "s-prod",
    name: "Northwind Production",
    protocol: "sftp",
    host: "northwind.coffee",
    port: 22,
    user: "deploy",
    auth: { kind: "key", path: "~/.ssh/id_ed25519" },
    remotePath: "/var/www/northwind.coffee",
    localPath: "",
    color: "indigo",
    bookmarks: [
      { name: "assets", path: "/var/www/northwind.coffee/assets" },
      { name: "Logs", path: "/var/log" },
    ],
    lastUsed: now - 600,
  },
  {
    id: "s-staging",
    name: "Staging",
    protocol: "sftp",
    host: "staging.northwind.coffee",
    port: 2222,
    user: "deploy",
    auth: { kind: "password" },
    remotePath: "/var/www/staging",
    localPath: "",
    color: "teal",
    bookmarks: [],
    lastUsed: now - day,
  },
  {
    id: "s-host",
    name: "Shared hosting",
    protocol: "ftps",
    host: "ftp.example-host.net",
    port: 21,
    user: "northwind",
    auth: { kind: "password" },
    remotePath: "",
    localPath: "",
    color: "orange",
    bookmarks: [],
    lastUsed: null,
  },
  {
    id: "s-mirror",
    name: "GNU mirror",
    protocol: "ftp",
    host: "ftp.gnu.org",
    port: 21,
    user: "",
    auth: { kind: "anonymous" },
    remotePath: "/gnu",
    localPath: "",
    color: "gray",
    bookmarks: [],
    lastUsed: null,
  },
];

function find(path: string): Node | null {
  let node: Node = tree;
  for (const part of path.split("/").filter(Boolean)) {
    if (!node.dir || !node.children[part]) return null;
    node = node.children[part];
  }
  return node;
}

function split(path: string): [string, string] {
  const i = path.lastIndexOf("/");
  return [i <= 0 ? "/" : path.slice(0, i), path.slice(i + 1)];
}

function join(dirPath: string, name: string) {
  return (dirPath === "/" ? "" : dirPath) + "/" + name;
}

const fail = (message: string) => Promise.reject({ kind: "remote", message });

let transfers: Transfer[] = [];
let nextId = 1;
const listeners = new Set<(t: Transfer) => void>();
const emit = (t: Transfer) => listeners.forEach((l) => l({ ...t }));

function seedTransfers() {
  const base = (over: Partial<Transfer>): Transfer => ({
    id: nextId++,
    siteId: "s-prod",
    siteName: "Northwind Production",
    direction: "upload",
    name: "",
    state: "done",
    bytesDone: 0,
    bytesTotal: 0,
    filesDone: 1,
    filesTotal: 1,
    current: null,
    rate: 0,
    error: null,
    started: now - 300,
    finished: now - 290,
    result: null,
    request: { siteId: "s-prod", direction: "upload", local: "", remote: "/var/www/northwind.coffee" },
    ...over,
  });
  transfers = [
    base({ name: "dist", state: "running", bytesDone: 7_340_032, bytesTotal: 18_874_368, filesDone: 41, filesTotal: 112, current: "hero@2x.jpg", rate: 2_411_000, finished: null }),
    base({ name: "backup-2026-10-01.tar.gz", direction: "download", request: { siteId: "s-prod", direction: "download", local: "/Users/you/Downloads", remote: "/var/www/northwind.coffee/backup-2026-10-01.tar.gz" }, state: "running", bytesDone: 12_000_000, bytesTotal: 48_331_920, rate: 5_900_000, finished: null, result: null }),
    base({ name: "shop.html", state: "queued", bytesTotal: 9_884, finished: null, started: null }),
    base({ name: "index.html", bytesDone: 612, bytesTotal: 612, result: "/var/www/northwind.coffee/index.html" }),
    base({ name: "error.log", direction: "download", request: { siteId: "s-staging", direction: "download", local: "/Users/you/Downloads", remote: "/var/log/error.log" }, siteName: "Staging", state: "failed", error: "Permission denied", bytesTotal: 40_112 }),
  ];
}
let started = false;

/** Only in demo mode: the app itself never runs this timer. */
function start() {
  if (started) return;
  started = true;
  seedTransfers();
  setInterval(tick, 200);
}

function tick() {
  for (const t of transfers) {
    if (t.state !== "running") continue;
    t.bytesDone = Math.min(t.bytesTotal, t.bytesDone + t.rate / 5);
    if (t.filesTotal > 1) t.filesDone = Math.min(t.filesTotal, Math.round((t.bytesDone / t.bytesTotal) * t.filesTotal));
    if (t.bytesDone >= t.bytesTotal) {
      t.state = "done";
      t.finished = Math.floor(Date.now() / 1000);
      t.current = null;
      const q = transfers.find((x) => x.state === "queued");
      if (q) {
        q.state = "running";
        q.rate = 800_000;
        emit(q);
      }
    }
    emit(t);
  }
}

function add(r: TransferRequest): Transfer {
  const name = r.direction === "upload" ? r.local.split("/").pop() ?? r.local : split(r.remote)[1];
  const t: Transfer = {
    id: nextId++,
    siteId: r.siteId,
    siteName: sites.find((s) => s.id === r.siteId)?.name ?? "",
    direction: r.direction,
    name,
    state: "running",
    bytesDone: 0,
    bytesTotal: 4_000_000,
    filesDone: 0,
    filesTotal: 1,
    current: name,
    rate: 1_500_000,
    error: null,
    started: Math.floor(Date.now() / 1000),
    finished: null,
    result: null,
    request: r,
  };
  transfers.unshift(t);
  emit(t);
  return t;
}

// Each handler takes its own argument shape; `never` accepts them all.
const handlers: Record<string, (a: never) => unknown> = {
  sites: () => sites,
  save_site: ({ site }: { site: Site }) => {
    const s = { ...site, id: site.id || `s-${Date.now()}`, name: site.name || site.host, port: site.port || (site.protocol === "sftp" ? 22 : 21) };
    sites = sites.some((x) => x.id === s.id) ? sites.map((x) => (x.id === s.id ? s : x)) : [...sites, s];
    return s;
  },
  delete_site: ({ id }: { id: string }) => {
    sites = sites.filter((s) => s.id !== id);
  },
  reorder_sites: () => undefined,
  has_secret: () => true,
  parse_url: ({ url }: { url: string }) => {
    const m = /^(\w+):\/\/(?:([^@:]+)@)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url.trim());
    if (!m) return Promise.reject({ kind: "invalid", message: "That isn't a server address" });
    const protocol = m[1] === "ftp" ? "ftp" : m[1] === "ftps" ? "ftps" : "sftp";
    return [
      { id: "", name: "", protocol, host: m[3], port: Number(m[4] ?? 0), user: m[2] ?? "", auth: { kind: m[2] ? "password" : "anonymous" }, remotePath: m[5] ?? "", localPath: "", color: "indigo", bookmarks: [], lastUsed: null },
      null,
    ];
  },
  url_for: ({ siteId, path }: { siteId: string; path: string }) => {
    const s = sites.find((x) => x.id === siteId)!;
    return `${s.protocol}://${s.user ? s.user + "@" : ""}${s.host}${path}`;
  },
  set_bookmarks: ({ siteId, bookmarks }: { siteId: string; bookmarks: Site["bookmarks"] }) => {
    sites = sites.map((s) => (s.id === siteId ? { ...s, bookmarks } : s));
    return sites.find((s) => s.id === siteId);
  },
  trust_server: () => undefined,
  test_site: () => new Promise((r) => setTimeout(() => r("/home/deploy"), 600)),
  connect: ({ siteId }: { siteId: string }) =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        const s = sites.find((x) => x.id === siteId)!;
        if (s.id === "s-host") reject({ kind: "untrustedCertificate", host: s.host, fingerprint: "3F:9A:1C:0B:77:E2:5D:41:A8:9C:12:6E:F0:33:B4:CB:58:0D:91:2A:6F:E4:7B:C1:09:DD:84:3A:5E:72:B6:10", reason: "it's self-signed" });
        else resolve({ home: "/home/deploy", start: s.remotePath || "/home/deploy" });
      }, 350),
    ),
  disconnect: () => undefined,
  connected: () => [],
  list: ({ path }: { path: string }) =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        const node = find(path);
        if (!node || !node.dir) return reject({ kind: "notFound", path });
        const entries: Entry[] = Object.entries(node.children).map(([name, n]) => ({
          name,
          path: join(path, name),
          kind: n.dir ? "dir" : "file",
          link: false,
          size: n.dir ? 0 : n.size,
          modified: n.modified,
          permissions: n.dir ? "rwxr-xr-x" : "rw-r--r--",
        }));
        entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) : a.kind === "dir" ? -1 : 1));
        resolve(entries);
      }, 120),
    ),
  mkdir: ({ dir: d, name }: { dir: string; name: string }) => {
    const node = find(d);
    if (!node?.dir) return fail("No such folder");
    if (node.children[name]) return fail(`${name} already exists`);
    node.children[name] = dir({}, 0);
    return join(d, name);
  },
  touch: ({ dir: d, name }: { dir: string; name: string }) => {
    const node = find(d);
    if (!node?.dir) return fail("No such folder");
    node.children[name] = file(0, 0, "");
    return join(d, name);
  },
  rename: ({ path, name }: { path: string; name: string }) => {
    const [parent, old] = split(path);
    const node = find(parent);
    if (!node?.dir) return fail("No such folder");
    if (node.children[name]) return fail(`There's already an item called “${name}”`);
    const moved = node.children[old];
    if (!moved) return fail("No such file");
    node.children[name] = moved;
    delete node.children[old];
    return join(parent, name);
  },
  move_to: () => undefined,
  delete: ({ paths }: { paths: string[] }) => {
    for (const p of paths) {
      const [parent, name] = split(p);
      const node = find(parent);
      if (node?.dir) delete node.children[name];
    }
  },
  chmod: () => undefined,
  read_text: ({ path, limit }: { path: string; limit: number }) => {
    const n = find(path);
    if (!n || n.dir) return Promise.reject({ kind: "notFound", path });
    return n.text !== undefined && n.size <= limit ? n.text : null;
  },
  read_bytes: ({ path }: { path: string }) => {
    if (!path.endsWith(".svg")) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"><rect width="240" height="120" rx="16" fill="#101012"/><circle cx="60" cy="60" r="28" fill="#2dd4bf"/><rect x="104" y="44" width="104" height="12" rx="6" fill="#ececef"/><rect x="104" y="66" width="72" height="10" rx="5" fill="#7e7e86"/></svg>`;
    return new TextEncoder().encode(svg).buffer;
  },
  write_text: ({ path, text }: { path: string; text: string }) => {
    const n = find(path);
    if (n && !n.dir) {
      n.text = text;
      n.size = text.length;
      n.modified = Math.floor(Date.now() / 1000);
    }
  },
  edit_external: ({ siteId, path }: { siteId: string; path: string }) => ({ siteId, remote: path, local: `/tmp/${path}` }),
  watched: () => [],
  stop_watching: () => undefined,
  transfer: ({ requests }: { requests: TransferRequest[] }) => requests.map(add),
  transfers: () => transfers.map((t) => ({ ...t })),
  cancel_transfer: ({ id }: { id: number }) => {
    const t = transfers.find((x) => x.id === id);
    if (t && (t.state === "running" || t.state === "queued")) {
      t.state = "cancelled";
      emit(t);
    }
  },
  retry_transfer: ({ id }: { id: number }) => {
    const t = transfers.find((x) => x.id === id);
    if (!t) return null;
    transfers = transfers.filter((x) => x.id !== id);
    return add(t.request);
  },
  clear_transfers: () => {
    transfers = transfers.filter((t) => t.state === "running" || t.state === "queued");
  },
  downloads_dir: () => "/Users/you/Downloads",
  reveal: () => undefined,
  open_local: () => undefined,
};

export const mock = {
  async call<T>(command: string, args: Record<string, unknown>): Promise<T> {
    start();
    const h = handlers[command];
    if (!h) throw new Error(`demo: no handler for ${command}`);
    return (await h(args as never)) as T;
  },
  onTransfer(handler: (t: Transfer) => void) {
    start();
    listeners.add(handler);
    return () => listeners.delete(handler);
  },
};
