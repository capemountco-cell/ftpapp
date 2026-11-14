/** App-wide services the views share, provided by App. */

import { createContext, useContext } from "react";

import type { MenuEntry, Toast } from "../components/ui";
import type { Entry, Site } from "./native";

export interface Services {
  toast: (kind: Toast["kind"], text: string, action?: Toast["action"]) => void;
  confirm: (opts: { title: string; body: React.ReactNode; action: string; danger?: boolean; onConfirm: () => void }) => void;
  prompt: (opts: { title: string; label: string; initial: string; action: string; onSubmit: (v: string) => void }) => void;
  menu: (at: { x: number; y: number }, items: MenuEntry[]) => void;
  editSite: (site: Site) => void;
  chmod: (site: Site, entry: Entry, onDone: () => void) => void;
  openEditor: (site: Site, entry: Entry, onSaved: () => void) => void;
  showTransfers: () => void;
  downloadsDir: string;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error("useServices outside ServicesContext");
  return s;
}
