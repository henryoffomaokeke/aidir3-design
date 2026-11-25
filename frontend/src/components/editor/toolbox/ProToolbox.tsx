// aidir3 fork: the docked pro toolbox.
//
// A column of canvas tools between the left rail and the canvas, grouped into
// sections that fold individually. Two layouts: icons only (two columns), and
// named (one tool per row with its shortcut). Both, and which sections are
// folded, are remembered per browser. Tools that come in variants (the shape
// families, tables, zoom) open a flyout beside the toolbox.
//
// It replaces the canvas's floating tool strip while it is on screen (the
// canvas reads `docked` from the proToolbox store), and carries every tool
// that strip had. What each tool does lives in catalog.ts and actions.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { locate } from "@hc/editor";
import { useEditor } from "@/store/editor";
import { usePresence } from "@/store/presence";
import { useComments } from "@/store/comments";
import { useProToolbox } from "@/store/proToolbox";
import { useToast } from "@/components/ui/Toast";
import { documentDirection, mirrorInRtl } from "@/lib/locale";
import { tr, useI18nVersion } from "@/lib/i18n";
import { pathDataFromContours } from "@/lib/toolbox/pathData";
import { canPickScreenColor, tidySketch } from "./actions";
import { toolboxSections, type Flyout, type MenuItem, type ShapeItem, type Tool, type ToolEnv, type ToolSection, type ToolState } from "./catalog";

type EditorState = ReturnType<typeof useEditor.getState>;

/** What the toolbox needs to know about the selection, as one string so the
 *  toolbox re-renders when the answer changes and not on every canvas frame. */
function selectionSignature(s: EditorState): string {
  const nodes = s.selection.map((id) => locate(s.doc, id)?.node).filter((n): n is NonNullable<typeof n> => !!n);
  const one = nodes.length === 1 ? nodes[0] : null;
  const t = one?.transform;
  return JSON.stringify({
    types: nodes.map((n) => n.type),
    croppable: !!one && one.type === "image" && !!t && t.rotation === 0 && Math.abs(t.scaleX) === 1 && Math.abs(t.scaleY) === 1 && !t.skewX && !t.skewY,
    locked: !!one?.locked,
    shadow: nodes.some((n) => !!(n as { effects?: { kind: string }[] }).effects?.some((e) => e.kind === "shadow")),
    // The Properties panel's own test for showing its Fill section.
    fillable: nodes.some((n) => Array.isArray((n as { fills?: unknown[] }).fills)),
    // Text is coloured through its runs, which the eyedropper also reaches.
    colorable: nodes.some((n) => n.type === "text" || Array.isArray((n as { fills?: unknown[] }).fills)),
  });
}

function useToolState(): ToolState {
  const tool = useEditor((s) => s.tool);
  const signature = useEditor(selectionSignature);
  const previewing = useEditor((s) => s.preview !== null);
  const editAccess = usePresence((s) => s.accessMode === "edit");
  const canComment = useComments((s) => s.canComment);
  const nodeEdit = useProToolbox((s) => s.nodeEdit);
  const smartDraw = useProToolbox((s) => s.smartDraw);
  return useMemo(() => {
    const sel = JSON.parse(signature) as Pick<ToolState, "types" | "croppable" | "locked" | "shadow" | "fillable" | "colorable">;
    return { tool, nodeEdit, smartDraw, canEdit: editAccess && !previewing, canComment, screenPicker: canPickScreenColor(), ...sel };
  }, [tool, signature, previewing, editAccess, canComment, nodeEdit, smartDraw]);
}

/**
 * Keeps the toolbox's two modes honest as the canvas tool changes by any
 * route (a shortcut, the canvas returning to Select after a draw), and runs
 * Smart drawing.
 */
