// Googleカレンダー取り込み用JSON（format: google-import, version 1）の検証と、既存データとの照合。純粋ロジック。
import { COLOR_IDS } from "./constants.js";
import { isLocalDateTime } from "./dateUtils.js";
import { eventDefaults } from "./migrate.js";
import type { CalendarEvent } from "./types.js";

export interface GoogleImportItem {
  googleEventId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  colorId: string | null;
  location: string | null;
  description: string | null;
  original: Record<string, unknown>;
}

export type ParseImportResult =
  | { ok: true; items: GoogleImportItem[]; skipped: string[]; skippedCount: number; duplicates: number }
  | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** 取り込み用JSON（パース済みの値）の検証。形式が違えばエラー、1件ずつの不正は読み飛ばして理由を返す */
export function parseGoogleImport(value: unknown): ParseImportResult {
  if (!isRecord(value)) return { ok: false, reason: "JSONの最上位がオブジェクトではありません" };
  if (value.app !== "calendar-app" || value.format !== "google-import") {
    return { ok: false, reason: "Googleカレンダー取り込み用のファイルではありません（app / format が違います）" };
  }
  if (value.version !== 1) return { ok: false, reason: `未対応の version です（${String(value.version)}）` };
  if (!Array.isArray(value.events)) return { ok: false, reason: "events が配列ではありません" };

  const byId = new Map<string, GoogleImportItem>();
  const skipped: string[] = [];
  let skippedCount = 0;
  let duplicates = 0;
  const skip = (index: number, why: string) => {
    skippedCount++;
    if (skipped.length < 5) skipped.push(`events[${index}]：${why}`);
  };
  value.events.forEach((v, i) => {
    if (!isRecord(v)) return skip(i, "オブジェクトではありません");
    if (typeof v.googleEventId !== "string" || v.googleEventId === "") return skip(i, "googleEventId がありません");
    if (typeof v.start !== "string" || !isLocalDateTime(v.start)) return skip(i, "start が YYYY-MM-DDTHH:mm 形式ではありません");
    if (typeof v.end !== "string" || !isLocalDateTime(v.end)) return skip(i, "end が YYYY-MM-DDTHH:mm 形式ではありません");
    if (v.end <= v.start) return skip(i, "終了が開始以前です");
    if (v.colorId !== null && v.colorId !== undefined && !(typeof v.colorId === "string" && (COLOR_IDS as readonly string[]).includes(v.colorId))) {
      return skip(i, "colorId が 1〜11 の文字列または null ではありません");
    }
    const title = typeof v.title === "string" && v.title.trim() !== "" ? v.title : "（無題）";
    if (byId.has(v.googleEventId)) duplicates++;
    byId.set(v.googleEventId, {
      googleEventId: v.googleEventId,
      title,
      start: v.start,
      end: v.end,
      allDay: v.allDay === true,
      colorId: (v.colorId as string | null | undefined) ?? null,
      location: strOrNull(v.location),
      description: strOrNull(v.description),
      original: isRecord(v.original) ? v.original : {},
    });
  });
  return { ok: true, items: [...byId.values()], skipped, skippedCount, duplicates };
}

/** 取り込み内容がアプリ側のイベントと同じか（取り込みが決める項目だけを比べる） */
function sameContent(e: CalendarEvent, item: GoogleImportItem): boolean {
  const place = item.location !== null ? [item.location] : [];
  return (
    e.title === item.title &&
    e.start === item.start &&
    e.end === item.end &&
    e.allDay === item.allDay &&
    e.colorId === item.colorId &&
    e.memo === (item.description ?? "") &&
    e.places.length === place.length &&
    e.places.every((p, i) => p === place[i]) &&
    JSON.stringify(e.original) === JSON.stringify(item.original)
  );
}

/** アプリ側で編集済みか：updatedAt が importedAt より新しい（importedAt が無ければ判断できないので編集済み扱い） */
export function isEditedInApp(e: CalendarEvent): boolean {
  return e.importedAt === null || e.updatedAt > e.importedAt;
}

export interface ImportPlan {
  create: CalendarEvent[];
  update: CalendarEvent[];
  unchanged: number;
  /** アプリ側で編集済みのため上書きしないもの */
  kept: number;
}

/**
 * 既存イベントとの照合（googleEventId）。
 * 新規＝種別不明・source=google で作る／更新＝取り込み内容で上書き／変更なし／保持＝アプリで編集済みなので触らない。
 */
export function planGoogleImport(items: GoogleImportItem[], existing: CalendarEvent[], stamp: string, newId: () => string): ImportPlan {
  const byGoogleId = new Map<string, CalendarEvent>();
  for (const e of existing) if (e.googleEventId !== null) byGoogleId.set(e.googleEventId, e);
  const plan: ImportPlan = { create: [], update: [], unchanged: 0, kept: 0 };
  for (const item of items) {
    const found = byGoogleId.get(item.googleEventId);
    const fields = {
      title: item.title,
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      colorId: item.colorId,
      places: item.location !== null ? [item.location] : [],
      memo: item.description ?? "",
      original: item.original,
    };
    if (!found) {
      plan.create.push({
        id: newId(),
        kind: "unknown",
        createdAt: stamp,
        updatedAt: stamp,
        ...eventDefaults(),
        ...fields,
        source: "google",
        googleEventId: item.googleEventId,
        importedAt: stamp,
      });
    } else if (isEditedInApp(found)) {
      plan.kept++;
    } else if (sameContent(found, item)) {
      plan.unchanged++;
    } else {
      plan.update.push({ ...found, ...fields, updatedAt: stamp, importedAt: stamp });
    }
  }
  return plan;
}
