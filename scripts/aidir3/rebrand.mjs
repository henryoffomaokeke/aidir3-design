// aidir3 Design rebrand: replaces the upstream product name in every place a
// user can read it. HyCanvas's trademark policy (TRADEMARKS.md) requires a
// modified version to carry its own name and logo; the copyright and licence
// notices (LICENSE, NOTICE, file headers) stay exactly as they are.
//
//   node scripts/aidir3/rebrand.mjs          # apply
//   node scripts/aidir3/rebrand.mjs --check  # report only, exit 1 if anything is left
//
// The script is idempotent, so it can be run again after merging a new
// upstream release: anything upstream re-introduced is replaced, and a rule
// that no longer matches is reported so it can be updated.
//
// NOT renamed on purpose (file-format and protocol identifiers; changing them
// would stop this fork opening upstream files or upgrading cleanly): the
// "hycanvas.design" format id, the .hyc extension, the Go module path, the
// @hc/* package scopes, cookie names, the hyk_ API-key prefix, env var names.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = process.argv.includes("--check");
const NAME = "aidir3 Design";
const HOME = "https://aidir3.com";
const APP_HOST = "design.aidir3.com";

let changedFiles = 0;
const problems = [];

function edit(rel, fn) {
  const file = join(ROOT, rel);
  if (!existsSync(file)) { problems.push(`${rel}: file not found`); return; }
  const before = readFileSync(file, "utf8");
  const after = fn(before, rel);
  if (after !== before) {
    changedFiles++;
    if (!CHECK) writeFileSync(file, after);
    else problems.push(`${rel}: not rebranded yet`);
  }
}

// --- 1. locale catalogues --------------------------------------------------
// Flat JSON, one "key": "value" per line. Only VALUES change; key names stay
// (the code looks strings up by key, and some keys contain the old name).

const LOCALE_OVERRIDES = {
  "auth.2026_hyscaler_hycanvas_is_a_hyscaler_product": "© 2026 aidir3. Built on the open-source HyCanvas project, AGPL-3.0.",
  "ui.hycanvas": NAME,
  "page.hycanvas": `${NAME}…`,
  "page.hycanvas_2": NAME,
  "page.hycanvas_editor": `${NAME} editor`,
  "installation.hycanvas_2": NAME,
  // Upstream promises "100% free ... No tiers, no limits". aidir3 has paid
  // plans, so the sign-in page says only what is true of this product.
  "auth.100_free_open_source_no_watermarks": "Open source · no watermarks",
  "auth.templates_photos_video_docs_whiteboards_and": "Templates, photos, video, docs, whiteboards and AI in one design studio.",
  // The owner does not want the phrase "magic link" anywhere. The feature is
  // off by default in this fork (config.go); if an operator turns it on, it
  // is called what it is.
  "auth.sign_in_with_a_magic_link": "Sign in with an email link",
  "auth.sign_up_with_a_magic_link": "Sign up with an email link",
};
// English only: the generic swap reads badly next to the word "design".
const EN_OVERRIDES = {
  "errors.hyc_invalid_design": "This file is not a valid design file ({detail}).",
  "errors.hyc_missing_fields": "This file is not a design file (missing pages or schema version).",
  "errors.hyc_newer_version": `This file was made by a newer version of ${NAME}. Update this instance to open it.`,
  "errors.hyc_not_design_file": "This file is not a design file.",
  "errors.hyc_not_json": "This file is not a design file (not valid JSON).",
};
// Values that are technical examples, not the product name.
const LOCALE_KEEP = new Set(["installation.hycanvas", "installation.postgresql_user_password_host_5432_hycanvas"]);

