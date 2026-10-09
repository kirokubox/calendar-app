import { BACKUP_APP_NAME, COLOR_IDS } from "./constants.js";
import { isLocalDateTime } from "./dateUtils.js";
import { migrateEvent, migrateSettings } from "./migrate.js";
import { normalizeRule } from "./recurrence.js";
import type { BackupFile, CalendarEvent, Nagara, PlanRevision, RecurrenceRule, Settings } from "./types.js";

export interface BackupExtras {
  nagara?: Nagara[];
  revisions?: PlanRevision[];
  recurrences?: RecurrenceRule[];
}

/** schemaVersion 2 のバックアップ（全ストア）を作る */
export function buildBackup(events: CalendarEvent[], settings: Settings, exportedAt: string, extras: BackupExtras = {}): BackupFile {
  return {
    app: BACKUP_APP_NAME, schemaVersion: 2, exportedAt, events,
    nagara: extras.nagara ?? [], revisions: extras.revisions ?? [], recurrences: extras.recurrences ?? [], settings,
  };
}

export function backupFileName(dateKey: string): string {
  return `calendar-backup-${dateKey}.json`;
}

/** sourceVersion＝読み込んだファイルの schemaVersion（1なら週の始まり等の設定を持たない） */
export type ValidationResult = { ok: true; backup: BackupFile; sourceVersion: 1 | 2 } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStrOrNull(v: unknown): boolean {
  return v === null || typeof v === "string";
}

function isStrArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
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
  // v2で追加した項目：あれば型を検証する（v1には無いので、無ければ既定値になる）
  if (v.people !== undefined && !isStrArray(v.people)) return `${at}.people が文字列の配列ではありません`;
  if (v.places !== undefined && !isStrArray(v.places)) return `${at}.places が文字列の配列ではありません`;
  if (v.memo !== undefined && typeof v.memo !== "string") return `${at}.memo が文字列ではありません`;
  if (v.subcategory !== undefined && !isStrOrNull(v.subcategory)) return `${at}.subcategory が文字列または null ではありません`;
  if (v.cancelReason !== undefined && typeof v.cancelReason !== "string") return `${at}.cancelReason が文字列ではありません`;
  if (v.status !== undefined && v.status !== "active" && v.status !== "cancelled") return `${at}.status が active / cancelled ではありません`;
  if (v.source !== undefined && v.source !== "app" && v.source !== "google") return `${at}.source が app / google ではありません`;
  for (const key of ["planId", "recurrenceId", "recurrenceDate", "googleEventId", "importedAt"]) {
    if (v[key] !== undefined && !isStrOrNull(v[key])) return `${at}.${key} が文字列または null ではありません`;
  }
  if (v.original !== undefined && v.original !== null && !isRecord(v.original)) return `${at}.original がオブジェクトまたは null ではありません`;
  return migrateEvent(v);
}

function validateNagaraItem(v: unknown, index: number): string | Nagara {
  const at = `nagara[${index}]`;
  if (!isRecord(v)) return `${at} がオブジェクトではありません`;
  if (typeof v.id !== "string" || v.id === "") return `${at}.id が文字列ではありません`;
  if (typeof v.label !== "string") return `${at}.label が文字列ではありません`;
  if (v.type !== "nagara" && v.type !== "place") return `${at}.type が nagara / place ではありません`;
  if (v.eventId !== undefined && !isStrOrNull(v.eventId)) return `${at}.eventId が文字列または null ではありません`;
  const eventId = (v.eventId as string | null | undefined) ?? null;
  const start = v.start ?? null;
  const end = v.end ?? null;
  if (start !== null && (typeof start !== "string" || !isLocalDateTime(start))) return `${at}.start が YYYY-MM-DDTHH:mm 形式ではありません`;
  if (end !== null && (typeof end !== "string" || !isLocalDateTime(end))) return `${at}.end が YYYY-MM-DDTHH:mm 形式ではありません`;
  if ((start === null) !== (end === null)) return `${at} の start と end は両方指定するか両方空にしてください`;
  if (start !== null && end !== null && end <= start) return `${at} の終了が開始以前です`;
  if (eventId === null && start === null) return `${at} はイベントも時間も指定がありません`;
  if (typeof v.createdAt !== "string" || typeof v.updatedAt !== "string") return `${at} の createdAt / updatedAt が文字列ではありません`;
  return {
    id: v.id, label: v.label, type: v.type, eventId,
    start: start as string | null, end: end as string | null, createdAt: v.createdAt, updatedAt: v.updatedAt,
  };
}

