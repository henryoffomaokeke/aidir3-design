// aidir3 fork: YouTube kit logic (chapters, timestamps, SRT for upload).
import { describe, expect, it } from "vitest";
import { newProject } from "@hc/timeline";
import {
  chapterIssues,
  chaptersOf,
  chaptersToDescription,
  endScreenActiveAt,
  remapChapters,
  uploadSrt,
  withChapters,
  ytFormatOf,
  ytTimestamp,
  type YtChapter,
  type YtProject,
} from "./youtube";

const ch = (sec: number, title: string, fps = 30): YtChapter => ({ id: `c${sec}`, frame: sec * fps, title });

describe("youtube chapters", () => {
  it("formats description lines as YouTube reads them", () => {
    const list = [ch(0, "Intro"), ch(75, "Setup"), ch(130, "")];
    expect(chaptersToDescription(list, 30, 300 * 30, (i) => `Chapter ${i}`)).toBe("00:00 Intro\n01:15 Setup\n02:10 Chapter 3");
    expect(ytTimestamp(3725, true)).toBe("1:02:05");
    expect(ytTimestamp(65, false)).toBe("01:05");
  });

  it("accepts a valid list", () => {
    expect(chapterIssues([ch(0, "a"), ch(10, "b"), ch(20, "c")], 30, 30 * 30)).toEqual([]);
  });

  it("flags every broken rule", () => {
    const codes = chapterIssues([ch(2, "a"), ch(8, "b")], 30, 15 * 30).map((i) => i.code);
    expect(codes).toContain("first_not_zero");
    expect(codes).toContain("too_few");
    expect(codes).toContain("too_short");
  });

  it("measures the last chapter against the video end", () => {
    const issues = chapterIssues([ch(0, "a"), ch(10, "b"), ch(20, "c")], 30, 25 * 30);
    expect(issues).toEqual([{ code: "too_short", index: 2, seconds: 5 }]);
  });

  it("stores sorted, drops the key when empty, and survives a remap", () => {
    const p = newProject();
    const withList = withChapters(p, [ch(20, "c"), ch(0, "a")]);
    expect(chaptersOf(withList).map((c) => c.title)).toEqual(["a", "c"]);
    expect("chapters" in withChapters(withList, [])).toBe(false);
    expect(remapChapters(p, (f) => f)).toEqual({});
    expect(remapChapters(withList, (f) => f * 2).chapters?.map((c) => c.frame)).toEqual([0, 1200]);
  });
});

describe("youtube formats and end screen", () => {
  it("recognises the upload presets", () => {
    expect(ytFormatOf(1080, 1920)).toBe("shorts");
    expect(ytFormatOf(3840, 2160)).toBe("yt4k");
    expect(ytFormatOf(1000, 1000)).toBeNull();
  });

  it("follows the end-screen track's clips", () => {
    const p = newProject() as YtProject;
    p.tracks.push({ id: "es", kind: "overlay", clips: [{ id: "x", startFrame: 100, inFrame: 0, outFrame: 50, speed: 1 }] });
    p.ytEndScreen = { trackId: "es" };
    expect(endScreenActiveAt(p, 99)).toBe(false);
    expect(endScreenActiveAt(p, 120)).toBe(true);
    expect(endScreenActiveAt(p, 150)).toBe(false);
  });
});

describe("upload SRT", () => {
  it("orders cues and drops empty ones", () => {
    const srt = uploadSrt(
      [
        { id: "b", startFrame: 60, endFrame: 90, text: "second" },
        { id: "e", startFrame: 10, endFrame: 20, text: "  " },
        { id: "a", startFrame: 0, endFrame: 30, text: "first" },
      ],
      30,
    );
    expect(srt).toBe("1\n00:00:00,000 --> 00:00:01,000\nfirst\n\n2\n00:00:02,000 --> 00:00:03,000\nsecond\n");
  });
});
