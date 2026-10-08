import assert from "node:assert/strict";
import test from "node:test";
import { allDayEventsOn, clipToDay, layoutColumns, segmentsForDay } from "../src/layout.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent } from "../src/types.js";

function ev(id: string, start: string, end: string, allDay = false): CalendarEvent {
  return { id, title: id, start, end, allDay, colorId: null, kind: "actual", createdAt: "x", updatedAt: "x", ...eventDefaults() };
}

test("その日に収まるイベントはそのまま", () => {
  const s = clipToDay(ev("a", "2026-10-08T10:00", "2026-10-08T11:30"), "2026-10-08");
  assert.deepEqual([s?.startMin, s?.endMin, s?.continuesFromPrev, s?.continuesToNext], [600, 690, false, false]);
});

test("日跨ぎ（睡眠23:30〜6:00）：前日側は翌日へ続く、当日側は前日から続く", () => {
  const sleep = ev("s", "2026-10-07T23:30", "2026-10-08T06:00");
  const d7 = clipToDay(sleep, "2026-10-07");
  assert.deepEqual([d7?.startMin, d7?.endMin, d7?.continuesFromPrev, d7?.continuesToNext], [1410, 1440, false, true]);
  const d8 = clipToDay(sleep, "2026-10-08");
  assert.deepEqual([d8?.startMin, d8?.endMin, d8?.continuesFromPrev, d8?.continuesToNext], [0, 360, true, false]);
  assert.equal(clipToDay(sleep, "2026-10-09"), null);
});

test("24:00ちょうどで終わるイベントは翌日に出ない", () => {
  const e = ev("a", "2026-10-08T22:00", "2026-10-09T00:00");
  assert.equal(clipToDay(e, "2026-10-09"), null);
  assert.equal(clipToDay(e, "2026-10-08")?.continuesToNext, false);
});

test("3日にまたがるイベントは中日が全日を占める", () => {
  const e = ev("a", "2026-10-07T20:00", "2026-10-09T08:00");
  const mid = clipToDay(e, "2026-10-08");
  assert.deepEqual([mid?.startMin, mid?.endMin, mid?.continuesFromPrev, mid?.continuesToNext], [0, 1440, true, true]);
});

test("終日イベントは時間軸に出ず、帯に出る（終端は排他的）", () => {
  const trip = ev("t", "2026-10-08T00:00", "2026-10-10T00:00", true);
  assert.equal(clipToDay(trip, "2026-10-08"), null);
  assert.equal(allDayEventsOn([trip], "2026-10-08").length, 1);
  assert.equal(allDayEventsOn([trip], "2026-10-09").length, 1);
  assert.equal(allDayEventsOn([trip], "2026-10-10").length, 0);
  assert.equal(allDayEventsOn([trip], "2026-10-07").length, 0);
});

test("列分割：重ならないものは1列", () => {
  const segs = segmentsForDay([ev("a", "2026-10-08T09:00", "2026-10-08T10:00"), ev("b", "2026-10-08T10:00", "2026-10-08T11:00")], "2026-10-08");
  const placed = layoutColumns(segs);
  assert.deepEqual(placed.map((p) => [p.col, p.cols]), [[0, 1], [0, 1]]);
});

test("列分割：重なる2件は2列", () => {
  const segs = segmentsForDay([ev("a", "2026-10-08T09:00", "2026-10-08T11:00"), ev("b", "2026-10-08T10:00", "2026-10-08T12:00")], "2026-10-08");
  const placed = layoutColumns(segs);
  assert.deepEqual(placed.map((p) => [p.event.id, p.col, p.cols]), [["a", 0, 2], ["b", 1, 2]]);
});

test("列分割：クラスタごとに列数が決まる（連鎖して重なるA-B、B-C）", () => {
  // A 9-11, B 10-13, C 12-14 : A と C は重ならないので C は列0を再利用、クラスタ全体で2列
  // D 15-16 は別クラスタで1列
  const segs = segmentsForDay([
    ev("a", "2026-10-08T09:00", "2026-10-08T11:00"),
    ev("b", "2026-10-08T10:00", "2026-10-08T13:00"),
    ev("c", "2026-10-08T12:00", "2026-10-08T14:00"),
    ev("d", "2026-10-08T15:00", "2026-10-08T16:00"),
  ], "2026-10-08");
  const m = Object.fromEntries(layoutColumns(segs).map((p) => [p.event.id, [p.col, p.cols]]));
  assert.deepEqual(m, { a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
});

test("列分割：3件が同時に重なると3列", () => {
  const segs = segmentsForDay([
    ev("a", "2026-10-08T09:00", "2026-10-08T12:00"),
    ev("b", "2026-10-08T09:30", "2026-10-08T12:00"),
    ev("c", "2026-10-08T10:00", "2026-10-08T12:00"),
  ], "2026-10-08");
  assert.deepEqual(layoutColumns(segs).map((p) => p.cols), [3, 3, 3]);
});

test("列分割：短い(5分)イベント直後の開始は見た目の最小高さ内なら重なり扱い", () => {
  const segs = segmentsForDay([ev("a", "2026-10-08T09:00", "2026-10-08T09:05"), ev("b", "2026-10-08T09:10", "2026-10-08T10:00")], "2026-10-08");
  assert.deepEqual(layoutColumns(segs).map((p) => p.cols), [2, 2]);
});
