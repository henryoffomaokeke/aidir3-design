// aidir3 fork: the pro toolbox's ready-made shapes, as path-node geometry.
//
// Arrow, flowchart, banner, callout and basic shapes are carried over from the
// previous aidir3 Design editor (its lib/design/protools.ts), where each is
// path data drawn in a 100 x 100 box. Here they become `path` nodes: closed
// outlines (with interior contours cutting holes under the even-odd rule the
// engine applies to compound paths) plus, for a few, stroke-only detail lines.
// Complex stars, spirals and graph paper are generated.
//
// Pure geometry: no DOM, no store, no translated text. Names come from the
// toolbox catalogue.

import type { Fill, Node, PathContour, PathSegment } from "@hc/schema";
import { contourBounds, contoursFromPathData, fitContours, mapContours, retraced } from "./pathData";

/** How a shape is painted when it lands on the page. */
export type ShapeStyle =
  | "fill" // filled, no outline
  | "outline" // filled, with an ink outline that also draws its detail lines
  | "line"; // outline only (a spiral, graph paper)

export interface BuiltShape {
  /** Contours in the shape's own design space (any scale). */
  contours: PathContour[];
  /** Size on a 1080 px page; scaled to the page it is inserted on. */
  width: number;
  height: number;
  style: ShapeStyle;
  /** Outline width on a 1080 px page. */
  strokeWidth: number;
}

export type ShapeFamily = "arrows" | "flowchart" | "banners" | "callouts" | "basic";

