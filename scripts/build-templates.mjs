// Compile compact template specs (scripts/templates/*.json) into the embedded
// template seed (backend/internal/templates/seed.json). The specs are the
// source of truth: hex colors, plain text blocks and button primitives compile
// deterministically into schema-valid design files, so template authors never
// hand-write srgb runs or worry about optically centering a CTA label.
//
//   node scripts/build-templates.mjs            # compile + validate + write seed
//   node scripts/build-templates.mjs --check    # compile + validate only
//
// Validation: every compiled file passes @hc/schema validate() (build the
// packages first), node ids are unique, and all geometry sits inside the page
// unless the node opts into bleed ("bleed": true).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Dynamic imports take a file URL: a bare absolute path only works on POSIX
// (on Windows "C:\..." parses as an unknown URL scheme).
const importPath = (...parts) => import(pathToFileURL(join(...parts)).href);
// TEMPLATE_SPECS / TEMPLATE_SEED override the spec dir and output (used by the
// authoring pipeline to compile candidate specs to a scratch seed for review).
const SPEC_DIR = process.env.TEMPLATE_SPECS || join(ROOT, "scripts", "templates");
const SEED = process.env.TEMPLATE_SEED || join(ROOT, "backend", "internal", "templates", "seed.json");
const { createNode } = await importPath(ROOT, "packages", "schema", "dist", "index.js");
const { validate } = await importPath(ROOT, "packages", "schema", "dist", "validation.js");
const { composeDeckFile, decodeDrawingPath } = await importPath(ROOT, "packages", "aistudio", "dist", "index.js");
// The composer's baked icon and drawing sets (Tabler Icons, ManyPixels; both
// MIT) are not part of the package's public surface, so they are read from
// their own modules: a template may place the same icons and drawings the
// generated decks use, recolored to its own palette.
const { ICON_GLYPHS, ICON_BOX } = await importPath(ROOT, "packages", "aistudio", "dist", "iconset.js");
const { ILLUSTRATIONS } = await importPath(ROOT, "packages", "aistudio", "dist", "illustrationset.js");
// composeDeckFile reads the same sets from a registry, so register them.
const { provideArtwork } = await importPath(ROOT, "packages", "aistudio", "dist", "artset.js");
provideArtwork();
const { svgToNodes } = await importPath(ROOT, "packages", "stock", "dist", "index.js");

// Bundled illustration packs (for "illustrations" page entries): asset id ->
// pack dir, svg file, title, and the pack license for provenance stamping.
const LIBRARY = join(ROOT, "backend", "internal", "stock", "library");
const STOCK = (() => {
  const m = new Map();
  for (const pack of ["illlustrations", "lukaszadam", "opendoodles", "openpeeps"]) {
    const idx = JSON.parse(readFileSync(join(LIBRARY, pack, "index.json"), "utf8"));
    for (const a of idx.assets) m.set(a.id, { pack, file: a.file, title: a.title, license: idx.license });
  }
  return m;
})();

// --- illustrations -----------------------------------------------------------

// True bounds from path geometry (converted paths keep transform at 0,0).
function nodeBBox(n) {
  if (n.segments?.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of n.segments) for (const p of [s, s.cIn, s.cOut]) if (p) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }
  const x = n.transform?.x ?? 0, y = n.transform?.y ?? 0;
  return { x0: x, y0: y, x1: x + (n.size?.width ?? 0), y1: y + (n.size?.height ?? 0) };
}

const roundTo = (v, p) => Math.round(v * p) / p;
function roundDeep(v, k) {
  if (typeof v === "number") return roundTo(v, k === "r" || k === "g" || k === "b" || k === "a" ? 1e4 : 1e2);
  if (Array.isArray(v)) return v.map((x) => roundDeep(x, k));
  if (v && typeof v === "object") { const o = {}; for (const [kk, vv] of Object.entries(v)) o[kk] = roundDeep(vv, kk); return o; }
  return v;
}

