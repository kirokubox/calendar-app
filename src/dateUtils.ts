// ローカル時刻文字列（YYYY-MM-DDTHH:mm）と日付キー（YYYY-MM-DD）の純粋ユーティリティ。
// UTC変換は一切しない。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isDateKey(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

export function isLocalDateTime(value: string): boolean {
  const m = LOCAL_RE.exec(value);
  if (!m) return false;
  if (!isDateKey(`${m[1]}-${m[2]}-${m[3]}`)) return false;
  return Number(m[4]) <= 23 && Number(m[5]) <= 59;
}

export function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocal(date: Date): string {
  return `${dateKeyOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseDateKey(key: string): Date {
  const m = DATE_RE.exec(key);
  if (!m) throw new Error(`不正な日付: ${key}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function parseLocal(value: string): Date {
  const m = LOCAL_RE.exec(value);
  if (!m) throw new Error(`不正な日時: ${value}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return dateKeyOf(d);
}

/** ローカル時刻文字列に分を足す */
export function addMinutes(value: string, minutes: number): string {
  const d = parseLocal(value);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocal(d);
}

/** b - a（分） */
export function diffMinutes(a: string, b: string): number {
  return Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 60000);
}

export function datePart(value: string): string {
  return value.slice(0, 10);
}

export function timePart(value: string): string {
  return value.slice(11, 16);
}

export function joinLocal(dateKey: string, time: string): string {
  return `${dateKey}T${time}`;
}

/** "HH:mm" → 0:00からの分 */
export function timeToMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** 0:00からの分 → "HH:mm"（1440は"24:00"） */
export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function floorTo(minutes: number, step: number): number {
  return Math.floor(minutes / step) * step;
}

export function roundTo(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

/** 日付キーと0:00からの分（1440以上可）からローカル時刻文字列を作る */
export function localFromMinutes(dateKey: string, minutes: number): string {
  return addMinutes(joinLocal(dateKey, "00:00"), minutes);
}

/** 例：10月8日(木) */
export function formatDayLabel(key: string): string {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;
}

export function formatShortDate(key: string): string {
  const d = parseDateKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}
