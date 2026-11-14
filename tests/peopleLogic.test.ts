import assert from "node:assert/strict";
import test from "node:test";
import { eventDefaults } from "../src/migrate.js";
import { peopleInPeriod } from "../src/peopleLogic.js";
import { periodOf } from "../src/reviewLogic.js";
import type { CalendarEvent } from "../src/types.js";

const STAMP = "2026-10-01T00:00:00.000Z";

function ev(id: string, start: string, end: string, people: string[], extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, start, end, allDay: false, colorId: null, kind: "actual", createdAt: STAMP, updatedAt: STAMP, ...eventDefaults(), people, ...extra };
}

// 2026-10-05 は月曜。週は 10/5〜10/11
const WEEK = periodOf("week", "2026-10-08", 1);
const END = "2026-10-12T00:00";
const NOW = "2026-10-20T12:00";

test("人ごと：時間・日数・件数を人ごとにまとめ、時間の長い順に並べる", () => {
  const rows = peopleInPeriod([
    ev("a", "2026-10-05T19:00", "2026-10-05T21:00", ["Aさん"]),
    ev("b", "2026-10-07T12:00", "2026-10-07T13:00", ["Aさん", "Bさん"]),
    ev("c", "2026-10-08T10:00", "2026-10-08T10:30", ["Bさん"]),
  ], WEEK, END, NOW);
  assert.deepEqual(rows.map((r) => [r.name, r.minutes, r.days, r.count]), [["Aさん", 180, 2, 2], ["Bさん", 90, 2, 2]]);
});

test("人ごと：同じ人の重なった記録は1回だけ数える。同じ記録の重複した名前・空の名前は無視する", () => {
  const rows = peopleInPeriod([
    ev("a", "2026-10-05T19:00", "2026-10-05T21:00", ["Aさん", " Aさん ", ""]),
    ev("b", "2026-10-05T20:00", "2026-10-05T22:00", ["Aさん"]),
  ], WEEK, END, NOW);
  assert.deepEqual(rows.map((r) => [r.name, r.minutes, r.days, r.count]), [["Aさん", 180, 1, 2]]);
});

test("人ごと：予定・キャンセル・終日・人のいない記録は数えない", () => {
  const rows = peopleInPeriod([
    ev("plan", "2026-10-05T19:00", "2026-10-05T21:00", ["Aさん"], { kind: "plan" }),
    ev("cancel", "2026-10-06T19:00", "2026-10-06T21:00", ["Aさん"], { status: "cancelled" }),
    ev("allday", "2026-10-07T00:00", "2026-10-08T00:00", ["Aさん"], { allDay: true }),
    ev("alone", "2026-10-08T19:00", "2026-10-08T21:00", []),
  ], WEEK, END, NOW);
  assert.deepEqual(rows, []);
});

test("人ごと：期間と集計の終わりで切る。0時をまたぐ記録は両方の日に数える", () => {
  const rows = peopleInPeriod([
    ev("before", "2026-10-04T23:00", "2026-10-05T01:00", ["Aさん"]),
    ev("night", "2026-10-06T23:00", "2026-10-07T01:00", ["Aさん"]),
    ev("after-cutoff", "2026-10-08T11:00", "2026-10-08T13:00", ["Aさん"]),
  ], WEEK, "2026-10-08T12:00", "2026-10-08T12:00");
  // 期間の前の1時間は除く（60）＋夜またぎ（120）＋集計の終わりまで（60）
  assert.deepEqual(rows.map((r) => [r.minutes, r.days, r.count]), [[240, 4, 3]]);
});

test("人ごと：最後に会った日は期間に関係なく、現在時刻までに始まった記録から出す", () => {
  const rows = peopleInPeriod([
    ev("in", "2026-10-05T19:00", "2026-10-05T21:00", ["Aさん"]),
    ev("later", "2026-10-15T19:00", "2026-10-15T21:00", ["Aさん"]),
    ev("future", "2026-10-25T19:00", "2026-10-25T21:00", ["Aさん"]),
    ev("other", "2026-10-16T19:00", "2026-10-16T21:00", ["Cさん"]),
  ], WEEK, END, NOW);
  assert.deepEqual(rows.map((r) => [r.name, r.lastDate]), [["Aさん", "2026-10-15"]]);
});
