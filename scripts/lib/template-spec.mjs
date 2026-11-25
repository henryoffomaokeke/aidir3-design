// Template spec compiler: turns one compact template spec (scripts/templates/*.json, see
// scripts/build-templates.mjs) into a seed entry { template, file }. Shared by
// build-templates.mjs (the built-in seed) and the legacy-library engine bundle
// (scripts/aidir3/legacy, run under goja to materialise variations), so both
// compile a spec the same way. Pure: no file system. The icon and drawing sets
// and the page-illustration step are injected by the caller.
//
//   const compile = makeSpecCompiler({ ICON_GLYPHS, ICON_BOX, ILLUSTRATIONS, decodeDrawingPath, illustrationGroup });
//   const { entry, errors } = compile(spec);

// --- primitives ------------------------------------------------------------

export function srgb(hex) {
  const h = hex.replace("#", "");
  // Alpha hex is rejected (see lint below): translucency comes from node
  // opacity, which every renderer applies; per-color alpha does not.
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const n = (i) => parseInt(full.slice(i, i + 2), 16) / 255;
  return { srgb: { r: n(0), g: n(2), b: n(4), a: 1 } };
}

const isAlphaHex = (c) => typeof c === "string" && c.replace("#", "").length === 8;

/** Palette entries must be 6-digit hex: the backend's colorMatches parses them. */
export function hex6(hex) {
  const h = hex.replace("#", "");
  return "#" + (h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6)).toLowerCase();
}

export function fillOf(f) {
  if (typeof f === "string") return { type: "solid", color: srgb(f) };
  // { angle, stops: [["#hex", position], ...], radial?: true }
  return {
    type: "gradient",
    gradient: f.radial ? "radial" : "linear",
    angle: f.angle ?? 90,
    stops: f.stops.map(([hex, position]) => ({ position, color: srgb(hex) })),
  };
}

const radius = (r) => ({ topLeft: r, topRight: r, bottomRight: r, bottomLeft: r });

function baseNode(id, n) {
  return {
    id,
    ...(n.name ? { name: n.name } : {}),
    transform: { x: n.x, y: n.y, scaleX: 1, scaleY: 1, rotation: n.rotation ?? 0 },
    size: { width: n.w, height: n.h },
    opacity: n.opacity ?? 1,
    blendMode: "normal",
  };
}

function shapeNode(id, n, shape) {
  const out = { ...baseNode(id, n), type: "shape", shape, fills: n.fill === undefined ? [] : [fillOf(n.fill)] };
  if (n.radius) out.cornerRadius = radius(n.radius);
  // The schema's stroke is singular; both renderers read node.stroke.
  if (n.stroke) out.stroke = { fill: fillOf(n.stroke), width: n.strokeWidth ?? 2, align: "center", cap: "butt", join: "miter" };
  return out;
}

function textNode(id, n) {
  const style = {
    fontFamily: n.family,
    fontStyle: "Regular",
    fontSize: n.size,
    axes: { wght: n.weight ?? 400 },
    fill: fillOf(n.color ?? "#111111"),
  };
  if (n.letterSpacing) style.letterSpacing = n.letterSpacing;
  if (n.upper) style.case = "upper";
  if (n.strike) style.decoration = ["strikethrough"];
  if (n.underline) style.decoration = [...(style.decoration ?? []), "underline"];
  if (n.lineHeight) style.lineHeight = { mode: "multiple", value: n.lineHeight };
  // "spans" mixes styles within one line (e.g. an accent-colored word);
  // otherwise "text" splits on newlines into single-style paragraphs.
  const paragraphs = n.spans
    ? [{
        runs: n.spans.map((sp) => ({
          text: sp.text,
          style: { ...style, ...(sp.color ? { fill: fillOf(sp.color) } : {}), ...(sp.weight ? { axes: { wght: sp.weight } } : {}) },
        })),
        style: { align: n.align ?? "left", direction: "auto" },
      }]
    : String(n.text).split("\n").map((line) => ({
        runs: [{ text: line, style }],
        style: { align: n.align ?? "left", direction: "auto" },
      }));
  return {
    ...baseNode(id, n),
    type: "text",
    box: {
      mode: "fixed",
      width: n.w,
      height: n.h,
      autoFit: { enabled: false, min: 8, max: 512 },
      verticalAlign: n.vAlign ?? "top",
    },
    content: paragraphs,
  };
}

