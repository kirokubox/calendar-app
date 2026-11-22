// 自分で撮った写真の縮小と保存（季節日記 diary-app の photos.ts と同じ考え方）
import { PHOTO_JPEG_QUALITY, PHOTO_MAX_EDGE, PHOTO_WEBP_QUALITY, THUMB_MAX_EDGE } from "./constants";
import type { StoredPhoto } from "./types";

export function makePhotoId(): string {
  return `ph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type DecodedImage = { source: CanvasImageSource; width: number; height: number; release: () => void };

// createImageBitmap の imageOrientation でスマホの写真の向きを直してから描く。使えない環境では img 要素で
async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // img 要素へ
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("画像を読み込めませんでした"));
      el.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/** 長辺 maxEdge まで縮小して WebP（だめならJPEG）にする */
async function encode(d: DecodedImage, maxEdge: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(d.width, d.height));
  const width = Math.max(1, Math.round(d.width * scale));
  const height = Math.max(1, Math.round(d.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を変換できませんでした");
  ctx.drawImage(d.source, 0, 0, width, height);
  const webp = await canvasToBlob(canvas, "image/webp", PHOTO_WEBP_QUALITY);
  const blob = webp && webp.type === "image/webp" ? webp : await canvasToBlob(canvas, "image/jpeg", PHOTO_JPEG_QUALITY);
  if (!blob || blob.size === 0) throw new Error("画像を変換できませんでした");
  return { blob, width, height };
}

/** 選んだ画像を長辺 PHOTO_MAX_EDGE まで縮小し、一覧用の小さい写真も作る。撮影場所などの情報は残らない */
export async function preparePhoto(file: File, eventId: string, now: string): Promise<StoredPhoto> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("画像ファイルではありません");
  const d = await decodeImage(file);
  try {
    if (!d.width || !d.height) throw new Error("画像の大きさが分かりませんでした");
    const main = await encode(d, PHOTO_MAX_EDGE);
    const thumb = await encode(d, THUMB_MAX_EDGE);
    const mimeType = main.blob.type || "image/jpeg";
    return { id: makePhotoId(), eventId, blob: main.blob, thumb: thumb.blob, mimeType, width: main.width, height: main.height, byteSize: main.blob.size, createdAt: now };
  } finally {
    d.release();
  }
}

/** バックアップから取り込んだ写真に、一覧用の小さい写真を作り直して付ける（作れなければ大きい写真のまま） */
export async function withThumbs(photos: readonly StoredPhoto[]): Promise<StoredPhoto[]> {
  const out: StoredPhoto[] = [];
  for (const p of photos) {
    if (p.thumb) {
      out.push(p);
      continue;
    }
    try {
      const d = await decodeImage(p.blob);
      try {
        out.push({ ...p, thumb: (await encode(d, THUMB_MAX_EDGE)).blob });
      } finally {
        d.release();
      }
    } catch {
      out.push(p);
    }
  }
  return out;
}
