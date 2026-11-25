// aidir3 fork: YouTube creator helpers for the video editor.
//
// Pure, UI-free logic behind the YouTube panel (components/editor/
// YouTubePanel.tsx): the upload-format presets, the safe-zone and end-screen
// guides drawn on the preview's overlay canvas (never on the stage canvas the
// exporter records), chapters, and a sorted SRT for upload.
//
// Storage: chapters and the end-screen link live inside `doc.meta.video`, the
// free-form document metadata that already carries the whole timeline
// (`DesignFile.meta` is `Record<string, unknown>` in @hc/schema, so neither the
// schema validator nor the Go write boundary looks inside it). Both are
// optional additive keys next to `markers`/`range`, so older files simply omit
// them, an older client keeps them (project edits spread the object), and no
// schema version bump or migration is involved.

import type { VideoProject } from "@hc/timeline";
import { toSrt, type CaptionCue } from "./captions";

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

export type YtFormatId = "yt1080" | "yt4k" | "shorts" | "square";

/** Upload formats. Labels resolve at the render site. */
export const YT_FORMATS: readonly { id: YtFormatId; width: number; height: number }[] = [
  { id: "yt1080", width: 1920, height: 1080 },
  { id: "yt4k", width: 3840, height: 2160 },
  { id: "shorts", width: 1080, height: 1920 },
  { id: "square", width: 1080, height: 1080 },
];

export type YtAspect = "landscape" | "portrait" | "square";

export function ytAspect(w: number, h: number): YtAspect {
  const r = w / Math.max(1, h);
  if (r > 1.05) return "landscape";
  if (r < 0.95) return "portrait";
  return "square";
}

/** The format a stage size matches exactly, if any. */
export function ytFormatOf(w: number, h: number): YtFormatId | null {
  return YT_FORMATS.find((f) => f.width === w && f.height === h)?.id ?? null;
}

// ---------------------------------------------------------------------------
// safe zones (overlay canvas only)
// ---------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }

/** Shorts player chrome, as fractions of a 9:16 frame: the action rail (like,
 *  comment, share, remix) down the right edge, the channel/caption block along
 *  the bottom, and the search/menu bar at the top. Content placed inside these
 *  areas is covered on a phone. */
export function shortsZones(W: number, H: number): { rail: Rect; caption: Rect; top: Rect; safe: Rect } {
  const rail = { x: W * 0.83, y: H * 0.42, w: W * 0.17, h: H * 0.43 };
  const caption = { x: 0, y: H * 0.8, w: W * 0.83, h: H * 0.2 };
  const top = { x: 0, y: 0, w: W, h: H * 0.08 };
  const safe = { x: W * 0.06, y: H * 0.08, w: W * 0.77, h: H * 0.72 };
  return { rail, caption, top, safe };
}

/** Draw the platform safe zones for the stage shape. Landscape and square get
 *  action-safe (93%) and title-safe (90%) frames; portrait gets the Shorts UI
 *  zones. `labels` are already-translated captions for the zones. */
