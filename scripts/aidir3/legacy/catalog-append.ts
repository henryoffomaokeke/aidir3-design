/* ------------------------------------------------------------------------------------------------
 * Appended to the old site's src/lib/design/gen/catalog.ts at bundle time (scripts/aidir3/legacy/
 * build.mjs), never written to that file. Inside the module it can reach the catalogue's private
 * enumeration and lookup tables, so it can:
 *   - list every template the old library offers as a compact recipe (__recipes), and
 *   - rebuild ONE listing from its recipe without enumerating the other 199,000 (__buildRecipe),
 *     through the catalogue's own buildGenerated, so a rebuilt listing is the old listing.
 * ------------------------------------------------------------------------------------------------ */
import { PROMO_VARIANTS as __PROMO_VARIANTS } from "./promo";
import { MODERN as __MODERN } from "./modern";
import { TEMPLATES as __TEMPLATES } from "../templates";

/** Which brief list a brief belongs to: n(iches), p(romo), c(ertificates), v (CVs). */
export type __BriefSet = "n" | "p" | "c" | "v";
export type __Recipe = {
  /** gen: niche or promo layout; doc: document layout; brand: logo or brand collateral; card: business card; thumb: YouTube collection; hand: hand-made template. */
  k: "gen" | "doc" | "brand" | "card" | "thumb" | "hand";
  id: string;
  set?: __BriefSet;
  brief?: string;
  layout?: string;
  format?: string;
  cw?: number;
  /** doc: index into DOC_SETS. */
  ds?: number;
  hidden?: boolean;
};

const __setOf = (b: Brief): __BriefSet => (PROMO_BRIEFS.includes(b) ? "p" : CERT_BRIEFS.includes(b) ? "c" : CV_BRIEFS.includes(b) ? "v" : "n");
const __briefIn = (set: __BriefSet, id: string): Brief | undefined => (set === "p" ? PROMO_BRIEFS : set === "c" ? CERT_BRIEFS : set === "v" ? CV_BRIEFS : NICHES).find((b) => b.id === id);
const __cwOf = (id: string, base: string) => (id === base ? 0 : +id.slice(base.length + 2) - 1);

/** Every generated listing (shown and retired) with its meta and recipe. Runs the real enumeration. */
export function __recipes(): { meta: TemplateMeta; r: __Recipe; b?: Brief }[] {
  const out: { meta: TemplateMeta; r: __Recipe; b?: Brief }[] = [];
  for (const m of thumbMetas()) if (!skip.has(m.id)) out.push({ meta: m, r: { k: "thumb", id: m.id, format: m.format, layout: thumbLayoutOf(m.id) ?? undefined } });
  enumerate((e) => out.push({ meta: e.meta, r: { k: "gen", id: e.meta.id, set: __setOf(e.b), brief: e.b.id, layout: e.layout.id, format: e.meta.format, cw: e.cw, ...(e.hidden ? { hidden: true } : {}) }, b: e.b }));
  enumerateDocs((e) => {
    const ds = DOC_SETS.findIndex((s) => s.briefs.includes(e.b) && s.layouts.some((l) => l.id === e.doc.id));
    out.push({ meta: e.meta, r: { k: "doc", id: e.meta.id, set: __setOf(e.b), brief: e.b.id, layout: e.doc.id, format: e.meta.format, cw: e.cw, ds, ...(e.hidden ? { hidden: true } : {}) }, b: e.b });
  });
  for (const e of enumerateBrand()) out.push({ meta: e.meta, r: { k: "brand", id: e.meta.id, set: "n", brief: e.b.id, layout: e.style, format: e.meta.format }, b: e.b });
  for (const e of enumerateCards()) out.push({ meta: e.meta, r: { k: "card", id: e.meta.id, set: "n", brief: e.b.id, layout: e.style, format: e.meta.format, cw: e.cw ?? 0 }, b: e.b });
  return out;
}

/** The meta and layout of a generated layout listing, rebuilt the way enumerate() makes them. */
function __genEntry(r: __Recipe): GenEntry | null {
  const b = __briefIn(r.set ?? "n", r.brief!);
  if (!b) return null;
  let layout: Layout | undefined;
  let shape: Shape | undefined;
  let extra = 0;
  if (r.set === "p") {
    const v = __PROMO_VARIANTS.find((x) => x.id === r.layout);
    if (!v) return null;
    layout = promoLayout(v);
    shape = PROMO_FORMATS.find(([f]) => f === r.format)?.[1];
    extra = PROMO_COLOURWAYS - 1;
  } else {
    const modern = b.ng ? [] : __MODERN.filter((l) => l.id === r.layout).map(modernLayout);
    layout = (b.ng ? NG_LAYOUTS : [...modern, ...LAYOUTS]).find((l) => l.id === r.layout);
    shape = FORMAT_SHAPE[r.format!];
  }
  if (!layout || !shape) return null;
  const base = `g-${b.id}-${layout.id}-${r.format}`;
  let found: GenEntry | null = null;
  const L = layout, S = shape;
  if (r.set === "p") withVariants(b, base, r.format!, L.label, true, (meta, cw) => { if (cw === r.cw) found = { meta, b, layout: L, shape: S, cw, base }; }, L.pals, L.fxs, L.trend, extra);
  else withVariants(b, base, r.format!, L.label, !!L.premium, (meta, cw) => { if (cw === r.cw) found = { meta, b, layout: L, shape: S, cw, base }; }, L.palsFor ? L.palsFor(b) : L.pals, L.fxs, L.trend);
  return found;
}

