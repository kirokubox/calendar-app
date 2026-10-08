import { defaultSettings } from "./constants.js";
import type { CalendarEvent, Settings } from "./types.js";

const DB_NAME = "calendar-app";
const DB_VERSION = 1;
const EVENTS = "events";
const SETTINGS = "settings";
const SETTINGS_KEY = "app";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
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

export async function getAllEvents(): Promise<CalendarEvent[]> {
  return run<CalendarEvent[]>(EVENTS, "readonly", (s) => s.getAll());
}

export async function putEvent(event: CalendarEvent): Promise<void> {
  await run<IDBValidKey>(EVENTS, "readwrite", (s) => s.put(event));
}

export async function deleteEvent(id: string): Promise<void> {
  await run<undefined>(EVENTS, "readwrite", (s) => s.delete(id));
}

/** 復元用：複数イベントを1トランザクションで書き込む（同じidは上書き） */
export async function putEvents(events: CalendarEvent[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(EVENTS, "readwrite");
    const store = tx.objectStore(EVENTS);
    for (const e of events) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getSettings(): Promise<Settings> {
  const stored = await run<Settings | undefined>(SETTINGS, "readonly", (s) => s.get(SETTINGS_KEY));
  const base = defaultSettings();
  if (!stored || typeof stored !== "object") return base;
  return { schemaVersion: 1, colorLabels: { ...base.colorLabels, ...(stored.colorLabels ?? {}) } };
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
