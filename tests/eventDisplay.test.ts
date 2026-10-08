import assert from "node:assert/strict";
import test from "node:test";
import { addChipValue, displayTitle, monthCellItems, moveItem, peopleSuggestions, placeSuggestions } from "../src/eventLogic.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent } from "../src/types.js";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...eventDefaults(), ...extra };
}

test("人を先に表示：人がいれば人名をタイトルの前に出す", () => {
  assert.equal(displayTitle(ev("a", "散歩/外食", "2026-10-08T10:00", "2026-10-08T11:00", { people: ["めぐちゃん"] })), "めぐちゃん　散歩/外食");
  assert.equal(displayTitle(ev("a", "散歩", "2026-10-08T10:00", "2026-10-08T11:00", { people: ["A", "B"] })), "A・B　散歩");
  assert.equal(displayTitle(ev("a", "散歩", "2026-10-08T10:00", "2026-10-08T11:00")), "散歩");
});

test("チップ値の追加・並べ替え", () => {
  assert.deepEqual(addChipValue(["a"], " b "), ["a", "b"]);
  assert.deepEqual(addChipValue(["a"], "a"), ["a"]);
  assert.deepEqual(addChipValue(["a"], "  "), ["a"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
});

test("人・場所の候補：新しい順・重複なし", () => {
  const events = [
    ev("1", "x", "2026-10-01T10:00", "2026-10-01T11:00", { people: ["A", "B"], places: ["駅"], updatedAt: "2026-10-01T00:00:00.000Z" }),
    ev("2", "x", "2026-10-05T10:00", "2026-10-05T11:00", { people: ["C", "A"], places: ["カフェ", "駅"], updatedAt: "2026-10-05T00:00:00.000Z" }),
  ];
  assert.deepEqual(peopleSuggestions(events), ["C", "A", "B"]);
  assert.deepEqual(placeSuggestions(events), ["カフェ", "駅"]);
  assert.deepEqual(peopleSuggestions(events, 2), ["C", "A"]);
});

test("月表示の1日ぶん：最大3件＋他n件、終日が先、キャンセルは除く、日跨ぎもかかる", () => {
  const events = [
    ev("a", "A", "2026-10-08T09:00", "2026-10-08T10:00"),
    ev("b", "B", "2026-10-08T11:00", "2026-10-08T12:00"),
    ev("c", "C", "2026-10-08T13:00", "2026-10-08T14:00"),
    ev("d", "D", "2026-10-08T15:00", "2026-10-08T16:00"),
    ev("e", "E", "2026-10-08T00:00", "2026-10-09T00:00", { allDay: true }),
    ev("f", "F", "2026-10-08T17:00", "2026-10-08T18:00", { status: "cancelled" }),
    ev("s", "S", "2026-10-07T23:00", "2026-10-08T06:00"),
  ];
  const cell = monthCellItems(events, "2026-10-08");
  assert.deepEqual(cell.shown.map((e) => e.id), ["e", "s", "a"]);
  assert.equal(cell.more, 3);
  assert.deepEqual(monthCellItems(events, "2026-10-09"), { shown: [], more: 0 });
  assert.deepEqual(monthCellItems(events, "2026-10-07").shown.map((e) => e.id), ["s"]);
});
