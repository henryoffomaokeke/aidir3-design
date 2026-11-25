// aidir3 logo: the "A3" mark used on aidir3.com (ember tile, ink lettering)
// and the wordmark with the 3 in the accent. This app is derived from
// HyCanvas, whose trademark policy requires a modified version to carry its
// own name and logo. The export names are unchanged so call sites stay as
// they are upstream. Static copies for non-React surfaces live in
// /public/brand and are rendered by scripts/aidir3/build-icons.mjs.

import { cn } from "@/lib/cn";
import { tr } from "@/lib/i18n";

// Lettering color on the ember tile. Part of the logo asset itself.
const INK = "#0B0C0E";

/** The bare A3 lettering, in currentColor. viewBox is 64x64 with the tile's
 *  own padding, so it is drawn at the tile's full size. */
export function VisitorMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M9 47L21 15h8l12 32h-7.4l-2.2-6.6H18.6L16.4 47H9zm11.3-12.4h9.4L25 21.6l-4.7 13z"
      />
      <path
        stroke="currentColor"
        strokeWidth="5.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M41 19h9.5c3.7 0 6 2 6 5.1s-2.6 5.4-6.3 5.4H44m0 0h7c3.9 0 6.5 2.3 6.5 5.7S54.9 41 50.5 41H41"
      />
    </svg>
  );
}

export function LogoMark({ size = 32, variant = "gradient" }: { size?: number; variant?: "gradient" | "light" }) {
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center", variant === "gradient" ? "bg-brand-600" : "bg-white/20")}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.2), color: variant === "gradient" ? INK : "#ffffff" }}
    >
      <VisitorMark size={size} />
    </span>
  );
}

/** "aidir3 Design": the 3 carries the accent, the product word sits quieter. */
function Wordmark({ light }: { light: boolean }) {
  const name = tr("ui.hycanvas");
  const m = /^(aidir)(3)(.*)$/.exec(name);
  const base = light ? "text-white" : "text-neutral-900";
  if (!m) return <span className={base}>{name}</span>;
  return (
    <span className={base}>
      {m[1]}
      <span className={light ? "text-brand-400" : "text-brand-ink"}>{m[2]}</span>
      {m[3] ? <span className={cn("font-semibold", light ? "text-white/70" : "text-neutral-500")}>{m[3]}</span> : null}
    </span>
  );
}

export function Logo({
  size = 32,
  variant = "gradient",
  className,
}: {
  size?: number;
  variant?: "gradient" | "light";
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-2.5 text-lg font-extrabold tracking-tight", className)}>
      <LogoMark size={size} variant={variant} />
      <Wordmark light={variant === "light"} />
    </span>
  );
}
