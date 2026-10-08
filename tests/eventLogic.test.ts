import assert from "node:assert/strict";
import test from "node:test";
import {
  allDayLastDate, autoKind, buildAllDayRange, colorForTitle, deriveEndDate, isNextDay, rangeForPlusButton, rangeFromTap, shiftEnd,
  titleSuggestions, validateEvent,
} from "../src/eventLogic.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent } from "../src/types.js";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...eventDefaults(), ...extra };
}

test("終了日の自動翌日化：終了時刻が開始より前なら翌日", () => {
  assert.equal(deriveEndDate("2026-10-08", "23:30", "06:00"), "2026-10-09");
  assert.equal(deriveEndDate("2026-10-08", "10:00", "11:00"), "2026-10-08");
  assert.equal(deriveEndDate("2026-10-08", "10:00", "10:00"), "2026-10-08");
  assert.equal(isNextDay("2026-10-08", "2026-10-09"), true);
  assert.equal(isNextDay("2026-10-08", "2026-10-10"), false);
});

test("開始を変えると長さを保って終了も動く", () => {
  assert.equal(shiftEnd("2026-10-08T10:00", "2026-10-08T22:30", "2026-10-08T11:00"), "2026-10-08T23:30");
  assert.equal(shiftEnd("2026-10-08T10:00", "2026-10-08T23:30", "2026-10-08T11:00"), "2026-10-09T00:30");
});

test("種別の自動判定：未来は予定、現在・過去は実績", () => {
  assert.equal(autoKind("2026-10-08T15:01", "2026-10-08T15:00"), "plan");
  assert.equal(autoKind("2026-10-08T15:00", "2026-10-08T15:00"), "actual");
  assert.equal(autoKind("2026-10-08T09:00", "2026-10-08T15:00"), "actual");
});

test("終日の保存値は最終日の翌日0:00（排他的終端）", () => {
  const r = buildAllDayRange("2026-10-08", "2026-10-09");
  assert.deepEqual(r, { start: "2026-10-08T00:00", end: "2026-10-10T00:00" });
  assert.equal(allDayLastDate(r.end), "2026-10-09");
});

test("保存可否：タイトル空・終了<=開始は不可", () => {
  assert.match(validateEvent("  ", "2026-10-08T10:00", "2026-10-08T11:00", false) ?? "", /タイトル/);
  assert.match(validateEvent("a", "2026-10-08T10:00", "2026-10-08T10:00", false) ?? "", /終了/);
  assert.match(validateEvent("a", "2026-10-08T10:00", "2026-10-08T09:00", false) ?? "", /終了/);
  assert.equal(validateEvent("a", "2026-10-08T10:00", "2026-10-08T10:01", false), null);
  assert.equal(validateEvent("a", "2026-10-08T00:00", "2026-10-09T00:00", true), null);
  assert.notEqual(validateEvent("a", "2026-10-08T00:00", "2026-10-08T00:00", true), null);
});

test("タイトル候補：重複除去・新しい順・最大200件", () => {
  const list = [
    ev("1", "散歩", "2026-10-01T10:00", "2026-10-01T11:00", { updatedAt: "2026-10-01T00:00:00.000Z" }),
    ev("2", "仕事", "2026-10-02T10:00", "2026-10-02T11:00", { updatedAt: "2026-10-02T00:00:00.000Z" }),
    ev("3", "散歩", "2026-10-03T10:00", "2026-10-03T11:00", { updatedAt: "2026-10-03T00:00:00.000Z" }),
    ev("4", " ", "2026-10-04T10:00", "2026-10-04T11:00", { updatedAt: "2026-10-04T00:00:00.000Z" }),
  ];
  assert.deepEqual(titleSuggestions(list), ["散歩", "仕事"]);
  const many = Array.from({ length: 300 }, (_, i) => ev(String(i), `t${i}`, "2026-10-01T10:00", "2026-10-01T11:00", { updatedAt: `2026-10-01T00:00:00.${String(i).padStart(3, "0")}Z` }));
  assert.equal(titleSuggestions(many).length, 200);
  assert.equal(titleSuggestions(many)[0], "t299");
});