function useToolModes(): void {
  useEffect(() => {
    // Smart drawing reads the stroke itself, not the curve the editor fits to
    // it (see lib/toolbox/sketch), so the pointer's path over the canvas is
    // recorded here while the tool is on. Window-level capture listeners see
    // each event before the canvas does, so by the time the canvas has turned
    // a finished stroke into a path, the stroke is waiting in `drawn`.
    let drawing: { x: number; y: number }[] | null = null;
    let drawn: { x: number; y: number }[] | null = null;
    const onDown = (e: PointerEvent) => {
      drawing = null;
      drawn = null;
      if (!useProToolbox.getState().smartDraw || e.button !== 0) return;
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "CANVAS" && el.closest("#oc-canvas-surface")) drawing = [{ x: e.clientX, y: e.clientY }];
    };
    const onMove = (e: PointerEvent) => {
      drawing?.push({ x: e.clientX, y: e.clientY });
    };
    const onUp = () => {
      drawn = drawing;
      drawing = null;
    };
    const onCancel = () => {
      drawing = null;
      drawn = null;
    };
    const unsubscribe = useEditor.subscribe((s, prev) => {
      const modes = useProToolbox.getState();
      if (s.tool !== prev.tool) {
        if (s.tool !== "pencil" && modes.smartDraw) modes.setSmartDraw(false);
        if (s.tool !== "select" && modes.nodeEdit) modes.setNodeEdit(false);
      }
      // A stroke has just become a path: the new, selected one.
      if (!drawn || !modes.smartDraw || s.selection === prev.selection || s.selection.length !== 1) return;
      const id = s.selection[0];
      if (locate(s.doc, id)?.node.type !== "path") return;
      // Taken once: undo puts the rough stroke back and reselects it, and it
      // must not be tidied again on the spot.
      const stroke = drawn;
      drawn = null;
      // After the store has finished the update that added the path.
      queueMicrotask(() => {
        const st = useEditor.getState();
        if (st.selection.length !== 1 || st.selection[0] !== id) return;
        tidySketch(id, stroke, {
          line: tr("editor.toolbox_line"),
          ellipse: tr("editor.ellipse"),
          rect: tr("editor.rectangle"),
          triangle: tr("editor.triangle"),
          polygon: tr("editor.toolbox_polygon"),
        });
      });
    });
    // V returns to the plain Pick tool. The canvas handles the key itself, but
    // it does not know about the Shape tool, which is also a selection tool.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "v" && e.key !== "V") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      useProToolbox.getState().setNodeEdit(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    };
  }, []);
}

/** A tool button's box, and the toolbox's own, when a card was opened for it. */
interface Anchor {
  id: string;
  rect: DOMRect;
  edge: DOMRect;
}

/** Where a floating card sits: level with its tool, just outside the toolbox
 *  on the side facing the canvas (in either reading direction), so it never
 *  covers the tools in the other column. */
function besideStyle({ rect, edge }: Anchor): { top: number; insetInlineStart: number } {
  const rtl = documentDirection() === "rtl";
  return { top: rect.top, insetInlineStart: (rtl ? window.innerWidth - edge.left : edge.right) + 6 };
}

/** Keeps a floating card inside the viewport once its real height is known. */
function useKeepInView(ref: React.RefObject<HTMLDivElement | null>, top: number): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const max = window.innerHeight - el.offsetHeight - 8;
    el.style.top = `${Math.max(8, Math.min(top, max))}px`;
  }, [ref, top]);
}