/** Compile one page-level illustration entry into an editable vector group,
 *  provenance-stamped like an editor stock insert. illlustrations-pack assets
 *  get their baked bottom-strip credit marks stripped, and optionally the
 *  baked background card too (cleanCard), refitting to the remaining art. */
function illustrationGroup(specId, k, il, pageW, pageH, errors) {
  const asset = STOCK.get(il.asset);
  if (!asset) { errors.push(`${specId} il${k}: unknown illustration asset ${il.asset}`); return null; }
  const cx = il.x + il.w / 2, cy = il.y + il.h / 2;
  if (cx < 0 || cy < 0 || cx > pageW || cy > pageH) { errors.push(`${specId} il${k}: center off page`); return null; }
  const svg = readFileSync(join(LIBRARY, asset.pack, asset.file), "utf8");
  let i = 0;
  let { nodes } = svgToNodes(svg, () => `${specId}-il${k}-n${++i}`);
  if (!nodes.length) { errors.push(`${specId} il${k}: empty svg parse`); return null; }
  const vb = /viewBox\s*=\s*"([^"]+)"/i.exec(svg)?.[1]?.trim().split(/[\s,]+/).map(Number);
  const vbW = (vb && vb[2]) || 200, vbH = (vb && vb[3]) || 200;
  let bx = 0, by = 0, bw = vbW, bh = vbH;
  if (asset.pack === "illlustrations") {
    nodes = nodes.filter((n) => {
      const b = nodeBBox(n);
      if (b.y0 > 0.86 * vbH) return false; // bottom-strip credit marks
      if (il.cleanCard && (b.x1 - b.x0) > 0.85 * vbW && (b.y1 - b.y0) > 0.85 * vbH) return false; // baked card
      // A card drawn as two bands (a sky and a ground, each the full width and
      // together the full height) is a card too.
      if (il.cleanCard && (b.x1 - b.x0) > 0.85 * vbW && (b.y1 - b.y0) > 0.3 * vbH && (b.y0 < 0.05 * vbH || b.y1 > 0.95 * vbH)) return false;
      return true;
    });
    if (!nodes.length) { errors.push(`${specId} il${k}: nothing left after cleaning`); return null; }
    if (il.cleanCard) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) { const b = nodeBBox(n); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
      bx = x0; by = y0; bw = x1 - x0; bh = y1 - y0;
    }
  }
  const s = Math.min(il.w / bw, il.h / bh);
  // A heavy drawing costs every load of the template; say so, once per use.
  const kb = Math.round(JSON.stringify(nodes).length / 1024);
  if (kb > 300) console.warn(`warning: ${specId} il${k}: ${il.asset} compiles to ${kb} KB, over the 300 KB ceiling`);
  return roundDeep(createNode("group", {
    id: `${specId}-il${k}`,
    name: asset.title,
    children: nodes,
    transform: { x: il.x + (il.w - bw * s) / 2 - bx * s, y: il.y + (il.h - bh * s) / 2 - by * s, scaleX: s, scaleY: s, rotation: il.rotation ?? 0 },
    size: { width: bw, height: bh },
    ...(il.opacity !== undefined && il.opacity !== 1 ? { opacity: il.opacity } : {}),
    data: { provenance: { origin: "stock", stockAssetId: il.asset, license: asset.license } },
  }), "");
}

const { makeSpecCompiler } = await importPath(ROOT, "scripts", "lib", "template-spec.mjs");

// --- compile one spec ---------------------------------------------------------
// The spec compiler is shared with the legacy-library engine (scripts/lib/template-spec.mjs);
// only the page-illustration step, which reads the bundled SVG packs, lives here.

const compile = makeSpecCompiler({ ICON_GLYPHS, ICON_BOX, ILLUSTRATIONS, decodeDrawingPath, illustrationGroup });


// --- deck-outline dialect (F40 E11) ------------------------------------------
// A presentation template authored THROUGH the product: a hand-written outline
// plus a catalog themeId, composed into a full design by the exact pipeline
// the generation API runs (composeDeckFile). Deterministic: node ids come from
// a counter shim installed around the compose (the same contract as the goja
// composer), so regenerating the seed never churns ids.