test("前回色：完全一致するタイトルの最新イベントの色を返す", () => {
  const list = [
    ev("1", "散歩", "2026-10-01T10:00", "2026-10-01T11:00", { colorId: "2", updatedAt: "2026-10-01T00:00:00.000Z" }),
    ev("2", "散歩", "2026-10-03T10:00", "2026-10-03T11:00", { colorId: "5", updatedAt: "2026-10-03T00:00:00.000Z" }),
    ev("3", "散歩", "2026-10-02T10:00", "2026-10-02T11:00", { colorId: null, updatedAt: "2026-10-02T00:00:00.000Z" }),
  ];
  assert.equal(colorForTitle(list, "散歩"), "5");
  assert.equal(colorForTitle(list, "散歩", "2"), null); // 自分自身を除くと、次に新しい「色指定なし」
  assert.equal(colorForTitle(list, "散"), undefined); // 部分一致は対象外
  assert.equal(colorForTitle(list, ""), undefined);
});

test("タップ新規：15分切り捨て、終了は+60分", () => {
  assert.deepEqual(rangeFromTap("2026-10-08", 14 * 60 + 29), { start: "2026-10-08T14:15", end: "2026-10-08T15:15" });
  assert.deepEqual(rangeFromTap("2026-10-08", 23 * 60 + 50), { start: "2026-10-08T23:45", end: "2026-10-09T00:45" });
});

test("＋ボタン（今日）：直前の終了時刻を開始にし、終了は現在を5分丸め", () => {
  const events = [
    ev("a", "睡眠", "2026-10-07T23:30", "2026-10-08T06:00"),
    ev("b", "朝食", "2026-10-08T07:00", "2026-10-08T07:30"),
    ev("c", "未来の予定", "2026-10-08T18:00", "2026-10-08T19:00", { kind: "plan" }),
  ];
  assert.deepEqual(rangeForPlusButton(events, "2026-10-08", "2026-10-08T09:33"), { start: "2026-10-08T07:30", end: "2026-10-08T09:35" });
});

test("＋ボタン（今日）：昨日で終わった記録は開始に使わない／無ければ現在を15分切り捨て", () => {
  const events = [ev("a", "昨日", "2026-10-07T20:00", "2026-10-07T22:00")];
  assert.deepEqual(rangeForPlusButton(events, "2026-10-08", "2026-10-08T09:33"), { start: "2026-10-08T09:30", end: "2026-10-08T09:35" });
});

test("＋ボタン（今日）：終了が開始以下になるなら開始+60分", () => {
  // 直前の終了=09:32、現在09:33 → 丸め後の終了09:35 > 開始 なのでそのまま
  const events = [ev("a", "x", "2026-10-08T09:00", "2026-10-08T09:32")];
  assert.deepEqual(rangeForPlusButton(events, "2026-10-08", "2026-10-08T09:33"), { start: "2026-10-08T09:32", end: "2026-10-08T09:35" });
  // 直前の終了=09:33、現在09:34 → 丸め後の終了09:35 だが…開始09:33<09:35 なのでそのまま。以下は「丸めで開始以下」になる例：終了09:32/現在09:32→丸め09:30<=開始
  const events2 = [ev("a", "x", "2026-10-08T09:00", "2026-10-08T09:32")];
  assert.deepEqual(rangeForPlusButton(events2, "2026-10-08", "2026-10-08T09:32"), { start: "2026-10-08T09:32", end: "2026-10-08T10:32" });
  // 無予定で現在 09:00 ちょうど → 開始09:00・終了09:00 → 開始+60
  assert.deepEqual(rangeForPlusButton([], "2026-10-08", "2026-10-08T09:00"), { start: "2026-10-08T09:00", end: "2026-10-08T10:00" });
});

test("＋ボタン（今日以外）：12:00〜13:00", () => {
  assert.deepEqual(rangeForPlusButton([], "2026-10-09", "2026-10-08T09:33"), { start: "2026-10-09T12:00", end: "2026-10-09T13:00" });
});
