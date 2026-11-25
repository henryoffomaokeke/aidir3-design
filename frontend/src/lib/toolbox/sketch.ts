// aidir3 fork: Smart drawing's recognition of a freehand sketch.
//
// The editor has a recognizer of its own (the "Recognize shape" button), but
// it reads the stroke after curve fitting, and the fit is not a faithful
// record of the sketch: it rounds some corners into a single curve with no
// anchor at the corner, bulges past others, and now and then throws a handle
// far outside the stroke. No reading of the fitted path tells those apart
// reliably, so a sketched rectangle can come back as a triangle or a
// seven-sided polygon, and a clean circle half as tall again as it was drawn.
//
// This module works from the stroke itself: the points the pointer actually
// passed through, which the toolbox records while Smart drawing is on. It
// decides first whether the stroke is round, and otherwise counts its corners.
//
// Pure: no store, no DOM.

import { simplifyPolyline } from "@hc/geometry";

type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

/** What a freehand sketch was meant to be, in the stroke's own coordinates. */
export type Sketch =
  | { kind: "line"; from: Point; to: Point }
  | { kind: "ellipse"; box: Box }
  | { kind: "rect"; box: Box }
  /** `flipped`: drawn point down, where the shape node points up. */
  | { kind: "triangle"; box: Box; flipped: boolean }
  /** A regular polygon; four sides is a diamond. */
  | { kind: "polygon"; box: Box; sides: number };

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function boxOf(points: Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/** The stroke resampled at even steps along its length, so a slow, dense part
 *  of the sketch weighs no more than a quick, sparse one. */
function resample(points: Point[], count: number): Point[] {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  if (total < 1e-6) return [points[0]];
  const step = total / count;
  const out: Point[] = [points[0]];
  let walked = 0;
  let next = step;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = dist(a, b);
    while (len > 0 && walked + len >= next && out.length < count) {
      const t = (next - walked) / len;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      next += step;
    }
    walked += len;
  }
  return out;
}

/**
 * How far a loop is from being an ellipse filling its own box: the spread of
 * each point's distance from the centre once the box is squashed to a unit
 * circle. An ellipse scores 0 and a shaky one about 0.03. A hexagon scores
 * 0.065, a rectangle 0.11, a triangle 0.3.
 */
function unroundness(points: Point[], box: Box): number {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const radii = points.map((p) => Math.hypot((p.x - cx) / (box.width / 2), (p.y - cy) / (box.height / 2)));
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const variance = radii.reduce((a, r) => a + (r - mean) * (r - mean), 0) / radii.length;
  return Math.sqrt(variance) / mean;
}

/** The angle the stroke turns through at `cur`, in degrees: 0 is straight on. */
function turn(prev: Point, cur: Point, next: Point): number {
  const ax = cur.x - prev.x;
  const ay = cur.y - prev.y;
  const bx = next.x - cur.x;
  const by = next.y - cur.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** The corners of a closed stroke: simplified, the doubled start folded away,
 *  and points that are not really bends dropped. */
function cornersOf(stroke: Point[], diag: number): Point[] {
  const loop = simplifyPolyline([...stroke, stroke[0]], diag * 0.05).slice();
  const close = diag * 0.12;
  // The stroke ends on or near its start; that is one corner, not two.
  while (loop.length > 1 && dist(loop[loop.length - 1], loop[0]) < close) loop.pop();
  let changed = true;
  while (changed && loop.length > 2) {
    changed = false;
    for (let i = 0; i < loop.length; i++) {
      const prev = loop[(i - 1 + loop.length) % loop.length];
      const cur = loop[i];
      const next = loop[(i + 1) % loop.length];
      // Two points hugging one rounded-off corner, or a point on a straight run.
      if (dist(cur, next) < close || turn(prev, cur, next) < 28) {
        loop.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return loop;
}

/** Whether four corners sit in the four corners of their box (a rectangle
 *  drawn square to the page) rather than on its sides (a diamond). */
function squareToPage(corners: Point[], box: Box): boolean {
  const reach = Math.min(box.width, box.height) * 0.3;
  const targets = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  return targets.every((t) => corners.some((c) => dist(c, t) <= reach));
}

/**
 * What a freehand stroke was meant to be: an ellipse, a rectangle, a
 * triangle, a polygon of four to seven sides, a straight line, or nothing
 * recognizable (null, and the sketch stays as drawn).
 */
export function classifyStroke(points: Point[]): Sketch | null {
  if (points.length < 3) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const hull = boxOf(points);
  const diag = Math.hypot(hull.width, hull.height);
  if (diag < 12) return null; // a dot or a slip of the hand

  if (dist(start, end) > diag * 0.25) {
    // An open stroke is a line when nothing on it strays from the straight
    // run between its ends.
    const length = dist(start, end);
    const stray = Math.max(...points.map((p) => Math.abs((p.x - start.x) * (end.y - start.y) - (p.y - start.y) * (end.x - start.x)) / length));
    return stray <= diag * 0.08 ? { kind: "line", from: start, to: end } : null;
  }

  // Round wins first: an octagon and a circle differ by less than a hand does.
  if (unroundness(resample(points, 96), hull) < 0.05) return { kind: "ellipse", box: hull };

  const corners = cornersOf(points, diag);
  if (corners.length === 3) {
    const middle = hull.y + hull.height / 2;
    return { kind: "triangle", box: hull, flipped: corners.filter((c) => c.y < middle).length === 2 };
  }
  if (corners.length === 4) return squareToPage(corners, hull) ? { kind: "rect", box: hull } : { kind: "polygon", box: hull, sides: 4 };
  if (corners.length >= 5 && corners.length <= 7) return { kind: "polygon", box: hull, sides: corners.length };
  return null; // too many bends to be a polygon, too few to be anything
}
