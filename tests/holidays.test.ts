import assert from "node:assert/strict";
import test from "node:test";
import { holidayName, holidaysOfYear, isHoliday, shortHolidayName } from "../src/holidays.js";

// 内閣府「国民の祝日について」の一覧と照合
const EXPECTED: Record<number, string[]> = {
  2025: [
    "2025-01-01", "2025-01-13", "2025-02-11", "2025-02-23", "2025-02-24", "2025-03-20", "2025-04-29", "2025-05-03", "2025-05-04", "2025-05-05",
    "2025-05-06", "2025-07-21", "2025-08-11", "2025-09-15", "2025-09-23", "2025-10-13", "2025-11-03", "2025-11-23", "2025-11-24",
  ],
  2026: [
    "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05", "2026-05-06",
    "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  ],
  2027: [
    "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05",
    "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23", "2027-10-11", "2027-11-03", "2027-11-23",
  ],
};

test("祝日：2025〜2027年が内閣府の一覧と一致する（振替休日・国民の休日を含む）", () => {
  for (const [year, days] of Object.entries(EXPECTED)) {
    assert.deepEqual([...holidaysOfYear(Number(year)).keys()], days, `${year}年`);
  }
});

test("祝日：名前と判定", () => {
  assert.equal(holidayName("2026-09-22"), "国民の休日");
  assert.equal(holidayName("2026-05-06"), "振替休日");
  assert.equal(holidayName("2026-10-12"), "スポーツの日");
  assert.equal(holidayName("2026-10-13"), null);
  assert.equal(isHoliday("2026-11-03"), true);
  assert.equal(shortHolidayName("スポーツの日"), "スポーツ");
  assert.equal(shortHolidayName("振替休日"), "振替");
});

test("祝日：五輪特例（2020・2021）と、春分・秋分の近似式", () => {
  assert.equal(holidayName("2021-07-23"), "スポーツの日");
  assert.equal(holidayName("2021-08-08"), "山の日");
  assert.equal(holidayName("2021-08-09"), "振替休日");
  assert.equal(holidayName("2030-03-20"), "春分の日");
  assert.equal(holidayName("2030-09-23"), "秋分の日");
  assert.equal(holidaysOfYear(2019).size, 0, "2020年より前は対象外");
});