function __docEntry(r: __Recipe): DocEntry | null {
  const set = DOC_SETS[r.ds ?? -1];
  const b = set && __briefIn(r.set ?? "n", r.brief!);
  const doc = set?.layouts.find((l) => l.id === r.layout);
  if (!b || !doc) return null;
  const base = `g-${b.id}-${doc.id}-${r.format}`;
  let found: DocEntry | null = null;
  withVariants(b, base, r.format!, doc.label, !!doc.premium, (meta, cw) => {
    if (cw !== r.cw) return;
    if (doc.category) meta.category = doc.category as TemplateCategory;
    found = { meta, b, doc, cw, base };
  }, doc.pals, doc.fxs, doc.trend);
  return found;
}

function __brandEntry(r: __Recipe): BrandEntry | null {
  const b = __briefIn("n", r.brief!);
  const st = LOGO_STYLES.find((s) => s.id === r.layout);
  const f = fmtLabel.get(r.format!);
  if (!b || !st || !f) return null;
  const isLogo = LOGO_FORMATS.includes(r.format!);
  const look = brandLook(b, st.id);
  return {
    b,
    style: st.id,
    meta: {
      id: brandTemplateId(b.id, st.id, r.format!),
      name: isLogo ? `${b.brand} · ${st.label} logo` : `${b.brand} · ${BRAND_FORMAT_LABEL[r.format!] ?? f.label}`,
      format: r.format!,
      category: BRAND_CATEGORY,
      niche: b.label,
      premium: !!st.premium,
      style: styleLabel(look.pal),
      tags: ["logo", "brand kit", "branding", b.label.toLowerCase(), `${st.label.toLowerCase()} logo`, b.category.toLowerCase(), ...b.tags.slice(0, 3), f.label.toLowerCase()],
    },
  };
}

function __cardEntry(r: __Recipe): BrandEntry | null {
  const b = __briefIn("n", r.brief!);
  const l = BUSINESS_CARDS.find((x) => x.id === r.layout);
  if (!b || !l) return null;
  const cw = r.cw ?? 0;
  const base = `g-${b.id}-card-${l.id}-${l.format}`;
  const side = l.format === "business-card-back" ? "back" : l.format === "business-card-vertical" ? "vertical" : "front";
  const { look } = cardLook(b, l.id, cw);
  return {
    b,
    style: l.id,
    card: true,
    cw,
    meta: {
      id: cw ? `${base}-c${cw + 1}` : base,
      name: `${b.brand} · Business card ${side} (${l.label})${CW_LABEL[cw] ?? ""}`,
      format: l.format,
      category: BRAND_CATEGORY,
      niche: b.label,
      premium: !!l.premium,
      style: styleLabel(look.pal),
      tags: ["business card", "business cards", "visiting card", "brand kit", `card ${side}`, l.label.toLowerCase(), b.label.toLowerCase(), b.category.toLowerCase(), ...b.tags.slice(0, 3)],
    },
  };
}

const __hand = new Map(__TEMPLATES.map((t) => [t.id, t]));

/**
 * Rebuilds one listing from its recipe: the same Template object the old site's getTemplate(id)
 * returns (pages, photos filled from the pre-picked free photos), or null when the recipe does not
 * name a listing of this catalogue. The catalogue's full enumeration is switched off, so this costs
 * one layout render, not a walk over the whole library.
 */
export function __buildRecipe(r: __Recipe): Template | null {
  if (r.k === "hand") {
    const t = __hand.get(r.id);
    return t ? { ...t, pages: t.pages.map((p, i) => ({ ...p, els: fillPhotos(p.els, hash(t.id) + i) })) } : null;
  }
  // buildGenerated() starts with generatedMetas(): a non-null list stops it enumerating.
  if (!metas) {
    metas = [];
    metasAll = [];
  }
  if (r.k === "thumb") return buildGenerated(r.id);
  const e = r.k === "gen" ? __genEntry(r) : r.k === "doc" ? __docEntry(r) : r.k === "card" ? __cardEntry(r) : __brandEntry(r);
  if (!e || e.meta.id !== r.id) return null;
  const map = (r.k === "gen" ? byId : r.k === "doc" ? docById : brandById) as Map<string, typeof e>;
  const prev = map.get(r.id);
  map.set(r.id, e);
  try {
    return buildGenerated(r.id);
  } finally {
    // One listing at a time: the maps never grow (an entry the full enumeration made is put back).
    if (prev) map.set(r.id, prev);
    else map.delete(r.id);
  }
}
