import {
  addDays, addMinutes, datePart, diffMinutes, floorTo, joinLocal, localFromMinutes, roundTo, timePart, timeToMinutes,
} from "./dateUtils.js";
import type { CalendarEvent, ColorId, EventKind } from "./types.js";

/**
 * 終了日の自動決定。終了時刻が開始時刻より前なら翌日、そうでなければ開始日。
 * （毎日の睡眠 23:30〜6:00 を1回で入れられるようにするため）
 */
export function deriveEndDate(startDate: string, startTime: string, endTime: string): string {
  return endTime < startTime ? addDays(startDate, 1) : startDate;
}

/** 終了日が開始日のちょうど翌日か（「翌日」表示用） */
export function isNextDay(startDate: string, endDate: string): boolean {
  return endDate === addDays(startDate, 1);
}

/** 開始を変えたとき、長さを保って終了も動かす */
export function shiftEnd(oldStart: string, newStart: string, oldEnd: string): string {
  return addMinutes(oldEnd, diffMinutes(oldStart, newStart));
}

/** 新規時の種別の自動判定：開始が現在より未来なら予定、それ以外は実績 */
export function autoKind(start: string, now: string): EventKind {
  return start > now ? "plan" : "actual";
}

/** 終日の保存値：開始日と最終日（含む）から start / end（排他的終端）を作る */
export function buildAllDayRange(startDate: string, lastDate: string): { start: string; end: string } {
  return { start: joinLocal(startDate, "00:00"), end: joinLocal(addDays(lastDate, 1), "00:00") };
}

/** 保存値から終日の最終日（含む）を取り出す */
export function allDayLastDate(end: string): string {
  return addDays(datePart(end), -1);
}

/** 保存可否の検証。保存できないときは理由、できるときは null */
export function validateEvent(title: string, start: string, end: string, allDay: boolean): string | null {
  if (title.trim() === "") return "タイトルを入力してください";
  if (allDay) {
    if (datePart(end) <= datePart(start)) return "終了日が開始日より前になっています";
    return null;
  }
  if (end <= start) return "終了は開始より後にしてください";
  return null;
}

/** タイトル候補：重複除去・新しい順（更新日時の新しい順）・最大200件 */
export function titleSuggestions(events: CalendarEvent[], limit = 200): string[] {
  const sorted = [...events].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.start.localeCompare(a.start));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of sorted) {
    const t = e.title.trim();
    if (t === "" || seen.has(t)) continue;
    seen.add(t);
    result.push(t);
    if (result.length >= limit) break;
  }
  return result;
}

/** タイトルが過去イベントと完全一致するとき、そのタイトルの最新イベントの色。一致なしは undefined（nullは「色指定なし」） */
export function colorForTitle(events: CalendarEvent[], title: string, excludeId?: string): ColorId | undefined {
  const t = title.trim();
  if (t === "") return undefined;
  let best: CalendarEvent | undefined;
  for (const e of events) {
    if (e.id === excludeId || e.title.trim() !== t) continue;
    if (!best || e.updatedAt.localeCompare(best.updatedAt) > 0 || (e.updatedAt === best.updatedAt && e.start > best.start)) best = e;
  }
  return best ? best.colorId : undefined;
}

export interface Range {
  start: string;
  end: string;
}

/** 空き部分をタップして新規作成：開始＝15分切り捨て、終了＝開始+60分 */
export function rangeFromTap(dayKey: string, minutesFromMidnight: number): Range {
  const startMin = Math.max(0, Math.min(floorTo(minutesFromMidnight, 15), 1440 - 15));
  const start = localFromMinutes(dayKey, startMin);
  return { start, end: addMinutes(start, 60) };
}

/**
 * ＋ボタンの新規作成範囲。
 * 今日：開始＝今日の（終日でない）イベントのうち終了が現在以前で最も遅いもの（無ければ現在を15分切り捨て）、
 * 終了＝現在を5分に丸めたもの（開始以下なら開始+60分）。今日以外は12:00〜13:00。
 */
export function rangeForPlusButton(events: CalendarEvent[], dayKey: string, now: string): Range {
  if (dayKey !== datePart(now)) {
    return { start: joinLocal(dayKey, "12:00"), end: joinLocal(dayKey, "13:00") };
  }
  const dayStart = joinLocal(dayKey, "00:00");
  let latest: string | null = null;
  for (const e of events) {
    if (e.allDay) continue;
    if (e.end > dayStart && e.end <= now && (latest === null || e.end > latest)) latest = e.end;
  }
  const nowMin = timeToMinutes(timePart(now));
  const start = latest ?? localFromMinutes(dayKey, floorTo(nowMin, 15));
  let end = localFromMinutes(dayKey, roundTo(nowMin, 5));
  if (end <= start) end = addMinutes(start, 60);
  return { start, end };
}

/** 人を先に出したタイトル。例：めぐちゃん　散歩/外食（人の区切りは「・」、人とタイトルの間は全角スペース） */
export function displayTitle(event: Pick<CalendarEvent, "title" | "people">): string {
  const people = event.people.map((p) => p.trim()).filter((p) => p !== "");
  return people.length > 0 ? `${people.join("・")}　${event.title}` : event.title;
}

/** 配列の項目を上下に入れ替える（範囲外は何もしない） */
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/** チップ項目の追加：前後の空白を削り、空・重複は無視 */
export function addChipValue(list: string[], value: string): string[] {
  const v = value.trim();
  if (v === "" || list.includes(v)) return list;
  return [...list, v];
}

/** 値の候補：重複除去・新しい順（更新日時の新しい順） */
function recentValues(events: CalendarEvent[], pick: (e: CalendarEvent) => string[], limit: number): string[] {
  const sorted = [...events].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.start.localeCompare(a.start));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of sorted) {
    for (const raw of pick(e)) {
      const v = raw.trim();
      if (v === "" || seen.has(v)) continue;
      seen.add(v);
      result.push(v);
      if (result.length >= limit) return result;
    }
  }
  return result;
}

export function peopleSuggestions(events: CalendarEvent[], limit = 100): string[] {
  return recentValues(events, (e) => e.people, limit);
}

export function placeSuggestions(events: CalendarEvent[], limit = 100): string[] {
  return recentValues(events, (e) => e.places, limit);
}

/** 月表示の1日ぶん：その日にかかるイベント（キャンセル・実績がリンクされた予定を除く）のうち最大 max 件と、残りの件数 */
export function monthCellItems(
  events: CalendarEvent[],
  dayKey: string,
  max = 3,
  linkedPlanIds: Set<string> = new Set(),
): { shown: CalendarEvent[]; more: number } {
  const dayStart = joinLocal(dayKey, "00:00");
  const dayEnd = joinLocal(addDays(dayKey, 1), "00:00");
  const hits = events
    .filter((e) => e.status !== "cancelled" && !(e.kind === "plan" && linkedPlanIds.has(e.id)) && e.start < dayEnd && e.end > dayStart)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { shown: hits.slice(0, max), more: Math.max(0, hits.length - max) };
}
