import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import { pairTravelMarkers, travelPairSummaries } from "../src/markerLogic.js";
import { computeReview, equivalentPreviousCutoff, periodOf, planOnlyReviewEvents, shiftPeriod } from "../src/reviewLogic.js";
import { yearPeople, yearPlaces, yearMonths } from "../src/yearLogic.js";
import type { CalendarEvent, Marker } from "../src/types.js";

const stamp = "2026-01-01T00:00:00.000Z";
const event = (id: string, title: string, start: string, end: string): CalendarEvent => ({
  ...eventDefaults(), id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: stamp, updatedAt: stamp,
});
const marker = (id: string, label: string, at: string): Marker => ({ id, label, at, createdAt: stamp, updatedAt: stamp });

test("年の境目で切り、前年を今年と同じ経過時間で比べる", () => {
  const year = periodOf("year", "2026-11-23", 1);
  assert.deepEqual(year, { kind: "year", start: "2026-01-01", end: "2027-01-01" });
  assert.deepEqual(shiftPeriod(year, -1), { kind: "year", start: "2025-01-01", end: "2026-01-01" });
  const now = "2026-02-01T12:00";
  assert.equal(equivalentPreviousCutoff(year, shiftPeriod(year, -1), now), "2025-02-01T12:00");
  const stats = computeReview([event("a", "年またぎ", "2025-12-31T23:00", "2026-01-01T01:00")], [], year, true, now);
  assert.equal(stats.byColor.default, 60);
  const months = yearMonths(stats, defaultSettings());
  assert.equal(months.length, 12);
  assert.equal(months[0].total, 31 * 1440);
  assert.equal(months[1].total, 12 * 60);
  assert.equal(months[2].total, 0);
});

test("年の上位は通常の人・場所を除き、切り替えで含める", () => {
  const settings = defaultSettings();
  settings.categoryParents["1"] = "仕事";
  settings.categoryParents["2"] = "自由時間";
  const period = periodOf("year", "2026-06-01", 1);
  const events = [
    { ...event("work", "勤務", "2026-01-02T09:00", "2026-01-02T17:00"), colorId: "1", people: ["同僚"], places: ["職場"] },
    { ...event("trip", "散歩", "2026-01-03T10:00", "2026-01-03T12:00"), colorId: "2", people: ["友人"], places: ["外出先＞公園", "移動＞電車", "自宅"] },
  ];
  const cutoff = "2026-02-01T00:00";
  const stats = computeReview(events, [], period, true, cutoff);
  assert.deepEqual(yearPeople(events, period, cutoff, cutoff, false, settings).map((p) => p.name), ["友人"]);
  assert.deepEqual(yearPeople(events, period, cutoff, cutoff, true, settings).map((p) => p.name), ["同僚", "友人"]);
  assert.deepEqual(yearPlaces(stats, events, [], period, cutoff, false).map((p) => p.label), ["外出先＞公園", "自宅"]);
  assert.equal(yearPlaces(stats, events, [], period, cutoff, true).length, 4);
  assert.equal(yearPlaces(stats, events, [], period, cutoff, false)[0].days, 1);
});

test("移動の組は途中の再開始・日またぎ・6時間超え・未対を処理する", () => {
  const markers = [
    marker("a", "家を出た", "2026-01-02T08:00"),
    marker("b", "家を出た", "2026-01-02T08:10"),
    marker("c", "会社着", "2026-01-02T09:00"),
    marker("d", "会社発", "2026-01-02T23:50"),
    marker("e", "帰宅", "2026-01-03T00:20"),
    marker("f", "家を出た", "2026-01-03T09:00"),
    marker("g", "目的地着", "2026-01-03T16:00"),
    marker("h", "目的地発", "2026-01-04T22:00"),
    marker("i", "帰宅", "2026-01-05T05:00"),
  ];
  const pairs = pairTravelMarkers(markers);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].start.id, "b");
  assert.equal(pairs[0].minutes, 50);
  assert.equal(pairs[1].minutes, 30);
  const summary = travelPairSummaries(markers, "2026-01-01", "2026-02-01");
  assert.equal(summary.find((s) => s.key === "toWork")?.average, 50);
});

test("予定専用の振り返りは有効な予定だけを数え、元データを変えない", () => {
  const plan = { ...event("p", "予定", "2026-01-02T10:00", "2026-01-02T11:00"), kind: "plan" as const };
  const cancel = { ...event("c", "中止", "2026-01-02T11:00", "2026-01-02T12:00"), kind: "plan" as const, status: "cancelled" as const };
  const actual = event("a", "実績", "2026-01-02T12:00", "2026-01-02T13:00");
  const input = [plan, cancel, actual];
  const mapped = planOnlyReviewEvents(input);
  assert.deepEqual(mapped.map((e) => e.id), ["p"]);
  assert.equal(mapped[0].kind, "actual");
  assert.equal(plan.kind, "plan");
  assert.equal(computeReview(mapped, [], periodOf("month", "2026-01-02", 1)).byColor.default, 60);
});
