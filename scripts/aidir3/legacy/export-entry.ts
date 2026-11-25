/**
 * Exports the old aidir3 Design library's listings (every template its gallery lists: hand-made
 * and generated) as the compact variation catalogue the backend embeds
 * (backend/internal/templates/legacy/catalog.json.gz). Bundled for Node and run by build.mjs.
 *
 * One row per listing, columnar, with the shared parts normalised into tables: briefs (the copy),
 * layouts, formats, name suffixes, old categories, and the distinct design ("base", an a3-lib-*
 * template of the port) each listing is a variation of. Every row is checked: its id and name are
 * rebuilt from the tables exactly as the backend rebuilds them, and a sample of listings is rebuilt
 * from its recipe and compared with the old library's own template.
 *
 * argv: <out.json> <port manifest.json> <G2 root> [--sample=N]
 */
import { writeFileSync, readFileSync } from "node:fs";
import { FORMATS } from "@/lib/design/types";
import { allTemplates, getTemplate } from "@/lib/design/library";
import { __buildRecipe, __recipes, briefById, type __Recipe, type TemplateMeta } from "@/lib/design/gen/catalog";
import { brandLook } from "@/lib/design/gen/brand";
import { PROMO_VARIANTS } from "@/lib/design/gen/promo";
import { TEMPLATES } from "@/lib/design/templates";
import { handmadeSkeletons } from "../../../../aidir3-design-candidates/port/src/handmade";
import { CLASSIC_WRAPS } from "../../../../aidir3-design-candidates/port/src/select";
import { categoriesFor } from "../../../../aidir3-design-candidates/port/src/convert";
import { APPROVED } from "../../../../aidir3-design-candidates/port/src/maps";

const [outPath, manifestPath, g2Root] = process.argv.slice(2);
const sampleN = +(process.argv.find((a) => a.startsWith("--sample="))?.slice(9) ?? 400);

type ManifestRow = { id: string; title: string; source: string; layout: string; label: string; collection: string };
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestRow[];

/* ---------------------------------------------------------------- base design of a listing (select.ts rules) */

// select.ts: layout ids drawn by the same function as another id, and layouts made only of pages ported elsewhere.
const SAME_AS: Record<string, string> = { "m-bentodata": "m-bento", "m-laptop": "m-phone", "m-browser": "m-phone", "m-info-tall": "m-infographic", "card-asoebi": "card-rsvp", "card-thanks": "card-rsvp", "card-colours": "card-rsvp" };
const DUPLICATE_OF: Record<string, string> = { "prog-photo": "prog-classic", order: "prog-heritage" };
const BANNER_FORMATS = ["fb-cover", "x-header", "li-banner", "yt-banner", "email-header"];
const HAND_CANON = (key: string) => (key.startsWith("deck:") ? "deck" : key);

const byLayout = new Map<string, ManifestRow>();
for (const m of manifest) {
  const k = m.source === "gen/thumbs.ts" ? `thumbs|${m.layout}` : m.collection === "handmade" ? `hand|${m.layout}` : `x|${m.layout}`;
  if (byLayout.has(k)) throw new Error(`manifest: two bases for ${k}`);
  byLayout.set(k, m);
}
const promoBase = new Map(PROMO_VARIANTS.map((v) => [v.id, `a3-lib-promo-${v.bg}`]));
const manifestById = new Map(manifest.map((m) => [m.id, m]));
const sk = handmadeSkeletons(g2Root);

function baseOf(r: __Recipe): ManifestRow {
  const need = (k: string) => {
    const m = byLayout.get(k);
    if (!m) throw new Error(`no base design for ${r.id} (${k})`);
    return m;
  };
  switch (r.k) {
    case "hand": {
      const s = sk.get(r.id);
      if (!s) throw new Error(`no skeleton for ${r.id}`);
      return need(`hand|${HAND_CANON(s.key)}`);
    }
    case "thumb":
      return need(`thumbs|${r.layout}`);
    case "brand": {
      if (["logo", "logo-wide", "social-profile"].includes(r.format!)) return need(`x|logo:${r.layout}`);
      if (BANNER_FORMATS.includes(r.format!)) return need("x|collateral:banner");
      if (r.format === "business-card-back") return need("x|card:contacts");
      if (r.format === "business-card") {
        const v = brandLook(briefById(r.brief!)!, r.layout!).v;
        return need(v === 1 ? "x|collateral:business-card" : v === 0 ? "x|card:reverse" : "x|card:split");
      }
      return need(`x|collateral:${r.format}`);
    }
    case "card":
      return need(`x|card:${r.layout}`);
    default: {
      const l = r.layout!;
      if (r.set === "p" && promoBase.has(l)) {
        const m = manifestById.get(promoBase.get(l)!);
        if (!m) throw new Error(`no promo base for ${l}`);
        return m;
      }
      if (CLASSIC_WRAPS[l]) return need(`hand|${CLASSIC_WRAPS[l]}`);
      return need(`x|${SAME_AS[l] ?? DUPLICATE_OF[l] ?? l}`);
    }
  }
}

