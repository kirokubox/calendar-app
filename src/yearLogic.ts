import { PARENT_CATEGORIES } from "./constants.js";
import { searchAll } from "./searchLogic.js";
import { parentOf, type ReviewStats, type StackedDay } from "./reviewLogic.js";
import type { CalendarEvent, LastItem, Marker, Nagara, ParentCategory, Settings } from "./types.js";

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

export function yearlyLastItems(items: LastItem[], events: CalendarEvent[], nagara: Nagara[], markers: Marker[], settings: Settings, start: string, end: string, nowLocal: string) {
  return items.map((item) => {
    const hits = searchAll(events, nagara, markers, settings, { text: item.name, field: "all", from: start, to: end, kind: "actual" })
      .filter((hit) => hit.start >= `${start}T00:00` && hit.start < `${end}T00:00` && hit.start <= nowLocal);
    const dates = new Set(hits.map((hit) => hit.start.slice(0, 10)));
    const sorted = [...dates].sort();
    return { item, count: dates.size, last: sorted[sorted.length - 1] ?? null };
  }).sort((a, b) => b.count - a.count || a.item.name.localeCompare(b.item.name));
}
