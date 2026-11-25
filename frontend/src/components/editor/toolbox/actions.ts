// aidir3 fork: what the pro toolbox's tools do.
//
// Every action here drives a capability the editor already has, through the
// editor store, so each one is undoable exactly as it is from the panel or
// menu it normally lives in. Nothing in this file renders; the catalogue
// (catalog.ts) names the tools and the toolbox (ProToolbox.tsx) draws them.

import type { Node, PathContour, TextNode } from "@hc/schema";
import { locate } from "@hc/editor";
import { useEditor } from "@/store/editor";
import { requestPickTool, useProToolbox } from "@/store/proToolbox";
import { requestOpenProperties } from "@/lib/aiRequests";
import { measuredTextHeight } from "@/lib/textFit";
import { pageScale, pathNodeInit, type BuiltShape } from "@/lib/toolbox/shapes";
import { classifyStroke, type Sketch } from "@/lib/toolbox/sketch";

type CanvasTool = Parameters<ReturnType<typeof useEditor.getState>["setTool"]>[0];

const store = () => useEditor.getState();

/** The page a new element will land on. */
function activePage() {
  const st = store();
  return st.doc.pages[Math.min(st.activePage, st.doc.pages.length - 1)];
}

/** Back to the canvas's selection tool. The canvas does the switch itself when
 *  it is listening, because it also drops any half-drawn path. */
function selectTool(): void {
  requestPickTool();
  if (store().tool !== "select") store().setTool("select");
}

/** The Pick tool: plain selection, with paths selected as boxes. */
export function pickTool(): void {
  selectTool();
  useProToolbox.getState().setNodeEdit(false);
  useProToolbox.getState().setSmartDraw(false);
}

/** The Shape tool: selection, with a selected path showing its nodes. */
export function nodeTool(): void {
  selectTool();
  useProToolbox.getState().setSmartDraw(false);
  useProToolbox.getState().setNodeEdit(true);
}

/** Activates one of the canvas's own drawing tools. */
export function canvasTool(tool: CanvasTool): void {
  useProToolbox.getState().setSmartDraw(false);
  store().setTool(tool);
}

/** Freehand drawing whose strokes are tidied into clean shapes as they land. */
export function smartDrawTool(): void {
  store().setTool("pencil");
  useProToolbox.getState().setSmartDraw(true);
}

/** What the layer made from each kind of recognized sketch is called. */
export type SketchNames = Record<Sketch["kind"], string>;

/**
 * Smart drawing: replaces the freehand path that was just drawn with the clean
 * shape its stroke resembles, keeping the brush's outline, as one undo step.
 * Returns false (and leaves the sketch alone) when the stroke is not a
 * recognizable shape.
 *
 * `screenStroke` is the stroke in screen pixels, as the toolbox recorded it.
 * It is brought into the page's coordinates by the zoom and by the one point
 * both records share: a freehand path starts exactly where its stroke did.
 */
export function tidySketch(id: string, screenStroke: { x: number; y: number }[], names: SketchNames): boolean {
  const st = store();
  const loc = locate(st.doc, id);
  if (!loc || loc.node.type !== "path" || screenStroke.length < 3) return false;
  const path = loc.node as unknown as { transform: { x: number; y: number }; segments: { x: number; y: number }[]; stroke?: unknown };
  const first = path.segments[0];
  const zoom = st.viewport.zoom;
  if (!first || !(zoom > 0)) return false;
  const origin = screenStroke[0];
  const sketch = classifyStroke(
    screenStroke.map((p) => ({ x: path.transform.x + first.x + (p.x - origin.x) / zoom, y: path.transform.y + first.y + (p.y - origin.y) / zoom })),
  );
  if (!sketch) return false;
  const stroke = path.stroke;
  const flat = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  /** Moves the node addNode just centred on the page to where the sketch was. */
  const moveTo = (x: number, y: number, flipY = false) => {
    const s = store();
    const nid = s.selection[0];
    const node = nid ? locate(s.doc, nid)?.node : null;
    if (!nid || !node) return;
    s.runCommand({ kind: "transform", nodes: [nid], before: [{ ...node.transform }], after: [{ ...node.transform, x, y, scaleY: flipY ? -1 : 1 }] });
  };
  st.runAsTurn(() => {
    store().select([id]);
    store().deleteSelection();
    if (sketch.kind === "line") {
      const x = Math.min(sketch.from.x, sketch.to.x);
      const y = Math.min(sketch.from.y, sketch.to.y);
      store().addNode("path", {
        name: names.line,
        closed: false,
        segments: [{ x: sketch.from.x - x, y: sketch.from.y - y }, { x: sketch.to.x - x, y: sketch.to.y - y }],
        fills: [],
        stroke,
        transform: flat,
        size: { width: Math.max(1, Math.abs(sketch.to.x - sketch.from.x)), height: Math.max(1, Math.abs(sketch.to.y - sketch.from.y)) },
      } as unknown as Partial<Node>);
      moveTo(x, y);
      return;
    }
    const { box } = sketch;
    store().addNode("shape", {
      name: names[sketch.kind],
      shape: sketch.kind,
      ...(sketch.kind === "polygon" ? { sides: sketch.sides } : {}),
      fills: [],
      stroke,
      transform: flat,
      size: { width: box.width, height: box.height },
    } as unknown as Partial<Node>);
    // A triangle drawn point down is the shape node mirrored top to bottom,
    // which puts its origin on the box's bottom edge.
    const flipped = sketch.kind === "triangle" && sketch.flipped;
    moveTo(box.x, flipped ? box.y + box.height : box.y, flipped);
  });
  return true;
}

