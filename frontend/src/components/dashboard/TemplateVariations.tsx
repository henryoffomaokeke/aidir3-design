// Variations of the ported template library in the Templates gallery. The
// gallery's cards stay the distinct designs; each design that has variations
// (the same layout with other copy, formats and palettes, as the earlier
// library listed them) carries a count that opens them, and a search reaches
// every variation. The list is paged on the server and loads as it scrolls.

import { useCallback, useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";
import type { TemplateVariation, TemplateVariationFilter, TemplateVariationSummary } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { tr } from "@/lib/i18n";
import { DesignThumb } from "./DesignThumb";

const PAGE = 48;

/** The variation summary (total and count per base design), fetched once. */
let summaryCache: Promise<TemplateVariationSummary | null> | null = null;
export function useVariationSummary(): TemplateVariationSummary | null {
  const [s, setS] = useState<TemplateVariationSummary | null>(null);
  useEffect(() => {
    let alive = true;
    summaryCache ??= oc.templateVariationSummary().catch(() => {
      summaryCache = null;
      return null;
    });
    void summaryCache.then((v) => alive && setS(v));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

/** "N variations" on a design card: opens that design's variations. */
export function VariationCountButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={tr("dashboard.show_variations")}
      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-neutral-600 transition hover:border-brand-300 hover:text-brand-ink"
    >
      <Layers size={12} aria-hidden />
      {tr("dashboard.n_variations", { count, n: count.toLocaleString() })}
    </button>
  );
}

/**
 * A grid of variations matching `filter`, loading the next page as its end
 * scrolls into view. `onUse` opens one (applies it like any template).
 */
export function VariationGrid(props: { filter: TemplateVariationFilter; onUse: (id: string) => void; busy?: boolean; onTotal?: (n: number) => void }) {
  // A new filter starts a fresh list.
  return <Grid key={JSON.stringify(props.filter)} {...props} />;
}

function Grid({ filter, onUse, busy, onTotal }: { filter: TemplateVariationFilter; onUse: (id: string) => void; busy?: boolean; onTotal?: (n: number) => void }) {
  const [items, setItems] = useState<TemplateVariation[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const state = useRef({ offset: 0, loading: false, done: false });

  const more = useCallback(async () => {
    const st = state.current;
    if (st.loading || st.done) return;
    st.loading = true;
    setLoading(true);
    try {
      const page = await oc.listTemplateVariations({ ...filter, offset: st.offset, limit: PAGE });
      st.offset += page.items.length;
      st.done = page.items.length === 0 || st.offset >= page.total;
      setItems((prev) => [...prev, ...page.items]);
      setTotal(page.total);
      onTotal?.(page.total);
    } catch {
      setFailed(true);
      st.done = true;
    } finally {
      st.loading = false;
      setLoading(false);
    }
    // The grid is keyed by its filter, so the filter never changes under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The first page loads at once (the observer below may not fire for an
  // end marker that is already in view when the grid mounts).
  useEffect(() => {
    const t = setTimeout(() => void more(), 0);
    return () => clearTimeout(t);
  }, [more]);

  // Load the next page when the end of the grid comes near.
  useEffect(() => {
    const el = end.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void more(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, items.length]);

  if (failed && items.length === 0) return <p className="py-6 text-sm text-neutral-500">{tr("dashboard.could_not_load_variations")}</p>;
  if (total === 0) return <p className="py-6 text-sm text-neutral-500">{tr("dashboard.no_matching_variations")}</p>;
  return (
    <>
      <ul className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((v) => (
          <li key={v.id} className="rounded-2xl border border-neutral-200 bg-surface shadow-sm transition hover:shadow-md">
            <button type="button" onClick={() => onUse(v.id)} disabled={busy} title={tr("dashboard.use_this_template")} className="block w-full text-start disabled:opacity-60">
              <div className="relative aspect-[4/3] overflow-hidden rounded-t-2xl bg-neutral-100">
                <DesignThumb templateId={v.id} />
                <span className="absolute bottom-2 start-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white/90">{v.formatLabel}</span>
              </div>
              <div className="truncate px-3 pt-2.5 text-sm font-semibold text-neutral-800">{v.title}</div>
              <div className="truncate px-3 pb-2.5 text-xs text-neutral-500">
                {v.width} × {v.height}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div ref={end} className="h-px" />
      {loading && <p className="py-4 text-center text-sm text-neutral-500">{tr("dashboard.loading_more")}</p>}
      {!loading && !failed && (total === null || items.length < total) && (
        <div className="py-4 text-center">
          <button type="button" onClick={() => void more()} className="rounded-lg border border-neutral-200 bg-surface px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50">
            {tr("dashboard.load_more")}
          </button>
        </div>
      )}
    </>
  );
}
