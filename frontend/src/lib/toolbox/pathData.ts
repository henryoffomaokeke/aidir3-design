// aidir3 fork: SVG path data to path-node contours, for the pro toolbox's
// ready-made shapes.
//
// The parser and the arc conversion are carried over from the previous aidir3
// Design editor (its lib/design/path.ts). The stock importer's own parser
// (@hc/stock parsePathData) flattens arcs to straight lines, which is fine for
// icon artwork but wrong for shapes that are mostly arcs (a cloud, a cylinder,
// a rounded callout), so the toolbox keeps this one.
//
// Everything here is pure: no DOM, no store.

import type { PathContour, PathSegment } from "@hc/schema";

type Cmd = { c: "M" | "L" | "C" | "Q" | "Z"; p: number[] };
type Point = { x: number; y: number };

const numberRe = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const commandRe = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
const argCount: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

/** Parses SVG path data into absolute M, L, C, Q and Z commands (arcs become
 *  cubic curves). */
export function parsePath(d: string): Cmd[] {
  const out: Cmd[] = [];
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  for (const m of d.matchAll(commandRe)) {
    const cmd = m[1];
    const nums = (m[2].match(numberRe) ?? []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      out.push({ c: "Z", p: [] });
      x = sx;
      y = sy;
      lastCubic = lastQuad = null;
      continue;
    }
    const size = argCount[C] ?? 2;
    for (let i = 0; i + size <= nums.length; i += size) {
      const a = nums.slice(i, i + size);
      const ox = rel ? x : 0;
      const oy = rel ? y : 0;
      if (C === "M" || C === "L") {
        const nx = a[0] + ox;
        const ny = a[1] + oy;
        const first = C === "M" && i === 0;
        out.push({ c: first ? "M" : "L", p: [nx, ny] });
        if (first) {
          sx = nx;
          sy = ny;
        }
        x = nx;
        y = ny;
        lastCubic = lastQuad = null;
      } else if (C === "H") {
        x = a[0] + (rel ? x : 0);
        out.push({ c: "L", p: [x, y] });
        lastCubic = lastQuad = null;
      } else if (C === "V") {
        y = a[0] + (rel ? y : 0);
        out.push({ c: "L", p: [x, y] });
        lastCubic = lastQuad = null;
      } else if (C === "C") {
        const p = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy, a[4] + ox, a[5] + oy];
        out.push({ c: "C", p });
        lastCubic = [p[2], p[3]];
        lastQuad = null;
        x = p[4];
        y = p[5];
      } else if (C === "S") {
        const c1: number[] = lastCubic ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]] : [x, y];
        const p: number[] = [c1[0], c1[1], a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        out.push({ c: "C", p });
        lastCubic = [p[2], p[3]];
        lastQuad = null;
        x = p[4];
        y = p[5];
      } else if (C === "Q") {
        const p = [a[0] + ox, a[1] + oy, a[2] + ox, a[3] + oy];
        out.push({ c: "Q", p });
        lastQuad = [p[0], p[1]];
        lastCubic = null;
        x = p[2];
        y = p[3];
      } else if (C === "T") {
        const c1: number[] = lastQuad ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]] : [x, y];
        const p: number[] = [c1[0], c1[1], a[0] + ox, a[1] + oy];
        out.push({ c: "Q", p });
        lastQuad = [p[0], p[1]];
        lastCubic = null;
        x = p[2];
        y = p[3];
      } else if (C === "A") {
        const ex = a[5] + ox;
        const ey = a[6] + oy;
        for (const seg of arcToCubic(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey)) out.push({ c: "C", p: seg });
        x = ex;
        y = ey;
        lastCubic = lastQuad = null;
      }
    }
  }
  return out;
}

