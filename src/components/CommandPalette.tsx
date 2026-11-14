import { useEffect, useMemo, useRef, useState } from "react";

import { fuzzy } from "../lib/format";
import { Command as CommandIcon } from "./Icons";
import { Kbd } from "./ui";

export interface PaletteCommand {
  id: string;
  label: string;
  group: string;
  sub?: string;
  keys?: string[];
  icon?: React.ReactNode;
  run: () => void;
}

/** ⌘K: every site, bookmark, folder in view and action, reachable by typing. */
export function CommandPalette({ commands, onClose, dynamic }: { commands: PaletteCommand[]; onClose: () => void; dynamic?: (query: string) => PaletteCommand[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const extra = dynamic?.(query) ?? [];
    const scored = commands
      .map((c) => ({ c, score: fuzzy(c.label + (c.sub ? " " + c.sub : ""), query) }))
      .filter((x): x is { c: PaletteCommand; score: number } => x.score !== null);
    if (query) scored.sort((a, b) => a.score - b.score);
    return [...extra, ...scored.map((x) => x.c)].slice(0, 60);
  }, [commands, query, dynamic]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = "";
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command menu"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(results[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="palette-input">
          <CommandIcon />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type a command, a site, or paste sftp://…" spellCheck={false} aria-label="Command" />
        </div>
        <ul className="palette-list" ref={list} role="listbox">
          {results.length === 0 && <li className="palette-empty">No results</li>}
          {results.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <div role="option" aria-selected={i === active} data-index={i} className={`palette-item${i === active ? " active" : ""}`} onMouseMove={() => setActive(i)} onClick={() => run(c)}>
                  <span className="palette-icon">{c.icon}</span>
                  <span className="palette-label">{c.label}</span>
                  {c.sub && <span className="palette-sub">{c.sub}</span>}
                  {c.keys && <Kbd keys={c.keys} />}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
