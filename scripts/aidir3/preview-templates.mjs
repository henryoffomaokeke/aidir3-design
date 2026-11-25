// Render candidate template specs to PNG for review, using the real server
// renderer (real fonts, real text layout), without touching the built-in seed
// and without restarting the backend.
//
//   node scripts/aidir3/preview-templates.mjs <specDir> <outDir> [--only=id1,id2] [--long=1100]
//
// It compiles <specDir>/*.json with scripts/build-templates.mjs into a scratch
// seed, uploads each compiled design to a running instance as a temporary
// design, downloads /designs/{id}/render.png for every page, and deletes the
// design again. It also writes <outDir>/_sheet-N.png contact sheets.
//
// Needs a running instance (A3_PREVIEW_URL, default http://localhost:8005). It
// signs in with A3_PREVIEW_EMAIL + A3_PREVIEW_PASSWORD where the instance has
// password sign-in, otherwise through the aidir3 hand-off using the shared
// secret (AIDIR3_SSO_SECRET, or the one in the fork's .env).
//
// A template is not ready until its PNG has been looked at: the compiler only
// proves the JSON is valid and inside the page, not that the design is good.

import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const [specDir, outDir] = args.filter((a) => !a.startsWith("--")).map((p) => resolve(p));
if (!specDir || !outDir) { console.error("usage: preview-templates.mjs <specDir> <outDir> [--only=a,b] [--long=1100]"); process.exit(2); }

const BASE = (process.env.A3_PREVIEW_URL || "http://localhost:8005").replace(/\/$/, "");
const EMAIL = process.env.A3_PREVIEW_EMAIL, PASSWORD = process.env.A3_PREVIEW_PASSWORD;
// Where the instance has no password sign-in (the aidir3 setup), the tool
// signs in the way the site does: a short-lived token signed with the shared
// secret, read from AIDIR3_SSO_SECRET or the fork's .env.
function ssoSecret() {
  if (process.env.AIDIR3_SSO_SECRET) return process.env.AIDIR3_SSO_SECRET.trim();
  try {
    const m = /^AIDIR3_SSO_SECRET="?([^"\r\n]+)"?/m.exec(readFileSync(join(ROOT, ".env"), "utf8"));
    return m ? m[1].trim() : "";
  } catch { return ""; }
}
const LONG = Number(flags.long || 1100);
const only = flags.only ? new Set(flags.only.split(",")) : null;

// 1. compile to a scratch seed (fails here on any schema or bounds error).
const seed = join(tmpdir(), `a3-preview-seed-${process.pid}.json`);
try {
  execFileSync(process.execPath, [join(ROOT, "scripts", "build-templates.mjs")], {
    env: { ...process.env, TEMPLATE_SPECS: specDir, TEMPLATE_SEED: seed }, stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  console.error(String(e.stdout || "") + String(e.stderr || ""));
  process.exit(1);
}
const entries = JSON.parse(readFileSync(seed, "utf8")).filter((e) => !only || only.has(e.template.id));
rmSync(seed, { force: true });

// 2. sign in (cookies kept by hand; Node's fetch has no jar).
let cookie = "";
async function api(path, init = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  return res;
}
let signedIn = false;
if (EMAIL && PASSWORD) {
  const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  signedIn = login.ok;
}
if (!signedIn) {
  const secret = ssoSecret();
  if (secret.length < 32) { console.error("cannot sign in: password sign-in failed or is off, and no AIDIR3_SSO_SECRET was found"); process.exit(1); }
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: "template-preview-tool", email: "template-preview@example.com", email_verified: true, name: "Template preview", aud: "aidir3-design", iat: now, exp: now + 60, jti: randomUUID() };
  const head = `v1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
  const token = `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
  const res = await api(`/auth/sso/aidir3?token=${encodeURIComponent(token)}`, { redirect: "manual" });
  if (!cookie.includes("hc_access=")) { console.error("sign-in through the hand-off failed:", res.status, res.headers.get("location")); process.exit(1); }
}
const workspaces = await (await api("/workspaces")).json();
const wsId = (Array.isArray(workspaces) ? workspaces : workspaces.workspaces ?? workspaces.items)[0].id;

// 3. render every page of every template.
mkdirSync(outDir, { recursive: true });
const sharp = createRequire(join(ROOT, "frontend", "package.json"))("sharp");
const shots = [];
for (const { template, file } of entries) {
  const made = await api("/designs", { method: "POST", body: JSON.stringify({ workspaceId: wsId, title: `preview ${template.id}`, from: file }) });
  if (!made.ok) { console.error(`${template.id}: create failed ${made.status} ${(await made.text()).slice(0, 300)}`); continue; }
  const { id } = await made.json();
  const scale = Math.min(1, LONG / Math.max(template.format.width, template.format.height));
  for (let page = 0; page < file.pages.length; page++) {
    const png = await api(`/designs/${id}/render.png?page=${page}&scale=${scale.toFixed(3)}`);
    if (!png.ok) { console.error(`${template.id} p${page}: render failed ${png.status}`); continue; }
    const out = join(outDir, file.pages.length > 1 ? `${template.id}-p${page + 1}.png` : `${template.id}.png`);
    writeFileSync(out, Buffer.from(await png.arrayBuffer()));
    shots.push({ out, label: file.pages.length > 1 ? `${template.id} p${page + 1}` : template.id });
  }
  await api(`/designs/${id}?purge=true`, { method: "DELETE" });
  console.log(`rendered ${template.id} (${file.pages.length} page${file.pages.length > 1 ? "s" : ""}, ${template.format.width}x${template.format.height})`);
}

// 4. contact sheets: 3 x 2 cells, each design fitted with its id underneath.
const CW = 520, CH = 520, PAD = 16, COLS = 3, ROWS = 2;
for (let s = 0; s * COLS * ROWS < shots.length; s++) {
  const group = shots.slice(s * COLS * ROWS, (s + 1) * COLS * ROWS);
  const layers = [];
  for (let i = 0; i < group.length; i++) {
    const x = PAD + (i % COLS) * (CW + PAD), y = PAD + Math.floor(i / COLS) * (CH + 40 + PAD);
    const img = await sharp(group[i].out).resize(CW, CH, { fit: "inside", background: "#1b1d22" }).png().toBuffer();
    const meta = await sharp(img).metadata();
    layers.push({ input: img, left: x + Math.round((CW - meta.width) / 2), top: y + Math.round((CH - meta.height) / 2) });
    const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="32"><text x="0" y="22" font-family="Arial, sans-serif" font-size="18" fill="#edeef0">${group[i].label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text></svg>`;
    layers.push({ input: Buffer.from(label), left: x, top: y + CH + 6 });
  }
  const W = PAD + COLS * (CW + PAD), H = PAD + ROWS * (CH + 40 + PAD);
  const sheet = join(outDir, `_sheet-${s + 1}.png`);
  await sharp({ create: { width: W, height: H, channels: 3, background: "#1b1d22" } }).composite(layers).png().toFile(sheet);
  console.log("sheet", sheet);
}
console.log(`done: ${shots.length} page(s) from ${entries.length} template(s) -> ${outDir}`);