function validateRevisionItem(v: unknown, index: number): string | PlanRevision {
  const at = `revisions[${index}]`;
  if (!isRecord(v)) return `${at} がオブジェクトではありません`;
  if (typeof v.id !== "string" || v.id === "") return `${at}.id が文字列ではありません`;
  if (typeof v.planId !== "string") return `${at}.planId が文字列ではありません`;
  if (typeof v.changedAt !== "string") return `${at}.changedAt が文字列ではありません`;
  const s = v.snapshot;
  if (!isRecord(s)) return `${at}.snapshot がオブジェクトではありません`;
  if (typeof s.title !== "string" || typeof s.start !== "string" || typeof s.end !== "string" || typeof s.allDay !== "boolean") {
    return `${at}.snapshot の title / start / end / allDay が不正です`;
  }
  return {
    id: v.id, planId: v.planId, changedAt: v.changedAt,
    snapshot: {
      title: s.title, start: s.start, end: s.end, allDay: s.allDay,
      colorId: typeof s.colorId === "string" ? s.colorId : null,
      people: isStrArray(s.people) ? (s.people as string[]) : [],
      places: isStrArray(s.places) ? (s.places as string[]) : [],
      memo: typeof s.memo === "string" ? s.memo : "",
      subcategory: typeof s.subcategory === "string" ? s.subcategory : null,
      status: s.status === "cancelled" ? "cancelled" : "active",
      cancelReason: typeof s.cancelReason === "string" ? s.cancelReason : "",
    },
  };
}

