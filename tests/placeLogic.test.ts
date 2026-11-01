import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import { formatPlace, parsePlace, placeKindOf } from "../src/placeLogic.js";
import { buildReviewMarkdown } from "../src/reviewMarkdown.js";
import { computeReview, periodOf } from "../src/reviewLogic.js";
import type { CalendarEvent, Nagara } from "../src/types.js";

const STAMP = "2026-10-01T00:00:00.000Z";
const WEEK = periodOf("week", "2026-10-08", 1);

function ev(id: string, title: string, start: string, end: string, places: string[]): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: STAMP, updatedAt: STAMP, ...eventDefaults(), places };
}
function placeSession(id: string, label: string, start: string, end: string): Nagara {
  return { id, label, type: "place", eventId: null, start, end, createdAt: STAMP, updatedAt: STAMP };
}

test("場所：入力の大分類と名前から1件を作る（どちらか一方だけでもよい）", () => {
  assert.equal(formatPlace("飲食店", " サイゼリヤ "), "飲食店＞サイゼリヤ");
  assert.equal(formatPlace("家", ""), "家");
  assert.equal(formatPlace(null, "ドトール"), "ドトール");
  assert.equal(formatPlace(null, " "), "");
});

test("場所：1件を大分類と名前に分ける。区切りの前が大分類でなければ全体が名前", () => {
  assert.deepEqual(parsePlace("作業場＞ドトール"), { kind: "作業場", detail: "ドトール" });
  assert.deepEqual(parsePlace("移動"), { kind: "移動", detail: "" });
  assert.deepEqual(parsePlace("カフェ＞ドトール"), { kind: null, detail: "カフェ＞ドトール" });
  assert.deepEqual(parsePlace("サイゼリヤ"), { kind: null, detail: "サイゼリヤ" });
});

test("場所の大分類：選んだ大分類を使う。古い記録は家・職場・移動手段だけ自動で、店名は推測しない", () => {
  assert.equal(placeKindOf("外出先＞映画館"), "外出先");
  assert.equal(placeKindOf("家"), "家");
  assert.equal(placeKindOf("自宅"), "家");
  assert.equal(placeKindOf("会社"), "職場");
  assert.equal(placeKindOf("電車"), "移動");
  assert.equal(placeKindOf("ドトール"), null);
});

test("集計：大分類ごとの時間。場所が複数でも大分類が1つならその大分類だけ、未分類は最後", () => {
  const events = [
    ev("e1", "作業", "2026-10-08T10:00", "2026-10-08T12:00", ["作業場＞ドトール"]),
    ev("e2", "移動", "2026-10-08T12:00", "2026-10-08T13:00", ["移動＞電車", "移動＞徒歩"]),
    ev("e3", "昼食", "2026-10-08T13:00", "2026-10-08T14:00", ["サイゼリヤ"]),
    ev("e4", "帰宅", "2026-10-08T14:00", "2026-10-08T14:30", ["移動＞電車", "家"]),
  ];
  const nagara = [placeSession("s", "作業場＞スタバ", "2026-10-09T10:00", "2026-10-09T11:00")];
  const s = computeReview(events, nagara, WEEK);
  assert.deepEqual(
    s.placeKindTotals.map((p) => [p.label, p.minutes, p.sharedMinutes]),
    [["作業場", 180, 0], ["移動", 60, 30], ["家", 0, 30], ["未分類", 60, 0]],
  );
});

test("AI用Markdown：場所の書き方の説明、大分類の表、明細に「大分類＞名前」を出す", () => {
  const events = [ev("e1", "昼食", "2026-10-08T12:00", "2026-10-08T13:00", ["飲食店＞サイゼリヤ"])];
  const md = buildReviewMarkdown({ events, nagara: [], revisions: [], settings: defaultSettings(), period: WEEK, nowLocal: "2026-10-12T12:00" });
  assert.match(md, /場所欄の1件は「大分類＞詳しい名前」/);
  assert.match(md, /### 場所の大分類ごとの時間/);
  assert.match(md, /\| 飲食店 \| 1時間 \|/);
  assert.match(md, /飲食店＞サイゼリヤ/);
});