function compileDeckOutline(spec) {
  const errors = [];
  if (!spec.outline?.pages?.length) errors.push(`${spec.id}: outline.pages is required`);
  if (!spec.themeId) errors.push(`${spec.id}: themeId is required`);
  const prevCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  let uuidSeq = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => `n-${++uuidSeq}` },
  });
  let file;
  try {
    file = composeDeckFile({
      outline: spec.outline,
      width: spec.size?.[0] ?? 1920,
      height: spec.size?.[1] ?? 1080,
      themeId: spec.themeId,
    });
  } catch (e) {
    errors.push(`${spec.id}: compose failed: ${e.message}`);
    return { entry: null, errors };
  } finally {
    if (prevCrypto) Object.defineProperty(globalThis, "crypto", prevCrypto);
  }
  file.id = `tpl-${spec.id}`;
  file.title = spec.title;
  file.meta = file.meta ?? {}; // the seed validator requires the record
  // Palette metadata from the catalog theme record (already stamped on file).
  const palette = (file.theme?.colors ?? [])
    .map((c) => {
      const s = c.color?.srgb;
      if (!s) return null;
      const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
      return `#${h(s.r)}${h(s.g)}${h(s.b)}`;
    })
    .filter(Boolean)
    .slice(0, 6);
  const template = {
    id: spec.id,
    title: spec.title,
    ownerId: "hycanvas",
    workspaceId: null,
    visibility: "public",
    categories: spec.categories,
    tags: spec.tags,
    style: {
      palette,
      typography: [
        { role: "heading", family: file.theme?.fontHeading ?? "Inter", weight: 700 },
        { role: "body", family: file.theme?.fontBody ?? "Inter", weight: 400 },
      ],
      styleTags: spec.styleTags ?? [],
    },
    format: { width: spec.size?.[0] ?? 1920, height: spec.size?.[1] ?? 1080, unit: "px" },
    pageCount: file.pages.length,
    previewUrls: [],
    fillableFields: [],
    attributions: [],
    version: spec.version ?? 1,
    createdAt: spec.created ?? "2026-08-28T00:00:00.000Z",
    updatedAt: spec.updated ?? spec.created ?? "2026-08-28T00:00:00.000Z",
    designFileKey: `seed:${spec.id}`,
  };
  return { entry: { template, file }, errors };
}

// --- run ---------------------------------------------------------------------

const specs = readdirSync(SPEC_DIR).filter((f) => f.endsWith(".json")).sort();
const entries = [];
const allErrors = [];
const ids = new Set();
for (const f of specs) {
  const spec = JSON.parse(readFileSync(join(SPEC_DIR, f), "utf8"));
  if (ids.has(spec.id)) allErrors.push(`duplicate template id: ${spec.id}`);
  ids.add(spec.id);
  if (!spec.categories?.length || !spec.tags?.length) allErrors.push(`${spec.id}: categories and tags are required`);
  const { entry, errors } = spec.kind === "deck-outline" ? compileDeckOutline(spec) : compile(spec);
  allErrors.push(...errors);
  if (!entry) continue;
  const v = validate(entry.file);
  if (!v.ok) allErrors.push(`${spec.id}: schema invalid at ${v.pointer}: ${v.message}`);
  entries.push({ entry, rank: spec.rank ?? 100, id: spec.id });
}
// The gallery serves built-ins in seed order, so seed order IS the landing
// order: curated rank first (lower leads), id as the stable tiebreak.
entries.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
if (allErrors.length) {
  console.error(`FAIL: ${allErrors.length} error(s)`);
  for (const e of allErrors) console.error("  -", e);
  process.exit(1);
}
if (!process.argv.includes("--check")) {
  // One template per line: compact (the seed is embedded in the binary and
  // never hand-edited), but a diff still shows which templates changed.
  writeFileSync(SEED, "[\n" + entries.map((e) => JSON.stringify(e.entry)).join(",\n") + "\n]\n");
  console.log(`wrote ${entries.length} templates -> ${SEED}`);
} else {
  console.log(`ok: ${entries.length} templates compile and validate`);
}