/** Two hexes mixed in sRGB, t of the way from a to b. */
function mixHex(a, b, t) {
  const pa = hex6(a).slice(1), pb = hex6(b).slice(1);
  const ch = (i) => Math.round(parseInt(pa.slice(i, i + 2), 16) * (1 - t) + parseInt(pb.slice(i, i + 2), 16) * t);
  return "#" + [0, 2, 4].map((i) => ch(i).toString(16).padStart(2, "0")).join("");
}

/** A live chart node, the same shape the generation pipeline emits: bars and
 *  lines carry their values, a legend shows for more than one series. */
function chartNode(id, n) {
  const series = n.series.map((s) => ({ name: s.name, values: s.values, ...(s.color ? { color: srgb(s.color) } : {}) }));
  const kind = n.chartType ?? "bar";
  return {
    ...baseNode(id, n),
    type: "chart",
    name: n.name ?? "Chart",
    chartType: kind,
    categories: n.categories,
    series,
    options: {},
    style: {
      fontSize: n.fontSize ?? 18,
      valueLabels: n.valueLabels ?? (kind === "bar" || kind === "barGrouped" || kind === "line"),
      legend: { show: n.legend ?? series.length > 1, position: "bottom" },
      axes: { showX: true, showY: kind !== "pie" && kind !== "donut" },
    },
  };
}

/** A path from a list of points in page space, as a stroked line, a filled
 *  region, or both. The node sits at the points' bounding box with its
 *  segments relative to it, the way the composer places its icons. */
function pathNodeFromPoints(id, n) {
  const pts = n.points.map((pt) => (Array.isArray(pt) ? { x: pt[0], y: pt[1] } : pt));
  const xs = pts.flatMap((pt) => [pt.x, pt.cIn?.x, pt.cOut?.x].filter((v) => v !== undefined));
  const ys = pts.flatMap((pt) => [pt.y, pt.cIn?.y, pt.cOut?.y].filter((v) => v !== undefined));
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const w = Math.max(1, Math.max(...xs) - x0), h = Math.max(1, Math.max(...ys) - y0);
  const rel = (pt) => ({ x: Math.round((pt.x - x0) * 100) / 100, y: Math.round((pt.y - y0) * 100) / 100 });
  const segments = pts.map((pt) => ({ ...rel(pt), ...(pt.cIn ? { cIn: rel(pt.cIn) } : {}), ...(pt.cOut ? { cOut: rel(pt.cOut) } : {}) }));
  return {
    ...baseNode(id, { ...n, x: x0, y: y0, w, h }),
    type: "path",
    name: n.name ?? "Path",
    segments,
    closed: !!n.closed,
    fills: n.fill === undefined ? [] : [fillOf(n.fill)],
    ...(n.stroke ? { stroke: { fill: fillOf(n.stroke), width: n.strokeWidth ?? 2, align: "center", cap: n.cap ?? "round", join: n.join ?? "round", ...(Array.isArray(n.dash) ? { dash: n.dash } : {}) } } : {}),
  };
}

/** A button compiles to a pill rect + a label the box centers both ways, so
 *  the label cannot drift off-center the way hand-placed CTA text does. */
function buttonNodes(id, n) {
  const rect = shapeNode(id + "-bg", { ...n, fill: n.fill, radius: n.radius ?? n.h / 2 }, "rect");
  const label = textNode(id + "-label", {
    x: n.x, y: n.y, w: n.w, h: n.h,
    text: n.label, family: n.family, size: n.size ?? 28, weight: n.weight ?? 700,
    color: n.color, align: "center", vAlign: "middle",
    letterSpacing: n.letterSpacing, upper: n.upper,
  });
  return [rect, label];
}

/** Template picture licences (spec `image.license`) as stock licence types. */
const LICENSE_TYPE = { cc0: "cc0", pdm: "public-domain", by: "cc-by" };

/**
 * The compiler. `deps`:
 *   ICON_GLYPHS, ICON_BOX       the composer's baked icon set (icon nodes)
 *   ILLUSTRATIONS, decodeDrawingPath   its drawing set (drawing nodes)
 *   illustrationGroup(specId, k, il, pageW, pageH, errors)   page "illustrations" entries (optional)
 */
