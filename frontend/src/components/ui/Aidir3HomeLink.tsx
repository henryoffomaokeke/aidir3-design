// aidir3 fork: links from the studio back to the main aidir3 website.
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpLeft } from "lucide-react";
import { AIDIR3_HOME_FALLBACK, aidir3HomeUrl } from "@/lib/aidir3";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/cn";

function useHomeUrl(): string {
  const [url, setUrl] = useState(AIDIR3_HOME_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    void aidir3HomeUrl().then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return url;
}

/** Wraps the logo so clicking it goes to the main website. */
export function Aidir3HomeLogo({ children, className }: { children: ReactNode; className?: string }) {
  const url = useHomeUrl();
  return (
    <a href={url} title={tr("dashboard.aidir3_back_to_site")} aria-label={tr("dashboard.aidir3_back_to_site")} className={cn("rounded-lg focus-visible:ring-2 focus-visible:ring-brand-400", className)}>
      {children}
    </a>
  );
}

/** A sidebar row: "aidir3.com" with an arrow, in the same shape as the rail items. */
export function Aidir3HomeRailLink({ collapsed }: { collapsed: boolean }) {
  const url = useHomeUrl();
  const label = tr("dashboard.aidir3_back_to_site");
  return (
    <a
      href={url}
      title={label}
      aria-label={label}
      className={cn(
        "flex items-center rounded-xl font-medium text-neutral-600 hover:bg-neutral-100",
        collapsed ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2 text-start",
      )}
    >
      <ArrowUpLeft size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </a>
  );
}
