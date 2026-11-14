import { useEffect, useState } from "react";

import { bytes, editable, exact, fileKind, kindLabel, plural, protocolLabel, serverLabel, tilde, when } from "../lib/format";
import { api, type Entry, type Site } from "../lib/native";
import { useServices } from "../lib/services";
import type { Tab } from "./Browser";
import { Code, Copy, Download, External, Folder, KindIcon, Link, Lock, Pencil, SiteGlyph, Trash } from "./Icons";
import { Kbd } from "./ui";

const PREVIEW_LIMIT = 64 * 1024;

export function Inspector({
  site,
  tab,
  selected,
  onOpen,
  onDownload,
  onRename,
  onDelete,
  onEditExternal,
  onCopyPath,
  onCopyUrl,
}: {
  site: Site;
  tab: Tab;
  selected: Entry[];
  onOpen: (e: Entry) => void;
  onDownload: (items: Entry[]) => void;
  onRename: (e: Entry) => void;
  onDelete: (items: Entry[]) => void;
  onEditExternal: (e: Entry) => void;
  onCopyPath: (items: Entry[]) => void;
  onCopyUrl: (e: Entry | null) => void;
}) {
  const services = useServices();
  const one = selected.length === 1 ? selected[0] : null;
  const [preview, setPreview] = useState<{ path: string; text: string | null } | null>(null);

  useEffect(() => {
    setPreview(null);
    if (!one || one.kind !== "file" || !editable(one) || one.size > PREVIEW_LIMIT) return;
    let stale = false;
    const t = window.setTimeout(() => {
      api
        .readText(site.id, one.path, PREVIEW_LIMIT)
        .then((text) => !stale && setPreview({ path: one.path, text }))
        .catch(() => !stale && setPreview({ path: one.path, text: null }));
    }, 150);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [site.id, one]);

  if (tab.status !== "open") {
    return (
      <aside className="inspector">
        <div className="inspector-head">Site</div>
        <SiteProps site={site} />
      </aside>
    );
  }

  if (!one) {
    const files = selected.filter((e) => e.kind === "file");
    return (
      <aside className="inspector">
        <div className="inspector-head">{selected.length ? "Selection" : "Folder"}</div>
        <div className="inspector-title">
          <span className="big-icon">
            <KindIcon kind="folder" />
          </span>
          <h2>{selected.length ? plural(selected.length, "item") : tab.path.split("/").pop() || "/"}</h2>
        </div>
        <dl className="props">
          {selected.length ? (
            <>
              <dt>Files</dt>
              <dd>{files.length}</dd>
              <dt>Folders</dt>
              <dd>{selected.length - files.length}</dd>
              <dt>Size</dt>
              <dd>{bytes(files.reduce((n, e) => n + e.size, 0))}</dd>
            </>
          ) : (
            <>
              <dt>Path</dt>
              <dd className="selectable code">{tilde(tab.path, tab.home)}</dd>
              <dt>Items</dt>
              <dd>{tab.entries.length}</dd>
            </>
          )}
        </dl>
        {selected.length > 0 && (
          <div className="ins-section">
            <div className="ins-actions">
              <button className="ins-action" onClick={() => onDownload(selected)}>
                <Download /> Download all <Kbd keys={["⌘", "D"]} />
              </button>
              <button className="ins-action" onClick={() => onCopyPath(selected)}>
                <Copy /> Copy paths
              </button>
              <button className="ins-action danger" onClick={() => onDelete(selected)}>
                <Trash /> Delete all <Kbd keys={["⌘", "⌫"]} />
              </button>
            </div>
          </div>
        )}
        <div className="ins-section">
          <h3>Site</h3>
          <SiteProps site={site} compact />
        </div>
      </aside>
    );
  }

  const isText = one.kind === "file" && editable(one);
  return (
    <aside className="inspector">
      <div className="inspector-head">Properties</div>
      <div className="inspector-title">
        <span className="big-icon">
          <KindIcon kind={fileKind(one)} />
        </span>
        <h2 className="selectable">{one.name}</h2>
      </div>
      <dl className="props">
        <dt>Kind</dt>
        <dd>{kindLabel(one)}{one.link ? " (link)" : ""}</dd>
        {one.kind === "file" && (
          <>
            <dt>Size</dt>
            <dd className="num">
              {bytes(one.size)}
              {one.size >= 1000 && <span className="faint">{one.size.toLocaleString()} bytes</span>}
            </dd>
          </>
        )}
        <dt>Modified</dt>
        <dd title={exact(one.modified)}>{one.modified ? `${when(one.modified)}` : "Unknown"}</dd>
        <dt>Permissions</dt>
        <dd>
          <button className="chip code" onClick={() => services.chmod(site, one, () => undefined)}>
            <Lock className="i" />
            {one.permissions ?? "Unknown"}
          </button>
        </dd>
        <dt>Path</dt>
        <dd className="selectable code">{tilde(one.path, tab.home)}</dd>
      </dl>

      <div className="ins-section">
        <div className="ins-actions">
          {one.kind === "dir" ? (
            <button className="ins-action" onClick={() => onOpen(one)}>
              <Folder /> Open <Kbd keys={["⌘", "↓"]} />
            </button>
          ) : null}
          {isText && (
            <button className="ins-action" onClick={() => onOpen(one)}>
              <Code /> Edit in Captain <Kbd keys={["⌘", "E"]} />
            </button>
          )}
          {one.kind === "file" && (
            <button className="ins-action" onClick={() => onEditExternal(one)}>
              <External /> Open in default app
            </button>
          )}
          <button className="ins-action" onClick={() => onDownload([one])}>
            <Download /> Download <Kbd keys={["⌘", "D"]} />
          </button>
          <button className="ins-action" onClick={() => onRename(one)}>
            <Pencil /> Rename <Kbd keys={["↩"]} />
          </button>
          <button className="ins-action" onClick={() => onCopyUrl(one)}>
            <Link /> Copy link
          </button>
          <button className="ins-action danger" onClick={() => onDelete([one])}>
            <Trash /> Delete <Kbd keys={["⌘", "⌫"]} />
          </button>
        </div>
      </div>

      {one.kind === "file" && (
        <div className="ins-section">
          <h3>Preview</h3>
          {isText && one.size <= PREVIEW_LIMIT ? (
            preview && preview.path === one.path ? (
              preview.text !== null ? (
                <pre className="preview">{preview.text.slice(0, 6000) || " "}</pre>
              ) : (
                <div className="preview-img">No preview</div>
              )
            ) : (
              <div className="preview-img">
                <span className="sk" style={{ width: "60%" }} />
              </div>
            )
          ) : (
            <div className="preview-img">
              <KindIcon kind={fileKind(one)} />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function SiteProps({ site, compact }: { site: Site; compact?: boolean }) {
  return (
    <>
      {!compact && (
        <div className="inspector-title">
          <SiteGlyph color={site.color} />
          <h2>{site.name}</h2>
        </div>
      )}
      <dl className="props" style={compact ? { padding: 0 } : undefined}>
        <dt>Protocol</dt>
        <dd>{protocolLabel(site.protocol)}</dd>
        <dt>Server</dt>
        <dd className="selectable">{serverLabel(site)}</dd>
        <dt>Login</dt>
        <dd>{site.auth.kind === "key" ? "SSH key" : site.auth.kind === "agent" ? "ssh-agent" : site.auth.kind === "anonymous" ? "Anonymous" : "Password (Keychain)"}</dd>
      </dl>
    </>
  );
}
