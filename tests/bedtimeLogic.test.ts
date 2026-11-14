import assert from "node:assert/strict";
import test from "node:test";
import { bedtimeDateTime, bedtimeSummary, isRestDay } from "../src/bedtimeLogic.js";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent } from "../src/types.js";

const STAMP = "2026-11-15T00:00:00.000Z";

function plan(id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, start, end, allDay: false, colorId: null, kind: "plan", createdAt: STAMP, updatedAt: STAMP, ...eventDefaults(), ...extra };
}

test("0:00〜4:59 の就寝予定は翌日の未明として扱う", () => {
  assert.equal(bedtimeDateTime("2026-11-16", "01:00"), "2026-11-17T01:00");
  assert.equal(bedtimeDateTime("2026-11-16", "05:00"), "2026-11-16T05:00");
});

test("土日と祝日は休日の就寝予定を選ぶ", () => {
  assert.equal(isRestDay("2026-11-15"), true);
  assert.equal(isRestDay("2026-11-16"), false);
  assert.equal(isRestDay("2026-11-23"), true);
  const settings = { ...defaultSettings(), weekdayBedtime: "23:00", holidayBedtime: "01:00" };
  assert.equal(bedtimeSummary([], settings, "2026-11-23", "2026-11-23T20:00")?.bedtime, "2026-11-24T01:00");
});

test("重なった予定を二重に数えず、キャンセル・終日・実績を除く", () => {
  const settings = { ...defaultSettings(), weekdayBedtime: "23:00" };
  const events = [
    plan("a", "2026-11-16T20:00", "2026-11-16T21:30"),
    plan("b", "2026-11-16T21:00", "2026-11-16T22:00"),
    plan("cancelled", "2026-11-16T22:00", "2026-11-16T22:30", { status: "cancelled" }),
    plan("all-day", "2026-11-16T00:00", "2026-11-17T00:00", { allDay: true }),
    plan("actual", "2026-11-16T22:00", "2026-11-16T22:30", { kind: "actual" }),
  ];
  assert.deepEqual(bedtimeSummary(events, settings, "2026-11-16", "2026-11-16T19:00"), {
    bedtime: "2026-11-16T23:00",
    remainingMinutes: 240,
    plannedMinutes: 120,
  });
});

test("予定なしは0分、未設定と時刻経過後は表示しない", () => {
  const base = defaultSettings();
  assert.equal(bedtimeSummary([], base, "2026-11-16", "2026-11-16T19:00"), null);
  const settings = { ...base, weekdayBedtime: "23:00" };
  assert.equal(bedtimeSummary([], settings, "2026-11-16", "2026-11-16T19:00")?.plannedMinutes, 0);
  assert.equal(bedtimeSummary([], settings, "2026-11-16", "2026-11-16T23:01"), null);
});
