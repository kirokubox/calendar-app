// schemaVersion 1 → 2 の移行。IndexedDBの読み込み・バックアップの復元の両方で使う純粋ロジック。
import { COLOR_KEYS, PARENT_CATEGORIES, defaultCategoryParents, defaultSettings } from "./constants.js";
import type { CalendarEvent, ParentCategory, Settings } from "./types.js";

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** v2で追加した項目の既定値 */
export function eventDefaults(): Pick<
  CalendarEvent,
  "people" | "places" | "memo" | "subcategory" | "planId" | "status" | "cancelReason" | "recurrenceId" | "recurrenceDate" | "source" | "googleEventId" | "original" | "importedAt"
> {
  return {
    people: [], places: [], memo: "", subcategory: null, planId: null, status: "active", cancelReason: "",
    recurrenceId: null, recurrenceDate: null, source: "app", googleEventId: null, original: null, importedAt: null,
  };
}

/** v1のイベント（またはv2の一部欠けたイベント）に既定値を付けてv2にする。v1の項目は検証済みの前提 */
export function migrateEvent(raw: Rec): CalendarEvent {
  const d = eventDefaults();
  return {
    id: raw.id as string,
    title: raw.title as string,
    start: raw.start as string,
    end: raw.end as string,
    allDay: raw.allDay as boolean,
    colorId: raw.colorId as string | null,
    kind: raw.kind as CalendarEvent["kind"],
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    people: strArray(raw.people),
    places: strArray(raw.places),
    memo: typeof raw.memo === "string" ? raw.memo : d.memo,
    subcategory: strOrNull(raw.subcategory),
    planId: strOrNull(raw.planId),
    status: raw.status === "cancelled" ? "cancelled" : "active",
    cancelReason: typeof raw.cancelReason === "string" ? raw.cancelReason : d.cancelReason,
    recurrenceId: strOrNull(raw.recurrenceId),
    recurrenceDate: strOrNull(raw.recurrenceDate),
    source: raw.source === "google" ? "google" : "app",
    googleEventId: strOrNull(raw.googleEventId),
    original: isRecord(raw.original) ? raw.original : null,
    importedAt: strOrNull(raw.importedAt),
  };
}

/** 保存済みの設定（v1・v2・空）をv2にする。足りない項目は既定値 */
export function migrateSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!isRecord(raw)) return base;
  const colorLabels = { ...base.colorLabels };
  if (isRecord(raw.colorLabels)) {
    for (const [k, v] of Object.entries(raw.colorLabels)) if (typeof v === "string") colorLabels[k] = v;
  }
  const weekStartDay =
    typeof raw.weekStartDay === "number" && Number.isInteger(raw.weekStartDay) && raw.weekStartDay >= 0 && raw.weekStartDay <= 6
      ? raw.weekStartDay
      : base.weekStartDay;
  const categoryParents: Record<string, ParentCategory> = defaultCategoryParents();
  if (isRecord(raw.categoryParents)) {
    for (const key of COLOR_KEYS) {
      const v = raw.categoryParents[key];
      if (typeof v === "string" && (PARENT_CATEGORIES as string[]).includes(v)) categoryParents[key] = v as ParentCategory;
    }
  }
  return { schemaVersion: 2, colorLabels, weekStartDay, categoryParents };
}
