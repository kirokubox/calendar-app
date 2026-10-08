import { BACKUP_APP_NAME, COLOR_IDS, defaultSettings } from "./constants.js";
import { isLocalDateTime } from "./dateUtils.js";
import type { BackupFile, CalendarEvent, Settings } from "./types.js";

export function buildBackup(events: CalendarEvent[], settings: Settings, exportedAt: string): BackupFile {
  return { app: BACKUP_APP_NAME, schemaVersion: 1, exportedAt, events, settings };
}

export function backupFileName(dateKey: string): string {
  return `calendar-backup-${dateKey}.json`;
}

export type ValidationResult = { ok: true; backup: BackupFile } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateEventItem(v: unknown, index: number): string | CalendarEvent {
  const at = `events[${index}]`;
  if (!isRecord(v)) return `${at} がオブジェクトではありません`;
  if (typeof v.id !== "string" || v.id === "") return `${at}.id が文字列ではありません`;
  if (typeof v.title !== "string") return `${at}.title が文字列ではありません`;
  if (typeof v.start !== "string" || !isLocalDateTime(v.start)) return `${at}.start が YYYY-MM-DDTHH:mm 形式ではありません`;
  if (typeof v.end !== "string" || !isLocalDateTime(v.end)) return `${at}.end が YYYY-MM-DDTHH:mm 形式ではありません`;
  if (v.end <= v.start) return `${at} の終了が開始以前です`;
  if (typeof v.allDay !== "boolean") return `${at}.allDay が true/false ではありません`;
  if (!(v.colorId === null || (typeof v.colorId === "string" && (COLOR_IDS as readonly string[]).includes(v.colorId)))) {
    return `${at}.colorId が 1〜11 の文字列または null ではありません`;
  }
  if (v.kind !== "plan" && v.kind !== "actual" && v.kind !== "unknown") return `${at}.kind が plan / actual / unknown ではありません`;
  if (typeof v.createdAt !== "string" || typeof v.updatedAt !== "string") return `${at} の createdAt / updatedAt が文字列ではありません`;
  return {
    id: v.id, title: v.title, start: v.start, end: v.end, allDay: v.allDay,
    colorId: v.colorId as string | null, kind: v.kind, createdAt: v.createdAt, updatedAt: v.updatedAt,
  };
}

/** バックアップJSON（パース済みの値）の形式検証。不正なら理由を返す */
export function validateBackup(value: unknown): ValidationResult {
  if (!isRecord(value)) return { ok: false, reason: "JSONの最上位がオブジェクトではありません" };
  if (value.app !== BACKUP_APP_NAME) return { ok: false, reason: `このアプリのバックアップではありません（app が ${BACKUP_APP_NAME} ではありません）` };
  if (value.schemaVersion !== 1) return { ok: false, reason: `未対応の schemaVersion です（${String(value.schemaVersion)}）` };
  if (typeof value.exportedAt !== "string") return { ok: false, reason: "exportedAt がありません" };
  if (!Array.isArray(value.events)) return { ok: false, reason: "events が配列ではありません" };
  const events: CalendarEvent[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < value.events.length; i++) {
    const r = validateEventItem(value.events[i], i);
    if (typeof r === "string") return { ok: false, reason: r };
    if (ids.has(r.id)) return { ok: false, reason: `events[${i}].id が重複しています` };
    ids.add(r.id);
    events.push(r);
  }
  if (!isRecord(value.settings)) return { ok: false, reason: "settings がありません" };
  const labels = value.settings.colorLabels;
  if (!isRecord(labels)) return { ok: false, reason: "settings.colorLabels がありません" };
  const merged = defaultSettings().colorLabels;
  for (const key of Object.keys(merged)) merged[key] = "";
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v !== "string") return { ok: false, reason: `settings.colorLabels の ${k} が文字列ではありません` };
    if (k === "default" || (COLOR_IDS as readonly string[]).includes(k)) merged[k] = v;
  }
  return {
    ok: true,
    backup: {
      app: BACKUP_APP_NAME, schemaVersion: 1, exportedAt: value.exportedAt, events,
      settings: { schemaVersion: 1, colorLabels: merged },
    },
  };
}

export interface BackupSummary {
  count: number;
  /** 最も早い開始日・最も遅い終了日（YYYY-MM-DD）。0件なら null */
  from: string | null;
  to: string | null;
}

export function summarizeBackup(backup: BackupFile): BackupSummary {
  if (backup.events.length === 0) return { count: 0, from: null, to: null };
  let from = backup.events[0].start;
  let to = backup.events[0].end;
  for (const e of backup.events) {
    if (e.start < from) from = e.start;
    if (e.end > to) to = e.end;
  }
  return { count: backup.events.length, from: from.slice(0, 10), to: to.slice(0, 10) };
}

/** 同じidは上書き、それ以外は追加 */
export function mergeEvents(existing: CalendarEvent[], incoming: CalendarEvent[]): CalendarEvent[] {
  const map = new Map<string, CalendarEvent>();
  for (const e of existing) map.set(e.id, e);
  for (const e of incoming) map.set(e.id, e);
  return [...map.values()];
}
