// Client-side route guard. Bootstraps the session on first mount and
// redirects to /login when anonymous. Compatible with static export: all auth
// resolution happens in the browser.

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/store/auth";
import { FullScreenLoader } from "@/components/ui/BrandLoader";
import { aidir3SsoConfig, aidir3SsoUrl } from "@/lib/aidir3";

export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    if (status === "loading") void bootstrap();
  }, [status, bootstrap]);

  useEffect(() => {
    if (status !== "anon") return;
    // Carry the current location as a return path so a deep link (e.g.
    // /dashboard/templates) survives the login round-trip. AuthForm validates
    // `next` as a same-origin relative path before honoring it.
    const path = router.asPath;
    const next = path && path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
    // aidir3 fork: when single sign-on from aidir3.com is configured, go
    // straight to the site (it signs the visitor in and returns them here)
    // instead of showing a second sign-in page. A failed hand-off lands on
    // /login?error=sso, which is not behind this guard, so there is no loop.
    let cancelled = false;
    void aidir3SsoConfig().then((cfg) => {
      if (cancelled) return;
      const sso = aidir3SsoUrl(cfg, path && path !== "/" ? path : null);
      if (sso) window.location.assign(sso);
      else void router.replace(`/login${next}`);
    });
    return () => {
      cancelled = true;
    };
  }, [status, router]);

  if (status !== "authed") {
    return <FullScreenLoader />;
  }
  return <>{children}</>;
}
