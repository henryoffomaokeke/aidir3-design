// aidir3 fork: the video editor's YouTube kit.
//
// One panel (toggled from the edit toolbar, under the timeline like the
// captions editor) with the tools a creator needs before upload:
//   - Format: the upload presets (1080p, 4K, Shorts 9:16, square) and the
//     safe-zone overlay (title/action safe, or the Shorts UI zones).
//   - Chapters: add at the playhead, rename, retime, delete, the YouTube rule
//     check, and "Copy for YouTube description".
//   - End screen: an overlay track over the last 5-20 s with the element
//     zones drawn as preview-only guides.
//   - Thumbnail: the current frame as a new 1280x720 design, blank or placed
//     in an `a3-yt-thumb-*` template's photo slot.
//   - Upload: export and a time-ordered SRT.
// The logic lives in lib/video/youtube.ts and lib/video/thumbnailFromFrame.ts;
// VideoSurface mounts this panel and hands it the project and a few callbacks.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ClipboardCheck,
  Clipboard,
  Download,
  ExternalLink,
  Flag,
  ImagePlus,
  Loader2,
  Plus,
  ScanLine,
  Trash2,
  X,
} from "lucide-react";
import { newTrack, projectDurationFrames, type Clip, type VideoProject } from "@hc/timeline";
import { createNode, type Node } from "@hc/schema";
import type { TemplateSummary } from "@hc/sdk";
import { oc } from "@/lib/sdk";
import { tr } from "@/lib/i18n";
import { userMessage } from "@/lib/errors";
import { downloadBlob } from "@/lib/video/exporter";
import type { CaptionCue } from "@/lib/video/captions";
import {
  YT_FORMATS,
  CHAPTER_MIN_COUNT,
  CHAPTER_MIN_SEC,
  END_SCREEN_MAX_SEC,
  END_SCREEN_MIN_SEC,
  END_SCREEN_MIN_VIDEO_SEC,
  chapterIssues,
  chaptersOf,
  chaptersToDescription,
  newChapterId,
  uploadSrt,
  withChapters,
  ytAspect,
  ytFormatOf,
  ytTimestamp,
  type ChapterIssue,
  type YtChapter,
  type YtFormatId,
  type YtProject,
} from "@/lib/video/youtube";
import { createThumbnailDesign } from "@/lib/video/thumbnailFromFrame";

/** Shorts can run up to three minutes. */
const SHORTS_MAX_SEC = 180;

/** "ss", "mm:ss" or "h:mm:ss" to seconds; null when it is not a time. */
function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (!parts.length || parts.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) return null;
  const n = parts.map((p) => parseFloat(p));
  if (n.length === 1) return n[0];
  if (n.length === 2) return n[0] * 60 + n[1];
  if (n.length === 3) return n[0] * 3600 + n[1] * 60 + n[2];
  return null;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API refused (insecure origin, no permission): the legacy path.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function formatLabel(id: YtFormatId): string {
  switch (id) {
    case "yt1080":
      return tr("editor.yt_format_1080");
    case "yt4k":
      return tr("editor.yt_format_4k");
    case "shorts":
      return tr("editor.yt_format_shorts");
    case "square":
      return tr("editor.yt_format_square");
  }
}

function issueText(issue: ChapterIssue): string {
  switch (issue.code) {
    case "first_not_zero":
      return tr("editor.yt_chapter_issue_first");
    case "too_few":
      return tr("editor.yt_chapter_issue_few", { min: CHAPTER_MIN_COUNT, have: issue.count });
    case "too_short":
      return tr("editor.yt_chapter_issue_short", { n: issue.index + 1, min: CHAPTER_MIN_SEC, seconds: issue.seconds });
    case "past_end":
      return tr("editor.yt_chapter_issue_past_end", { n: issue.index + 1 });
  }
}

function Card(props: { title: string; children: React.ReactNode; wide?: boolean }): React.ReactElement {
  return (
    <section className={`flex min-w-0 flex-col gap-1.5 rounded-lg border border-neutral-200 bg-surface p-2 ${props.wide ? "w-full sm:w-[26rem]" : "w-full sm:w-60"}`}>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{props.title}</h3>
      {props.children}
    </section>
  );
}

const btn = "inline-flex items-center gap-1 rounded bg-neutral-200 px-2 py-1 text-xs text-neutral-800 hover:bg-neutral-300 disabled:cursor-not-allowed disabled:opacity-40";
const btnPrimary = "inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40";
const warnCls = "flex items-start gap-1 text-[11px] leading-snug text-amber-700 dark:text-amber-400";

