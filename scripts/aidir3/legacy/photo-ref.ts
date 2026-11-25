/**
 * Pictures of the old library as template pictures of this one. The old site served its picked
 * Openverse photos from /api/design/image?id=<openverse id> and its cut-out people from
 * /design/cutouts/...; here both are served by GET /api/v1/templates/photos/... (the backend reads
 * an embedded copy when one ships, else fetches the photo from Openverse once and keeps it under the
 * data dir). Only cc0, public-domain and CC BY pictures are used; anything else stays an empty slot.
 */
import type { ImageEl } from "@/lib/design/types";
import type { PhotoRef } from "../../../../aidir3-design-candidates/port/src/convert";

const licenseOf = (label: string | undefined): PhotoRef["license"] | null => {
  const l = (label ?? "").trim();
  if (/^cc0\b/i.test(l)) return "cc0";
  if (/^(public domain|pdm)\b/i.test(l)) return "pdm";
  if (/^cc by \d/i.test(l) || /^cc by$/i.test(l)) return "by";
  return null;
};

export function photoRef(el: ImageEl): PhotoRef | null {
  const credit = el.credit;
  const license = licenseOf(credit?.license);
  if (!license) return null;
  const c = credit ? { ...(credit.title ? { title: credit.title } : {}), ...(credit.author ? { author: credit.author } : {}), ...(credit.url ? { url: credit.url } : {}), licenseLabel: credit.license } : undefined;
  const ov = /^\/api\/design\/image\?id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(el.src);
  if (ov) return { asset: `tplph-ov-${ov[1]}`, url: `/api/v1/templates/photos/ov/${ov[1]}.jpg`, mime: "image/jpeg", license, credit: c, name: credit?.title ? `Photo: ${credit.title}` : "Photo" };
  const cut = /^\/design\/cutouts\/((?:faces\/)?[0-9a-f-]{36}(?:-o)?)\.webp$/.exec(el.src);
  if (cut) return { asset: `tplph-cut-${cut[1].replace("/", "-")}`, url: `/api/v1/templates/photos/cutouts/${cut[1]}.webp`, mime: "image/webp", license, credit: c, fit: "contain", name: "Cut-out person" };
  return null;
}
