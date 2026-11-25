// aidir3 fork: the pro toolbox's shape geometry. These are the checks that a
// shape placed from the toolbox is a well-formed path node: finite, sized to
// its box, holes where holes belong, and detail lines that can never fill.
import { describe, expect, it } from "vitest";
import type { PathContour, PathSegment } from "@hc/schema";
import { contourBounds, contoursFromPathData, fitContours, pathDataFromContours, retraced } from "./pathData";
import { complexStar, complexStars, familyShape, graphPaper, pageScale, pathNodeInit, previewContours, shapeFamilies, spiral, type ShapeFamily } from "./shapes";
import { applyPathGeometry, resizePathGeometry, restorePathGeometry, type PathGeometry } from "./pathResize";

const families = Object.keys(shapeFamilies) as ShapeFamily[];
const everyShape = families.flatMap((f) => shapeFamilies[f].map((s) => [f, s.id] as const));

const points = (c: PathContour) => c.segments.flatMap((s) => [s, s.cIn, s.cOut].filter((p): p is { x: number; y: number } => !!p));

/** Signed area of a contour, curves flattened, so a hole-free retraced line
 *  can be told from a region. */
function area(c: PathContour): number {
  const pts: { x: number; y: number }[] = [];
  const s = c.segments;
  const edge = (a: PathSegment, b: PathSegment) => {
    const c1 = a.cOut ?? a;
    const c2 = b.cIn ?? b;
    for (let i = 0; i < 16; i++) {
      const t = i / 16;
      const u = 1 - t;
      pts.push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      });
    }
  };
  for (let i = 1; i < s.length; i++) edge(s[i - 1], s[i]);
  edge(s[s.length - 1], s[0]);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

describe("path data to contours", () => {
  it("turns straight commands into corner anchors", () => {
    const [c] = contoursFromPathData("M0 0H10V10H0Z");
    expect(c.closed).toBe(true);
    expect(c.segments).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
  });

  it("folds a closing point that lands back on the start into the first anchor", () => {
    // A circle drawn as two half arcs ends where it began; the node editor
    // should show four anchors, not five with two stacked.
    const [c] = contoursFromPathData("M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z");
    expect(c.segments).toHaveLength(4);
    expect(c.segments[0].cIn).toBeDefined();
    expect(c.segments[0].cOut).toBeDefined();
  });

  it("keeps arcs as curves rather than chords", () => {
    const [c] = contoursFromPathData("M0 50A50 50 0 1 0 100 50A50 50 0 1 0 0 50Z");
    // A circle of radius 50 has area 7854; four chords would enclose 5000.
    expect(Math.abs(area(c))).toBeGreaterThan(7800);
    expect(Math.abs(area(c))).toBeLessThan(7900);
  });

  it("converts quadratic curves to cubic handles", () => {
    const [c] = contoursFromPathData("M0 0Q50 100 100 0");
    expect(c.closed).toBe(false);
    expect(c.segments[0].cOut!.x).toBeCloseTo(100 / 3, 9);
    expect(c.segments[0].cOut!.y).toBeCloseTo(200 / 3, 9);
    expect(c.segments[1].cIn!.x).toBeCloseTo(200 / 3, 9);
    expect(c.segments[1].cIn!.y).toBeCloseTo(200 / 3, 9);
  });

  it("starts a new contour at each move", () => {
    expect(contoursFromPathData("M0 0L10 0L10 10ZM20 20L30 20L30 30Z")).toHaveLength(2);
  });

  it("round-trips through path data", () => {
    const d = "M0 0L10 0C15 0 20 5 20 10L0 10Z";
    expect(pathDataFromContours(contoursFromPathData(d))).toBe(d);
  });
});

describe("retraced detail lines", () => {
  it("enclose no area, straight or curved", () => {
    for (const d of ["M30 50L0 100", "M0 25L75 25L100 0", "M0 15A50 15 0 0 0 100 15"]) {
      for (const c of contoursFromPathData(d).map(retraced)) {
        expect(c.closed).toBe(true);
        expect(Math.abs(area(c))).toBeLessThan(1e-6);
      }
    }
  });

  it("visit every anchor of the line", () => {
    const [line] = contoursFromPathData("M0 25L75 25L100 0");
    const back = retraced(line);
    expect(back.segments.map((s) => [s.x, s.y])).toEqual([[0, 25], [75, 25], [100, 0], [75, 25]]);
  });
});

