import { MOVING_PLACE, PARENT_CATEGORIES } from "./constants.js";
import { addDays, addMinutes, datePart } from "./dateUtils.js";
import { peopleInPeriod } from "./peopleLogic.js";
import { parsePlace } from "./placeLogic.js";
import { colorKeyOf, computeReview, eventSubcategories, isMainEvent, parentOf, reviewNagaraInterval, type Period, type ReviewStats, type StackedDay } from "./reviewLogic.js";
import type { CalendarEvent, Nagara, ParentCategory, Settings } from "./types.js";

export type YearMonth = { month: string; total: number; parents: Record<ParentCategory, number>; unrecorded: number };

/** 日別の時間を月にまとめる。未来の月は分母0のままにする。 */
export function yearMonths(stats: ReviewStats, settings: Settings): YearMonth[] {
  const year = stats.perDay[0]?.date.slice(0, 4);
  const months = Array.from({ length: 12 }, (_, i): YearMonth => ({
    month: `${year}-${String(i + 1).padStart(2, "0")}`,
    total: 0,
    parents: Object.fromEntries(PARENT_CATEGORIES.map((p) => [p, 0])) as Record<ParentCategory, number>,
    unrecorded: 0,
  }));
  for (const day of stats.perDay) {
    const month = months[Number(day.date.slice(5, 7)) - 1];
    for (const [key, minutes] of Object.entries(day.byColor)) month.parents[parentOf(key, settings)] += minutes;
    month.unrecorded += day.unrecorded;
    month.total += day.unrecorded + Object.values(day.byColor).reduce((sum, n) => sum + n, 0);
  }
  return months;
}

export function monthlyTrend(days: StackedDay[]): StackedDay[] {
  const map = new Map<string, Map<string, StackedDay["segments"][number]>>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const segments = map.get(month) ?? new Map();
    for (const s of day.segments) {
      const old = segments.get(s.key);
      segments.set(s.key, { ...s, minutes: (old?.minutes ?? 0) + s.minutes });
    }
    map.set(month, segments);
  }
  return [...map].map(([month, segments]) => ({ date: `${month}-01`, segments: [...segments.values()] }));
}

export function yearPeople(events: CalendarEvent[], period: Period, cutoff: string, nowLocal: string, includeRoutine: boolean, settings: Settings) {
  const selected = includeRoutine ? events : events.filter((e) => !isRoutineEvent(e, period, cutoff, settings));
  return peopleInPeriod(selected, period, cutoff, nowLocal).slice(0, 10);
}

/** 週・月にも使える、仕事・通勤の除外判定。 */
export function isRoutineEvent(event: CalendarEvent, period: Period, cutoff: string, settings: Settings): boolean {
  return parentOf(colorKeyOf(event), settings) === "仕事" || eventSubcategories(event, period, cutoff).split("・").includes("通勤");
}

export function isRoutinePlace(label: string): boolean {
  const place = parsePlace(label);
  return ["家", "職場", "移動"].includes(place.kind ?? "") || (place.kind === null && (label === "自宅" || label === "会社" || MOVING_PLACE.test(label)));
}

/** 場所の時間は既存の「場所・移動ごとの時間」と同じ集計を使い、日数だけ区間から数える。 */
export function yearPlaces(stats: ReviewStats, events: CalendarEvent[], nagara: Nagara[], period: Period, cutoff: string, includeRoutine: boolean, settings: Settings) {
  const selectedEvents = includeRoutine ? events : events.filter((e) => !isRoutineEvent(e, period, cutoff, settings));
  const selectedIds = new Set(selectedEvents.map((e) => e.id));
  const selectedNagara = includeRoutine ? nagara : nagara.filter((n) => n.eventId === null || selectedIds.has(n.eventId));
  const placeStats = includeRoutine ? stats : computeReview(selectedEvents, selectedNagara, period, true, cutoff);
  const days = new Map<string, Set<string>>();
  const mark = (label: string, start: string, end: string) => {
    const from = start > `${period.start}T00:00` ? start : `${period.start}T00:00`;
    const to = end < cutoff ? end : cutoff;
    if (from >= to) return;
    const set = days.get(label) ?? new Set<string>();
    for (let day = datePart(from), last = datePart(addMinutes(to, -1)); day <= last; day = addDays(day, 1)) set.add(day);
    days.set(label, set);
  };
  for (const e of selectedEvents) if (isMainEvent(e)) for (const label of new Set(e.places)) mark(label, e.start, e.end);
  const eventMap = new Map(selectedEvents.map((e) => [e.id, e]));
  for (const n of selectedNagara) if (n.type === "place") {
    const interval = reviewNagaraInterval(n, eventMap, cutoff);
    if (interval) mark(n.label, interval.start, interval.end);
  }
  return placeStats.placeTotals
    .filter((p) => includeRoutine || !isRoutinePlace(p.label))
    .map((p) => ({ ...p, days: days.get(p.label)?.size ?? 0 }))
    .sort((a, b) => b.minutes + b.sharedMinutes - a.minutes - a.sharedMinutes || a.label.localeCompare(b.label, "ja"))
    .slice(0, 10);
}