interface FamilyShape {
  id: string;
  /** Closed outlines, filled together under the even-odd rule. */
  d: string;
  /** Stroke-only detail lines. */
  lines?: string;
  w: number;
  h: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const poly = (pts: number[][]) => pts.map((p, i) => `${i ? "L" : "M"}${r2(p[0])} ${r2(p[1])}`).join("") + "Z";
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;

function gear(teeth = 10): string {
  const pts: number[][] = [];
  for (let i = 0; i < teeth * 4; i++) {
    const a = (i / (teeth * 4)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 4 < 2 ? 50 : 38;
    pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  return poly(pts) + circle(50, 50, 14);
}

function burst(points: number, inner: number): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? inner : 50;
    pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  return pts;
}

export const shapeFamilies: Record<ShapeFamily, FamilyShape[]> = {
  arrows: [
    { id: "right", w: 260, h: 170, d: poly([[0, 30], [60, 30], [60, 8], [100, 50], [60, 92], [60, 70], [0, 70]]) },
    { id: "left", w: 260, h: 170, d: poly([[100, 30], [40, 30], [40, 8], [0, 50], [40, 92], [40, 70], [100, 70]]) },
    { id: "up", w: 170, h: 260, d: poly([[30, 100], [30, 40], [8, 40], [50, 0], [92, 40], [70, 40], [70, 100]]) },
    { id: "down", w: 170, h: 260, d: poly([[30, 0], [30, 60], [8, 60], [50, 100], [92, 60], [70, 60], [70, 0]]) },
    { id: "both", w: 300, h: 160, d: poly([[0, 50], [25, 10], [25, 32], [75, 32], [75, 10], [100, 50], [75, 90], [75, 68], [25, 68], [25, 90]]) },
    { id: "four", w: 240, h: 240, d: poly([[50, 0], [68, 20], [58, 20], [58, 42], [80, 42], [80, 32], [100, 50], [80, 68], [80, 58], [58, 58], [58, 80], [68, 80], [50, 100], [32, 80], [42, 80], [42, 58], [20, 58], [20, 68], [0, 50], [20, 32], [20, 42], [42, 42], [42, 20], [32, 20]]) },
    { id: "chevron", w: 240, h: 160, d: poly([[0, 0], [65, 0], [100, 50], [65, 100], [0, 100], [35, 50]]) },
    { id: "tag", w: 240, h: 140, d: poly([[0, 0], [70, 0], [100, 50], [70, 100], [0, 100]]) },
    { id: "notched", w: 260, h: 170, d: poly([[0, 30], [60, 30], [60, 8], [100, 50], [60, 92], [60, 70], [0, 70], [14, 50]]) },
    { id: "uturn", w: 200, h: 230, d: "M10 100L10 45C10 15 30 5 50 5C70 5 85 15 85 45L85 55L100 55L75 85L50 55L65 55L65 45C65 30 60 25 50 25C40 25 30 30 30 45L30 100Z" },
    { id: "curved", w: 230, h: 230, d: "M0 100C0 45 35 20 70 20L70 0L100 32L70 64L70 44C45 44 22 60 22 100Z" },
    { id: "circular", w: 230, h: 230, d: "M50 8A42 42 0 1 1 10 62L0 62L18 40L36 62L26 62A26 26 0 1 0 50 24Z" },
  ],
  flowchart: [
    { id: "process", w: 240, h: 140, d: poly([[0, 0], [100, 0], [100, 100], [0, 100]]) },
    { id: "decision", w: 220, h: 170, d: poly([[50, 0], [100, 50], [50, 100], [0, 50]]) },
    { id: "terminator", w: 240, h: 100, d: "M25 0L75 0A25 50 0 0 1 75 100L25 100A25 50 0 0 1 25 0Z" },
    { id: "data", w: 250, h: 140, d: poly([[20, 0], [100, 0], [80, 100], [0, 100]]) },
    { id: "document", w: 240, h: 160, d: "M0 0L100 0L100 85C75 70 50 100 25 92C15 89 8 86 0 85Z" },
    { id: "subroutine", w: 240, h: 140, d: poly([[0, 0], [100, 0], [100, 100], [0, 100]]), lines: "M12 0L12 100M88 0L88 100" },
    { id: "manual-input", w: 240, h: 140, d: poly([[0, 25], [100, 0], [100, 100], [0, 100]]) },
    { id: "preparation", w: 260, h: 140, d: poly([[20, 0], [80, 0], [100, 50], [80, 100], [20, 100], [0, 50]]) },
    { id: "delay", w: 220, h: 140, d: "M0 0L55 0A45 50 0 0 1 55 100L0 100Z" },
    { id: "database", w: 180, h: 220, d: "M0 15A50 15 0 0 1 100 15L100 85A50 15 0 0 1 0 85Z", lines: "M0 15A50 15 0 0 0 100 15" },
    { id: "offpage", w: 180, h: 200, d: poly([[0, 0], [100, 0], [100, 70], [50, 100], [0, 70]]) },
    { id: "connector", w: 140, h: 140, d: circle(50, 50, 50) },
    { id: "manual-step", w: 240, h: 140, d: poly([[0, 0], [100, 0], [80, 100], [20, 100]]) },
    { id: "merge", w: 200, h: 170, d: poly([[0, 0], [100, 0], [50, 100]]) },
  ],
  banners: [
    { id: "ribbon", w: 360, h: 150, d: poly([[0, 30], [18, 30], [18, 15], [82, 15], [82, 30], [100, 30], [90, 55], [100, 80], [82, 80], [82, 70], [18, 70], [18, 80], [0, 80], [10, 55]]) + "M18 70L28 80L28 70ZM82 70L72 80L72 70Z" },
    { id: "flag", w: 280, h: 190, d: "M0 20C25 0 50 40 75 20C85 12 92 10 100 12L100 72C92 70 85 72 75 80C50 100 25 60 0 80Z" },
    { id: "seal", w: 220, h: 220, d: poly(burst(16, 42)) },
    { id: "shield", w: 200, h: 230, d: "M50 0L95 15L95 50C95 75 75 92 50 100C25 92 5 75 5 50L5 15Z" },
    { id: "label", w: 280, h: 130, d: "M10 0L90 0L100 50L90 100L10 100L0 50Z" },
    { id: "pennant", w: 260, h: 170, d: poly([[0, 0], [100, 50], [0, 100]]) },
    { id: "bookmark", w: 160, h: 240, d: poly([[0, 0], [100, 0], [100, 100], [50, 75], [0, 100]]) },
    { id: "forked", w: 300, h: 130, d: poly([[0, 0], [100, 0], [80, 50], [100, 100], [0, 100]]) },
  ],
  callouts: [
    { id: "speech", w: 260, h: 200, d: "M0 0L100 0L100 70L45 70L20 100L25 70L0 70Z" },
    { id: "rounded", w: 260, h: 200, d: "M12 0L88 0A12 12 0 0 1 100 12L100 58A12 12 0 0 1 88 70L45 70L20 100L26 70L12 70A12 12 0 0 1 0 58L0 12A12 12 0 0 1 12 0Z" },
    { id: "oval", w: 260, h: 220, d: "M50 0A50 35 0 1 1 30 67L10 100L18 60A50 35 0 0 1 50 0Z" },
    { id: "thought", w: 260, h: 230, d: "M25 15A18 18 0 0 1 55 8A18 18 0 0 1 85 20A16 16 0 0 1 92 50A18 18 0 0 1 65 68A18 18 0 0 1 30 66A16 16 0 0 1 8 45A16 16 0 0 1 25 15Z" + circle(16, 82, 7) + circle(6, 96, 4) },
    { id: "shout", w: 260, h: 240, d: poly([[0, 10], [25, 18], [40, 0], [55, 15], [80, 2], [78, 25], [100, 30], [85, 48], [100, 68], [75, 68], [70, 90], [52, 72], [35, 100], [32, 72], [8, 75], [18, 52], [0, 35], [18, 28]]) },
    { id: "line", w: 260, h: 200, d: "M30 0L100 0L100 50L30 50Z", lines: "M30 50L0 100" },
    { id: "pointer-left", w: 280, h: 160, d: poly([[20, 0], [100, 0], [100, 100], [20, 100], [20, 60], [0, 50], [20, 40]]) },
    { id: "pointer-down", w: 260, h: 190, d: poly([[0, 0], [100, 0], [100, 80], [60, 80], [50, 100], [40, 80], [0, 80]]) },
  ],
  basic: [
    { id: "heart", w: 220, h: 210, d: "M50 95C20 72 0 55 0 30C0 12 14 0 29 0C40 0 47 6 50 14C53 6 60 0 71 0C86 0 100 12 100 30C100 55 80 72 50 95Z" },
    { id: "cloud", w: 260, h: 180, d: "M22 85A20 20 0 0 1 18 46A24 24 0 0 1 52 22A22 22 0 0 1 88 38A20 20 0 0 1 82 85Z" },
    { id: "lightning", w: 150, h: 240, d: poly([[58, 0], [18, 55], [45, 55], [32, 100], [82, 38], [54, 38], [72, 0]]) },
    { id: "gear", w: 220, h: 220, d: gear() },
    { id: "moon", w: 200, h: 220, d: "M62 2A48 48 0 1 0 98 70A40 40 0 1 1 62 2Z" },
    { id: "drop", w: 160, h: 230, d: "M50 0C50 0 15 45 15 65A35 35 0 0 0 85 65C85 45 50 0 50 0Z" },
    { id: "cross", w: 200, h: 200, d: poly([[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]]) },
    { id: "trapezoid", w: 240, h: 160, d: poly([[20, 0], [80, 0], [100, 100], [0, 100]]) },
    { id: "parallelogram", w: 260, h: 150, d: poly([[25, 0], [100, 0], [75, 100], [0, 100]]) },
    { id: "octagon", w: 200, h: 200, d: poly([[30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]]) },
    { id: "cylinder", w: 170, h: 220, d: "M0 12A50 12 0 0 1 100 12L100 88A50 12 0 0 1 0 88Z", lines: "M0 12A50 12 0 0 0 100 12" },
    { id: "cube", w: 210, h: 210, d: poly([[0, 25], [25, 0], [100, 0], [100, 75], [75, 100], [0, 100]]), lines: "M0 25L75 25L100 0M75 25L75 100" },
    { id: "frame", w: 240, h: 240, d: poly([[0, 0], [100, 0], [100, 100], [0, 100]]) + poly([[12, 12], [12, 88], [88, 88], [88, 12]]) },
    { id: "ring", w: 220, h: 220, d: circle(50, 50, 50) + circle(50, 50, 30) },
    { id: "arc", w: 260, h: 130, d: "M0 100A50 50 0 0 1 100 100L78 100A28 28 0 0 0 22 100Z" },
    { id: "smiley", w: 220, h: 220, d: circle(50, 50, 50) + circle(34, 38, 7) + circle(66, 38, 7) + "M28 62Q50 82 72 62Q50 72 28 62Z" },
    { id: "burst", w: 230, h: 230, d: poly(burst(12, 34)) },
    { id: "plaque", w: 260, h: 160, d: "M15 0L85 0A15 15 0 0 0 100 15L100 85A15 15 0 0 0 85 100L15 100A15 15 0 0 0 0 85L0 15A15 15 0 0 0 15 0Z" },
  ],
};

/** One of the family shapes, ready to place. */
export function familyShape(family: ShapeFamily, id: string): BuiltShape | null {
  const def = shapeFamilies[family].find((s) => s.id === id);
  if (!def) return null;
  const outlines = contoursFromPathData(def.d);
  const details = def.lines ? contoursFromPathData(def.lines).map(retraced) : [];
  return {
    contours: [...outlines, ...details].map(markCusps),
    width: def.w,
    height: def.h,
    style: details.length ? "outline" : "fill",
    strokeWidth: 3,
  };
}

/** Star polygons the toolbox offers: `points` vertices, every `step`-th joined.
 *  Each pair is coprime, so the star is a single interlaced outline. */
export const complexStars: { id: string; points: number; step: number }[] = [
  { id: "5-2", points: 5, step: 2 },
  { id: "7-2", points: 7, step: 2 },
  { id: "7-3", points: 7, step: 3 },
  { id: "8-3", points: 8, step: 3 },
  { id: "9-2", points: 9, step: 2 },
  { id: "9-4", points: 9, step: 4 },
  { id: "10-3", points: 10, step: 3 },
  { id: "12-5", points: 12, step: 5 },
];

/**
 * A complex star: the star polygon {n/k}, filled under the even-odd rule so
 * alternate layers are see-through.
 *
 * The previous editor drew this as one self-crossing polygon and let the
 * renderer's even-odd fill sort the layers out. A path node only fills
 * even-odd when it has more than one contour, so the same picture is built
 * here from its layers instead: the star's edges cross on `k - 1` rings, the
 * points on ring `j` sitting at radius R cos(pi k / n) / cos(pi (k - j) / n),
 * half a step round from the ring outside it. Layer `j` is the star whose tips
 * are ring `j - 1` and whose notches are ring `j`; the innermost layer is the
 * central polygon. Filled together, even-odd, they are the classic figure.
 */
export function complexStar(points: number, step: number): BuiltShape {
  const n = Math.max(5, Math.round(points));
  const k = Math.max(2, Math.min(Math.floor((n - 1) / 2), Math.round(step)));
  const R = 50;
  const ringRadius = (j: number) => (R * Math.cos((Math.PI * k) / n)) / Math.cos((Math.PI * (k - j)) / n);
  const ringPoint = (j: number, i: number): PathSegment => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2 + (j * Math.PI) / n;
    return { x: 50 + Math.cos(a) * ringRadius(j), y: 50 + Math.sin(a) * ringRadius(j) };
  };
  const contours: PathContour[] = [];
  for (let j = 1; j < k; j++) {
    const segments: PathSegment[] = [];
    for (let i = 0; i < n; i++) segments.push(ringPoint(j - 1, i), ringPoint(j, i));
    contours.push({ segments, closed: true });
  }
  contours.push({ segments: Array.from({ length: n }, (_, i) => ringPoint(k - 1, i)), closed: true });
  return natural(contours, 240, "fill", 3);
}

/** An Archimedean spiral of `turns` turns, as a smooth open curve. Each eighth
 *  of a turn is one cubic whose handles follow the spiral's own tangent. */
export function spiral(turns: number): BuiltShape {
  const t = Math.max(1, Math.min(12, turns));
  const omega = t * Math.PI * 2;
  const steps = Math.round(t * 8);
  const at = (u: number) => ({ x: 50 + 50 * u * Math.cos(omega * u), y: 50 + 50 * u * Math.sin(omega * u) });
  const tangent = (u: number) => ({
    x: 50 * (Math.cos(omega * u) - u * omega * Math.sin(omega * u)),
    y: 50 * (Math.sin(omega * u) + u * omega * Math.cos(omega * u)),
  });
  const h = 1 / steps;
  const segments: PathSegment[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i * h;
    const p = at(u);
    const d = tangent(u);
    const seg: PathSegment = { x: p.x, y: p.y };
    if (i > 0) seg.cIn = { x: p.x - (d.x * h) / 3, y: p.y - (d.y * h) / 3 };
    if (i < steps) seg.cOut = { x: p.x + (d.x * h) / 3, y: p.y + (d.y * h) / 3 };
    segments.push(seg);
  }
  return natural([{ segments, closed: false }], 260, "line", 4);
}

/** Graph paper: a frame with evenly spaced rules. The rules are zero-area
 *  contours, so giving the node a fill colours the sheet without the rules
 *  cutting it up. */
export function graphPaper(cols: number, rows: number): BuiltShape {
  const c = Math.max(1, Math.min(40, Math.round(cols)));
  const r = Math.max(1, Math.min(40, Math.round(rows)));
  const w = c * 10;
  const h = r * 10;
  const contours: PathContour[] = [{ segments: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], closed: true }];
  for (let i = 1; i < c; i++) contours.push({ segments: [{ x: i * 10, y: 0 }, { x: i * 10, y: h }], closed: true });
  for (let i = 1; i < r; i++) contours.push({ segments: [{ x: 0, y: i * 10 }, { x: w, y: i * 10 }], closed: true });
  const box = 280;
  const k = box / Math.max(w, h);
  return { contours, width: Math.round(w * k), height: Math.round(h * k), style: "line", strokeWidth: 2 };
}

