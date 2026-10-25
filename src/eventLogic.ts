import {
  addDays, addMinutes, datePart, diffMinutes, floorTo, joinLocal, localFromMinutes, roundTo, timePart, timeToMinutes,
} from "./dateUtils.js";
import { remainingPlanRanges } from "./planLogic.js";
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

/**
 * ＋ボタンから作るとき（終了＝押した時刻で固定）に開始時刻だけを変えたときの開始日。
 * 終了の日かその前日なら、終了より前で最も近い日を選ぶ（0:30に「23:40から」と直すと前日の23:40になる）。
 * それより前の日を自分で選んでいるときは、その日のまま。
 */
export function startDateKeepingEnd(startDate: string, newStartTime: string, end: string): string {
  const endDate = datePart(end);
  const dayBefore = addDays(endDate, -1);
  if (startDate !== endDate && startDate !== dayBefore) return startDate;
  return joinLocal(endDate, newStartTime) < end ? endDate : dayBefore;
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

/** ＋ボタンで、前日に終わった記録を開始に使う範囲（分） */
const PLUS_LOOKBACK_MINUTES = 8 * 60;

/**
 * ＋ボタンの新規作成範囲。
 * 今日：開始＝今日（日付が変わった直後は、前日のうち現在から8時間以内）に終わった（終日でない）イベントのうち
 * 終了が現在以前で最も遅いもの（無ければ現在を15分切り捨て）、
 * 終了＝現在を5分に丸めたもの（開始以下なら開始+60分）。今日以外は12:00〜13:00。
 */
export function rangeForPlusButton(events: CalendarEvent[], dayKey: string, now: string): Range {
  if (dayKey !== datePart(now)) {
    return { start: joinLocal(dayKey, "12:00"), end: joinLocal(dayKey, "13:00") };
  }
  // 日付が変わった直後でも前の記録の続きから始められるよう、前日に終わった記録も、現在から8時間以内なら見る
  const dayStart = joinLocal(dayKey, "00:00");
  const recent = addMinutes(now, -PLUS_LOOKBACK_MINUTES);
  const lookFrom = recent < dayStart ? recent : dayStart;
  let latest: string | null = null;
  for (const e of events) {
    if (e.allDay) continue;
    if (e.end > lookFrom && e.end <= now && (latest === null || e.end > latest)) latest = e.end;
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

/** タイトルを「→」「/」で区切った要素（前後の空白を除く・空は捨てる）。複合タイトルの中にあるラベルを見つけるために使う */
export function titleTokens(title: string): string[] {
  return title.split(/[→/／]/).map((t) => t.trim()).filter((t) => t !== "");
}

export interface BlockLines {
  /** タイトルの最大行数（1〜3） */
  titleLines: number;
  /** 人を独立した1行目に出すか（false のときはタイトルの前に付ける） */
  peopleLine: boolean;
  nagaraLine: boolean;
  placeLine: boolean;
  timeLine: boolean;
}

/**
 * ブロックの高さに入る行数から、何を何行で出すかを決める。
 * 文字で埋め尽くさないよう、タイトルは最大3行。足りないときは 時刻 → 場所 → ながら → 人の行 の順に省く。
 */
export function blockLines(
  availableLines: number,
  has: { people: boolean; nagara: boolean; place: boolean },
  opts: { time: boolean; maxTitleLines?: number } = { time: true },
): BlockLines {
  const max = opts.maxTitleLines ?? 3;
  const lines = Math.max(1, Math.floor(availableLines));
  let peopleLine = has.people;
  let nagaraLine = has.nagara;
  let placeLine = has.place;
  const extras = () => Number(peopleLine) + Number(nagaraLine) + Number(placeLine);
  if (lines < extras() + 1) placeLine = false;
  if (lines < extras() + 1) nagaraLine = false;
  if (lines < extras() + 1) peopleLine = false;
  // 1行しか無いときは、人の行を作らずタイトルの前に付ける
  if (lines < 2) peopleLine = false;
  const rest = lines - extras();
  const timeLine = opts.time && rest >= 2;
  return { titleLines: Math.max(1, Math.min(max, rest - (timeLine ? 1 : 0))), peopleLine, nagaraLine, placeLine, timeLine };
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

/** 細分類の候補：入力履歴から新しい順（表記ゆれは統合しない） */
export function subcategorySuggestions(events: CalendarEvent[], limit = 100): string[] {
  return recentValues(events, (e) => (e.subcategory ? [e.subcategory] : []), limit);
}

/** ワンタップ候補：固定候補を先に、続けて履歴の新しい順。選択済みは除く */
export function quickCandidates(fixed: string[], history: string[], selected: string[], historyCount = 5): string[] {
  const out = fixed.filter((f) => !selected.includes(f));
  let added = 0;
  for (const h of history) {
    if (added >= historyCount) break;
    if (selected.includes(h) || out.includes(h) || fixed.includes(h)) continue;
    out.push(h);
    added++;
  }
  return out;
}

/** 月表示の1日ぶん：その日にかかるイベント（キャンセル・消化済み予定を除く）のうち最大 max 件と、残りの件数 */
export function monthCellItems(
  events: CalendarEvent[],
  dayKey: string,
  max = 3,
  linkedPlanIds: Set<string> = new Set(),
): { shown: CalendarEvent[]; more: number } {
  const dayStart = joinLocal(dayKey, "00:00");
  const dayEnd = joinLocal(addDays(dayKey, 1), "00:00");
  const hits = events
    .filter((e) => {
      if (e.status === "cancelled") return false;
      if (e.kind === "plan" && linkedPlanIds.has(e.id)) {
        return remainingPlanRanges(e, events).some((range) => range.start < dayEnd && range.end > dayStart);
      }
      return e.start < dayEnd && e.end > dayStart;
    })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { shown: hits.slice(0, max), more: Math.max(0, hits.length - max) };
}
