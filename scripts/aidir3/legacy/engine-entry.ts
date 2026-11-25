/**
 * The legacy-library engine: rebuilds one listing of the old aidir3 Design library (G2,
 * src/lib/design) and turns it into a template of this editor, under goja in the Go backend
 * (backend/internal/templates/legacy). Three steps, each the code that already does it elsewhere:
 *   1. the old catalogue builds the listing from its recipe (gen/catalog.ts + catalog-append.ts);
 *   2. the port converter turns the old template into a template spec (aidir3-design-candidates/port);
 *   3. the spec compiler turns the spec into a design file (scripts/lib/template-spec.mjs).
 * Bundled by scripts/aidir3/legacy/build.mjs. Entry: globalThis.__a3Materialise(json) -> json.
 */
import { __buildRecipe, type __Recipe } from "@/lib/design/gen/catalog";
import { convertTemplate, setPhotoResolver } from "../../../../aidir3-design-candidates/port/src/convert";
import type { Pick } from "../../../../aidir3-design-candidates/port/src/select";
import { makeSpecCompiler } from "../../lib/template-spec.mjs";
import { ICON_BOX, ICON_GLYPHS } from "../../../packages/aistudio/dist/iconset.js";
import { photoRef } from "./photo-ref";

const compile = makeSpecCompiler({ ICON_GLYPHS, ICON_BOX });

type Req = {
  recipe: __Recipe;
  /** Id the materialised template carries (the variation id). */
  id: string;
  /** Title to use instead of the converter's (the catalogue's listing name). */
  title?: string;
  /** The distinct design this listing is a variation of. */
  base: { collection: Pick["collection"]; label: string; source: string; layout: string };
  /** Keep the old pictures (default) or leave empty photo slots. */
  photos?: boolean;
};

function materialise(req: Req) {
  const t = __buildRecipe(req.recipe);
  if (!t) return { error: `no listing for recipe ${req.recipe.id}` };
  const { pages: _pages, ...meta } = t;
  setPhotoResolver(req.photos === false ? null : photoRef);
  try {
    const pick: Pick = { id: req.id, source: req.base.source, layout: req.base.layout, label: req.base.label, templateId: t.id, listed: 0, meta, collection: req.base.collection };
    const { spec, report } = convertTemplate(t, pick);
    if (req.title) spec.title = req.title;
    spec.created = "2026-11-25T00:00:00.000Z";
    const { entry, errors } = compile(spec);
    return { template: entry.template, file: entry.file, warnings: [...report.warnings, ...errors], lost: [...report.lost].sort() };
  } finally {
    setPhotoResolver(null);
  }
}

(globalThis as unknown as { __a3Materialise: (json: string) => string }).__a3Materialise = (json: string) => {
  try {
    return JSON.stringify(materialise(JSON.parse(json) as Req));
  } catch (e) {
    return JSON.stringify({ error: String((e as Error)?.stack ?? e) });
  }
};
