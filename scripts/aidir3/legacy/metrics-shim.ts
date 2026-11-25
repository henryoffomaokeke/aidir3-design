/**
 * Stand-in for the port converter's metrics.ts inside the legacy engine bundle. The converter
 * measures text with the advance widths of the fonts the renderer ships
 * (backend/internal/render/stockfonts); under goja there is no file system and no font parser, so
 * build.mjs reads those widths once (opentype.js, the same reader metrics.ts uses) into
 * font-metrics.json and this module answers from the table. Same face choice, same fallbacks and
 * the same greedy wrap rule as metrics.ts, so a listing converts to the same spec either way.
 */
import TABLE from "./font-metrics.json";

type FaceRow = { file: string; weight: number; upm: number; runs: number[][] };
const table = TABLE as unknown as { faces: Record<string, FaceRow[]> };
type Face = { upm: number; adv: Map<number, number> };

const norm = (f: string) => f.toLowerCase().replace(/ /g, "");
export const stockWeights = (family: string) => (table.faces[norm(family)] ?? []).map((f) => f.weight).sort((a, b) => a - b);
export const hasStock = (family: string) => !!table.faces[norm(family)];

const faces = new Map<string, Face>();
function face(family: string, weight: number): Face | null {
  const list = table.faces[norm(family)];
  if (!list) return family === "Liberation Sans" ? null : face("Inter", weight);
  const best = [...list].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight) || a.weight - b.weight)[0];
  let f = faces.get(best.file);
  if (!f) {
    const adv = new Map<number, number>();
    for (const run of best.runs) for (let i = 1; i < run.length; i++) adv.set(run[0] + i - 1, run[i] / best.upm);
    faces.set(best.file, (f = { upm: best.upm, adv }));
  }
  return f;
}

function advance(f: Face, cp: number): number {
  const a = f.adv.get(cp);
  // A rune the face lacks falls back to another font in the renderer: assume a wide-ish glyph.
  return a !== undefined ? a : cp === 0x20 ? 0.28 : 0.62;
}

export const covers = (family: string, weight: number, ch: string) => {
  const f = face(family, weight);
  return !!f && f.adv.has(ch.codePointAt(0)!);
};

export function textWidth(text: string, family: string, weight: number, size: number, ls = 0): number {
  const f = face(family, weight);
  let w = 0;
  for (const ch of text) w += (f ? advance(f, ch.codePointAt(0)!) : 0.56) * size + ls;
  return w;
}

export type Run = { text: string; family: string; weight: number; size: number; ls: number };
export function wrapRuns(runs: Run[], width: number): number[] {
  const lines: number[] = [];
  let cur = 0;
  for (const r of runs) {
    for (const chunk of r.text.match(/\s+|\S+/g) ?? []) {
      const ws = /^\s/.test(chunk);
      const w = textWidth(ws ? chunk.replace(/\s/g, " ") : chunk, r.family, r.weight, r.size, r.ls);
      if (cur > 0 && cur + w > width && !ws) {
        lines.push(cur);
        cur = 0;
      }
      cur += w;
    }
  }
  lines.push(cur);
  return lines;
}

export function wrapText(text: string, family: string, weight: number, size: number, ls: number, width: number): number[] {
  return text.split("\n").flatMap((p) => wrapRuns([{ text: p, family, weight, size, ls }], width));
}

export function widestWord(text: string, family: string, weight: number, size: number, ls: number): number {
  let m = 0;
  for (const w of text.split(/\s+/)) if (w) m = Math.max(m, textWidth(w, family, weight, size, ls));
  return m;
}

export function vmetrics(_family: string, _weight: number) {
  return { asc: 0.95, desc: 0.25, cap: 0.7 };
}