/** Places a ready-made shape at the centre of the active page, selected, as
 *  one undo step. */
export function insertPathShape(shape: BuiltShape, name: string): void {
  pickTool();
  store().addNode("path", pathNodeInit(shape, name, pageScale(activePage())));
}

/** Places a regular polygon or star as an ordinary shape node, the same node
 *  the Elements panel inserts. */
export function insertRegularShape(kind: "polygon" | "triangle" | "star", sides: number, name: string, innerRadius?: number): void {
  pickTool();
  const side = Math.round(220 * pageScale(activePage()));
  store().addNode("shape", {
    name,
    shape: kind,
    sides,
    ...(innerRadius !== undefined ? { innerRadius } : {}),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width: side, height: side },
    fills: [{ type: "solid", color: { srgb: { r: 0.38, g: 0.22, b: 0.86, a: 1 } } }],
  } as Partial<Node>);
}

/** Places a text frame whose text wraps inside it and grows it downwards. */
export function insertParagraph(text: string, name: string): void {
  pickTool();
  const k = pageScale(activePage());
  const width = Math.round(460 * k);
  const fontSize = Math.max(10, Math.round(24 * k));
  const init = {
    name,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width, height: Math.round(fontSize * 3) },
    box: { mode: "autoHeight", width, height: Math.round(fontSize * 3), autoFit: { enabled: false, min: 8, max: 512 }, verticalAlign: "top" },
    content: [
      {
        runs: [{ text, style: { fontFamily: "system", fontStyle: "Regular", fontSize, fill: { type: "solid", color: { srgb: { r: 0.1, g: 0.12, b: 0.16, a: 1 } } } } }],
        style: { align: "left", direction: "auto" },
      },
    ],
  };
  // The frame opens at the height its wrapped text needs, so the selection box
  // hugs the paragraph from the first frame.
  try {
    const h = measuredTextHeight({ type: "text", ...init } as unknown as TextNode);
    init.size.height = h;
    init.box.height = h;
  } catch {
    /* no measuring canvas: keep the estimate, the editor refits on first edit */
  }
  store().addNode("text", init as unknown as Partial<Node>);
}

export function insertTable(rows: number, cols: number): void {
  pickTool();
  store().insertTable(rows, cols);
}

/** Joins the two selected objects with a connector that follows them. */
export function connectSelection(route: "straight" | "elbow"): void {
  const st = store();
  const [a, b] = st.selection;
  if (st.selection.length !== 2 || !a || !b) return;
  st.runAsTurn(() => {
    const id = store().connectNodes(a, b);
    if (id) store().setConnectorRoute(route);
  });
}

/** Whether any selected node carries a drop shadow. */
export function selectionHasShadow(): boolean {
  const st = store();
  return st.selection.some((id) => {
    const effects = (locate(st.doc, id)?.node as { effects?: { kind: string; enabled?: boolean }[] } | undefined)?.effects;
    return !!effects?.some((e) => e.kind === "shadow");
  });
}

