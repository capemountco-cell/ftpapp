import { useEffect, useMemo, useRef, useState } from "react";

import { fileKind, kindLabel } from "../lib/format";
import { api, errorText, type Entry, type Site } from "../lib/native";
import { useServices } from "../lib/services";
import { ChevronRight, Close, External, KindIcon, SiteGlyph } from "./Icons";
import { Kbd } from "./ui";

/**
 * Quick edits without leaving Captain: the file opens over the listing, ⌘S
 * saves straight to the server. For heavier work, "Open in default app"
 * keeps a synced copy in the user's own editor.
 */
export function Editor({ site, entry, onClose, onSaved }: { site: Site; entry: Entry; onClose: () => void; onSaved: () => void }) {
  const services = useServices();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const dirty = text !== null && text !== saved;

  useEffect(() => {
    api
      .readText(site.id, entry.path, 2_000_000)
      .then((t) => {
        if (t === null) {
          setState("error");
          setError("This file isn't text Captain can edit.");
          return;
        }
        setText(t);
        setSaved(t);
        setState("ready");
        window.setTimeout(() => area.current?.focus(), 0);
      })
      .catch((e) => {
        setState("error");
        setError(errorText(e));
      });
  }, [site.id, entry.path]);

  const save = async () => {
    if (text === null || state === "saving") return;
    setState("saving");
    try {
      await api.writeText(site.id, entry.path, text);
      setSaved(text);
      setState("ready");
      onSaved();
      services.toast("ok", `Saved “${entry.name}” to ${site.name}`);
    } catch (e) {
      setState("ready");
      services.toast("bad", errorText(e));
    }
  };

  const close = () => {
    if (!dirty) return onClose();
    services.confirm({ title: `Discard changes to “${entry.name}”?`, body: "Your edits haven't been saved to the server.", action: "Discard", danger: true, onConfirm: onClose });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".scrim")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (e.key === "Escape" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w")) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const lines = useMemo(() => {
    const n = (text ?? "").split("\n").length;
    return Array.from({ length: n }, (_, i) => i + 1).join("\n");
  }, [text]);

  return (
    <div className="editor">
      <header className="header">
        <nav className="crumbs">
          <span className="crumb root">
            <SiteGlyph color={site.color} />
            {site.name}
          </span>
          <ChevronRight className="i crumb-sep" />
          <span className="crumb last">
            <KindIcon kind={fileKind(entry)} />
            {entry.name}
          </span>
        </nav>
        <span className="edit-state">
          {state === "saving" ? (
            "Saving…"
          ) : dirty ? (
            <>
              <span className="dot" /> Edited
            </>
          ) : state === "ready" ? (
            kindLabel(entry)
          ) : null}
        </span>
        <span className="spacer" data-tauri-drag-region />
        <button
          className="btn ghost"
          onClick={() =>
            void api
              .editExternal(site.id, entry.path)
              .then(() => services.toast("ok", "Opened in your editor. Saves upload automatically."))
              .catch((e) => services.toast("bad", errorText(e)))
          }
        >
          <External /> Open in default app
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={!dirty || state === "saving"}>
          Save <Kbd keys={["⌘", "S"]} />
        </button>
        <button className="icon-btn" onClick={close} title="Close (Esc)">
          <Close />
        </button>
      </header>
      <div className="editor-body">
        {state === "error" ? (
          <div className="empty">
            <h2>Can't edit this file</h2>
            <p>{error}</p>
          </div>
        ) : text === null ? (
          <div className="empty">
            <span className="sk" style={{ width: 160 }} />
          </div>
        ) : (
          <>
            <div className="gutter" ref={gutter} aria-hidden>
              {lines}
            </div>
            <textarea
              ref={area}
              value={text}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              aria-label={`Contents of ${entry.name}`}
              onChange={(e) => setText(e.target.value)}
              onScroll={(e) => {
                if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
              }}
              onKeyDown={(e) => {
                if (e.key === "Tab" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: a, selectionEnd: b } = el;
                  const next = el.value.slice(0, a) + "  " + el.value.slice(b);
                  setText(next);
                  window.requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
                }
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
