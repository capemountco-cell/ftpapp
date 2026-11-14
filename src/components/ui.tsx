/** Small shared pieces: keyboard hints, menus, dialogs, toasts. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CheckCircle, Warning } from "./Icons";

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className="kbd-group" aria-hidden>
      {keys.map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

export type MenuEntry =
  | { label: string; icon?: React.ReactNode; keys?: string[]; danger?: boolean; disabled?: boolean; run: () => void }
  | { separator: true }
  | { heading: string };

/** A context menu at a point, kept inside the window, closed by click-away or Escape. */
export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(-1);
  const actionable = items.map((it, i) => ("run" in it && !it.disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const at = actionable.indexOf(active);
        const next = e.key === "ArrowDown" ? (at + 1) % actionable.length : (at - 1 + actionable.length) % actionable.length;
        setActive(actionable[next] ?? -1);
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const it = items[active];
        if (it && "run" in it) {
          onClose();
          it.run();
        }
      }
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, items, active, actionable]);

  return (
    <div className="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if ("separator" in it) return <div key={i} className="menu-sep" />;
        if ("heading" in it)
          return (
            <div key={i} className="menu-label">
              {it.heading}
            </div>
          );
        return (
          <button
            key={i}
            role="menuitem"
            className={`menu-item${it.danger ? " danger" : ""}${i === active ? " active" : ""}`}
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.keys && <Kbd keys={it.keys} />}
          </button>
        );
      })}
    </div>
  );
}

export type MenuState = { x: number; y: number; items: MenuEntry[] } | null;

/** A modal with a scrim. Escape and click-away close it. */
export function Dialog({
  children,
  onClose,
  wide,
  label,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  label: string;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className={`dialog${wide ? " wide" : ""}`} role="dialog" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Ask a yes/no question. */
export function Confirm({
  title,
  body,
  action,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: React.ReactNode;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog onClose={onClose} label={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onClose();
          onConfirm();
        }}
      >
        <div className="dialog-body">
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost big" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={`btn big ${danger ? "danger" : "primary"}`} autoFocus>
            {action}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Ask for one line of text (a new folder's name). */
export function Prompt({
  title,
  label,
  initial,
  action,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  action: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <Dialog onClose={onClose} label={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          onClose();
          onSubmit(value.trim());
        }}
      >
        <div className="dialog-body">
          <h2>{title}</h2>
          <div className="field" style={{ marginTop: 14 }}>
            <label htmlFor="prompt">{label}</label>
            <div className="input">
              <input id="prompt" ref={input} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} autoComplete="off" />
            </div>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost big" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary big" disabled={!value.trim()}>
            {action}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export type Toast = { id: number; kind: "ok" | "bad" | "info"; text: string; action?: { label: string; run: () => void } };

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((kind: Toast["kind"], text: string, action?: Toast["action"]) => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "bad" ? 7000 : 3500);
  }, []);
  return { toasts, push };
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "bad" ? <Warning /> : <CheckCircle />}
          <span>{t.text}</span>
          {t.action && (
            <button className="toast-action" onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
