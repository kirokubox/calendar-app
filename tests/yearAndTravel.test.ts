import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import { pairTravelMarkers, travelPairSummaries } from "../src/markerLogic.js";
import { computeReview, equivalentPreviousCutoff, periodOf, shiftPeriod } from "../src/reviewLogic.js";
import { yearlyLastItems, yearMonths } from "../src/yearLogic.js";
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

test("前回の一覧の今年の回数は実績がある日数で数える", () => {
  const settings = defaultSettings();
  const items = [{ id: "x", name: "散歩", targetDays: null }];
  const events = [
    event("old", "散歩", "2025-12-31T23:00", "2026-01-01T01:00"),
    event("a", "散歩", "2026-01-02T10:00", "2026-01-02T11:00"),
    event("b", "散歩", "2026-01-02T15:00", "2026-01-02T16:00"),
    event("c", "散歩", "2026-03-04T10:00", "2026-03-04T11:00"),
    { ...event("plan", "散歩", "2026-01-03T10:00", "2026-01-03T11:00"), kind: "plan" as const },
  ];
  const rows = yearlyLastItems(items, events, [], [], settings, "2026-01-01", "2027-01-01", "2026-02-01T00:00");
  assert.equal(rows[0].count, 1);
  assert.equal(rows[0].last, "2026-01-02");
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
