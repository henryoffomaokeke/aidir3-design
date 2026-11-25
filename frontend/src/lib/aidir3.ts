// aidir3 fork: single sign-on from aidir3.com.
//
// The studio sits behind aidir3.com, which owns the accounts. When the server
// has the hand-off configured (AIDIR3_SSO_SECRET + AIDIR3_SITE_URL), a
// signed-out visitor is sent to the site, which signs them in and returns
// them here with a session. When it is not configured (local development, a
// plain self-hosted copy) everything behaves as upstream: the built-in
// sign-in page.

const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8005/api";

export interface Aidir3SsoConfig {
  enabled: boolean;
  /** Where the hand-off starts on the site. */
  startUrl?: string;
  /** The site's origin, for "back to aidir3" links. */
  siteUrl?: string;
  /** The profile page on the site, which owns the account. */
  profileUrl?: string;
}

const OFF: Aidir3SsoConfig = { enabled: false };
let cached: Promise<Aidir3SsoConfig> | null = null;

/** The server's SSO settings, fetched once per page load. Never rejects: any
 *  failure reads as "not configured", so sign-in falls back to the local page. */
export function aidir3SsoConfig(): Promise<Aidir3SsoConfig> {
  cached ??= fetch(`${baseUrl}/v1/auth/sso/aidir3/config`, { credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<Aidir3SsoConfig>) : OFF))
    .then((c) => (c && c.enabled && typeof c.startUrl === "string" && /^https?:\/\//.test(c.startUrl) ? c : OFF))
    .catch(() => OFF);
  return cached;
}

export interface Aidir3About {
  name?: string;
  license?: string;
  /** Public location of this fork's source code; empty when not configured. */
  sourceUrl?: string;
}

let about: Promise<Aidir3About> | null = null;

/** What the app says about itself. The AGPL (section 13) requires a modified
 *  version used over a network to offer its users the source, so the interface
 *  shows a "Source code" link whenever the server names one. Never rejects. */
export function aidir3About(): Promise<Aidir3About> {
  about ??= fetch(`${baseUrl}/v1/aidir3/about`, { credentials: "omit" })
    .then((r): Promise<Aidir3About> | Aidir3About => (r.ok ? (r.json() as Promise<Aidir3About>) : {}))
    .then((a): Aidir3About => (a && typeof a.sourceUrl === "string" && /^https?:\/\//.test(a.sourceUrl) ? a : { ...a, sourceUrl: "" }))
    .catch((): Aidir3About => ({}));
  return about;
}

/** The URL that starts the hand-off, carrying a local return path. `next` is
 *  only ever a path inside this app; the server validates it again. */
export function aidir3SsoUrl(cfg: Aidir3SsoConfig, next?: string | null): string | null {
  if (!cfg.enabled || !cfg.startUrl) return null;
  const local = next && next.startsWith("/") && !next.startsWith("//") ? next : "";
  return local ? `${cfg.startUrl}?next=${encodeURIComponent(local)}` : cfg.startUrl;
}

/** The main aidir3 website: the configured site when sign-in goes through it, else aidir3.com. */
export const AIDIR3_HOME_FALLBACK = "https://aidir3.com";
export async function aidir3HomeUrl(): Promise<string> {
  const cfg = await aidir3SsoConfig();
  return cfg.enabled && cfg.siteUrl ? cfg.siteUrl : AIDIR3_HOME_FALLBACK;
}
