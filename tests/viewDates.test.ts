import assert from "node:assert/strict";
import test from "node:test";
import { addMonths, diffDays, endOfMonth, formatMonthLabel, formatWeekRangeLabel, monthGridWeeks, startOfMonth, startOfWeek, weekDayKeys, weekdayName } from "../src/dateUtils.js";

test("週の初日：月曜始まり・日曜始まり・木曜始まり", () => {
  // 2026-10-08 は木曜
  assert.equal(startOfWeek("2026-10-08", 1), "2026-10-05");
  assert.equal(startOfWeek("2026-10-08", 0), "2026-10-04");
  assert.equal(startOfWeek("2026-10-05", 1), "2026-10-05");
  assert.equal(startOfWeek("2026-10-11", 1), "2026-10-05");
  assert.equal(startOfWeek("2026-10-08", 4), "2026-10-08");
});

test("週の7日：月・年をまたぐ", () => {
  assert.deepEqual(weekDayKeys("2026-10-08", 1), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  assert.equal(weekDayKeys("2026-10-08", 0)[0], "2026-10-04");
  assert.equal(weekDayKeys("2026-12-31", 1)[0], "2026-12-28");
  assert.equal(weekDayKeys("2026-12-31", 1)[6], "2027-01-03");
});

test("月の足し引き：月末に丸める・年をまたぐ", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-10-08", -10), "2025-12-08");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
});

test("月の初日・末日", () => {
  assert.equal(startOfMonth("2026-10-08"), "2026-10-01");
  assert.equal(endOfMonth("2026-10-08"), "2026-10-31");
  assert.equal(endOfMonth("2028-02-10"), "2028-02-29");
  assert.equal(endOfMonth("2026-12-01"), "2026-12-31");
});

test("月表示のグリッド：週の始まりに合わせて月にかかる週を並べる", () => {
  // 2026年10月：1日は木曜。月曜始まりなら 9/28 から 11/1 までの5週
  const w = monthGridWeeks("2026-10-08", 1);
  assert.equal(w.length, 5);
  assert.equal(w[0][0], "2026-09-28");
  assert.equal(w[4][6], "2026-11-01");
  assert.ok(w.every((week) => week.length === 7));
  // 日曜始まり
  const s = monthGridWeeks("2026-10-08", 0);
  assert.equal(s[0][0], "2026-09-27");
  assert.equal(s[s.length - 1][6], "2026-10-31");
  // 6週になる月：2026年8月（1日が土曜）、月曜始まり
  assert.equal(monthGridWeeks("2026-08-15", 1).length, 6);
  // 2月で1日が月曜、28日まで：ちょうど4週
  assert.equal(monthGridWeeks("2027-02-10", 1).length, 4);
});

test("日数差・表示ラベル", () => {
  assert.equal(diffDays("2026-10-01", "2026-10-08"), 7);
  assert.equal(diffDays("2026-10-08", "2026-10-01"), -7);
  assert.equal(formatMonthLabel("2026-10-08"), "2026年10月");
  assert.equal(formatWeekRangeLabel("2026-10-08", 1), "10/5(月)〜10/11(日)");
  assert.equal(weekdayName(0), "日");
  assert.equal(weekdayName(7), "日");
  assert.equal(weekdayName(1), "月");
});