/* ---------------------------------------------------------------- tables */

const intern = <T>(list: T[], index: Map<string, number>, key: string, make: () => T) => {
  let i = index.get(key);
  if (i === undefined) index.set(key, (i = list.push(make()) - 1));
  return i;
};
const formats: { id: string; label: string; w: number; h: number }[] = [];
const formatIx = new Map<string, number>();
const fmt = new Map(FORMATS.map((f) => [f.id, f]));
const briefs: { s: string; id: string; label: string; brand: string; cat: string; tags: string[] }[] = [];
const briefIx = new Map<string, number>();
const layouts: { k: string; id: string; ds?: number }[] = [];
const layoutIx = new Map<string, number>();
const suffixes: string[] = [];
const suffixIx = new Map<string, number>();
const cats: string[] = [];
const catIx = new Map<string, number>();
const bases: { id: string; title: string; source: string; layout: string; label: string; collection: string }[] = [];
const baseIx = new Map<string, number>();
const studioCats = [...APPROVED];

const cols = { k: [] as number[], l: [] as number[], b: [] as number[], f: [] as number[], cw: [] as number[], s: [] as number[], pre: [] as number[], c: [] as number[], base: [] as number[], sc: [] as number[] };
const KINDS = ["gen", "doc", "brand", "card", "thumb", "hand"];

/** The listing id the backend rebuilds from a row (backend/internal/templates/legacy). */
function idOf(k: string, briefId: string, layoutId: string, format: string, cw: number): string {
  const c = cw ? `-c${cw + 1}` : "";
  switch (k) {
    case "hand": return layoutId;
    case "thumb": return `g-yt-${briefId}-${layoutId}-${format}${c}`;
    case "brand": return `g-${briefId}-brand-${layoutId}-${format}`;
    case "card": return `g-${briefId}-card-${layoutId}-${format}${c}`;
    default: return `g-${briefId}-${layoutId}-${format}${c}`;
  }
}

const listed = new Set(allTemplates().map((m) => m.id));
const rows: { meta: TemplateMeta; r: __Recipe; b?: { id: string; label: string; brand: string; category: string; tags: string[] } }[] = [];
for (const t of TEMPLATES) {
  const { pages: _p, ...meta } = t;
  rows.push({ meta: meta as TemplateMeta, r: { k: "hand", id: t.id, format: t.format } });
}
for (const x of __recipes()) if (listed.has(x.meta.id) && !x.r.hidden) rows.push(x as (typeof rows)[number]);
if (rows.length !== listed.size) throw new Error(`catalogue rows ${rows.length} != listed ${listed.size}`);

