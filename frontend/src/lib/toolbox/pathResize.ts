// aidir3 fork: resizing a path node.
//
// A path is drawn from its anchors, not from its size. Upstream never resized
// one by its box (a selected path shows the node editor instead of handles),
// so a size change left the artwork where it was. The pro toolbox puts
// ready-made shapes on the page as paths and selects them with the ordinary
// resize box, so a size change has to scale the anchors, handles and extra
// contours with it. This is the same treatment the editor already gives a
// line's points, kept here so the upstream files only carry a short call.
//
// No import of the editor store: callers pass what is needed, so the store can
// call this without an import cycle.

import type { DesignFile, PathContour, PathSegment, Transform } from "@hc/schema";
import { locate } from "@hc/editor";

type Size = { width: number; height: number };

/** A path's geometry at the start of a resize, as `snapshotPath` returns it. */
export interface PathGeometry {
  segments: PathSegment[];
  contours?: PathContour[];
  transform: Transform;
  size: Size;
}

interface PathLike {
  segments: PathSegment[];
  contours?: PathContour[];
  transform: Transform;
  size: Size;
}

const scaleSegments = (segs: PathSegment[], kx: number, ky: number): PathSegment[] =>
  segs.map((s) => ({
    ...s,
    x: s.x * kx,
    y: s.y * ky,
    ...(s.cIn ? { cIn: { x: s.cIn.x * kx, y: s.cIn.y * ky } } : {}),
    ...(s.cOut ? { cOut: { x: s.cOut.x * kx, y: s.cOut.y * ky } } : {}),
  }));

/** Whether the artwork has no extent on each axis (a dead-straight horizontal
 *  or vertical line). Such an axis cannot be scaled, only kept. */
function flatAxes(g: Pick<PathGeometry, "segments" | "contours">): { x: boolean; y: boolean } {
  const all = [...g.segments, ...(g.contours ?? []).flatMap((c) => c.segments)];
  const xs = all.flatMap((s) => [s.x, s.cIn?.x, s.cOut?.x]).filter((v): v is number => v !== undefined);
  const ys = all.flatMap((s) => [s.y, s.cIn?.y, s.cOut?.y]).filter((v): v is number => v !== undefined);
  return {
    x: !xs.length || Math.max(...xs) - Math.min(...xs) < 0.5,
    y: !ys.length || Math.max(...ys) - Math.min(...ys) < 0.5,
  };
}

/**
 * Writes `start` scaled to `size` into the path. Always scales from the
 * gesture's starting geometry, never from the previous frame, so a long drag
 * does not accumulate rounding.
 *
 * Returns the transform and size the node should take: an axis the artwork
 * does not span keeps its starting box, or the box would drift away from a
 * stroke that cannot follow it (the rule the editor applies to lines).
 */
export function resizePathGeometry(
  node: PathLike,
  start: PathGeometry,
  handle: string,
  transform: Transform,
  size: Size,
): { transform: Transform; size: Size } {
  const flat = flatAxes(start);
  let tf = transform;
  let next = size;
  if (flat.x) {
    next = { ...next, width: start.size.width };
    tf = { ...tf, scaleX: start.transform.scaleX, x: handle.includes("w") || handle.includes("e") ? start.transform.x : tf.x };
  }
  if (flat.y) {
    next = { ...next, height: start.size.height };
    tf = { ...tf, scaleY: start.transform.scaleY, y: handle.includes("n") || handle.includes("s") ? start.transform.y : tf.y };
  }
  const kx = flat.x || start.size.width <= 0 ? 1 : next.width / start.size.width;
  const ky = flat.y || start.size.height <= 0 ? 1 : next.height / start.size.height;
  node.segments = scaleSegments(start.segments, kx, ky);
  if (start.contours) node.contours = start.contours.map((c) => ({ ...c, segments: scaleSegments(c.segments, kx, ky) }));
  return { transform: tf, size: next };
}

/** Puts a path back exactly as it was when the gesture began (Escape). */
export function restorePathGeometry(node: PathLike, start: PathGeometry): void {
  node.segments = structuredClone(start.segments);
  if (start.contours) node.contours = structuredClone(start.contours);
}

/** The slice of the editor store a typed-in size change needs. */
interface PathStore {
  doc: DesignFile;
  undoStack: unknown[];
  snapshotPath(id: string): unknown;
  commitPathEdit(id: string, before: unknown): void;
}

/**
 * Applies a new transform and size to a path as ONE undo step, scaling its
 * geometry to the new box. The Properties panel's W and H fields use it, as
 * the other node kinds whose content follows their box have their own.
 *
 * Takes the store's getter rather than a state object: the undo stack is read
 * again after the commit, and a state object captured before it would be stale.
 */
export function applyPathGeometry(getStore: () => PathStore, id: string, transform: Transform, size: Size): void {
  const store = getStore();
  const loc = locate(store.doc, id);
  if (!loc || loc.node.type !== "path" || loc.node.locked) return;
  const before = store.snapshotPath(id) as PathGeometry | null;
  if (!before) return;
  const node = loc.node as unknown as PathLike;
  const next = resizePathGeometry(node, before, "", transform, { width: Math.max(1, size.width), height: Math.max(1, size.height) });
  node.transform = { ...next.transform };
  node.size = next.size;
  // commitPathEdit refuses a brand-locked or collaborator-locked path and
  // records nothing. Take the in-place change back in that case rather than
  // leave an edit on the page that no undo entry knows about.
  const depth = store.undoStack.length;
  store.commitPathEdit(id, before);
  if (getStore().undoStack.length === depth) {
    restorePathGeometry(node, before);
    node.transform = { ...before.transform };
    node.size = { ...before.size };
  }
}
