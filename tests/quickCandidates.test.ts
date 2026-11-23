import test from "node:test";
import assert from "node:assert/strict";
import { colorRecentSuggestions, recentQuickCandidates } from "../src/eventLogic.js";
import type { CalendarEvent } from "../src/types.js";

const ev = (id: string, start: string, colorId: string, people: string[]): CalendarEvent =>
  ({ id, start, end: start, colorId, people, places: [], status: "confirmed", kind: "actual", updatedAt: start } as unknown as CalendarEvent);

test("人・場所の候補：選んだ色で最後に使ったものが新しい順", () => {
  const events = [ev("a", "2026-11-01T10:00", "1", ["A", "B"]), ev("b", "2026-11-20T10:00", "1", ["B"]), ev("c", "2026-11-21T10:00", "2", ["C"]), ev("d", "2026-07-01T10:00", "1", ["古い"])];
  assert.deepEqual(colorRecentSuggestions(events, "1", "2026-11-23", (e) => e.people), ["B", "A"]);
});

test("人・場所の候補：合わせて5つまで、選択済みと重複は除く", () => {
  assert.deepEqual(recentQuickCandidates(["B", "A"], ["C", "B", "D", "E", "F", "G"], ["A"]), ["B", "C", "D", "E", "F"]);
  assert.deepEqual(recentQuickCandidates([], [], []), []);
});
