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

const WEEKDAY_NAMES = WEEKDAYS;

/** 0=日〜6=土 の曜日名 */
export function weekdayName(index: number): string {
  return WEEKDAY_NAMES[((index % 7) + 7) % 7];
}

/** 曜日の色分け用のクラス名：土＝sat、日＝sun、平日＝空 */
export function weekendClass(key: string): string {
  const d = parseDateKey(key).getDay();
  return d === 6 ? "sat" : d === 0 ? "sun" : "";
}

/** 週の始まりの曜日（0=日〜6=土）に合わせた、その日を含む週の初日 */
export function startOfWeek(key: string, weekStartDay: number): string {
  const back = (parseDateKey(key).getDay() - weekStartDay + 7) % 7;
  return addDays(key, -back);
}

/** その日を含む週の7日分の日付キー */
export function weekDayKeys(key: string, weekStartDay: number): string[] {
  const first = startOfWeek(key, weekStartDay);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** 月の1日 */
export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** 月の末日 */
export function endOfMonth(key: string): string {
  return addDays(addMonths(startOfMonth(key), 1), -1);
}

/** 月を足す。移動先の月に同じ日が無ければ月末に丸める（1/31 → 2/28） */
export function addMonths(key: string, months: number): string {
  const d = parseDateKey(key);
  const day = d.getDate();
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(day, last));
  return dateKeyOf(first);
}

/** 月表示のグリッド：その月にかかる週を、週の始まりに合わせて並べる（各週7日） */
export function monthGridWeeks(key: string, weekStartDay: number): string[][] {
  const first = startOfWeek(startOfMonth(key), weekStartDay);
  const lastDay = endOfMonth(key);
  const weeks: string[][] = [];
  for (let start = first; start <= lastDay; start = addDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
  }
  return weeks;
}

/** 2つの日付キーの差（b - a、日数） */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDateKey(b).getTime() - parseDateKey(a).getTime()) / 86400000);
}

/** 例：2026年10月 */
export function formatMonthLabel(key: string): string {
  return `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`;
}

/** 例：10/5(月)〜10/11(日) */
export function formatWeekRangeLabel(key: string, weekStartDay: number): string {
  const days = weekDayKeys(key, weekStartDay);
  return `${formatShortDate(days[0])}〜${formatShortDate(days[6])}`;
}