export function drawYtSafeZones(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  labels: { action: string; title: string; rail: string; caption: string; top: string },
): void {
  const lw = Math.max(2, Math.round(Math.min(W, H) / 540));
  const font = Math.max(16, Math.round(Math.min(W, H) * 0.034));
  ctx.save();
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const tag = (text: string, x0: number, y: number, color: string) => {
    const pad = font * 0.3;
    const w = ctx.measureText(text).width + pad * 2;
    const x = Math.max(0, Math.min(x0, W - w)); // keep the tag inside the frame
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y, w, font + pad * 2);
    ctx.fillStyle = color;
    ctx.fillText(text, x + pad, y + pad);
  };
  if (ytAspect(W, H) === "portrait") {
    const z = shortsZones(W, H);
    ctx.fillStyle = "rgba(239,68,68,0.22)";
    for (const r of [z.rail, z.caption, z.top]) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "rgba(239,68,68,0.9)";
    ctx.lineWidth = lw;
    ctx.setLineDash([lw * 6, lw * 4]);
    for (const r of [z.rail, z.caption, z.top]) ctx.strokeRect(r.x, r.y, r.w, r.h);
    // Action-rail icon stand-ins so the zone reads at a glance.
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    const cx = z.rail.x + z.rail.w / 2;
    const rr = z.rail.w * 0.2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(cx, z.rail.y + z.rail.h * (0.1 + i * 0.2), rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(34,197,94,0.95)";
    ctx.setLineDash([lw * 3, lw * 3]);
    ctx.strokeRect(z.safe.x, z.safe.y, z.safe.w, z.safe.h);
    ctx.setLineDash([]);
    tag(labels.top, z.top.x + font * 0.5, z.top.y + z.top.h - font * 1.8, "#fecaca");
    tag(labels.rail, z.rail.x - font * 0.2, z.rail.y - font * 2, "#fecaca");
    tag(labels.caption, z.caption.x + font * 0.5, z.caption.y + font * 0.5, "#fecaca");
    tag(labels.title, z.safe.x + font * 0.5, z.safe.y + font * 0.5, "#bbf7d0");
  } else {
    ctx.lineWidth = lw;
    ctx.strokeStyle = "rgba(250,204,21,0.95)";
    ctx.setLineDash([lw * 6, lw * 4]);
    ctx.strokeRect(W * 0.035, H * 0.035, W * 0.93, H * 0.93);
    ctx.strokeStyle = "rgba(34,197,94,0.95)";
    ctx.setLineDash([lw * 3, lw * 3]);
    ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
    ctx.setLineDash([]);
    tag(labels.action, W * 0.035 + lw * 2, H * 0.035 - font * 1.7 < 0 ? H * 0.035 + lw * 2 : H * 0.035 - font * 1.7, "#fef08a");
    tag(labels.title, W * 0.05 + lw * 2, H * 0.05 + font * 1.9, "#bbf7d0");
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// end screen
// ---------------------------------------------------------------------------

/** The end-screen link stored on the project: the overlay track holding the
 *  end-screen clips. Its guides show while the playhead is inside any clip on
 *  that track, so they follow the clip when it is moved or trimmed. */
export interface YtEndScreen { trackId: string }

export type YtProject = VideoProject & { chapters?: YtChapter[]; ytEndScreen?: YtEndScreen };

export const END_SCREEN_MIN_SEC = 5;
export const END_SCREEN_MAX_SEC = 20;
/** End screens can be added only to videos at least this long. */
export const END_SCREEN_MIN_VIDEO_SEC = 25;

/** The standard element zones (two video slots and a subscribe circle),
 *  scaled from a 1920x1080 layout. Portrait stages stack the slots. */
export function endScreenZones(W: number, H: number): { videos: Rect[]; subscribe: { cx: number; cy: number; r: number } } {
  if (ytAspect(W, H) === "portrait") {
    const vw = W * 0.8;
    const vh = (vw * 9) / 16;
    const x = (W - vw) / 2;
    return {
      videos: [
        { x, y: H * 0.14, w: vw, h: vh },
        { x, y: H * 0.14 + vh + H * 0.04, w: vw, h: vh },
      ],
      subscribe: { cx: W / 2, cy: H * 0.14 + vh * 2 + H * 0.04 + H * 0.12, r: W * 0.14 },
    };
  }
  const sx = W / 1920;
  const sy = H / 1080;
  return {
    videos: [
      { x: 1076 * sx, y: 96 * sy, w: 768 * sx, h: 432 * sy },
      { x: 1076 * sx, y: 576 * sy, w: 768 * sx, h: 432 * sy },
    ],
    subscribe: { cx: 320 * sx, cy: 830 * sy, r: 138 * Math.min(sx, sy) },
  };
}

/** True while frame `f` sits inside a clip on the end-screen track. */
export function endScreenActiveAt(p: YtProject, f: number): boolean {
  const id = p.ytEndScreen?.trackId;
  if (!id) return false;
  const t = p.tracks.find((x) => x.id === id);
  if (!t || t.hidden) return false;
  return t.clips.some((c) => f >= c.startFrame && f < c.startFrame + (c.outFrame - c.inFrame) / Math.abs(c.speed || 1));
}

export function drawEndScreenGuides(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  labels: { video: string; subscribe: string },
): void {
  const z = endScreenZones(W, H);
  const lw = Math.max(2, Math.round(Math.min(W, H) / 400));
  const font = Math.max(16, Math.round(Math.min(W, H) * 0.042));
  ctx.save();
  ctx.lineWidth = lw;
  ctx.setLineDash([lw * 5, lw * 3]);
  ctx.font = `700 ${font}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  z.videos.forEach((r, i) => {
    ctx.fillStyle = "rgba(14,165,233,0.18)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "rgba(14,165,233,0.95)";
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(`${labels.video} ${i + 1}`, r.x + r.w / 2, r.y + r.h / 2);
  });
  const s = z.subscribe;
  ctx.beginPath();
  ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(239,68,68,0.2)";
  ctx.fill();
  ctx.strokeStyle = "rgba(239,68,68,0.95)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(labels.subscribe, s.cx, s.cy);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

export interface YtChapter { id: string; frame: number; title: string }

/** YouTube's chapter rules. */
export const CHAPTER_MIN_COUNT = 3;
export const CHAPTER_MIN_SEC = 10;

export function chaptersOf(p: VideoProject | null | undefined): YtChapter[] {
  const raw = (p as YtProject | null | undefined)?.chapters;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is YtChapter => !!c && typeof c.frame === "number" && Number.isFinite(c.frame) && typeof c.id === "string")
    .map((c) => ({ ...c, title: typeof c.title === "string" ? c.title : "" }))
    .sort((a, b) => a.frame - b.frame);
}

/** The project with its chapter list replaced (sorted; empty list removes the key). */
export function withChapters<P extends VideoProject>(p: P, list: YtChapter[]): P {
  const next = { ...p } as P & { chapters?: YtChapter[] };
  if (list.length) next.chapters = [...list].sort((a, b) => a.frame - b.frame);
  else delete next.chapters;
  return next;
}

/** Re-time chapters with a frame mapping (fps change, ripple shift). Returns
 *  the patch to spread into the project, so a project without chapters gets
 *  no key. */
export function remapChapters(p: VideoProject, map: (f: number) => number): { chapters?: YtChapter[] } {
  const list = (p as YtProject).chapters;
  if (!Array.isArray(list)) return {};
  return { chapters: list.map((c) => ({ ...c, frame: Math.max(0, map(c.frame)) })).sort((a, b) => a.frame - b.frame) };
}

let chapterSeq = 0;
export function newChapterId(): string {
  chapterSeq += 1;
  return `chap_${Date.now().toString(36)}${chapterSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A YouTube description timestamp: m:ss below ten minutes is accepted, but
 *  the zero-padded mm:ss reads cleaner; h:mm:ss once the video passes an hour. */
export function ytTimestamp(seconds: number, withHours: boolean): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p2 = (n: number) => n.toString().padStart(2, "0");
  return withHours ? `${hh}:${p2(mm)}:${p2(ss)}` : `${p2(mm + hh * 60)}:${p2(ss)}`;
}

/** The chapter list as YouTube description lines (`00:00 Intro`). */
export function chaptersToDescription(chapters: YtChapter[], fps: number, durationFrames: number, untitled: (i: number) => string): string {
  const safeFps = fps > 0 ? fps : 30;
  const withHours = durationFrames / safeFps >= 3600;
  return chapters
    .map((c, i) => `${ytTimestamp(c.frame / safeFps, withHours)} ${c.title.trim() || untitled(i + 1)}`)
    .join("\n");
}

export type ChapterIssue =
  | { code: "first_not_zero" }
  | { code: "too_few"; count: number }
  | { code: "too_short"; index: number; seconds: number }
  | { code: "past_end"; index: number };

/** Every way the list breaks YouTube's rules. Chapter length is measured in
 *  whole seconds as YouTube reads the description timestamps. */
export function chapterIssues(chapters: YtChapter[], fps: number, durationFrames: number): ChapterIssue[] {
  if (!chapters.length) return [];
  const safeFps = fps > 0 ? fps : 30;
  const out: ChapterIssue[] = [];
  const secs = chapters.map((c) => Math.floor(c.frame / safeFps));
  const end = durationFrames / safeFps;
  if (secs[0] !== 0) out.push({ code: "first_not_zero" });
  if (chapters.length < CHAPTER_MIN_COUNT) out.push({ code: "too_few", count: chapters.length });
  chapters.forEach((c, i) => {
    if (c.frame >= durationFrames) {
      out.push({ code: "past_end", index: i });
      return;
    }
    const next = i + 1 < secs.length ? secs[i + 1] : end;
    const len = next - secs[i];
    if (len < CHAPTER_MIN_SEC) out.push({ code: "too_short", index: i, seconds: Math.max(0, Math.round(len * 10) / 10) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// captions for upload
// ---------------------------------------------------------------------------

/** SRT for an upload: cues in time order, empty cues dropped, numbered from 1.
 *  (The editor's own download keeps authoring order.) */
export function uploadSrt(cues: CaptionCue[], fps: number): string {
  const ordered = cues
    .filter((c) => c.text.trim() && c.endFrame > c.startFrame)
    .sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
  return toSrt(ordered, fps);
}