export function makeSpecCompiler(deps) {
  const { ICON_GLYPHS, ICON_BOX, ILLUSTRATIONS, decodeDrawingPath, illustrationGroup } = deps;

  /** An icon from the composer's set, baked into a path node at its final
   *  size: the glyph's contours scaled from the pack's 24-unit box into the
   *  square, filled in one color under the even-odd rule. `w` is the square. */
  function iconNode(id, n, errors, where) {
    const contours = ICON_GLYPHS[n.icon];
    if (!contours?.length) { errors.push(`${where}: unknown icon ${n.icon}`); return null; }
    const size = n.w;
    const k = size / ICON_BOX;
    const pt = (p) => ({ x: Math.round(p.x * k * 100) / 100, y: Math.round(p.y * k * 100) / 100 });
    const scaled = contours.map((c) => ({
      closed: c.closed,
      segments: c.segments.map((sg) => ({ ...pt(sg), ...(sg.cIn ? { cIn: pt(sg.cIn) } : {}), ...(sg.cOut ? { cOut: pt(sg.cOut) } : {}) })),
    }));
    const [first, ...rest] = scaled;
    return {
      ...baseNode(id, { ...n, h: size }),
      type: "path",
      name: n.name ?? "Icon",
      segments: first.segments,
      closed: first.closed,
      ...(rest.length ? { contours: rest } : {}),
      fills: [fillOf(n.color ?? "#111111")],
      data: { icon: n.icon },
    };
  }

  /** A drawing from the composer's baked set, decoded into one path node per
   *  fill role and recolored to the template: the pack's line becomes `ink`,
   *  its accent `accent`, its greys tints between `ground` and `ink`. Fitted
   *  inside the box, centered. */
  function drawingGroup(id, n, errors, where) {
    const d = ILLUSTRATIONS?.[n.drawing];
    if (!d) { errors.push(`${where}: unknown drawing ${n.drawing}`); return null; }
    const ink = n.ink ?? "#111111", accent = n.accent ?? "#2563eb", ground = n.ground ?? "#ffffff";
    const k = Math.min(n.w / d.w, n.h / d.h);
    const w = Math.round(d.w * k), h = Math.round(d.h * k);
    const x = n.x + Math.round((n.w - w) / 2), y = n.y + Math.round((n.h - h) / 2);
    const roleColor = (role) => {
      switch (role) {
        case "line": case "stroke": return ink;
        case "accent": return accent;
        case "white": return mixHex(ground, ink, 0.04);
        case "grey": return mixHex(ground, ink, 0.18);
        case "grey2": return mixHex(ground, ink, 0.1);
        case "grey3": return mixHex(ground, ink, 0.4);
        default: return role.startsWith("#") ? role : ink;
      }
    };
    const children = [];
    d.layers.forEach(([role, path], li) => {
      const contours = decodeDrawingPath(path, k, 0, 0);
      if (!contours.length) return;
      const [first, ...rest] = contours;
      const color = roleColor(role);
      children.push({
        id: `${id}-l${li}`,
        name: role,
        type: "path",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        size: { width: w, height: h },
        opacity: 1,
        blendMode: "normal",
        segments: first.segments,
        closed: first.closed,
        ...(rest.length ? { contours: rest } : {}),
        ...(role === "stroke"
          ? { stroke: { fill: fillOf(color), width: Math.max(1, Math.round(k)), align: "center", cap: "round", join: "round" } }
          : { fills: [fillOf(color)] }),
      });
    });
    if (!children.length) { errors.push(`${where}: drawing ${n.drawing} decoded to nothing`); return null; }
    return {
      ...baseNode(id, { ...n, x, y, w, h }),
      type: "group",
      name: n.name ?? n.drawing,
      children,
      data: { illustration: n.drawing },
    };
  }

  /** A picture placeholder: an empty image frame (the node the editor's
   *  "use as image frame" makes) with a quiet fill, so dropping a photo on it
   *  fills the frame clipped to the shape. `shape` is "rect" or "ellipse".
   *  With `image` the frame already holds a picture: an image child sized to
   *  the frame (cover), the way the editor fills a frame, whose asset the
   *  caller registers in the file. */
  function photoFrame(id, n, assets, credits) {
    const out = {
      ...baseNode(id, n),
      type: "frame",
      name: n.name ?? "Photo",
      clip: true,
      children: [],
      maskShape: n.shape === "ellipse" ? "ellipse" : "rect",
      fills: n.image && n.image.noFill ? [] : [fillOf(n.fill ?? "#e2e5ea")],
    };
    if (n.radius && n.shape !== "ellipse") out.cornerRadius = radius(n.radius);
    const im = n.image;
    if (im) {
      const childId = `${id}-img`;
      const lic = im.license ? LICENSE_TYPE[im.license] ?? "cc-by" : null;
      const credit = im.credit ?? null;
      const required = im.license === "by";
      out.children.push({
        id: childId,
        name: im.name ?? "Photo",
        type: "image",
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        size: { width: n.w, height: n.h },
        opacity: 1,
        blendMode: "normal",
        source: { assetId: im.asset, naturalWidth: im.w ?? 0, naturalHeight: im.h ?? 0 },
        fit: im.fit ?? "cover",
        ...(im.focal ? { focalPoint: im.focal } : {}),
        ...(im.crop ? { crop: im.crop } : {}),
        ...(im.flipX ? { flipX: true } : {}),
        ...(im.flipY ? { flipY: true } : {}),
        ...(credit?.title ? { alt: credit.title } : {}),
        ...(lic ? { data: { provenance: { origin: "stock", stockAssetId: im.asset, license: { type: lic, attributionRequired: required, ...(credit ? { attributionText: creditText(credit), ...(credit.url ? { attributionUrl: credit.url } : {}) } : {}) } } } } : {}),
      });
      if (!assets.some((a) => a.id === im.asset)) assets.push({ id: im.asset, kind: "image", url: im.url, mime: im.mime ?? "image/jpeg", ...(im.w ? { width: im.w, height: im.h } : {}) });
      if (credit) credits.push({ assetId: im.asset, nodeId: childId, credit, required });
    }
    return out;
  }

  function compile(spec) {
    const errors = [];
    const assets = [];
    const credits = [];
    let ilCount = 0; // illustration ids are numbered across the whole template
    const pages = spec.pages.map((p, pi) => {
      const children = [];
      (p.nodes ?? []).forEach((n, ni) => {
        const id = `${spec.id}-p${pi}-n${ni}`;
        if (n.kind === "rect") children.push(shapeNode(id, n, "rect"));
        else if (n.kind === "ellipse") children.push(shapeNode(id, n, "ellipse"));
        else if (n.kind === "text") children.push(textNode(id, n));
        else if (n.kind === "button") children.push(...buttonNodes(id, n));
        else if (n.kind === "frame" || n.kind === "photo") children.push(photoFrame(id, n, assets, credits));
        else if (n.kind === "icon") { const g = iconNode(id, n, errors, `${spec.id} p${pi} n${ni}`); if (g) children.push(g); }
        else if (n.kind === "drawing") { const g = drawingGroup(id, n, errors, `${spec.id} p${pi} n${ni}`); if (g) children.push(g); }
        else if (n.kind === "chart") children.push(chartNode(id, n));
        else if (n.kind === "path") {
          if (!Array.isArray(n.points) || n.points.length < 2) { errors.push(`${spec.id} p${pi} n${ni}: a path needs two or more points`); return; }
          const node = pathNodeFromPoints(id, n);
          // The bounds lint reads the spec node's box; a path's is its points'.
          n.x = node.transform.x; n.y = node.transform.y; n.w = node.size.width; n.h = node.size.height;
          children.push(node);
        }
        else errors.push(`${spec.id} p${pi} n${ni}: unknown kind ${n.kind}`);
        // Alpha-hex lint: 8-digit colors silently lose their alpha; authors must
        // use node opacity for translucency.
        for (const c of [n.fill, n.color, n.stroke]) {
          if (isAlphaHex(c)) errors.push(`${spec.id} p${pi} n${ni}: alpha hex ${c}; use "opacity" on the node instead`);
          if (c && typeof c === "object") for (const [hex] of c.stops ?? []) {
            if (isAlphaHex(hex)) errors.push(`${spec.id} p${pi} n${ni}: alpha hex ${hex} in gradient; use node "opacity"`);
          }
        }
        // Geometry lint: everything stays on the page unless it declares bleed.
        if (!n.bleed) {
          const pad = 1;
          const nh = n.kind === "icon" ? n.w : n.h;
          if (n.x < -pad || n.y < -pad || n.x + n.w > spec.size[0] + pad || n.y + nh > spec.size[1] + pad) {
            errors.push(`${spec.id} p${pi} n${ni} (${n.kind}) out of bounds: ${n.x},${n.y} ${n.w}x${n.h}`);
          }
        }
      });
      const all = typeof p.bg === "object"
        ? [shapeNode(`${spec.id}-p${pi}-bg`, { x: 0, y: 0, w: spec.size[0], h: spec.size[1], fill: p.bg, bleed: true }, "rect"), ...children]
        : children;
      // Illustrations land after every primitive so "after:<nodeId>" anchors
      // resolve; "bottom" sits under everything, "top" (default) over.
      (p.illustrations ?? []).forEach((il) => {
        const k = ilCount++;
        if (!illustrationGroup) { errors.push(`${spec.id} il${k}: page illustrations are not available here`); return; }
        const g = illustrationGroup(spec.id, k, il, spec.size[0], spec.size[1], errors);
        if (!g) return;
        if (il.position === "bottom") all.unshift(g);
        else if (typeof il.position === "string" && il.position.startsWith("after:")) {
          const at = all.findIndex((n) => n.id === il.position.slice(6));
          if (at < 0) { errors.push(`${spec.id} p${pi} il${k}: anchor ${il.position} not found`); return; }
          all.splice(at + 1, 0, g);
        } else all.push(g);
      });
      return {
        id: `${spec.id}-page-${pi}`,
        name: p.name ?? `Page ${pi + 1}`,
        width: spec.size[0],
        height: spec.size[1],
        background: { type: "solid", color: srgb(typeof p.bg === "string" ? p.bg : "#ffffff") },
        children: all,
      };
    });

    const file = {
      id: `tpl-${spec.id}`,
      title: spec.title,
      schemaVersion: 10,
      format: "hycanvas.design",
      unit: "px",
      dpi: 96,
      fonts: [],
      assets,
      meta: {},
      pages,
    };

    // Palette: distinct solid hexes in author order, capped at 6.
    const palette = [];
    const seen = new Set();
    const push = (c) => { const h = hex6(c); if (!seen.has(h)) { seen.add(h); palette.push(h); } };
    for (const p of spec.pages) {
      if (typeof p.bg === "string") push(p.bg);
      if (p.bg && typeof p.bg === "object") for (const [hex] of p.bg.stops ?? []) push(hex);
      for (const n of p.nodes ?? []) {
        for (const c of [n.fill, n.color]) {
          if (typeof c === "string") push(c);
          if (c && typeof c === "object") for (const [hex] of c.stops ?? []) push(hex);
        }
      }
    }

    // Credits for pictures that ask for one (CC BY), one entry per picture,
    // in the stock attribution shape the editor merges into a design.
    const attributions = [];
    for (const c of credits) {
      if (!c.required) continue;
      const prev = attributions.find((a) => a.assetId === c.assetId);
      if (prev) { if (!prev.nodeIds.includes(c.nodeId)) prev.nodeIds.push(c.nodeId); continue; }
      attributions.push({ assetId: c.assetId, source: "stock", attributionText: creditText(c.credit), ...(c.credit.url ? { attributionUrl: c.credit.url } : {}), nodeIds: [c.nodeId] });
    }

    const template = {
      id: spec.id,
      title: spec.title,
      ownerId: "hycanvas",
      workspaceId: null,
      visibility: "public",
      categories: spec.categories,
      tags: spec.tags,
      style: { palette: palette.slice(0, 6), typography: spec.typography ?? [], styleTags: spec.styleTags ?? [] },
      format: { width: spec.size[0], height: spec.size[1], unit: "px" },
      pageCount: pages.length,
      previewUrls: [],
      fillableFields: (spec.fillable ?? []).map(({ node, ...rest }) => ({ nodeId: `${spec.id}-${node}`, ...rest })),
      attributions,
      version: spec.version ?? 1,
      createdAt: spec.created ?? "2026-07-04T00:00:00.000Z",
      updatedAt: spec.updated ?? spec.created ?? "2026-07-04T00:00:00.000Z",
      designFileKey: `seed:${spec.id}`,
    };
    return { entry: { template, file }, errors };
  }

  return compile;
}

/** "Title" by Author (Licence), the credit line a CC BY picture asks for. */
export function creditText(c) {
  const title = c.title ? `"${c.title}"` : "Photo";
  return `${title}${c.author ? ` by ${c.author}` : ""}${c.licenseLabel ? ` (${c.licenseLabel})` : ""}`;
}