function Tooltip({ tool, anchor, reason }: { tool: Tool; anchor: Anchor; reason: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = besideStyle(anchor);
  useKeepInView(ref, pos.top - 4);
  return (
    <div ref={ref} role="tooltip" className="pointer-events-none fixed z-[70] w-60 rounded-lg border border-neutral-200 bg-surface px-3 py-2 shadow-lg" style={pos}>
      <p className="flex items-center gap-2 text-xs font-semibold text-neutral-800">
        <span className="min-w-0 flex-1">{tool.label}</span>
        {tool.shortcut && <kbd className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-500">{tool.shortcut}</kbd>}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-neutral-500">{tool.tip}</p>
      {reason && <p className="mt-1 text-[11px] font-medium leading-snug text-brand-ink">{reason}</p>}
    </div>
  );
}

function ShapeTile({ item, onRun }: { item: ShapeItem; onRun: () => void }) {
  const { d, paint } = useMemo(() => {
    const p = item.preview();
    return { d: pathDataFromContours(p.contours), paint: p.paint };
  }, [item]);
  return (
    <button
      type="button"
      role="menuitem"
      data-a3-fly
      tabIndex={-1}
      onClick={onRun}
      title={item.label}
      className="flex flex-col items-center gap-1 rounded-lg px-1 pb-1.5 pt-2 text-neutral-600 transition hover:bg-brand-50 hover:text-brand-ink focus-visible:bg-brand-50 focus-visible:text-brand-ink focus-visible:outline-none"
    >
      <svg viewBox="0 0 100 100" className="h-9 w-9" aria-hidden>
        {paint === "line" ? (
          <path d={d} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        ) : paint === "outline" ? (
          <path d={d} fill="currentColor" fillOpacity={0.35} fillRule="evenodd" stroke="currentColor" strokeWidth={4} strokeLinejoin="round" />
        ) : (
          <path d={d} fill="currentColor" fillRule="evenodd" />
        )}
      </svg>
      <span className="line-clamp-2 w-full text-center text-[10px] font-medium leading-tight">{item.label}</span>
    </button>
  );
}

function MenuRow({ item, reason, onRun }: { item: MenuItem; reason: string | null; onRun: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      data-a3-fly
      tabIndex={-1}
      aria-disabled={reason ? true : undefined}
      onClick={onRun}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-[13px] text-neutral-700 transition hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none ${reason ? "opacity-40" : ""}`}
    >
      {item.icon && <item.icon size={15} className="shrink-0 text-neutral-400" />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut && <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">{item.shortcut}</span>}
    </button>
  );
}

/** The variants of one tool, beside the toolbox. Arrow keys move between
 *  them, Escape closes it and returns focus to the tool. */
function FlyoutCard({
  tool,
  flyout,
  anchor,
  state,
  env,
  onClose,
  onRun,
}: {
  tool: Tool;
  flyout: Flyout;
  anchor: Anchor;
  state: ToolState;
  env: ToolEnv;
  onClose: (refocus: boolean) => void;
  onRun: (run: () => void, reason: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = besideStyle(anchor);
  useKeepInView(ref, pos.top - 8);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-a3-fly]")?.focus();
  }, []);
  const columns = flyout.kind === "shapes" ? 4 : 1;
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-a3-fly]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = at;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
        return;
      case "Tab":
        onClose(true);
        return;
      case "ArrowDown":
        next = at + columns;
        break;
      case "ArrowUp":
        next = at - columns;
        break;
      case "ArrowRight":
        next = at + (documentDirection() === "rtl" ? -1 : 1);
        break;
      case "ArrowLeft":
        next = at - (documentDirection() === "rtl" ? -1 : 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      case " ":
        // The canvas claims Space for panning before a button could act on
        // it, so a focused variant is activated here.
        e.preventDefault();
        e.stopPropagation();
        (document.activeElement as HTMLElement | null)?.click();
        return;
      default:
        return;
    }
    // Arrow keys also nudge the canvas selection; they are ours while the
    // flyout is open.
    e.preventDefault();
    e.stopPropagation();
    if (next >= 0 && next < items.length) items[next].focus();
  };
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={tool.label}
      data-a3-flyout
      onKeyDown={onKeyDown}
      className={`oc-scroll fixed z-[60] max-h-[min(34rem,calc(100dvh-1rem))] overflow-y-auto rounded-xl border border-neutral-200 bg-surface p-1.5 shadow-xl ${flyout.kind === "shapes" ? "w-[21rem]" : "w-56"}`}
      style={pos}
    >
      <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{tool.label}</p>
      {flyout.kind === "shapes" ? (
        <div className="grid grid-cols-4 gap-0.5">
          {flyout.items.map((item) => (
            <ShapeTile key={item.id} item={item} onRun={() => onRun(() => item.run(env), null)} />
          ))}
        </div>
      ) : (
        flyout.items.map((item) => {
          const reason = item.blocked?.(state) ?? null;
          return <MenuRow key={item.id} item={item} reason={reason} onRun={() => onRun(() => item.run(env), reason)} />;
        })
      )}
    </div>
  );
}

export function ProToolbox({ iconsOnly = false }: { iconsOnly?: boolean }) {
  const toast = useToast();
  const i18n = useI18nVersion();
  const state = useToolState();
  useToolModes();

  const storedMode = useProToolbox((s) => s.mode);
  const collapsed = useProToolbox((s) => s.collapsed);
  const named = storedMode === "expanded" && !iconsOnly;

  // Tell the canvas the toolbox is on screen, so it hides its own tool strip
  // and selects paths as boxes; and tell it again when the toolbox goes. A
  // layout effect, so the strip never paints for a frame beside the toolbox.
  useLayoutEffect(() => {
    useProToolbox.getState().setDocked(true);
    return () => {
      const s = useProToolbox.getState();
      s.setDocked(false);
      s.setNodeEdit(false);
      s.setSmartDraw(false);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt when the interface language changes
  const sections = useMemo(() => toolboxSections(), [i18n]);
  const visible: ToolSection[] = sections
    .map((sec) => ({ ...sec, tools: sec.tools.filter((t) => !t.hidden?.(state)) }))
    .filter((sec) => sec.tools.length > 0);

  const rootRef = useRef<HTMLElement>(null);
  const [tip, setTip] = useState<Anchor | null>(null);
  const [fly, setFly] = useState<Anchor | null>(null);
  const anchorOf = (id: string, el: HTMLElement): Anchor => {
    const rect = el.getBoundingClientRect();
    return { id, rect, edge: rootRef.current?.getBoundingClientRect() ?? rect };
  };
  // The one toolbar item that takes Tab focus; the arrow keys move from it.
  const [tabStop, setTabStop] = useState<string | null>(null);
  const hoverTimer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const toolById = new Map(visible.flatMap((sec) => sec.tools.map((t) => [t.id, t] as const)));
  const flyTool = fly ? toolById.get(fly.id) : undefined;
  const tipTool = tip && !fly ? toolById.get(tip.id) : undefined;

  const closeFly = (refocus: boolean) => {
    const id = fly?.id;
    setFly(null);
    if (refocus && id) rootRef.current?.querySelector<HTMLElement>(`[data-a3-item="tool:${id}"]`)?.focus();
  };

  // A flyout closes on a click anywhere outside it and its tool.
  useEffect(() => {
    if (!fly) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("[data-a3-flyout]") || el?.closest(`[data-a3-item="tool:${fly.id}"]`)) return;
      setFly(null);
    };
    const onResize = () => setFly(null);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [fly]);

  const env: ToolEnv = { inserted: (name) => toast.success(tr("editor.toolbox_added_name", { name })) };

  const runTool = (tool: Tool, el: HTMLElement) => {
    window.clearTimeout(hoverTimer.current);
    setTip(null);
    const reason = tool.blocked?.(state) ?? null;
    if (reason) {
      toast.toast(reason, "info");
      return;
    }
    if (tool.flyout) {
      const anchor = anchorOf(tool.id, el);
      setFly((cur) => (cur?.id === tool.id ? null : anchor));
      return;
    }
    setFly(null);
    tool.run?.(env);
  };

  const runFlyItem = (run: () => void, reason: string | null) => {
    if (reason) {
      toast.toast(reason, "info");
      return;
    }
    closeFly(false);
    run();
  };

  const showTip = (id: string, el: HTMLElement, delay: number) => {
    window.clearTimeout(hoverTimer.current);
    const anchor = anchorOf(id, el);
    if (delay === 0) setTip(anchor);
    else hoverTimer.current = window.setTimeout(() => setTip(anchor), delay);
  };
  const hideTip = () => {
    window.clearTimeout(hoverTimer.current);
    setTip(null);
  };

  // Toolbar keys: one Tab stop, arrows to move, Home and End to jump. Space is
  // handled here because the canvas claims it (to pan) before a focused button
  // could act on it; arrows are stopped so they do not also nudge the selection.
  const onToolbarKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-a3-item]"));
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    let next = at;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = at + 1;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = at - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      case " ":
        e.preventDefault();
        e.stopPropagation();
        items[at].click();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    items[Math.max(0, Math.min(items.length - 1, next))].focus();
  };

  const itemIds = visible.flatMap((sec) => [`section:${sec.id}`, ...(collapsed.includes(sec.id) ? [] : sec.tools.map((t) => `tool:${t.id}`))]);
  const stop = tabStop && itemIds.includes(tabStop) ? tabStop : itemIds[0];
  const itemProps = (id: string) => ({
    "data-a3-item": id,
    tabIndex: id === stop ? 0 : -1,
  });

  const allFolded = visible.every((sec) => collapsed.includes(sec.id));
  const headerBtn = "grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400";
  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400";

  const toolButton = (tool: Tool) => {
    const active = !!tool.active?.(state);
    const on = !!tool.on?.(state);
    const reason = tool.blocked?.(state) ?? null;
    const open = fly?.id === tool.id;
    const id = `tool:${tool.id}`;
    const tone = active || open ? "bg-brand-50 text-brand-ink" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900";
    const common = {
      ...itemProps(id),
      type: "button" as const,
      "aria-label": tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label,
      "aria-pressed": tool.flyout ? undefined : active || on,
      "aria-haspopup": tool.flyout ? ("menu" as const) : undefined,
      "aria-expanded": tool.flyout ? open : undefined,
      "aria-disabled": reason ? true : undefined,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => runTool(tool, e.currentTarget),
      onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => showTip(tool.id, e.currentTarget, 350),
      onMouseLeave: hideTip,
      onFocus: (e: React.FocusEvent<HTMLButtonElement>) => {
        setTabStop(id);
        // Only a keyboard focus opens the description at once; a click
        // focuses the button too and should not flash it.
        if (e.currentTarget.matches(":focus-visible")) showTip(tool.id, e.currentTarget, 0);
      },
      onBlur: hideTip,
    };
    if (named) {
      return (
        <button key={tool.id} {...common} className={`relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[13px] font-medium transition ${focusRing} ${tone} ${reason ? "opacity-40" : ""}`}>
          <tool.icon size={16} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{tool.label}</span>
          {on && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
          {tool.shortcut && <kbd className="shrink-0 rounded border border-neutral-200 px-1 font-mono text-[10px] font-medium text-neutral-400">{tool.shortcut}</kbd>}
          {tool.flyout && <ChevronRight size={13} className={`shrink-0 text-neutral-400 ${mirrorInRtl}`} />}
        </button>
      );
    }
    return (
      <button key={tool.id} {...common} className={`relative grid h-9 w-9 place-items-center rounded-lg transition ${focusRing} ${tone} ${reason ? "opacity-40" : ""}`}>
        <tool.icon size={18} />
        {on && <span aria-hidden className="absolute end-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-500" />}
        {tool.flyout && (
          <svg aria-hidden viewBox="0 0 6 6" className={`absolute bottom-1 end-1 h-1.5 w-1.5 opacity-60 ${mirrorInRtl}`}>
            <path d="M6 0V6H0Z" fill="currentColor" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <aside
      ref={rootRef}
      data-a3-toolbox
      aria-label={tr("editor.toolbox_title")}
      // The icon-only width is also written into ToolRail's overlay offset;
      // change the two together.
      className={`relative flex h-full shrink-0 flex-col border-e border-neutral-200 bg-surface ${named ? "w-56" : "w-[86px]"}`}
    >
      <div className={`flex shrink-0 items-center gap-0.5 border-b border-neutral-200 py-1 ${named ? "ps-3 pe-1.5" : "justify-center px-1"}`}>
        {named && <h2 className="min-w-0 flex-1 truncate text-xs font-bold text-neutral-800">{tr("editor.toolbox_title")}</h2>}
        <button
          type="button"
          onClick={() => useProToolbox.getState().setAllCollapsed(allFolded ? [] : visible.map((sec) => sec.id))}
          title={allFolded ? tr("editor.toolbox_expand_all") : tr("editor.toolbox_collapse_all")}
          aria-label={allFolded ? tr("editor.toolbox_expand_all") : tr("editor.toolbox_collapse_all")}
          className={headerBtn}
        >
          {allFolded ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
        </button>
        {!iconsOnly && (
          <button
            type="button"
            onClick={() => {
              setFly(null);
              useProToolbox.getState().setMode(named ? "compact" : "expanded");
            }}
            title={named ? tr("editor.toolbox_icons_only") : tr("editor.toolbox_show_names")}
            aria-label={named ? tr("editor.toolbox_icons_only") : tr("editor.toolbox_show_names")}
            aria-pressed={named}
            className={headerBtn}
          >
            {named ? <PanelLeftClose size={15} className={mirrorInRtl} /> : <PanelLeftOpen size={15} className={mirrorInRtl} />}
          </button>
        )}
      </div>
      <div
        role="toolbar"
        aria-label={tr("editor.toolbox_title")}
        aria-orientation="vertical"
        onKeyDown={onToolbarKeyDown}
        onScroll={() => {
          hideTip();
          if (fly) setFly(null);
        }}
        className="oc-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-2"
      >
        {visible.map((sec, i) => {
          const open = !collapsed.includes(sec.id);
          const hasActive = sec.tools.some((t) => t.active?.(state));
          const sid = `section:${sec.id}`;
          return (
            <div key={sec.id} role="group" aria-label={sec.label} className={i > 0 ? "border-t border-neutral-100" : ""}>
              <button
                {...itemProps(sid)}
                type="button"
                onClick={() => useProToolbox.getState().toggleSection(sec.id)}
                onFocus={() => setTabStop(sid)}
                aria-expanded={open}
                aria-controls={`a3-toolbox-${sec.id}`}
                title={named ? undefined : sec.label}
                aria-label={sec.label}
                className={`group flex w-full items-center gap-1 text-start font-semibold uppercase tracking-wide transition hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none ${
                  named ? "px-3 py-1.5 text-[11px]" : "px-2 py-1 text-[9px]"
                } ${!open && hasActive ? "text-brand-ink" : "text-neutral-500"}`}
              >
                <span className="min-w-0 flex-1 truncate">{named ? sec.label : sec.short}</span>
                {named && <span className="rounded-full bg-neutral-100 px-1.5 text-[10px] font-semibold text-neutral-500">{sec.tools.length}</span>}
                <ChevronDown size={named ? 14 : 11} className={`shrink-0 text-neutral-300 transition-transform group-hover:text-neutral-400 ${open ? "" : "-rotate-90"}`} />
              </button>
              {open && (
                <div id={`a3-toolbox-${sec.id}`} className={named ? "flex flex-col gap-px px-1.5 pb-1.5" : "grid grid-cols-2 justify-items-center gap-0.5 px-1 pb-1.5"}>
                  {sec.tools.map(toolButton)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {fly && flyTool?.flyout && (
        <FlyoutCard key={fly.id} tool={flyTool} flyout={flyTool.flyout} anchor={fly} state={state} env={env} onClose={closeFly} onRun={runFlyItem} />
      )}
      {tip && tipTool && <Tooltip tool={tipTool} anchor={tip} reason={tipTool.blocked?.(state) ?? null} />}
    </aside>
  );
}
