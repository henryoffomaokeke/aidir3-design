// aidir3 fork: one sign-in page for everything.
//
// When sign-in through aidir3.com is configured, this app has no sign-in or
// sign-up page of its own: /login and /signup hand the visitor to the aidir3
// login page, which returns them here already signed in to the same account.
// The local form (children) is only rendered when the hand-off is not
// configured (local development, a plain self-hosted copy), or to finish a
// second-factor challenge the server asked for.
//
// A hand-off that fails comes back as /login?error=..., and is shown here as a
// short message with a retry, never as an automatic redirect (which would
// loop).

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/router";
import { CanvasFloor } from "@/components/ui/CanvasFloor";
import { FullScreenLoader } from "@/components/ui/BrandLoader";
import { Logo } from "@/components/ui/Logo";
import { tr } from "@/lib/i18n";
import { aidir3SsoConfig, aidir3SsoUrl, type Aidir3SsoConfig } from "@/lib/aidir3";

function localNext(raw: unknown): string | null {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

export function Aidir3Gate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<Aidir3SsoConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    void aidir3SsoConfig().then((c) => {
      if (!cancelled) setCfg(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = !!cfg && router.isReady;
  const error = typeof router.query.error === "string" ? router.query.error : "";
  const mfa = typeof router.query.mfa === "string";
  const url = cfg ? aidir3SsoUrl(cfg, localNext(router.query.next)) : null;
  const handOff = ready && !!url && !error && !mfa;

  useEffect(() => {
    if (handOff && url) window.location.replace(url);
  }, [handOff, url]);

  if (!ready || handOff) return <FullScreenLoader />;
  // Not configured, or the server wants this account's second factor.
  if (!url || mfa) return <>{children}</>;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6 py-12">
      <CanvasFloor />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-neutral-950/70 p-8 text-center shadow-2xl backdrop-blur">
        <div className="flex justify-center">
          <Logo variant="light" />
        </div>
        <h1 className="mt-6 text-xl font-bold text-white">{tr("auth.aidir3_sign_in_failed_title")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-white/70">
          {error === "sso_exists" ? tr("auth.aidir3_sign_in_exists_body") : tr("auth.aidir3_sign_in_failed_body")}
        </p>
        <a
          href={url}
          className="oc-gradient mt-6 flex items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          {tr("auth.continue_with_provider", { provider: "aidir3" })}
        </a>
        {cfg?.siteUrl && (
          <a href={cfg.siteUrl} className="mt-4 inline-block text-sm text-white/60 underline hover:text-white">
            {tr("auth.aidir3_back_to_site")}
          </a>
        )}
      </div>
    </main>
  );
}
