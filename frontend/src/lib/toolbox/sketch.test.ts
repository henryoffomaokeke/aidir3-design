// aidir3 fork: Smart drawing's recognition of a raw pointer stroke. Each shape
// is tried with a dozen different hand wobbles: recognition that only works on
// one lucky stroke is not recognition.
import { describe, expect, it } from "vitest";
import { classifyStroke } from "./sketch";

type Point = { x: number; y: number };

const seeds = Array.from({ length: 12 }, (_, i) => i + 1);

/** A hand's wobble: small, deterministic, different at every point and seed. */
const wobble = (i: number, seed: number, amount: number) => ({
  dx: Math.sin(i * 12.9898 + seed * 3.7) * amount,
  dy: Math.cos(i * 78.233 + seed * 1.3) * amount,
});

/** A stroke along straight edges through `corners`, a point every 3 units. */
function polyline(corners: Point[], close: boolean, seed = 1, amount = 1): Point[] {
  const list = close ? [...corners, corners[0]] : corners;
  const out: Point[] = [];
  let n = 0;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 3));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const w = wobble(n++, seed, amount);
      out.push({ x: a.x + (b.x - a.x) * t + w.dx, y: a.y + (b.y - a.y) * t + w.dy });
    }
  }
  const last = list[list.length - 1];
  out.push({ x: last.x, y: last.y });
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, seed = 1, amount = 1, sweep = 1): Point[] {
  const n = Math.round((Math.PI * (rx + ry)) / 3);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2 * sweep;
    const w = wobble(i, seed, amount);
    return { x: cx + Math.cos(a) * rx + w.dx, y: cy + Math.sin(a) * ry + w.dy };
  });
}

const regular = (sides: number, r = 120, turn = -Math.PI / 2) =>
  Array.from({ length: sides }, (_, i) => ({ x: 150 + Math.cos((i / sides) * Math.PI * 2 + turn) * r, y: 150 + Math.sin((i / sides) * Math.PI * 2 + turn) * r }));

const kinds = (strokes: Point[][]) => strokes.map((s) => classifyStroke(s)?.kind ?? "none");
const all = (kind: string) => seeds.map(() => kind);

const box = [{ x: 0, y: 0 }, { x: 220, y: 3 }, { x: 222, y: 152 }, { x: 2, y: 150 }];

describe("classifyStroke: round sketches", () => {
  it("takes a rough circle for an ellipse the size it was drawn", () => {
    for (const s of seeds) {
      const r = classifyStroke(ellipse(200, 200, 100, 100, s, 1.5));
      if (r?.kind !== "ellipse") throw new Error(`seed ${s}: ${r?.kind}`);
      expect(r.box.width).toBeGreaterThan(196);
      expect(r.box.width).toBeLessThan(206);
      expect(r.box.height).toBeGreaterThan(196);
      expect(r.box.height).toBeLessThan(206);
    }
  });

  it("takes a rough oval, a small circle and a shaky circle for ellipses", () => {
    expect(kinds(seeds.map((s) => ellipse(300, 150, 160, 70, s, 1.5)))).toEqual(all("ellipse"));
    expect(kinds(seeds.map((s) => ellipse(50, 50, 25, 25, s, 0.6)))).toEqual(all("ellipse"));
    expect(kinds(seeds.map((s) => ellipse(200, 200, 100, 100, s, 4)))).toEqual(all("ellipse"));
  });

  it("takes a circle that overshoots or stops short of its start for an ellipse", () => {
    expect(kinds(seeds.map((s) => ellipse(200, 200, 90, 90, s, 1, 1.06)))).toEqual(all("ellipse"));
    expect(kinds(seeds.map((s) => ellipse(200, 200, 90, 90, s, 1, 0.95)))).toEqual(all("ellipse"));
  });

  it("is not thrown by a circle drawn slowly on one side", () => {
    // Twice as many points on the right half as on the left: an unweighted
    // average would pull the centre over and misread the circle.
    const lopsided = (s: number) => [...ellipse(200, 200, 100, 100, s, 1).filter((_, i) => i % 2 === 0 || i < 105)];
    expect(kinds(seeds.map(lopsided))).toEqual(all("ellipse"));
  });
});

