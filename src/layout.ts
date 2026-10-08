import { addDays, datePart, joinLocal, parseDateKey } from "./dateUtils.js";
import type { CalendarEvent } from "./types.js";

export interface DaySegment {
  event: CalendarEvent;
  /** その日の0:00からの分 */
  startMin: number;
  endMin: number;
  continuesFromPrev: boolean;
  continuesToNext: boolean;
}

export type Placed<T> = T & { col: number; cols: number };
export type PlacedSegment = Placed<DaySegment>;

function minutesBetween(fromLocal: string, toLocal: string): number {
  const a = new Date(`${fromLocal}:00`).getTime();
  const b = new Date(`${toLocal}:00`).getTime();
  return Math.round((b - a) / 60000);
}

export interface DayRange {
  startMin: number;
  endMin: number;
  continuesFromPrev: boolean;
  continuesToNext: boolean;
}

/** 期間（start〜end）のうち、その日にかかる部分だけを切り出す。かからなければ null（ながらのセッションにも使う） */
export function clipRangeToDay(start: string, end: string, dayKey: string): DayRange | null {
  const dayStart = joinLocal(dayKey, "00:00");
  const dayEnd = joinLocal(addDays(dayKey, 1), "00:00");
  if (!(start < dayEnd && end > dayStart)) return null;
  const continuesFromPrev = start < dayStart;
  const continuesToNext = end > dayEnd;
  return {
    startMin: continuesFromPrev ? 0 : minutesBetween(dayStart, start),
    endMin: continuesToNext ? 1440 : minutesBetween(dayStart, end),
    continuesFromPrev,
    continuesToNext,
  };
}

/** 時間指定イベントのうち、その日にかかる部分だけを切り出す。かからなければ null */
export function clipToDay(event: CalendarEvent, dayKey: string): DaySegment | null {
  if (event.allDay) return null;
  const r = clipRangeToDay(event.start, event.end, dayKey);
  return r ? { event, ...r } : null;
}

export function segmentsForDay(events: CalendarEvent[], dayKey: string): DaySegment[] {
  const result: DaySegment[] = [];
  for (const event of events) {
    const seg = clipToDay(event, dayKey);
    if (seg) result.push(seg);
  }
  return result.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
}

/** その日にかかる終日イベント（end は排他的終端） */
export function allDayEventsOn(events: CalendarEvent[], dayKey: string): CalendarEvent[] {
  return events.filter((e) => e.allDay && datePart(e.start) <= dayKey && dayKey < datePart(e.end));
}

/** 短いイベントでも重なり判定が見た目と合うよう、最低でもこの分数ぶんは場所を取るとみなす */
export const MIN_LAYOUT_MINUTES = 20;

/**
 * 重なりのクラスタごとに列数を決める標準的な列分割。
 * クラスタ＝推移的に重なり合うイベントの塊。クラスタ内で最小の空き列へ貼り、列数はクラスタ内の最大列数。
 */
export function layoutColumns<T extends { startMin: number; endMin: number }>(segments: T[]): Array<Placed<T>> {
  const sorted = [...segments].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const placed: Array<Placed<T>> = [];
  let cluster: Array<Placed<T>> = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    const cols = colEnds.length;
    for (const p of cluster) p.cols = cols;
    placed.push(...cluster);
    cluster = [];
    colEnds = [];
    clusterEnd = -1;
  };

  for (const seg of sorted) {
    const effEnd = Math.max(seg.endMin, seg.startMin + MIN_LAYOUT_MINUTES);
    if (cluster.length > 0 && seg.startMin >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= seg.startMin);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(effEnd);
    } else {
      colEnds[col] = effEnd;
    }
    clusterEnd = Math.max(clusterEnd, effEnd);
    cluster.push({ ...seg, col, cols: 1 });
  }
  if (cluster.length > 0) flush();
  return placed;
}

/** 曜日確認用（テスト・表示補助） */
export function weekdayOf(dayKey: string): number {
  return parseDateKey(dayKey).getDay();
}