let checked = 0;
for (const { meta, r, b } of rows) {
  const f = fmt.get(meta.format);
  if (!f) throw new Error(`unknown format ${meta.format}`);
  const fi = intern(formats, formatIx, f.id, () => ({ id: f.id, label: f.label, w: f.width, h: f.height }));
  // Brief: the copy a listing is written from. Thumbnail briefs are not exported by the old library,
  // so their id is read back from the listing id and their words from its meta.
  let briefId = "", set = r.set ?? "n";
  if (r.k === "thumb") {
    const cw = /-c(\d+)$/.exec(meta.id);
    r.cw = cw ? +cw[1] - 1 : 0;
    const core = cw ? meta.id.slice(0, -cw[0].length) : meta.id;
    const tail = `-${r.layout}-${meta.format}`;
    if (!core.endsWith(tail)) throw new Error(`cannot read the brief of ${meta.id}`);
    briefId = core.slice("g-yt-".length, -tail.length);
    set = "t";
  } else if (b) briefId = b.id;
  const bi = r.k === "hand" ? -1 : intern(briefs, briefIx, `${set}|${briefId}`, () => (b ? { s: set, id: b.id, label: b.label, brand: b.brand, cat: b.category, tags: b.tags } : { s: set, id: briefId, label: meta.niche ?? meta.name, brand: "", cat: meta.category, tags: meta.tags }));
  const li = intern(layouts, layoutIx, `${r.k}|${r.k === "hand" ? r.id : r.layout}|${r.ds ?? ""}`, () => ({ k: r.k, id: r.k === "hand" ? r.id : r.layout!, ...(r.ds !== undefined ? { ds: r.ds } : {}) }));
  // Name: "<brief label or brand> · <suffix>" (or the whole name for hand-made templates).
  const brief = bi >= 0 ? briefs[bi] : null;
  let pre = 0, suffix = meta.name;
  if (brief && meta.name.startsWith(`${brief.label} · `)) (pre = 1), (suffix = meta.name.slice(brief.label.length + 3));
  else if (brief && brief.brand && meta.name.startsWith(`${brief.brand} · `)) (pre = 2), (suffix = meta.name.slice(brief.brand.length + 3));
  else if (r.k !== "hand") throw new Error(`name of ${meta.id} does not start with its brief: ${meta.name}`);
  const si = intern(suffixes, suffixIx, suffix, () => suffix);
  const ci = intern(cats, catIx, meta.category, () => meta.category);
  const base = baseOf(r);
  const bx = intern(bases, baseIx, base.id, () => ({ id: base.id, title: base.title, source: base.source, layout: base.layout, label: base.label, collection: base.collection }));
  let mask = 0;
  for (const c of categoriesFor({ id: base.id, source: base.source, layout: base.layout, label: base.label, templateId: meta.id, listed: 0, meta, collection: base.collection as never }, meta.format)) mask |= 1 << studioCats.indexOf(c);
  const cw = r.cw ?? 0;
  // The backend must rebuild this listing's id from the row alone.
  if (idOf(r.k, briefId, layouts[li].id, f.id, cw) !== meta.id) throw new Error(`id of ${meta.id} is not rebuilt from its row`);
  cols.k.push(KINDS.indexOf(r.k));
  cols.l.push(li);
  cols.b.push(bi);
  cols.f.push(fi);
  cols.cw.push(cw);
  cols.s.push(si);
  cols.pre.push(pre);
  cols.c.push(ci);
  cols.base.push(bx);
  cols.sc.push(mask);
  checked++;
}

/* ---------------------------------------------------------------- fidelity sample */

// A spread of listings rebuilt from their recipe must equal the old library's own template.
/** Element ids come from a running counter in the old library: compared by order of appearance. */
const norm = (json: string) => {
  const ids = new Map<string, number>();
  return json.replace(/"(id|group|parent)":"([^"]+)"/g, (_m, k: string, v: string) => `"${k}":"#${ids.get(v) ?? ids.set(v, ids.size).get(v)}"`);
};
let same = 0;
const step = Math.max(1, Math.floor(rows.length / sampleN));
const bad: string[] = [];
for (let i = 0; i < rows.length; i += step) {
  const { r, meta } = rows[i];
  if (r.k === "hand") continue;
  const want = norm(JSON.stringify(getTemplate(meta.id)));
  const got = norm(JSON.stringify(__buildRecipe({ ...r, set: r.k === "thumb" ? undefined : r.set })));
  if (want === got) same++;
  else {
    if (!bad.length) {
      let k = 0;
      while (want[k] === got[k]) k++;
      console.error(`first difference in ${meta.id}:
  old: ${want.slice(Math.max(0, k - 80), k + 100)}
  new: ${got.slice(Math.max(0, k - 80), k + 100)}`);
    }
    bad.push(meta.id);
  }
}
if (bad.length) throw new Error(`${bad.length} rebuilt listings differ from the old library: ${bad.slice(0, 5).join(", ")}`);

const out = { v: 1, listed: rows.length, kinds: KINDS, formats, studioCats, cats, bases, layouts, briefs, suffixes, rows: cols };
writeFileSync(outPath, JSON.stringify(out));
console.log(`catalogue: ${rows.length} listings (${TEMPLATES.length} hand-made), ${bases.length} base designs, ${briefs.length} briefs, ${layouts.length} layouts, ${suffixes.length} name suffixes; ${checked} rows checked, ${same} sampled listings rebuilt identically`);