function validateRecurrenceItem(v: unknown, index: number): string | RecurrenceRule {
  const at = `recurrences[${index}]`;
  if (!isRecord(v)) return `${at} がオブジェクトではありません`;
  if (typeof v.id !== "string" || v.id === "") return `${at}.id が文字列ではありません`;
  if (typeof v.title !== "string") return `${at}.title が文字列ではありません`;
  if (!(v.colorId === null || typeof v.colorId === "string")) return `${at}.colorId が文字列または null ではありません`;
  if (typeof v.startTime !== "string" || typeof v.endTime !== "string") return `${at} の startTime / endTime が文字列ではありません`;
  if (!Array.isArray(v.weekdays) || !v.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return `${at}.weekdays が 0〜6 の配列ではありません`;
  if (typeof v.startDate !== "string") return `${at}.startDate が文字列ではありません`;
  if (!isStrOrNull(v.endDate)) return `${at}.endDate が文字列または null ではありません`;
  if (typeof v.active !== "boolean") return `${at}.active が true/false ではありません`;
  if (!isStrArray(v.generatedDates)) return `${at}.generatedDates が文字列の配列ではありません`;
  // v0.3.0 で追加した項目（無ければ既定値。あれば型を確かめる）
  for (const k of ["people", "places", "nagaraLabels", "removedDates"]) {
    if (v[k] !== undefined && !isStrArray(v[k])) return `${at}.${k} が文字列の配列ではありません`;
  }
  if (v.subcategory !== undefined && !isStrOrNull(v.subcategory)) return `${at}.subcategory が文字列または null ではありません`;
  if (v.memo !== undefined && typeof v.memo !== "string") return `${at}.memo が文字列ではありません`;
  if (v.excludeHolidays !== undefined && typeof v.excludeHolidays !== "boolean") return `${at}.excludeHolidays が true/false ではありません`;
  return normalizeRule(v).rule;
}

function validateList<T>(
  value: unknown, name: string, validate: (v: unknown, i: number) => string | T, idOf: (t: T) => string,
): { ok: true; items: T[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: `${name} が配列ではありません` };
  const items: T[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const r = validate(value[i], i);
    if (typeof r === "string") return { ok: false, reason: r };
    const id = idOf(r);
    if (ids.has(id)) return { ok: false, reason: `${name}[${i}].id が重複しています` };
    ids.add(id);
    items.push(r);
  }
  return { ok: true, items };
}

/** バックアップJSON（パース済みの値）の形式検証。v1・v2の両方を受け付け、v2の形に揃えて返す。不正なら理由を返す */
export function validateBackup(value: unknown): ValidationResult {
  if (!isRecord(value)) return { ok: false, reason: "JSONの最上位がオブジェクトではありません" };
  if (value.app !== BACKUP_APP_NAME) return { ok: false, reason: `このアプリのバックアップではありません（app が ${BACKUP_APP_NAME} ではありません）` };
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return { ok: false, reason: `未対応の schemaVersion です（${String(value.schemaVersion)}）` };
  const sourceVersion: 1 | 2 = value.schemaVersion;
  if (typeof value.exportedAt !== "string") return { ok: false, reason: "exportedAt がありません" };
  const ev = validateList(value.events, "events", validateEventItem, (e) => e.id);
  if (!ev.ok) return ev;
  let nagara: Nagara[] = [];
  let revisions: PlanRevision[] = [];
  let recurrences: RecurrenceRule[] = [];
  if (sourceVersion === 2) {
    const n = validateList(value.nagara, "nagara", validateNagaraItem, (x) => x.id);
    if (!n.ok) return n;
    const r = validateList(value.revisions, "revisions", validateRevisionItem, (x) => x.id);
    if (!r.ok) return r;
    const c = validateList(value.recurrences, "recurrences", validateRecurrenceItem, (x) => x.id);
    if (!c.ok) return c;
    nagara = n.items;
    revisions = r.items;
    // 墓標（removedDates）が無い旧形式は、同じバックアップのイベントから導出する
    recurrences = (value.recurrences as Array<Record<string, unknown>>).map((raw) => normalizeRule(raw, ev.items).rule);
  }
  if (!isRecord(value.settings)) return { ok: false, reason: "settings がありません" };
  const labels = value.settings.colorLabels;
  if (!isRecord(labels)) return { ok: false, reason: "settings.colorLabels がありません" };
  // 欠けた色の名前は空文字で補う（既定のカテゴリ名では補わない）
  const colorLabels = migrateSettings(null).colorLabels;
  for (const key of Object.keys(colorLabels)) colorLabels[key] = "";
  for (const [k, v] of Object.entries(labels)) {
    if (typeof v !== "string") return { ok: false, reason: `settings.colorLabels の ${k} が文字列ではありません` };
    if (k === "default" || (COLOR_IDS as readonly string[]).includes(k)) colorLabels[k] = v;
  }
  const migrated = migrateSettings(value.settings);
  return {
    ok: true,
    sourceVersion,
    backup: {
      app: BACKUP_APP_NAME, schemaVersion: 2, exportedAt: value.exportedAt, events: ev.items, nagara, revisions, recurrences,
      settings: { schemaVersion: 2, colorLabels, weekStartDay: migrated.weekStartDay, categoryParents: migrated.categoryParents, startView: migrated.startView },
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

/** 同じidは上書き、それ以外は追加（全ストア共通） */
export function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map<string, T>();
  for (const e of existing) map.set(e.id, e);
  for (const e of incoming) map.set(e.id, e);
  return [...map.values()];
}

/** 同じidは上書き、それ以外は追加 */
export function mergeEvents(existing: CalendarEvent[], incoming: CalendarEvent[]): CalendarEvent[] {
  return mergeById(existing, incoming);
}

/** 復元時に保存する設定。v1のバックアップは週の始まり・親カテゴリを持たないので、今の設定を残す */
export function settingsForRestore(backup: BackupFile, sourceVersion: 1 | 2, current: Settings): Settings {
  if (sourceVersion === 2) return backup.settings;
  return { ...backup.settings, weekStartDay: current.weekStartDay, categoryParents: current.categoryParents, startView: current.startView };
}
