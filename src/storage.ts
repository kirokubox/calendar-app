import { migrateEvent, migrateSettings } from "./migrate.js";
import type { CalendarEvent, Nagara, PlanRevision, RecurrenceRule, Settings } from "./types.js";

const DB_NAME = "calendar-app";
/** 1: events / settings、2: nagara / revisions / recurrences を追加し、イベントと設定を v2 へ移行 */
const DB_VERSION = 2;
const EVENTS = "events";
const SETTINGS = "settings";
const NAGARA = "nagara";
const REVISIONS = "revisions";
const RECURRENCES = "recurrences";
const SETTINGS_KEY = "app";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
      if (!db.objectStoreNames.contains(NAGARA)) db.createObjectStore(NAGARA, { keyPath: "id" });
      if (!db.objectStoreNames.contains(REVISIONS)) db.createObjectStore(REVISIONS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(RECURRENCES)) db.createObjectStore(RECURRENCES, { keyPath: "id" });
      // v1 → v2：既存イベントへ既定値を付け、設定に週の始まり・親カテゴリを足す
      if (tx && ev.oldVersion >= 1 && ev.oldVersion < 2) {
        const events = tx.objectStore(EVENTS);
        const cursorReq = events.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          cursor.update(migrateEvent(cursor.value as Record<string, unknown>));
          cursor.continue();
        };
        const settings = tx.objectStore(SETTINGS);
        const getReq = settings.get(SETTINGS_KEY);
        getReq.onsuccess = () => {
          if (getReq.result) settings.put(migrateSettings(getReq.result), SETTINGS_KEY);
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("別タブを閉じてから、アプリを開き直してください。"));
  });
  return dbPromise;
}

async function run<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = action(tx.objectStore(store));
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
    tx.onerror = () => reject(tx.error);
  });
}

/** 複数ストアへの書き込み・削除を1トランザクションで行う */
async function writeAll(ops: Array<{ store: string; put?: unknown[]; deleteKeys?: string[] }>): Promise<void> {
  const db = await openDb();
  const names = [...new Set(ops.map((o) => o.store))];
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(names, "readwrite");
    for (const op of ops) {
      const store = tx.objectStore(op.store);
      for (const v of op.put ?? []) store.put(v);
      for (const k of op.deleteKeys ?? []) store.delete(k);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 画面操作1回ぶんの変更。複数ストアをまとめて1トランザクションで書く */
export interface Changes {
  putEvents?: CalendarEvent[];
  deleteEventIds?: string[];
  putNagara?: Nagara[];
  deleteNagaraIds?: string[];
  putRevisions?: PlanRevision[];
  deleteRevisionIds?: string[];
  putRecurrences?: RecurrenceRule[];
}

export async function commitChanges(c: Changes): Promise<void> {
  await writeAll([
    { store: EVENTS, put: c.putEvents, deleteKeys: c.deleteEventIds },
    { store: NAGARA, put: c.putNagara, deleteKeys: c.deleteNagaraIds },
    { store: REVISIONS, put: c.putRevisions, deleteKeys: c.deleteRevisionIds },
    { store: RECURRENCES, put: c.putRecurrences },
  ]);
}

export async function getAllEvents(): Promise<CalendarEvent[]> {
  const raw = await run<Array<Record<string, unknown>>>(EVENTS, "readonly", (s) => s.getAll());
  // 念のため読み込み時にも既定値を補う（移行済みなら変化しない）
  return raw.map(migrateEvent);
}

export async function getAllNagara(): Promise<Nagara[]> {
  return run<Nagara[]>(NAGARA, "readonly", (s) => s.getAll());
}

export async function getAllRevisions(): Promise<PlanRevision[]> {
  return run<PlanRevision[]>(REVISIONS, "readonly", (s) => s.getAll());
}

export async function getAllRecurrences(): Promise<RecurrenceRule[]> {
  return run<RecurrenceRule[]>(RECURRENCES, "readonly", (s) => s.getAll());
}

export async function putEvent(event: CalendarEvent): Promise<void> {
  await run<IDBValidKey>(EVENTS, "readwrite", (s) => s.put(event));
}

/** イベントの保存と、付随するながらの追加・更新・削除を1トランザクションで */
export async function saveEventWithNagara(event: CalendarEvent, putNagara: Nagara[], deleteNagaraIds: string[]): Promise<void> {
  await writeAll([
    { store: EVENTS, put: [event] },
    { store: NAGARA, put: putNagara, deleteKeys: deleteNagaraIds },
  ]);
}

/** イベントの削除と、付随するながらの削除を1トランザクションで */
export async function deleteEventWithNagara(id: string, nagaraIds: string[]): Promise<void> {
  await writeAll([
    { store: EVENTS, deleteKeys: [id] },
    { store: NAGARA, deleteKeys: nagaraIds },
  ]);
}

export async function putNagara(n: Nagara): Promise<void> {
  await run<IDBValidKey>(NAGARA, "readwrite", (s) => s.put(n));
}

export async function deleteNagara(id: string): Promise<void> {
  await run<undefined>(NAGARA, "readwrite", (s) => s.delete(id));
}

export async function putRevision(r: PlanRevision): Promise<void> {
  await run<IDBValidKey>(REVISIONS, "readwrite", (s) => s.put(r));
}

export async function putRecurrence(r: RecurrenceRule): Promise<void> {
  await run<IDBValidKey>(RECURRENCES, "readwrite", (s) => s.put(r));
}

/** 復元用：全ストアを1トランザクションで書き込む（同じidは上書き）。設定も同時に保存する */
export async function restoreAll(data: {
  events: CalendarEvent[];
  nagara: Nagara[];
  revisions: PlanRevision[];
  recurrences: RecurrenceRule[];
  settings: Settings;
}): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([EVENTS, NAGARA, REVISIONS, RECURRENCES, SETTINGS], "readwrite");
    for (const e of data.events) tx.objectStore(EVENTS).put(e);
    for (const n of data.nagara) tx.objectStore(NAGARA).put(n);
    for (const r of data.revisions) tx.objectStore(REVISIONS).put(r);
    for (const r of data.recurrences) tx.objectStore(RECURRENCES).put(r);
    tx.objectStore(SETTINGS).put(data.settings, SETTINGS_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getSettings(): Promise<Settings> {
  const stored = await run<unknown>(SETTINGS, "readonly", (s) => s.get(SETTINGS_KEY));
  return migrateSettings(stored);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await run<IDBValidKey>(SETTINGS, "readwrite", (s) => s.put(settings, SETTINGS_KEY));
}

/** 端末のストレージを「消されにくい」永続扱いにするよう要求する。失敗しても無視 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // 無視
  }
}

/** イベントid。非セキュアコンテキスト（http のLAN接続など）では randomUUID が無いので代替する */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
