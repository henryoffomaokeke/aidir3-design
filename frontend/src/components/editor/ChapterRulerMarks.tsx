// aidir3 fork: YouTube chapter flags on the video timeline ruler.
//
// Each chapter is a flag at its start: click to jump, drag to move (whole
// seconds, since YouTube timestamps are), double-click to rename. Edits go
// through the same draft-then-persist path as the ruler markers, so a drag is
// one undo step. The list itself is edited in the YouTube panel.

import { promptText } from "@/lib/promptDialog";
import { tr } from "@/lib/i18n";
import type { YtChapter } from "@/lib/video/youtube";

export function ChapterRulerMarks(props: {
  chapters: YtChapter[];
  pxPerFrame: number;
  durationFrames: number;
  fps: number;
  onDraft: (list: YtChapter[]) => void;
  onCommit: (list: YtChapter[]) => void;
  onSeek: (frame: number) => void;
}): React.ReactElement | null {
  const { chapters, pxPerFrame, durationFrames } = props;
  const fps = props.fps > 0 ? props.fps : 30;
  if (!chapters.length) return null;
  return (
    <>
      {chapters.map((c, i) => {
        const next = chapters[i + 1];
        const room = next ? (next.frame - c.frame) * pxPerFrame : 160;
        return (
          <div
            key={c.id}
            data-yt-chapter-flag={i}
            title={tr("editor.yt_chapter_flag_tip", { title: c.title || tr("editor.yt_chapter_n", { n: i + 1 }) })}
            className="absolute top-0 z-[11] flex h-3.5 cursor-grab items-center"
            style={{ left: c.frame * pxPerFrame, maxWidth: Math.max(10, room - 2) }}
            onDoubleClick={async (e) => {
              e.stopPropagation();
              const title = await promptText({
                title: tr("editor.yt_rename_chapter"),
                label: tr("editor.yt_chapter_title"),
                defaultValue: c.title,
              });
              if (title === null) return;
              props.onCommit(chapters.map((x) => (x.id === c.id ? { ...x, title } : x)));
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              const rulerEl = (e.currentTarget as HTMLElement).parentElement;
              if (!rulerEl) return;
              let moved = false;
              let cur = c.frame;
              const onMove = (ev: PointerEvent) => {
                const rect = rulerEl.getBoundingClientRect();
                const raw = Math.max(0, Math.min(durationFrames, Math.round((ev.clientX - rect.left) / pxPerFrame)));
                const f = Math.round(raw / fps) * fps;
                moved = moved || Math.abs(raw - c.frame) > 2;
                if (moved && f !== cur) {
                  cur = f;
                  props.onDraft(chapters.map((x) => (x.id === c.id ? { ...x, frame: f } : x)));
                }
              };
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                if (moved) props.onCommit(chapters.map((x) => (x.id === c.id ? { ...x, frame: cur } : x)));
                else props.onSeek(c.frame);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
          >
            <span className="h-3.5 w-0.5 shrink-0 bg-brand-600" />
            <span className="truncate rounded-e bg-brand-600 px-1 text-[9px] font-medium leading-[14px] text-white">
              {c.title || tr("editor.yt_chapter_n", { n: i + 1 })}
            </span>
          </div>
        );
      })}
    </>
  );
}