const LINE = /^(\s*)"((?:[^"\\]|\\.)+)"(\s*:\s*)"((?:[^"\\]|\\.)*)"(,?\s*)$/;

function rebrandLocale(text, rel) {
  const english = /[\\/]en(-gb)?\.json$/.test(rel);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return text.split(/\r?\n/).map((line) => {
    const m = LINE.exec(line);
    if (!m) return line;
    const [, indent, key, sep, rawValue, tail] = m;
    if (LOCALE_KEEP.has(key)) return line;
    let value = JSON.parse(`"${rawValue}"`);
    if (key in LOCALE_OVERRIDES) value = LOCALE_OVERRIDES[key];
    else if (english && key in EN_OVERRIDES) value = EN_OVERRIDES[key];
    else if (/HyCanvas|HyScaler/.test(value) || /magic links?/i.test(value)) {
      value = value.replace(/HyCanvas/g, NAME).replace(/HyScaler®?/g, "aidir3");
      // "magic link" is not a phrase this product uses (owner's instruction).
      value = value.replace(/magic links/gi, "sign-in links").replace(/magic link/gi, "sign-in link");
    } else return line;
    return `${indent}"${key}"${sep}${JSON.stringify(value)}${tail}`;
  }).join(eol);
}

const localeFiles = [
  "frontend/src/locales/en.json",
  ...readdirSync(join(ROOT, "frontend/public/locales")).filter((f) => f.endsWith(".json")).map((f) => `frontend/public/locales/${f}`),
];
for (const rel of localeFiles) edit(rel, rebrandLocale);

// --- 2. literal strings in source ------------------------------------------
// [file, [[from, to], ...]]. A rule must either match or already be applied.

const UA = "design-studio/1.0 (self-hosted)";
const RULES = [
  ["frontend/src/components/editor/ShareDialog.tsx", [[`|| "HyCanvas")`, `|| "${NAME}")`]]],
  ["frontend/src/components/editor/WebsiteDialog.tsx", [
    [`hint=".hycanvas.site (hosting deferred)"`, `hint=".${APP_HOST} (hosting deferred)"`],
    [`>.hycanvas.site</span>`, `>.${APP_HOST}</span>`],
  ]],
  ["frontend/src/components/editor/PublishDialog.tsx", [[`"https://hycanvas.art"`, `"https://${APP_HOST}"`]]],
  ["frontend/src/components/installation/Step1Access.tsx", [[`"https://hycanvas.art"`, `"https://${APP_HOST}"`]]],
  ["frontend/src/components/installation/Step2Database.tsx", [[`subtitle="HyCanvas stores`, `subtitle="${NAME} stores`]]],
  ["frontend/src/components/installation/Step6Admin.tsx", [[`subtitle="HyCanvas is running.`, `subtitle="${NAME} is running.`]]],
  ["frontend/src/components/settings/SettingsApp.tsx", [["hycanvas-export-", "aidir3-design-export-"]]],
  ["frontend/src/store/editor.ts", [[`text: "HyCanvas", // i18n-ignore`, `text: "${NAME}", // i18n-ignore`]]],
  ["frontend/src/lib/hycFile.ts", [
    [`"This file is not a HyCanvas design file (not valid JSON)."`, `"This file is not a design file (not valid JSON)."`],
    [`"This file is not a HyCanvas design file."`, `"This file is not a design file."`],
    [`"This file is not a HyCanvas design file (missing pages or schema version)."`, `"This file is not a design file (missing pages or schema version)."`],
    [`a newer version of HyCanvas.`, `a newer version of ${NAME}.`],
    ["`This file is not a valid HyCanvas design (${result.message}).`", "`This file is not a valid design file (${result.message}).`"],
  ]],
  ["frontend/public/sw.js", [[`payload.title || "HyCanvas"`, `payload.title || "${NAME}"`]]],
  ["frontend/src/pages/dashboard/[[...view]].tsx", [["} · HyCanvas`}", `} · ${NAME}\`}`]]],
  ["frontend/src/pages/new.tsx", [["} · HyCanvas`}", `} · ${NAME}\`}`]]],
  ["frontend/src/pages/settings/[[...tab]].tsx", [["} · HyCanvas`}", `} · ${NAME}\`}`]]],
  ["frontend/src/pages/shared.tsx", [["{designTitle} · HyCanvas<", `{designTitle} · ${NAME}<`]]],
  ["packages/shortcuts/src/index.ts", [[`name: "HyCanvas default"`, `name: "${NAME} default"`]]],
  ["packages/export/src/pptx.ts", [
    [`name="HyCanvas"><a:themeElements>`, `name="${NAME}"><a:themeElements>`],
    [`<a:clrScheme name="HyCanvas">`, `<a:clrScheme name="${NAME}">`],
    [`<a:fontScheme name="HyCanvas">`, `<a:fontScheme name="${NAME}">`],
    [`<dc:creator>HyCanvas</dc:creator>`, `<dc:creator>${NAME}</dc:creator>`],
    [`<Application>HyCanvas</Application>`, `<Application>${NAME}</Application>`],
  ]],
  ["packages/website/src/render.ts", [["`https://${site.slug}.hycanvas.site`", "`https://${site.slug}." + APP_HOST + "`"]]],
  ["packages/config/src/index.ts", [[`"HyCanvas <no-reply@localhost>"`, `"${NAME} <no-reply@localhost>"`]]],
  ["backend/internal/accounts/email.go", [
    [`"Reset your HyCanvas password"`, `"Reset your ${NAME} password"`],
    [`"Your HyCanvas sign-in link"`, `"Your ${NAME} sign-in link"`],
    [`"Verify your HyCanvas email"`, `"Verify your ${NAME} email"`],
  ]],
  ["backend/internal/accounts/smtp.go", [[`fromName = "HyCanvas"`, `fromName = "${NAME}"`]]],
  ["backend/internal/accounts/mfa.go", [[`mfaIssuer       = "HyCanvas"`, `mfaIssuer       = "${NAME}"`]]],
  ["backend/internal/engagement/emitter.go", [[`title := "HyCanvas"`, `title := "${NAME}"`]]],
  ["backend/internal/httpapi/static.go", [
    ["<title>HyCanvas (API only)</title>", `<title>${NAME} (API only)</title>`],
    ["<h1>HyCanvas (API only)</h1>", `<h1>${NAME} (API only)</h1>`],
  ]],
  ["backend/internal/httpapi/apidocs.go", [
    ["<title>HyCanvas Generation API</title>", `<title>${NAME} Generation API</title>`],
    ["<h1>HyCanvas Generation API</h1>", `<h1>${NAME} Generation API</h1>`],
  ]],
  ["backend/internal/httpapi/mcp.go", [[`"HyCanvas generation tools.`, `"${NAME} generation tools.`]]],
  ["backend/internal/httpapi/account.go", [["hycanvas-account.json", "aidir3-design-account.json"]]],
  ["backend/internal/stock/openverse.go", [["HyCanvas/1.0 (self-hosted; https://github.com/hyscaler/hycanvas)", UA]]],
  ["backend/internal/stock/iconify.go", [["HyCanvas/1.0 (self-hosted; https://github.com/hyscaler/hycanvas)", UA]]],
  ["backend/internal/httpapi/brandfromurl.go", [["HyCanvas-Brand/1.0 (+brand kit draft)", "design-studio-brand/1.0 (+brand kit draft)"]]],
  ["backend/internal/httpapi/extracturl.go", [
    ["HyCanvas-Data/1.0 (+live chart binding)", "design-studio-data/1.0 (+live chart binding)"],
    ["HyCanvas-Ingest/1.0 (+deck import)", "design-studio-ingest/1.0 (+deck import)"],
  ]],
  ["frontend/public/offline.html", [["<title>HyCanvas</title>", `<title>${NAME}</title>`]]],
];

for (const [rel, pairs] of RULES) {
  edit(rel, (text) => {
    let out = text;
    for (const [from, to] of pairs) {
      if (out.includes(from)) out = out.split(from).join(to);
      else if (!out.includes(to)) problems.push(`${rel}: rule no longer matches: ${from.slice(0, 60)}`);
    }
    return out;
  });
}

// Offline page: the body sentence is repeated per language inside the file.
edit("frontend/public/offline.html", (t) => t.replace(/HyCanvas/g, NAME));

// --- 3. web manifest --------------------------------------------------------

edit("frontend/public/manifest.webmanifest", (t) => {
  const m = JSON.parse(t);
  m.name = NAME;
  m.short_name = "aidir3";
  m.description = "Design studio for graphics, presentations, video, whiteboards and documents.";
  m.background_color = "#0A0B0D";
  m.theme_color = "#0A0B0D";
  const out = JSON.stringify(m, null, 2) + "\n";
  return JSON.stringify(JSON.parse(t)) === JSON.stringify(m) ? t : out;
});

// --- report -----------------------------------------------------------------

void HOME;
if (CHECK) {
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  console.log("rebrand: nothing left to do.");
} else {
  console.log(`rebrand: ${changedFiles} file(s) updated.`);
  if (problems.length) { console.error("Needs attention:\n" + problems.join("\n")); process.exit(1); }
}
