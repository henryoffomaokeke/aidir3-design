// Builds the legacy-library variation catalogue and its engine from the old aidir3 Design site
// (G2, src/lib/design) and the template port (aidir3-design-candidates/port):
//
//   backend/internal/templates/legacy/catalog.json.gz   every listing of the old gallery as a row
//   backend/internal/templates/legacy/engine.js         rebuilds + converts + compiles one listing (goja)
//
// Both outputs are committed, like the composer bundle, so `go build` never needs Node or the old
// site. Re-run after the old library, the port converter or the spec compiler changes:
//
//   node scripts/aidir3/legacy/build.mjs [--engine-only] [--sample=N]
//
// LEGACY_SITE and LEGACY_PORT override the two source folders.
import { build } from "esbuild";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");
const SITE = process.env.LEGACY_SITE || path.resolve(ROOT, "..", "G2");
const PORT = process.env.LEGACY_PORT || path.resolve(ROOT, "..", "aidir3-design-candidates", "port");
const OUT = path.join(ROOT, "backend", "internal", "templates", "legacy");
const WORK = path.join(here, ".build");
const STOCK = path.join(ROOT, "backend", "internal", "render", "stockfonts");
const args = process.argv.slice(2);
const engineOnly = args.includes("--engine-only");
const sample = args.find((a) => a.startsWith("--sample="));
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const [what, dir] of [["old site", SITE], ["port", PORT]]) if (!existsSync(dir)) throw new Error(`${what} not found at ${dir}`);

/* ------------------------------------------------------------------ font metrics */

// The converter's font map (port/src/maps.ts) names the families it measures; every stock face of
// those families (and of the old families it measures where the renderer ships them) is read.
{
  const opentype = createRequire(path.join(SITE, "package.json"))("opentype.js");
  const maps = readFileSync(path.join(PORT, "src", "maps.ts"), "utf8");
  const target = /TARGET_FONTS = new Set\(\s*"([^"]+)"/.exec(maps)[1].split(", ");
  const old = [...maps.matchAll(/^\s+"?([A-Z][A-Za-z ]+?)"?: \{ to:/gm)].map((m) => m[1]);
  const want = new Set([...target, ...old, "Inter"].map((f) => f.toLowerCase().replace(/ /g, "")));
  const faces = {};
  for (const name of readdirSync(STOCK).sort()) {
    const m = /^(.+)-(\d+)\.ttf\.gz$/.exec(name);
    if (!m) continue;
    const key = m[1].toLowerCase().replace(/ /g, "");
    if (!want.has(key)) continue;
    const buf = gunzipSync(readFileSync(path.join(STOCK, name)));
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const map = font.tables.cmap.glyphIndexMap;
    const cps = Object.keys(map).map(Number).filter((cp) => map[cp] !== 0).sort((a, b) => a - b);
    // Runs of consecutive code points: [first, advance, advance, ...] in font units.
    const runs = [];
    for (const cp of cps) {
      const adv = font.glyphs.get(map[cp]).advanceWidth;
      if (adv == null) continue;
      const last = runs[runs.length - 1];
      if (last && last[0] + last.length - 1 === cp) last.push(adv);
      else runs.push([cp, adv]);
    }
    (faces[key] ??= []).push({ file: name, weight: +m[2], upm: font.unitsPerEm, runs });
  }
  writeFileSync(path.join(WORK, "font-metrics.json"), JSON.stringify({ faces }));
  console.log(`font metrics: ${Object.keys(faces).length} families, ${Object.values(faces).flat().length} faces`);
}

/* ------------------------------------------------------------------ bundling */

const append = readFileSync(path.join(here, "catalog-append.ts"), "utf8");
const legacyPlugin = (engine) => ({
  name: "legacy-library",
  setup(b) {
    // The old catalogue module, with the recipe builder appended inside it.
    b.onLoad({ filter: /[\\/]lib[\\/]design[\\/]gen[\\/]catalog\.ts$/ }, (a) => ({ contents: readFileSync(a.path, "utf8") + "\n" + append, loader: "ts", resolveDir: path.dirname(a.path) }));
    // The converter measures text with a table, not by reading font files.
    b.onResolve({ filter: /^\.\/metrics$/ }, (a) => (a.importer.startsWith(path.join(PORT, "src")) ? { path: path.join(here, "metrics-shim.ts") } : undefined));
    b.onResolve({ filter: /^\.\/font-metrics\.json$/ }, () => ({ path: path.join(WORK, "font-metrics.json") }));
    // Listing-only data the engine never reads (it builds one known listing).
    if (engine) b.onLoad({ filter: /[\\/]gen[\\/]skip\.json$/ }, () => ({ contents: "[]", loader: "json" }));
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export {}", loader: "js" }));
  },
});
const common = {
  bundle: true,
  tsconfig: path.join(SITE, "tsconfig.json"),
  nodePaths: [path.join(SITE, "node_modules"), path.join(ROOT, "node_modules")],
  legalComments: "none",
  logLevel: "warning",
};

if (!engineOnly) {
  const exporter = path.join(WORK, "export.cjs");
  await build({ ...common, entryPoints: [path.join(here, "export-entry.ts")], outfile: exporter, platform: "node", format: "cjs", plugins: [legacyPlugin(false)] });
  const json = path.join(WORK, "catalog.json");
  execFileSync(process.execPath, ["--max-old-space-size=8192", exporter, json, path.join(PORT, "manifest.json"), SITE, ...(sample ? [sample] : [])], { stdio: "inherit" });
  const gz = gzipSync(readFileSync(json), { level: 9 });
  writeFileSync(path.join(OUT, "catalog.json.gz"), gz);
  console.log(`catalog.json.gz: ${(gz.length / 1024).toFixed(0)} KB (${(statSync(json).size / 1048576).toFixed(1)} MB raw)`);
}

await build({
  ...common,
  entryPoints: [path.join(here, "engine-entry.ts")],
  outfile: path.join(OUT, "engine.js"),
  platform: "neutral",
  format: "iife",
  // goja parses ES2017-ish syntax (the composer bundle uses the same target).
  target: "es2016",
  minify: true,
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  plugins: [legacyPlugin(true)],
  banner: { js: "// GENERATED by scripts/aidir3/legacy/build.mjs from the old aidir3 Design library and the template port - do not edit by hand." },
});
console.log(`engine.js: ${(statSync(path.join(OUT, "engine.js")).size / 1024).toFixed(0)} KB`);
