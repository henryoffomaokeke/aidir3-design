// Print session cookies for a local test user, for driving the app from a
// script or a headless browser when sign-in goes through aidir3.com.
//
//   node scripts/aidir3/dev-session.mjs [--json] [--sub=dev-tester] [--email=dev-tester@example.com]
//
// It signs in the way the site does: a short-lived token signed with the
// shared secret (AIDIR3_SSO_SECRET, or the one in the fork's .env), redeemed
// at /api/v1/auth/sso/aidir3 on the running instance (A3_PREVIEW_URL, default
// http://localhost:8005). Local development only: it needs the secret.

import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const BASE = (process.env.A3_PREVIEW_URL || "http://localhost:8005").replace(/\/$/, "");

function secret() {
  if (process.env.AIDIR3_SSO_SECRET) return process.env.AIDIR3_SSO_SECRET.trim();
  const m = /^AIDIR3_SSO_SECRET="?([^"\r\n]+)"?/m.exec(readFileSync(join(ROOT, ".env"), "utf8"));
  return m ? m[1].trim() : "";
}

const key = secret();
if (key.length < 32) { console.error("AIDIR3_SSO_SECRET not found (env or .env)"); process.exit(1); }
const now = Math.floor(Date.now() / 1000);
const claims = {
  sub: flags.sub || "dev-tester", email: flags.email || "dev-tester@example.com", email_verified: true,
  name: flags.name || "Dev Tester", aud: "aidir3-design", iat: now, exp: now + 60, jti: randomUUID(),
};
const head = `v1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
const token = `${head}.${createHmac("sha256", key).update(head).digest("base64url")}`;
const res = await fetch(`${BASE}/api/v1/auth/sso/aidir3?token=${encodeURIComponent(token)}`, { redirect: "manual" });
const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1) }));
if (!cookies.some((c) => c.name === "hc_access")) { console.error("sign-in failed:", res.status, res.headers.get("location")); process.exit(1); }

if (flags.json) {
  // Shape accepted by CDP Network.setCookie; cookies are host-only for localhost.
  console.log(JSON.stringify(cookies.map((c) => ({ ...c, domain: "localhost", path: "/", httpOnly: true }))));
} else {
  console.log(cookies.map((c) => `${c.name}=${c.value}`).join("; "));
}
