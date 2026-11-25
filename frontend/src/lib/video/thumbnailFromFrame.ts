// aidir3 fork: make a YouTube thumbnail design from a video preview frame.
//
// The frame is captured from the stage canvas (what the exporter records, so
// no editing chrome), scaled to cover 1280x720, uploaded to the workspace as a
// JPEG, and placed either full-bleed on a new blank 1280x720 design or into
// the photo slot (the largest frame) of an `a3-yt-thumb-*` template. Both go
// through the ordinary create-design call, so the result is a normal design.

import { createBlankDesign, createNode, type DesignFile, type Node } from "@hc/schema";
import { directUploadWithProgress, oc, resolveAssetUrl } from "@/lib/sdk";
import { CodedError } from "@/lib/errors";

export const THUMB_W = 1280;
export const THUMB_H = 720;
/** YouTube rejects custom thumbnails over 2 MB. */
const THUMB_MAX_BYTES = 2 * 1024 * 1024;

/** Draw `src` into a WxH canvas with cover fit (centered crop). */
export function coverCanvas(src: CanvasImageSource & { width: number; height: number }, W: number, H: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (ctx) {
    const s = Math.max(W / Math.max(1, src.width), H / Math.max(1, src.height));
    const dw = src.width * s;
    const dh = src.height * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  return c;
}

function toJpeg(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new CodedError("errors.image_decode_failed", "Couldn't encode the frame."))), "image/jpeg", q));
}

/** The 1280x720 frame as a JPEG under YouTube's 2 MB limit. */
export async function frameJpeg(stage: HTMLCanvasElement): Promise<{ blob: Blob; canvas: HTMLCanvasElement }> {
  const canvas = coverCanvas(stage, THUMB_W, THUMB_H);
  let q = 0.92;
  let blob = await toJpeg(canvas, q);
  while (blob.size > THUMB_MAX_BYTES && q > 0.5) {
    q -= 0.1;
    blob = await toJpeg(canvas, q);
  }
  return { blob, canvas };
}

/** The template's photo slot: its largest frame node. */
type FrameSlot = { type: string; size: { width: number; height: number }; children: Node[]; clip?: boolean };
export function photoSlot(file: DesignFile): FrameSlot | null {
  let best: FrameSlot | null = null;
  let bestArea = 0;
  const walk = (n: Node) => {
    const node = n as unknown as Partial<FrameSlot> & { type: string };
    if (node.type === "frame" && node.size) {
      const area = node.size.width * node.size.height;
      if (area > bestArea) {
        bestArea = area;
        best = node as FrameSlot;
      }
    }
    for (const c of node.children ?? []) walk(c);
  };
  for (const p of file.pages ?? []) for (const n of p.children ?? []) walk(n);
  return best;
}

function imageNode(assetId: string, w: number, h: number): Node {
  return createNode("image", {
    source: { assetId, naturalWidth: THUMB_W, naturalHeight: THUMB_H },
    fit: "cover",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    size: { width: w, height: h },
  } as Partial<Node>);
}

/**
 * Upload the frame and create the thumbnail design. `templateId` null makes a
 * blank 1280x720 design with the frame full-bleed; otherwise the template's
 * photo slot receives the frame. Returns the new design id.
 */
export async function createThumbnailDesign(input: {
  workspaceId: string;
  stage: HTMLCanvasElement;
  title: string;
  templateId: string | null;
}): Promise<{ designId: string; placedInSlot: boolean }> {
  const { blob } = await frameJpeg(input.stage);
  const up = await directUploadWithProgress(input.workspaceId, blob, { filename: "thumbnail-frame.jpg" });
  const url = resolveAssetUrl(up.url);
  const assetId = `asset-${crypto.randomUUID()}`;
  let file: DesignFile;
  let placedInSlot = false;
  if (input.templateId) {
    file = structuredClone(await oc.getTemplateFile(input.templateId));
    const blank = createBlankDesign({ title: input.title });
    file.id = blank.id;
    file.title = input.title;
    file.assets = [...(file.assets ?? [])];
    file.meta = { ...(file.meta ?? {}) };
    const slot = photoSlot(file);
    if (slot) {
      slot.children = [imageNode(assetId, slot.size.width, slot.size.height)];
      slot.clip = true;
      placedInSlot = true;
    } else {
      // No slot: the frame goes behind everything on the first page.
      const page = file.pages[0];
      page.children = [imageNode(assetId, page.width, page.height), ...page.children];
    }
  } else {
    file = createBlankDesign({ title: input.title, width: THUMB_W, height: THUMB_H });
    file.pages[0].children.push(imageNode(assetId, THUMB_W, THUMB_H));
  }
  file.assets.push({ id: assetId, kind: "image", url, mime: "image/jpeg", width: THUMB_W, height: THUMB_H, checksum: "" });
  const rec = await oc.createDesign({ workspaceId: input.workspaceId, title: input.title, from: file });
  return { designId: rec.id, placedInSlot };
}
