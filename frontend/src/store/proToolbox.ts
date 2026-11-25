// aidir3 fork: state for the docked pro toolbox.
//
// Two kinds of state live here. Preferences (icon-only or named layout, which
// sections are folded) are the user's and persist per browser. Mode flags
// (whether the toolbox is on screen, whether paths are being edited by their
// nodes) are for this session only and are read by the canvas through the
// small hooks marked "aidir3 fork:" in Canvas.tsx.
//
// A store of its own, like boardFocus, so the canvas and the editor shell can
// both read it without threading props through each other.

import { create } from "zustand";

export type ToolboxMode = "compact" | "expanded";

const storageKey = "a3-toolbox";

interface Prefs {
  mode: ToolboxMode;
  collapsed: string[];
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { mode: "compact", collapsed: [] };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const j = JSON.parse(raw) as Partial<Prefs>;
    return {
      mode: j.mode === "expanded" ? "expanded" : "compact",
      collapsed: Array.isArray(j.collapsed) ? j.collapsed.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    return fallback; // storage blocked or corrupt: defaults
  }
}

function savePrefs(p: Prefs): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(p));
  } catch {
    /* storage blocked: the choice lasts for this session only */
  }
}

interface ProToolboxState extends Prefs {
  /** The docked toolbox is on screen. While it is, the canvas hides its own
   *  floating tool strip (the toolbox carries every tool on it) and a single
   *  selected path gets the resize box unless `nodeEdit` is on. */
  docked: boolean;
  setDocked(v: boolean): void;
  /** The Shape (nodes) tool: a single selected path shows its anchors and
   *  handles instead of the resize box. */
  nodeEdit: boolean;
  setNodeEdit(v: boolean): void;
  /** Smart drawing: each freehand stroke is replaced by the clean shape it
   *  resembles as soon as it is drawn. */
  smartDraw: boolean;
  setSmartDraw(v: boolean): void;
  setMode(mode: ToolboxMode): void;
  toggleSection(id: string): void;
  setAllCollapsed(ids: string[]): void;
}

export const useProToolbox = create<ProToolboxState>((set, get) => ({
  ...loadPrefs(),
  docked: false,
  setDocked: (docked) => set({ docked }),
  nodeEdit: false,
  setNodeEdit: (nodeEdit) => set({ nodeEdit }),
  smartDraw: false,
  setSmartDraw: (smartDraw) => set({ smartDraw }),
  setMode: (mode) => {
    set({ mode });
    savePrefs({ mode, collapsed: get().collapsed });
  },
  toggleSection: (id) => {
    const cur = get().collapsed;
    const collapsed = cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id];
    set({ collapsed });
    savePrefs({ mode: get().mode, collapsed });
  },
  setAllCollapsed: (collapsed) => {
    set({ collapsed });
    savePrefs({ mode: get().mode, collapsed });
  },
}));

const pickListeners = new Set<() => void>();

/** Asks the canvas to return to its selection tool. The canvas owns that
 *  switch because it also has to drop whatever path or line was half drawn. */
export function requestPickTool(): void {
  for (const cb of pickListeners) cb();
}

/** The canvas registers its own "back to select" routine here. */
export function onPickToolRequest(cb: () => void): () => void {
  pickListeners.add(cb);
  return () => {
    pickListeners.delete(cb);
  };
}

/** True when a single selected path should show the resize box rather than the
 *  node editor. Without the toolbox on screen this is never true, so the
 *  canvas behaves exactly as upstream. */
export const pathsSelectAsBoxes = (s: Pick<ProToolboxState, "docked" | "nodeEdit">): boolean => s.docked && !s.nodeEdit;
