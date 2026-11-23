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

test("翌日が土日と祝日なら休日前の時刻を選ぶ", () => {
  assert.equal(isRestDay("2026-11-15"), true);
  assert.equal(isRestDay("2026-11-16"), false);
  assert.equal(isRestDay("2026-11-23"), true);
  const settings = { ...defaultSettings(), weekdayBedtime: "23:00", holidayBedtime: "01:00" };
  assert.equal(bedtimeSummary([], settings, "2026-11-20", "2026-11-20T20:00")?.bedtime, "2026-11-21T01:00");
  assert.equal(bedtimeSummary([], settings, "2026-11-15", "2026-11-15T20:00")?.bedtime, "2026-11-15T23:00");
  assert.equal(bedtimeSummary([], settings, "2026-11-23", "2026-11-23T20:00")?.bedtime, "2026-11-23T23:00");
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
    passed: false,
    nextPlan: { title: "a", remainingMinutes: 60, ongoing: false },
  });
});

test("予定なしは就寝まで、未設定は非表示、予定時刻を過ぎたら案内", () => {
  const base = defaultSettings();
  assert.equal(bedtimeSummary([], base, "2026-11-16", "2026-11-16T19:00"), null);
  const settings = { ...base, weekdayBedtime: "23:00" };
  assert.equal(bedtimeSummary([], settings, "2026-11-16", "2026-11-16T19:00")?.plannedMinutes, 0);
  assert.equal(bedtimeSummary([], settings, "2026-11-16", "2026-11-16T23:01")?.passed, true);
});

test("日またぎの0時台は前夜の就寝時刻を見る", () => {
  const settings = { ...defaultSettings(), weekdayBedtime: "00:45", holidayBedtime: "02:00" };
  assert.equal(bedtimeSummary([], settings, "2026-11-15", "2026-11-15T01:00")?.bedtime, "2026-11-15T02:00");
  assert.equal(bedtimeSummary([], settings, "2026-11-17", "2026-11-17T00:30")?.bedtime, "2026-11-17T00:45");
  assert.equal(bedtimeSummary([], settings, "2026-11-17", "2026-11-17T01:00")?.passed, true);
});

test("明日の仕事の休暇記録は休日前の時刻を使う", () => {
  const settings = { ...defaultSettings(), weekdayBedtime: "23:00", holidayBedtime: "02:00" };
  const leave = plan("休暇", "2026-11-17T09:00", "2026-11-17T18:00", { subcategory: "休暇", colorId: "11" });
  assert.equal(bedtimeSummary([leave], settings, "2026-11-16", "2026-11-16T21:00")?.bedtime, "2026-11-17T02:00");
});

test("予定の開始前・最中・終了後を切り替える", () => {
  const settings = { ...defaultSettings(), weekdayBedtime: "23:00" };
  const dentist = plan("歯医者", "2026-11-16T20:00", "2026-11-16T20:30");
  assert.deepEqual(bedtimeSummary([dentist], settings, "2026-11-16", "2026-11-16T19:20")?.nextPlan, { title: "歯医者", remainingMinutes: 40, ongoing: false });
  assert.deepEqual(bedtimeSummary([dentist], settings, "2026-11-16", "2026-11-16T20:10")?.nextPlan, { title: "歯医者", remainingMinutes: 20, ongoing: true });
  assert.equal(bedtimeSummary([dentist], settings, "2026-11-16", "2026-11-16T20:31")?.nextPlan, null);
});
