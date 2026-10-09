import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays, addMinutes, diffMinutes, floorTo, formatDayLabel, isDateKey, isLocalDateTime, localFromMinutes, minutesToTime, roundTo, timeToMinutes, toLocal, weekendClass,
} from "../src/dateUtils.js";
import { colorHex, textColorOn } from "../src/colors.js";

test("addDays：月またぎ・年またぎ・うるう日", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-10-08", -8), "2026-09-30");
});

test("addMinutes / diffMinutes は日跨ぎを正しく扱う", () => {
  assert.equal(addMinutes("2026-10-08T23:30", 60), "2026-10-09T00:30");
  assert.equal(diffMinutes("2026-10-08T23:30", "2026-10-09T06:00"), 390);
});

test("localFromMinutes：1440は翌日0:00", () => {
  assert.equal(localFromMinutes("2026-10-08", 1440), "2026-10-09T00:00");
  assert.equal(localFromMinutes("2026-10-08", 75), "2026-10-08T01:15");
});

test("floorTo / roundTo", () => {
  assert.equal(floorTo(14 * 60 + 29, 15), 14 * 60 + 15);
  assert.equal(roundTo(10 * 60 + 33, 5), 10 * 60 + 35);
  assert.equal(roundTo(10 * 60 + 32, 5), 10 * 60 + 30);
});

test("時刻の変換", () => {
  assert.equal(timeToMinutes("06:30"), 390);
  assert.equal(minutesToTime(390), "06:30");
  assert.equal(minutesToTime(1440), "24:00");
});

test("日付ラベル：10月8日(木)", () => {
  assert.equal(formatDayLabel("2026-10-08"), "10月8日(木)");
});

test("toLocalはローカル時刻のまま文字列化する（UTC変換しない）", () => {
  assert.equal(toLocal(new Date(2026, 9, 8, 0, 5)), "2026-10-08T00:05");
});

test("形式判定", () => {
  assert.equal(isDateKey("2026-02-30"), false);
  assert.equal(isDateKey("2026-10-08"), true);
  assert.equal(isLocalDateTime("2026-10-08T24:00"), false);
  assert.equal(isLocalDateTime("2026-10-08T23:59"), true);
});

test("文字色：黄色には黒、濃い色には白", () => {
  assert.equal(textColorOn(colorHex("5")), "#1f1f1f");
  assert.equal(textColorOn(colorHex("11")), "#ffffff");
  assert.equal(textColorOn(colorHex(null)), "#ffffff");
  assert.equal(textColorOn(colorHex("2")), "#ffffff");
});

test("曜日の色分けクラス：土＝sat、日＝sun、平日は空", () => {
  assert.equal(weekendClass("2026-10-10"), "sat");
  assert.equal(weekendClass("2026-10-11"), "sun");
  assert.equal(weekendClass("2026-10-12"), "");
});
