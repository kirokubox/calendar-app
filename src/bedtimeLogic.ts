import { addDays, diffMinutes, joinLocal, parseDateKey } from "./dateUtils.js";
import { isHoliday } from "./holidays.js";
import type { CalendarEvent, Settings } from "./types.js";
import { colorKeyOf, parentOf } from "./reviewLogic.js";

export interface BedtimeSummary {
  bedtime: string;
  remainingMinutes: number;
  plannedMinutes: number;
  passed: boolean;
  nextPlan: { title: string; remainingMinutes: number; ongoing: boolean } | null;
}

export function isRestDay(dayKey: string): boolean {
  const day = parseDateKey(dayKey).getDay();
  return day === 0 || day === 6 || isHoliday(dayKey);
}

/** 0:00〜4:59 は、その日の続き（翌日未明）として日時へ直す。 */
export function bedtimeDateTime(dayKey: string, time: string): string {
  return joinLocal(time < "05:00" ? addDays(dayKey, 1) : dayKey, time);
}

/** 今日の就寝予定までの残り時間と、重なりを二重計上しない予定時間。 */
export function bedtimeSummary(events: CalendarEvent[], settings: Settings, todayKey: string, nowLocal: string): BedtimeSummary | null {
  const nightKey = nowLocal.slice(11, 16) < "05:00" ? addDays(todayKey, -1) : todayKey;
  const tomorrow = addDays(nightKey, 1);
  const leaveTomorrow = events.some((e) => e.start.slice(0, 10) === tomorrow && e.status !== "cancelled" && e.subcategory === "休暇" && parentOf(colorKeyOf(e), settings) === "仕事");
  const time = isRestDay(tomorrow) || leaveTomorrow ? settings.holidayBedtime : settings.weekdayBedtime;
  if (time === null) return null;
  const bedtime = bedtimeDateTime(nightKey, time);
  if (bedtime <= nowLocal) return { bedtime, remainingMinutes: 0, plannedMinutes: 0, passed: true, nextPlan: null };

  const plans = events.filter((e) => e.kind === "plan" && e.status !== "cancelled" && !e.allDay && e.start < bedtime && e.end > nowLocal).sort((a, b) => a.start.localeCompare(b.start));
  const ongoing = plans.filter((e) => e.start <= nowLocal).sort((a, b) => a.end.localeCompare(b.end))[0];
  const next = ongoing ?? plans[0];
  const nextPlan = next ? { title: next.title, remainingMinutes: diffMinutes(nowLocal, ongoing ? ongoing.end : next.start), ongoing: Boolean(ongoing) } : null;

  const intervals = events
    .filter((e) => e.kind === "plan" && e.status !== "cancelled" && !e.allDay && e.start < bedtime && e.end > nowLocal)
    .map((e) => ({ start: e.start < nowLocal ? nowLocal : e.start, end: e.end > bedtime ? bedtime : e.end }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));

  let plannedMinutes = 0;
  let current: { start: string; end: string } | null = null;
  for (const interval of intervals) {
    if (current === null) {
      current = { ...interval };
    } else if (interval.start <= current.end) {
      if (interval.end > current.end) current.end = interval.end;
    } else {
      plannedMinutes += diffMinutes(current.start, current.end);
      current = { ...interval };
    }
  }
  if (current) plannedMinutes += diffMinutes(current.start, current.end);

  return { bedtime, remainingMinutes: diffMinutes(nowLocal, bedtime), plannedMinutes, passed: false, nextPlan };
}