export function YouTubePanel(props: {
  project: VideoProject;
  /** False while a nested sequence is open: chapters and the end screen belong
   *  to the main timeline. */
  topLevel: boolean;
  frame: number;
  durationFrames: number;
  docTitle: string;
  workspaceId?: string;
  persist: (next: VideoProject) => void;
  seek: (frame: number) => void;
  setStageSize: (w: number, h: number) => void;
  safeOn: boolean;
  onToggleSafe: () => void;
  stageCanvas: () => HTMLCanvasElement | null;
  cues: CaptionCue[];
  captionLang?: string;
  onOpenExport: () => void;
  onClose: () => void;
}): React.ReactElement {
  const { project, frame, durationFrames, persist } = props;
  const fps = (project.fps as number) > 0 ? (project.fps as number) : 30;
  const W = project.stage.width;
  const H = project.stage.height;
  const aspect = ytAspect(W, H);
  const current = ytFormatOf(W, H);
  const seconds = durationFrames / fps;
  const withHours = seconds >= 3600;

  // ---- chapters ------------------------------------------------------------
  const chapters = chaptersOf(project);
  const issues = chapterIssues(chapters, fps, durationFrames);
  const untitled = (i: number) => tr("editor.yt_chapter_n", { n: i });
  const description = chaptersToDescription(chapters, fps, durationFrames, untitled);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  // The duplicate-second notice belongs to the frame it was raised at.
  const [dupAt, setDupAt] = useState<number | null>(null);
  const saveChapters = (list: YtChapter[]) => persist(withChapters(project, list));
  const addChapter = () => {
    const sec = Math.floor(frame / fps);
    if (chapters.some((c) => Math.floor(c.frame / fps) === sec)) {
      setDupAt(frame);
      return;
    }
    setDupAt(null);
    const title = chapters.length === 0 && sec === 0 ? tr("editor.yt_chapter_intro") : untitled(chapters.length + 1);
    saveChapters([...chapters, { id: newChapterId(), frame: sec * fps, title }]);
  };
  const patchChapter = (id: string, patch: Partial<YtChapter>) =>
    saveChapters(chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const copyDescription = async () => {
    const ok = await copyText(description);
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied(null), 4000);
  };

  // ---- end screen ----------------------------------------------------------
  const yp = project as YtProject;
  const endTrack = yp.ytEndScreen ? project.tracks.find((t) => t.id === yp.ytEndScreen?.trackId) : undefined;
  const endClip = endTrack?.clips[0];
  const [endSec, setEndSec] = useState(END_SCREEN_MAX_SEC);
  const withoutEndScreen = (p: YtProject): YtProject => {
    const next: YtProject = { ...p, tracks: p.tracks.filter((t) => t.id !== p.ytEndScreen?.trackId) };
    delete next.ytEndScreen;
    return next;
  };
  const finish = (p: YtProject): VideoProject => ({ ...p, durationFrames: Math.max(projectDurationFrames(p), p.minDurationFrames ?? 0) });
  const insertEndScreen = () => {
    const base = withoutEndScreen(yp);
    const contentEnd = Math.max(projectDurationFrames(base), base.minDurationFrames ?? 0);
    const want = Math.round(endSec * fps);
    const start = Math.max(0, contentEnd - want);
    const len = contentEnd > 0 ? Math.max(1, Math.min(want, contentEnd - start)) : want;
    const portrait = aspect === "portrait";
    const fontSize = Math.round(H * (portrait ? 0.045 : 0.075));
    const bx = Math.round(W * (portrait ? 0.08 : 0.05));
    const by = Math.round(H * (portrait ? 0.03 : 0.12));
    const bw = Math.round(W * (portrait ? 0.84 : 0.47));
    const bh = Math.round(fontSize * 2.6);
    const heading: Node = createNode("text", {
      transform: { x: bx, y: by, scaleX: 1, scaleY: 1, rotation: 0 },
      size: { width: bw, height: bh },
      box: { mode: "fixed", width: bw, height: bh, autoFit: { enabled: false, min: 8, max: 512 }, verticalAlign: "middle" },
      content: [{
        runs: [{ text: tr("editor.yt_end_screen_heading"), style: { fontFamily: "system", fontStyle: "Bold", fontSize, axes: { wght: 800 }, fill: { type: "solid", color: { srgb: { r: 1, g: 1, b: 1, a: 1 } } } } }],
        style: { align: portrait ? "center" : "left", direction: "auto" },
      }],
    } as Partial<Node>);
    const track = newTrack("overlay", tr("editor.yt_end_screen"));
    const clip: Clip = { id: `clip_${Math.random().toString(36).slice(2, 9)}`, name: tr("editor.yt_end_screen"), startFrame: start, inFrame: 0, outFrame: len, speed: 1, element: heading };
    const next: YtProject = { ...base, tracks: [...base.tracks, { ...track, clips: [clip] }], ytEndScreen: { trackId: track.id } };
    persist(finish(next));
    props.seek(start);
  };
  const removeEndScreen = () => persist(finish(withoutEndScreen(yp)));

  // ---- thumbnail -----------------------------------------------------------
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbResult, setThumbResult] = useState<{ designId: string; placedInSlot: boolean; templated: boolean } | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    oc.listTemplates({ q: "thumbnail" })
      .then((list) => {
        if (live) setTemplates(list.filter((t) => t.id.startsWith("a3-yt-thumb-")));
      })
      .catch(() => {
        if (live) setTemplates([]);
      });
    return () => {
      live = false;
    };
  }, []);
  const makeThumbnail = async (fromTemplate: boolean) => {
    const stage = props.stageCanvas();
    if (!stage || !props.workspaceId) return;
    setThumbBusy(true);
    setThumbError(null);
    setThumbResult(null);
    try {
      const title = tr("editor.yt_thumbnail_title", { title: props.docTitle || tr("editor.yt_untitled_video"), time: ytTimestamp(frame / fps, withHours) });
      const r = await createThumbnailDesign({ workspaceId: props.workspaceId, stage, title, templateId: fromTemplate ? templateId || null : null });
      setThumbResult({ ...r, templated: fromTemplate });
    } catch (e) {
      setThumbError(userMessage(e, tr("editor.yt_thumbnail_failed")));
    } finally {
      setThumbBusy(false);
    }
  };

  // ---- upload --------------------------------------------------------------
  const srtCues = useMemo(() => props.cues.filter((c) => c.text.trim()), [props.cues]);
  const downloadSrt = () => {
    if (!srtCues.length) return;
    const lang = props.captionLang ? `.${props.captionLang}` : "";
    downloadBlob(new Blob([uploadSrt(props.cues, fps)], { type: "text/plain;charset=utf-8" }), `${(props.docTitle || "captions").replace(/[^\w.-]+/g, "_")}${lang}.srt`);
  };

  return (
    <div className="max-h-64 overflow-y-auto border-t border-neutral-200 bg-neutral-100 px-3 py-2 text-xs" data-yt-panel="">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold uppercase tracking-wide text-neutral-600">{tr("editor.yt_kit")}</span>
        <span className="text-[11px] text-neutral-500">{tr("editor.yt_kit_hint")}</span>
        <button type="button" onClick={props.onClose} title={tr("editor.yt_close")} aria-label={tr("editor.yt_close")} className="ms-auto rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900">
          <X size={13} />
        </button>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {/* format */}
        <Card title={tr("editor.yt_format")}>
          <div className="grid grid-cols-2 gap-1">
            {YT_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                data-yt-format={f.id}
                onClick={() => props.setStageSize(f.width, f.height)}
                className={`rounded border px-1.5 py-1 text-start ${current === f.id ? "border-brand-500 bg-brand-50 text-brand-ink" : "border-neutral-200 bg-neutral-50 text-neutral-700 hover:border-neutral-300"}`}
              >
                <span className="block text-[11px] font-medium">{formatLabel(f.id)}</span>
                <span className="block font-mono text-[10px] text-neutral-500">{f.width}x{f.height}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-neutral-700">
            <input type="checkbox" checked={props.safeOn} onChange={props.onToggleSafe} data-yt-safe="" />
            <ScanLine size={12} className="text-neutral-500" />
            {aspect === "portrait" ? tr("editor.yt_safe_shorts") : tr("editor.yt_safe_landscape")}
          </label>
          {!current && <p className="text-[11px] text-neutral-500">{tr("editor.yt_custom_size", { size: `${W}x${H}` })}</p>}
        </Card>

        {/* chapters */}
        <Card title={tr("editor.yt_chapters")} wide>
          {!props.topLevel ? (
            <p className="text-[11px] text-neutral-500">{tr("editor.yt_main_timeline_only")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" className={btn} onClick={addChapter} data-yt-add-chapter="">
                  <Flag size={12} /> {tr("editor.yt_add_chapter", { time: ytTimestamp(frame / fps, withHours) })}
                </button>
                <button type="button" className={btnPrimary} disabled={!chapters.length} onClick={() => void copyDescription()} data-yt-copy="">
                  {copied === "ok" ? <ClipboardCheck size={12} /> : <Clipboard size={12} />}
                  {copied === "ok" ? tr("editor.yt_copied") : tr("editor.yt_copy_description")}
                </button>
                {copied === "fail" && <span className="text-[11px] text-red-600">{tr("editor.yt_copy_failed")}</span>}
              </div>
              {dupAt === frame && <p className="text-[11px] text-neutral-500">{tr("editor.yt_chapter_exists_here")}</p>}
              {chapters.length === 0 ? (
                <p className="text-[11px] text-neutral-500">{tr("editor.yt_no_chapters")}</p>
              ) : (
                <ol className="flex flex-col gap-0.5">
                  {chapters.map((c, i) => (
                    <li key={c.id} className="flex items-center gap-1" data-yt-chapter={i}>
                      <span className="w-4 text-end font-mono text-[10px] text-neutral-400">{i + 1}</span>
                      <input
                        key={`${c.id}:${c.frame}`}
                        defaultValue={ytTimestamp(c.frame / fps, withHours)}
                        aria-label={tr("editor.yt_chapter_time")}
                        title={tr("editor.yt_chapter_time")}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        onBlur={(e) => {
                          const s = parseClock(e.target.value);
                          if (s === null) { e.target.value = ytTimestamp(c.frame / fps, withHours); return; }
                          const f = Math.max(0, Math.min(durationFrames, Math.round(Math.floor(s) * fps)));
                          if (f !== c.frame) patchChapter(c.id, { frame: f });
                        }}
                        className="w-16 rounded border border-neutral-300 bg-surface px-1 py-0.5 font-mono text-[11px] text-neutral-900"
                      />
                      <input
                        key={`${c.id}:t`}
                        defaultValue={c.title}
                        aria-label={tr("editor.yt_chapter_title")}
                        placeholder={untitled(i + 1)}
                        maxLength={100}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        onBlur={(e) => { if (e.target.value !== c.title) patchChapter(c.id, { title: e.target.value }); }}
                        className="min-w-0 flex-1 rounded border border-neutral-300 bg-surface px-1.5 py-0.5 text-[11px] text-neutral-900"
                      />
                      <button type="button" title={tr("editor.yt_jump_to_chapter")} aria-label={tr("editor.yt_jump_to_chapter")} onClick={() => props.seek(c.frame)} className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900">
                        <Flag size={11} />
                      </button>
                      <button type="button" title={tr("editor.yt_delete_chapter")} aria-label={tr("editor.yt_delete_chapter")} onClick={() => saveChapters(chapters.filter((x) => x.id !== c.id))} className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-red-600">
                        <Trash2 size={11} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {issues.length > 0 && (
                <ul className="flex flex-col gap-0.5" data-yt-issues="">
                  {issues.map((iss, i) => (
                    <li key={i} className={warnCls}><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {issueText(iss)}</li>
                  ))}
                </ul>
              )}
              {chapters.length > 0 && issues.length === 0 && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400">{tr("editor.yt_chapters_ok")}</p>
              )}
              {chapters.length > 0 && (
                <textarea
                  readOnly
                  value={description}
                  rows={Math.min(6, chapters.length)}
                  aria-label={tr("editor.yt_description_preview")}
                  className="w-full resize-none rounded border border-neutral-200 bg-neutral-50 px-1.5 py-1 font-mono text-[11px] text-neutral-800"
                  data-yt-description=""
                />
              )}
              <p className="text-[10px] text-neutral-400">{tr("editor.yt_chapter_rules", { min: CHAPTER_MIN_COUNT, sec: CHAPTER_MIN_SEC })}</p>
            </>
          )}
        </Card>

        {/* end screen */}
        <Card title={tr("editor.yt_end_screen")}>
          {!props.topLevel ? (
            <p className="text-[11px] text-neutral-500">{tr("editor.yt_main_timeline_only")}</p>
          ) : (
            <>
              <label className="flex items-center gap-1.5 text-neutral-700">
                {tr("editor.yt_end_screen_length")}
                <input
                  type="range"
                  min={END_SCREEN_MIN_SEC}
                  max={END_SCREEN_MAX_SEC}
                  step={1}
                  value={endSec}
                  onChange={(e) => setEndSec(parseInt(e.target.value, 10))}
                  className="min-w-0 flex-1"
                />
                <span className="w-7 text-end font-mono text-[11px]">{endSec}s</span>
              </label>
              <div className="flex flex-wrap gap-1">
                <button type="button" className={btnPrimary} onClick={insertEndScreen} data-yt-end-screen="">
                  <Plus size={12} /> {endTrack ? tr("editor.yt_end_screen_replace") : tr("editor.yt_end_screen_insert")}
                </button>
                {endClip && (
                  <button type="button" className={btn} onClick={() => props.seek(endClip.startFrame)}>
                    <Flag size={12} /> {tr("editor.yt_end_screen_jump")}
                  </button>
                )}
                {endTrack && (
                  <button type="button" className={btn} onClick={removeEndScreen}>
                    <Trash2 size={12} /> {tr("editor.remove")}
                  </button>
                )}
              </div>
              <p className="text-[11px] leading-snug text-neutral-500">{tr("editor.yt_end_screen_hint")}</p>
              {seconds < END_SCREEN_MIN_VIDEO_SEC && (
                <p className={warnCls}><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {tr("editor.yt_end_screen_too_short", { min: END_SCREEN_MIN_VIDEO_SEC })}</p>
              )}
              {aspect === "portrait" && (
                <p className={warnCls}><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {tr("editor.yt_end_screen_shorts")}</p>
              )}
            </>
          )}
        </Card>

        {/* thumbnail */}
        <Card title={tr("editor.yt_thumbnail")}>
          <p className="text-[11px] leading-snug text-neutral-500">{tr("editor.yt_thumbnail_hint", { time: ytTimestamp(frame / fps, withHours) })}</p>
          <button type="button" className={btnPrimary} disabled={thumbBusy || !props.workspaceId} onClick={() => void makeThumbnail(false)} data-yt-thumb-blank="">
            {thumbBusy ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />} {tr("editor.yt_thumbnail_blank")}
          </button>
          <div className="flex items-center gap-1">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={!templates?.length}
              aria-label={tr("editor.yt_thumbnail_template")}
              className="min-w-0 flex-1 rounded border border-neutral-300 bg-surface px-1 py-1 text-[11px] text-neutral-900 disabled:opacity-50"
              data-yt-thumb-template=""
            >
              <option value="">{templates === null ? tr("editor.yt_loading") : templates.length ? tr("editor.yt_thumbnail_pick") : tr("editor.yt_thumbnail_none")}</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
            <button type="button" className={btn} disabled={thumbBusy || !templateId || !props.workspaceId} onClick={() => void makeThumbnail(true)} data-yt-thumb-use="">
              {tr("editor.yt_thumbnail_use")}
            </button>
          </div>
          {!props.workspaceId && <p className={warnCls}>{tr("editor.yt_needs_workspace")}</p>}
          {thumbError && <p className="text-[11px] text-red-600">{thumbError}</p>}
          {thumbResult && (
            <a
              href={`/editor/?id=${encodeURIComponent(thumbResult.designId)}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-ink underline"
              data-yt-thumb-link={thumbResult.designId}
            >
              <ExternalLink size={11} />
              {thumbResult.templated && !thumbResult.placedInSlot ? tr("editor.yt_thumbnail_open_no_slot") : tr("editor.yt_thumbnail_open")}
            </a>
          )}
        </Card>

        {/* upload */}
        <Card title={tr("editor.yt_upload")}>
          <button type="button" className={btnPrimary} onClick={props.onOpenExport}>
            <Download size={12} /> {aspect === "portrait" ? tr("editor.yt_export_short") : tr("editor.yt_export_video")}
          </button>
          {aspect === "portrait" && seconds > SHORTS_MAX_SEC && (
            <p className={warnCls}><AlertTriangle size={11} className="mt-0.5 shrink-0" /> {tr("editor.yt_shorts_too_long", { max: SHORTS_MAX_SEC / 60 })}</p>
          )}
          <button type="button" className={btn} disabled={!srtCues.length} onClick={downloadSrt} data-yt-srt="">
            <Download size={12} /> {tr("editor.yt_download_srt")}
          </button>
          <p className="text-[11px] leading-snug text-neutral-500">
            {srtCues.length ? tr("editor.yt_srt_hint", { cues: srtCues.length }) : tr("editor.yt_srt_none")}
          </p>
        </Card>
      </div>
    </div>
  );
}