describe("classifyStroke: cornered sketches", () => {
  it("takes a rough box for a rectangle the size it was drawn", () => {
    for (const s of seeds) {
      const r = classifyStroke(polyline(box, true, s));
      if (r?.kind !== "rect") throw new Error(`seed ${s}: ${r?.kind}`);
      expect(r.box.width).toBeGreaterThan(218);
      expect(r.box.width).toBeLessThan(227);
      expect(r.box.height).toBeGreaterThan(148);
      expect(r.box.height).toBeLessThan(157);
    }
  });

  it("takes small, tall and square boxes for rectangles", () => {
    expect(kinds(seeds.map((s) => polyline([{ x: 0, y: 0 }, { x: 60, y: 1 }, { x: 61, y: 44 }, { x: 1, y: 43 }], true, s, 0.6)))).toEqual(all("rect"));
    expect(kinds(seeds.map((s) => polyline([{ x: 0, y: 0 }, { x: 90, y: 2 }, { x: 92, y: 300 }, { x: 1, y: 298 }], true, s)))).toEqual(all("rect"));
    expect(kinds(seeds.map((s) => polyline([{ x: 0, y: 0 }, { x: 150, y: 2 }, { x: 151, y: 152 }, { x: 1, y: 150 }], true, s)))).toEqual(all("rect"));
  });

  it("takes a box that starts mid-edge, or does not quite close, for a rectangle", () => {
    const midEdge = [{ x: 110, y: 1 }, { x: 220, y: 3 }, { x: 222, y: 152 }, { x: 2, y: 150 }, { x: 0, y: 0 }];
    expect(kinds(seeds.map((s) => polyline(midEdge, true, s)))).toEqual(all("rect"));
    const gap = [...box, { x: 1, y: 22 }];
    expect(kinds(seeds.map((s) => polyline(gap, false, s)))).toEqual(all("rect"));
  });

  it("takes a diamond for a four-sided polygon, not a rectangle", () => {
    for (const s of seeds) expect(classifyStroke(polyline(regular(4), true, s))).toMatchObject({ kind: "polygon", sides: 4 });
  });

  it("takes a rough triangle for a triangle, and knows which way it points", () => {
    for (const s of seeds) {
      expect(classifyStroke(polyline([{ x: 110, y: 0 }, { x: 225, y: 170 }, { x: 0, y: 172 }], true, s))).toMatchObject({ kind: "triangle", flipped: false });
      expect(classifyStroke(polyline([{ x: 0, y: 0 }, { x: 225, y: 3 }, { x: 112, y: 172 }], true, s))).toMatchObject({ kind: "triangle", flipped: true });
    }
  });

  it("counts the sides of a pentagon and a hexagon", () => {
    for (const s of seeds) {
      expect(classifyStroke(polyline(regular(5), true, s))).toMatchObject({ kind: "polygon", sides: 5 });
      expect(classifyStroke(polyline(regular(6, 120, 0), true, s))).toMatchObject({ kind: "polygon", sides: 6 });
    }
  });
});

describe("classifyStroke: lines and everything else", () => {
  it("takes a straight stroke for a line between its ends", () => {
    for (const s of seeds) {
      const r = classifyStroke(polyline([{ x: 10, y: 20 }, { x: 310, y: 80 }], false, s));
      if (r?.kind !== "line") throw new Error(`seed ${s}: ${r?.kind}`);
      expect(Math.hypot(r.from.x - 10, r.from.y - 20)).toBeLessThan(3);
      expect(Math.hypot(r.to.x - 310, r.to.y - 80)).toBeLessThan(3);
    }
  });

  it("leaves a wavy line, an arc and a star as drawn", () => {
    const wave = Array.from({ length: 100 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 8) * 40 }));
    expect(classifyStroke(wave)).toBeNull();
    expect(classifyStroke(ellipse(200, 200, 100, 100, 1, 1, 0.5))).toBeNull();
    const star = Array.from({ length: 10 }, (_, i) => {
      const r = i % 2 ? 50 : 130;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      return { x: 150 + Math.cos(a) * r, y: 150 + Math.sin(a) * r };
    });
    expect(kinds(seeds.map((s) => polyline(star, true, s)))).toEqual(all("none"));
  });

  it("ignores a dot and a stroke of two points", () => {
    expect(classifyStroke([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 6 }])).toBeNull();
    expect(classifyStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toBeNull();
  });
});
