import { addDays, diffMinutes, joinLocal, parseDateKey } from "./dateUtils.js";
import { isHoliday } from "./holidays.js";
import type { CalendarEvent, Settings } from "./types.js";

export interface BedtimeSummary {
  bedtime: string;
  remainingMinutes: number;
  plannedMinutes: number;
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
  const time = isRestDay(todayKey) ? settings.holidayBedtime : settings.weekdayBedtime;
  if (time === null) return null;
  const bedtime = bedtimeDateTime(todayKey, time);
  if (bedtime <= nowLocal) return null;

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

  return { bedtime, remainingMinutes: diffMinutes(nowLocal, bedtime), plannedMinutes };
}