/** A generated shape at its own proportions, its longer side `box` long. */
function natural(contours: PathContour[], box: number, style: ShapeStyle, strokeWidth: number): BuiltShape {
  const b = contourBounds(contours);
  const k = box / Math.max(b.width, b.height, 1e-6);
  return { contours, width: Math.round(b.width * k), height: Math.round(b.height * k), style, strokeWidth };
}

/**
 * Flags the anchors whose two handles do not line up, so the node editor
 * treats them as corners. Without the flag it would take any anchor with two
 * handles for a smooth one and snap the far handle into line the first time
 * either is dragged, reshaping a cusp (the dip of a heart, the joins of a
 * cloud) the user never touched.
 */
function markCusps(c: PathContour): PathContour {
  return {
    closed: c.closed,
    segments: c.segments.map((s) => {
      if (!s.cIn || !s.cOut) return s;
      const ax = s.cIn.x - s.x;
      const ay = s.cIn.y - s.y;
      const bx = s.cOut.x - s.x;
      const by = s.cOut.y - s.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) return { ...s, corner: true };
      const cross = Math.abs(ax * by - ay * bx) / (la * lb);
      const opposed = ax * bx + ay * by < 0;
      return cross < 0.02 && opposed ? s : { ...s, corner: true };
    }),
  };
}