describe("shape families", () => {
  it("carries the five families of the previous toolbox", () => {
    expect(families).toEqual(["arrows", "flowchart", "banners", "callouts", "basic"]);
    expect(everyShape.length).toBe(60);
  });

  it.each(everyShape)("%s/%s builds a closed, finite outline", (family, id) => {
    const shape = familyShape(family, id);
    expect(shape).not.toBeNull();
    const { contours } = shape!;
    expect(contours.length).toBeGreaterThan(0);
    expect(contours[0].closed).toBe(true);
    expect(contours[0].segments.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(area(contours[0]))).toBeGreaterThan(100);
    for (const c of contours) for (const p of points(c)) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it.each(everyShape)("%s/%s lands exactly on its box as a path node", (family, id) => {
    const shape = familyShape(family, id)!;
    const node = pathNodeInit(shape, "Shape") as unknown as { segments: PathSegment[]; contours?: PathContour[]; closed: boolean; size: { width: number; height: number }; fills: unknown[]; stroke?: unknown };
    const all = [{ segments: node.segments, closed: node.closed }, ...(node.contours ?? [])];
    const b = contourBounds(all);
    expect(b.x).toBeCloseTo(0, 1);
    expect(b.y).toBeCloseTo(0, 1);
    expect(b.width).toBeCloseTo(node.size.width, 1);
    expect(b.height).toBeCloseTo(node.size.height, 1);
    expect(node.size).toEqual({ width: shape.width, height: shape.height });
    expect(node.fills).toHaveLength(1);
  });

  it("gives a shape with detail lines an outline to draw them with", () => {
    for (const [family, id] of [["flowchart", "subroutine"], ["flowchart", "database"], ["callouts", "line"], ["basic", "cylinder"], ["basic", "cube"]] as const) {
      const shape = familyShape(family, id)!;
      expect(shape.style).toBe("outline");
      expect((pathNodeInit(shape, "Shape") as { stroke?: unknown }).stroke).toBeDefined();
      // Every contour after the outline is a line that cannot fill.
      for (const c of shape.contours.slice(1)) expect(Math.abs(area(c))).toBeLessThan(1e-6);
    }
  });

  it("cuts holes with interior contours", () => {
    expect(familyShape("basic", "ring")!.contours).toHaveLength(2);
    expect(familyShape("basic", "frame")!.contours).toHaveLength(2);
    expect(familyShape("basic", "gear")!.contours).toHaveLength(2);
    expect(familyShape("basic", "smiley")!.contours).toHaveLength(4);
  });

  it("marks a cusp as a corner and leaves a smooth join smooth", () => {
    // The ring is all smooth arc joins; the heart has cusps at its dip and tip.
    expect(familyShape("basic", "ring")!.contours[0].segments.some((s) => s.corner)).toBe(false);
    expect(familyShape("basic", "heart")!.contours[0].segments.some((s) => s.corner)).toBe(true);
  });

  it("returns null for a shape that does not exist", () => {
    expect(familyShape("basic", "nope")).toBeNull();
  });
});

describe("complex stars", () => {
  it("offers only star polygons that are a single outline", () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    for (const c of complexStars) expect(gcd(c.points, c.step)).toBe(1);
  });

  it("builds a pentagram as a star with a pentagonal hole", () => {
    const { contours } = complexStar(5, 2);
    expect(contours).toHaveLength(2);
    expect(contours[0].segments).toHaveLength(10);
    expect(contours[1].segments).toHaveLength(5);
    // The hole's corners are the star's own notches: R cos(72) / cos(36).
    const r = Math.hypot(contours[1].segments[0].x - 50, contours[1].segments[0].y - 50);
    expect(r).toBeCloseTo((50 * Math.cos((2 * Math.PI) / 5)) / Math.cos(Math.PI / 5), 6);
    expect(contours[0].segments[1]).toEqual(contours[1].segments[0]);
  });

  it("has one layer per step, each inside the last", () => {
    for (const c of complexStars) {
      const { contours } = complexStar(c.points, c.step);
      expect(contours).toHaveLength(c.step);
      const areas = contours.map((k) => Math.abs(area(k)));
      for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeLessThan(areas[i - 1]);
    }
  });

  it("keeps its natural proportions", () => {
    const s = complexStar(5, 2);
    expect(s.width).toBe(240);
    expect(s.height).toBeLessThan(240);
  });
});

describe("spiral and graph paper", () => {
  it("draws a spiral as one open smooth curve ending on its rim", () => {
    const { contours, style } = spiral(3);
    expect(style).toBe("line");
    expect(contours).toHaveLength(1);
    expect(contours[0].closed).toBe(false);
    expect(contours[0].segments).toHaveLength(25);
    const end = contours[0].segments[24];
    expect(Math.hypot(end.x - 50, end.y - 50)).toBeCloseTo(50, 6);
    expect(contours[0].segments[0]).toMatchObject({ x: 50, y: 50 });
    expect((pathNodeInit(spiral(3), "Spiral") as { fills: unknown[] }).fills).toEqual([]);
  });

  it("rules graph paper with lines that cannot fill", () => {
    const { contours, width, height } = graphPaper(12, 8);
    expect(contours).toHaveLength(1 + 11 + 7);
    expect(Math.abs(area(contours[0]))).toBe(120 * 80);
    for (const c of contours.slice(1)) expect(area(c)).toBe(0);
    expect(width / height).toBeCloseTo(1.5, 1);
  });
});

describe("placing a shape", () => {
  it("scales the shape and its outline with the page", () => {
    const shape = familyShape("basic", "cube")!;
    const small = pathNodeInit(shape, "Cube", 0.5) as unknown as { size: { width: number }; stroke: { width: number } };
    const large = pathNodeInit(shape, "Cube", 2) as unknown as { size: { width: number }; stroke: { width: number } };
    expect(small.size.width).toBe(105);
    expect(large.size.width).toBe(420);
    expect(large.stroke.width).toBeGreaterThan(small.stroke.width);
  });

  it("sizes for the page's shorter side, within limits", () => {
    expect(pageScale({ width: 1080, height: 1080 })).toBe(1);
    expect(pageScale({ width: 1920, height: 1080 })).toBe(1);
    expect(pageScale({ width: 2160, height: 3840 })).toBe(2);
    expect(pageScale({ width: 100, height: 100 })).toBe(0.4);
    expect(pageScale({ width: 9000, height: 9000 })).toBe(4);
    expect(pageScale(undefined)).toBe(1);
  });

  it("previews inside the tile's box at the shape's own proportions", () => {
    const b = contourBounds(previewContours(familyShape("arrows", "both")!));
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(100);
    expect(b.width / b.height).toBeCloseTo(300 / 160, 1);
  });

  it("fits without moving an axis the artwork does not span", () => {
    const flat: PathContour[] = [{ segments: [{ x: 5, y: 7 }, { x: 25, y: 7 }], closed: false }];
    expect(fitContours(flat, 100, 50)[0].segments).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });
});

describe("resizing a path", () => {
  const start = (): PathGeometry => ({
    segments: [{ x: 0, y: 0 }, { x: 100, y: 0, cOut: { x: 100, y: 20 } }, { x: 100, y: 50, cIn: { x: 100, y: 30 } }, { x: 0, y: 50 }],
    contours: [{ closed: true, segments: [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 40 }] }],
    transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width: 100, height: 50 },
  });

  it("scales anchors, handles and extra contours with the box", () => {
    const s = start();
    const node = structuredClone(s);
    const r = resizePathGeometry(node, s, "se", s.transform, { width: 200, height: 150 });
    expect(r.size).toEqual({ width: 200, height: 150 });
    expect(node.segments[1]).toEqual({ x: 200, y: 0, cOut: { x: 200, y: 60 } });
    expect(node.segments[2]).toEqual({ x: 200, y: 150, cIn: { x: 200, y: 90 } });
    expect(node.contours![0].segments[2]).toEqual({ x: 160, y: 120 });
    // The starting geometry is never mutated: every frame scales from it.
    expect(s.segments[1].x).toBe(100);
  });

  it("scales from the start each frame, so a drag does not compound", () => {
    const s = start();
    const node = structuredClone(s);
    resizePathGeometry(node, s, "se", s.transform, { width: 300, height: 50 });
    resizePathGeometry(node, s, "se", s.transform, { width: 150, height: 50 });
    expect(node.segments[1].x).toBe(150);
  });

  it("keeps the box of a dead-straight line on the axis it does not span", () => {
    const s: PathGeometry = { segments: [{ x: 0, y: 0 }, { x: 80, y: 0 }], transform: { x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0 }, size: { width: 80, height: 1 } };
    const node = structuredClone(s);
    const r = resizePathGeometry(node, s, "s", { ...s.transform, y: 9 }, { width: 80, height: 40 });
    expect(r.size).toEqual({ width: 80, height: 1 });
    expect(r.transform.y).toBe(5);
    expect(node.segments).toEqual(s.segments);
  });

  it("restores the starting geometry on cancel", () => {
    const s = start();
    const node = structuredClone(s);
    resizePathGeometry(node, s, "se", s.transform, { width: 10, height: 10 });
    restorePathGeometry(node, s);
    expect(node.segments).toEqual(s.segments);
    expect(node.contours).toEqual(s.contours);
  });

  it("applies a typed size as one path edit, and takes it back if the store refuses", () => {
    const make = (accept: boolean) => {
      const node = { id: "p", type: "path", ...start(), closed: true };
      const store = {
        doc: { pages: [{ id: "pg", children: [node] }] },
        undoStack: [] as unknown[],
        snapshotPath: () => structuredClone({ segments: node.segments, contours: node.contours, transform: node.transform, size: node.size }),
        commitPathEdit: (_id: string, before: unknown) => {
          if (accept) store.undoStack = [...store.undoStack, before];
        },
      };
      return { node, store };
    };
    const ok = make(true);
    applyPathGeometry(() => ok.store as never, "p", { ...ok.node.transform, x: 40 }, { width: 200, height: 100 });
    expect(ok.node.size).toEqual({ width: 200, height: 100 });
    expect(ok.node.transform.x).toBe(40);
    expect(ok.node.segments[1].x).toBe(200);
    expect(ok.store.undoStack).toHaveLength(1);

    const refused = make(false);
    applyPathGeometry(() => refused.store as never, "p", { ...refused.node.transform, x: 40 }, { width: 200, height: 100 });
    expect(refused.node.size).toEqual({ width: 100, height: 50 });
    expect(refused.node.transform.x).toBe(10);
    expect(refused.node.segments[1].x).toBe(100);
  });
});