/** SVG elliptical arc to cubic Bezier segments (W3C implementation notes F.6). */
function arcToCubic(x1: number, y1: number, rxIn: number, ryIn: number, phiDeg: number, large: number, sweep: number, x2: number, y2: number): number[][] {
  if (!rxIn || !ryIn) return [[x1, y1, x2, y2, x2, y2]];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = den === 0 ? 0 : sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= Math.PI * 2;
  if (sweep && dt < 0) dt += Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const segs: number[][] = [];
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  let t = t1;
  for (let i = 0; i < n; i++) {
    const c1 = Math.cos(t);
    const s1 = Math.sin(t);
    const c2 = Math.cos(t + step);
    const s2 = Math.sin(t + step);
    const pt = (px: number, py: number) => [cos * rx * px - sin * ry * py + cx, sin * rx * px + cos * ry * py + cy];
    segs.push([...pt(c1 - k * s1, s1 + k * c1), ...pt(c2 + k * s2, s2 - k * c2), ...pt(c2, s2)]);
    t += step;
  }
  return segs;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Path data as path-node contours: one per subpath, each anchor carrying its
 *  incoming and outgoing bezier handles in absolute coordinates. */
export function contoursFromPathData(d: string): PathContour[] {
  const contours: PathContour[] = [];
  let cur: PathContour | null = null;
  let start = { x: 0, y: 0 };
  const open = (x: number, y: number) => {
    cur = { segments: [{ x, y }], closed: false };
    contours.push(cur);
    start = { x, y };
    return cur;
  };
  for (const k of parsePath(d)) {
    if (k.c === "M") {
      open(k.p[0], k.p[1]);
      continue;
    }
    if (k.c === "Z") {
      if (cur) closeContour(cur);
      cur = null;
      continue;
    }
    // A drawing command straight after a close continues from the subpath's
    // start point, as SVG defines it.
    const c: PathContour = cur ?? open(start.x, start.y);
    const prev = c.segments[c.segments.length - 1];
    if (k.c === "L") {
      c.segments.push({ x: k.p[0], y: k.p[1] });
    } else if (k.c === "C") {
      prev.cOut = { x: k.p[0], y: k.p[1] };
      c.segments.push({ x: k.p[4], y: k.p[5], cIn: { x: k.p[2], y: k.p[3] } });
    } else {
      // Quadratic to cubic: both controls sit two thirds of the way to it.
      const [qx, qy, ex, ey] = k.p;
      prev.cOut = { x: prev.x + (2 / 3) * (qx - prev.x), y: prev.y + (2 / 3) * (qy - prev.y) };
      c.segments.push({ x: ex, y: ey, cIn: { x: ex + (2 / 3) * (qx - ex), y: ey + (2 / 3) * (qy - ey) } });
    }
  }
  return contours.filter((c) => c.segments.length >= 2);
}

/** Marks a contour closed. Path data usually ends a closed subpath back on its
 *  first point; that duplicate anchor is folded into the first one so the node
 *  editor shows one anchor there, not two stacked. */
function closeContour(c: PathContour): void {
  c.closed = true;
  if (c.segments.length < 3) return;
  const first = c.segments[0];
  const last = c.segments[c.segments.length - 1];
  if (!near(first.x, last.x) || !near(first.y, last.y)) return;
  if (last.cIn) first.cIn = last.cIn;
  c.segments.pop();
}

/** A stroke-only detail (a fold line, the rim of a cylinder) as a contour that
 *  runs out along the line and straight back again. It encloses no area, so it
 *  never fills and never cuts a hole under the even-odd rule the engine uses
 *  for compound paths, yet a stroke still draws it. */
export function retraced(c: PathContour): PathContour {
  const s = c.segments;
  const n = s.length - 1;
  const anchor = (p: PathSegment, cIn?: Point, cOut?: Point): PathSegment => {
    const seg: PathSegment = { x: p.x, y: p.y };
    if (cIn) seg.cIn = { x: cIn.x, y: cIn.y };
    if (cOut) seg.cOut = { x: cOut.x, y: cOut.y };
    return seg;
  };
  const out: PathSegment[] = [];
  // Out: the first anchor's incoming handle mirrors its outgoing one, because
  // the closing segment arrives along the same curve it left on.
  out.push(anchor(s[0], s[0].cOut, s[0].cOut));
  for (let i = 1; i < n; i++) out.push(anchor(s[i], s[i].cIn, s[i].cOut));
  // The far end turns round: it leaves along the handle it arrived on.
  out.push(anchor(s[n], s[n].cIn, s[n].cIn));
  // Back: the same anchors in reverse, handles swapped.
  for (let i = n - 1; i >= 1; i--) out.push(anchor(s[i], s[i].cOut, s[i].cIn));
  return { segments: out, closed: true };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Contours back to SVG path data (for the toolbox's shape previews). */
export function pathDataFromContours(contours: PathContour[]): string {
  let d = "";
  for (const c of contours) {
    const s = c.segments;
    if (s.length < 2) continue;
    d += `M${round2(s[0].x)} ${round2(s[0].y)}`;
    const to = (a: PathSegment, b: PathSegment) => {
      if (a.cOut || b.cIn) {
        const c1 = a.cOut ?? a;
        const c2 = b.cIn ?? b;
        d += `C${round2(c1.x)} ${round2(c1.y)} ${round2(c2.x)} ${round2(c2.y)} ${round2(b.x)} ${round2(b.y)}`;
      } else {
        d += `L${round2(b.x)} ${round2(b.y)}`;
      }
    };
    for (let i = 1; i < s.length; i++) to(s[i - 1], s[i]);
    if (c.closed) {
      // A straight closing edge is what Z draws; only a curved one is spelled out.
      const last = s[s.length - 1];
      if (last.cOut || s[0].cIn) to(last, s[0]);
      d += "Z";
    }
  }
  return d;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounds over anchors and handles. The same rule the editor store applies when
 *  it re-tightens a path after a node edit, so an inserted shape's box does not
 *  jump the first time one of its nodes is moved. */
export function contourBounds(contours: PathContour[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p: { x: number; y: number }) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const c of contours) {
    for (const s of c.segments) {
      add(s);
      if (s.cIn) add(s.cIn);
      if (s.cOut) add(s.cOut);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Maps every anchor and handle through `fn`, returning new contours. */
export function mapContours(contours: PathContour[], fn: (p: { x: number; y: number }) => { x: number; y: number }): PathContour[] {
  const pt = (p: { x: number; y: number }) => {
    const q = fn(p);
    return { x: round2(q.x), y: round2(q.y) };
  };
  return contours.map((c) => ({
    closed: c.closed,
    segments: c.segments.map((s) => ({
      ...pt(s),
      ...(s.cIn ? { cIn: pt(s.cIn) } : {}),
      ...(s.cOut ? { cOut: pt(s.cOut) } : {}),
      ...(s.corner !== undefined ? { corner: s.corner } : {}),
    })),
  }));
}

/** Stretches contours so their bounds land exactly on a `width` x `height` box
 *  at the origin. An axis the artwork does not span is left alone. */
export function fitContours(contours: PathContour[], width: number, height: number): PathContour[] {
  const b = contourBounds(contours);
  const kx = b.width > 1e-6 ? width / b.width : 1;
  const ky = b.height > 1e-6 ? height / b.height : 1;
  return mapContours(contours, (p) => ({ x: (p.x - b.x) * kx, y: (p.y - b.y) * ky }));
}