const solid = (r: number, g: number, b: number): Fill => ({ type: "solid", color: { srgb: { r, g, b, a: 1 } } });

// The same violet and ink the rectangle, ellipse and line tools draw with, so
// a toolbox shape matches whatever else was just drawn.
const shapeFill = solid(0.38, 0.22, 0.86);
const shapeInk = solid(0.1, 0.12, 0.16);

/** How much a shape sized for a 1080 px page should be scaled for this page,
 *  so it lands at a usable size on a business card and on a poster alike. */
export function pageScale(page: { width: number; height: number } | undefined): number {
  if (!page) return 1;
  return Math.max(0.4, Math.min(4, Math.min(page.width, page.height) / 1080));
}

/** The fields of a `path` node for a built shape. The caller places it. */
export function pathNodeInit(shape: BuiltShape, name: string, scale = 1): Partial<Node> {
  const width = Math.max(8, Math.round(shape.width * scale));
  const height = Math.max(8, Math.round(shape.height * scale));
  const [first, ...rest] = fitContours(shape.contours, width, height);
  const init = {
    name,
    segments: first.segments,
    closed: first.closed,
    ...(rest.length ? { contours: rest } : {}),
    fills: shape.style === "line" ? [] : [shapeFill],
    ...(shape.style === "fill"
      ? {}
      : { stroke: { fill: shapeInk, width: Math.max(1, Math.round(shape.strokeWidth * scale)), align: "center", cap: "round", join: "round" } }),
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width, height },
  };
  return init as Partial<Node>;
}

/** A built shape's contours in a 100 x 100 preview box, centred, at their own
 *  proportions. */
export function previewContours(shape: BuiltShape): PathContour[] {
  const k = 92 / Math.max(shape.width, shape.height, 1);
  const w = shape.width * k;
  const h = shape.height * k;
  const fitted = fitContours(shape.contours, w, h);
  return mapContours(fitted, (p) => ({ x: p.x + (100 - w) / 2, y: p.y + (100 - h) / 2 }));
}
