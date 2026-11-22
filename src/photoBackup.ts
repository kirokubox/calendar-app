import { buildBackup, type BackupExtras } from "./backup.js";
import type { CalendarEvent, Settings, StoredPhoto } from "./types.js";
import { createZipBlob, readZipEntries } from "./zip.js";

const JSON_NAME = "calendar-backup.json";

function photoPath(id: string, mime: string): string {
  return `photos/${id}.${mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg"}`;
}

/** ZIPはJSONと参照中の写真の本体を一緒に保管する。小さい写真は復元時に作り直す。 */
export async function buildPhotoZip(events: CalendarEvent[], settings: Settings, extras: BackupExtras, photos: StoredPhoto[], now: Date): Promise<Blob> {
  const ids = new Set(events.flatMap((e) => e.photoIds ?? []));
  const used = photos.filter((p) => ids.has(p.id));
  if (used.length !== ids.size) throw new Error("一部の写真が端末内に見つかりません。写真つきZIPを作れませんでした");
  const backup = buildBackup(events, settings, now.toISOString(), extras);
  const manifest = used.map(({ id, eventId, mimeType, width, height, createdAt }) => ({ id, eventId, mimeType, width, height, createdAt }));
  return createZipBlob([
    { path: JSON_NAME, blob: new Blob([JSON.stringify({ ...backup, photos: manifest }, null, 2)], { type: "application/json" }) },
    ...used.map((p) => ({ path: photoPath(p.id, p.mimeType), blob: p.blob })),
  ], now);
}

/** ZIP内の形式を確認し、写真が欠けていれば復元前にエラーにする。 */
export async function readPhotoZip(file: Blob): Promise<{ backup: unknown; photos: StoredPhoto[] }> {
  const entries = await readZipEntries(file);
  const json = entries.find((e) => e.path === JSON_NAME);
  if (!json) throw new Error(`ZIPに ${JSON_NAME} がありません`);
  const backup = JSON.parse(await json.blob.text()) as Record<string, unknown>;
  if (!Array.isArray(backup.photos)) throw new Error("ZIPに写真の一覧がありません");
  const photos: StoredPhoto[] = [];
  for (const raw of backup.photos) {
    if (!raw || typeof raw !== "object") throw new Error("写真の情報が不正です");
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || typeof p.eventId !== "string" || typeof p.mimeType !== "string" || typeof p.createdAt !== "string" ||
        typeof p.width !== "number" || typeof p.height !== "number") throw new Error("写真の情報が不正です");
    const entry = entries.find((e) => e.path === photoPath(p.id as string, p.mimeType as string));
    if (!entry) throw new Error(`ZIP内の写真 ${p.id} が見つかりません`);
    photos.push({ id: p.id, eventId: p.eventId, mimeType: p.mimeType, width: p.width, height: p.height, createdAt: p.createdAt,
      blob: new Blob([entry.blob], { type: p.mimeType }), byteSize: entry.blob.size });
  }
  const events = Array.isArray(backup.events) ? backup.events as Array<{ id?: string; photoIds?: string[] }> : [];
  for (const event of events) for (const id of event.photoIds ?? []) {
    if (!photos.some((p) => p.id === id && p.eventId === event.id)) throw new Error(`記録の写真 ${id} がZIPにありません`);
  }
  return { backup, photos };
}