export function toggleShadow(): void {
  store().setShadowSel(!selectionHasShadow());
}

export function setOpacity(value: number): void {
  store().setOpacitySel(value);
}

export function combineShapes(op: "union" | "subtract" | "intersect" | "exclude"): void {
  store().booleanSelection(op);
}

export function cropSelection(): void {
  const st = store();
  if (st.selection.length === 1) st.setCropping(st.selection[0]);
}

export function refineSelection(): void {
  const st = store();
  if (st.selection.length === 1) st.setMaskRefining(st.selection[0]);
}

/** Zooms about the centre of the canvas, as the keyboard zoom does. */
function zoomAboutCentre(next: (zoom: number) => number): void {
  const st = store();
  const { zoom, panX, panY } = st.viewport;
  const vs = st.viewportSize;
  const z = Math.min(8, Math.max(0.05, next(zoom)));
  const cx = panX + vs.width / 2 / zoom;
  const cy = panY + vs.height / 2 / zoom;
  st.setViewport({ zoom: z, panX: cx - vs.width / 2 / z, panY: cy - vs.height / 2 / z });
}

export const zoomIn = () => zoomAboutCentre((z) => z * 1.2);
export const zoomOut = () => zoomAboutCentre((z) => z / 1.2);
export const zoomActualSize = () => zoomAboutCentre(() => 1);
export const zoomFitPage = () => store().fitToScreen();
export const zoomToSelection = () => store().zoomToSelection();

interface EyeDropperCtor {
  new (): { open(): Promise<{ sRGBHex: string }> };
}

const eyeDropper = (): EyeDropperCtor | null =>
  typeof window === "undefined" ? null : ((window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null);

/** The browser's screen colour picker exists (Chromium-based browsers). */
export const canPickScreenColor = (): boolean => eyeDropper() !== null;

/** Picks a colour from anywhere on screen and fills the selection with it.
 *  Resolves false when the picker is unavailable or the user cancels it. */
export async function pickScreenColor(): Promise<boolean> {
  const Picker = eyeDropper();
  if (!Picker) return false;
  try {
    const { sRGBHex } = await new Picker().open();
    store().setFillColorSel(sRGBHex);
    return true;
  } catch {
    return false; // Escape cancels the picker by rejecting
  }
}

const flashClasses = ["rounded-lg", "ring-2", "ring-brand-400"];
const flashTimers = new WeakMap<Element, number>();

/**
 * Opens the Properties panel and brings one of its sections into view,
 * unfolding it if it was folded, with a brief highlight so the eye lands on
 * it. `tab` names a tab inside the section to switch to.
 *
 * The panel has no anchors to address a section by, so it is found by its
 * heading, which is the same translated title the panel renders. If the
 * section is not on screen for the current selection this does nothing more
 * than open the panel.
 */
export function revealPropertiesSection(title: string, tab?: string): void {
  requestOpenProperties();
  // Two frames: one for the panel to mount, one for its sections to lay out.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const header = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")).find(
        (b) => !b.closest("[data-a3-toolbox]") && b.querySelector("span")?.textContent?.trim() === title,
      );
      const section = header?.parentElement;
      if (!header || !section) return;
      if (header.getAttribute("aria-expanded") === "false") header.click();
      section.scrollIntoView({ block: "nearest", behavior: "smooth" });
      section.classList.add(...flashClasses);
      // One timer per section: revealing it again while it is still lit must
      // not let the first reveal's timer put the highlight out early.
      window.clearTimeout(flashTimers.get(section));
      flashTimers.set(section, window.setTimeout(() => section.classList.remove(...flashClasses), 1400));
      if (tab) {
        requestAnimationFrame(() => {
          const btn = Array.from(section.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")).find((b) => b.textContent?.trim() === tab);
          if (btn && btn.getAttribute("aria-pressed") !== "true") btn.click();
        });
      }
    }),
  );
}

/** A regular polygon or star in a 100 x 100 box, for a flyout preview. */
export function regularPreview(sides: number, innerRadius?: number): PathContour[] {
  const n = innerRadius === undefined ? sides : sides * 2;
  const segments = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = innerRadius !== undefined && i % 2 ? 46 * innerRadius : 46;
    return { x: 50 + Math.cos(a) * r, y: 50 + Math.sin(a) * r };
  });
  return [{ segments, closed: true }];
}
