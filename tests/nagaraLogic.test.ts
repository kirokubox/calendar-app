import assert from "node:assert/strict";
import test from "node:test";
import { eventDefaults } from "../src/migrate.js";
import {
  buildNagaraSave, draftsFromNagara, eventMap, isSession, layoutSessions, nagaraIdsOfEvent, nagaraLabelMap, nagaraLabelsOfEvent,
  nagaraLabelSuggestions, resolveNagara, sessionSegmentsForDay, validateNagaraDrafts,
} from "../src/nagaraLogic.js";
import type { CalendarEvent, Nagara } from "../src/types.js";

function ev(id: string, start: string, end: string): CalendarEvent {
  return { id, title: id, start, end, allDay: false, colorId: null, kind: "actual", createdAt: "x", updatedAt: "x", ...eventDefaults() };
}

function ng(id: string, label: string, extra: Partial<Nagara> = {}): Nagara {
  return { id, label, type: "nagara", eventId: null, start: null, end: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...extra };
}

test("ながらの解決：eventIdのみ→イベントの時間を継承（イベントを動かすと追従）", () => {
  const events = [ev("e1", "2026-10-08T10:00", "2026-10-08T11:00")];
  const n = ng("n1", "YouTube", { eventId: "e1" });
  assert.deepEqual(resolveNagara(n, eventMap(events)), { start: "2026-10-08T10:00", end: "2026-10-08T11:00" });
  const moved = [ev("e1", "2026-10-08T13:00", "2026-10-08T15:00")];
  assert.deepEqual(resolveNagara(n, eventMap(moved)), { start: "2026-10-08T13:00", end: "2026-10-08T15:00" });
});

test("ながらの解決：自分の時間があればそれを優先／セッションはそのまま／イベントが無ければ null", () => {
  const events = [ev("e1", "2026-10-08T10:00", "2026-10-08T11:00")];
  const part = ng("n1", "音楽", { eventId: "e1", start: "2026-10-08T10:20", end: "2026-10-08T10:40" });
  assert.deepEqual(resolveNagara(part, eventMap(events)), { start: "2026-10-08T10:20", end: "2026-10-08T10:40" });
  const session = ng("n2", "カフェ", { type: "place", start: "2026-10-08T15:30", end: "2026-10-08T18:45" });
  assert.deepEqual(resolveNagara(session, eventMap([])), { start: "2026-10-08T15:30", end: "2026-10-08T18:45" });
  assert.equal(resolveNagara(ng("n3", "x", { eventId: "gone" }), eventMap(events)), null);
  assert.equal(resolveNagara(ng("n4", "x"), eventMap(events)), null);
});

test("セッションの判定：eventIdなし・時間ありだけ", () => {
  assert.equal(isSession(ng("a", "x", { start: "2026-10-08T10:00", end: "2026-10-08T11:00" })), true);
  assert.equal(isSession(ng("b", "x", { eventId: "e1" })), false);
  assert.equal(isSession(ng("c", "x", { eventId: "e1", start: "2026-10-08T10:00", end: "2026-10-08T11:00" })), false);
});

test("セッションの日ごとの切り出し：日跨ぎ（YouTube 20:00〜翌1:45）", () => {
  const youtube = ng("y", "YouTube", { start: "2026-10-08T20:00", end: "2026-10-09T01:45" });
  const cafe = ng("c", "カフェ", { type: "place", start: "2026-10-08T15:30", end: "2026-10-08T18:45" });
  const attached = ng("z", "音楽", { eventId: "e1" });
  const d8 = sessionSegmentsForDay([youtube, cafe, attached], "2026-10-08");
  assert.deepEqual(d8.map((s) => [s.nagara.id, s.startMin, s.endMin, s.continuesFromPrev, s.continuesToNext]), [
    ["c", 930, 1125, false, false],
    ["y", 1200, 1440, false, true],
  ]);
  const d9 = sessionSegmentsForDay([youtube, cafe], "2026-10-09");
  assert.deepEqual(d9.map((s) => [s.nagara.id, s.startMin, s.endMin, s.continuesFromPrev]), [["y", 0, 105, true]]);
  assert.deepEqual(sessionSegmentsForDay([youtube, cafe], "2026-10-10"), []);
});

test("重なったセッションはレーン内で横に並ぶ", () => {
  const a = ng("a", "A", { start: "2026-10-08T10:00", end: "2026-10-08T12:00" });
  const b = ng("b", "B", { type: "place", start: "2026-10-08T11:00", end: "2026-10-08T13:00" });
  const placed = layoutSessions(sessionSegmentsForDay([a, b], "2026-10-08"));
  assert.deepEqual(placed.map((p) => [p.nagara.id, p.col, p.cols]), [["a", 0, 2], ["b", 1, 2]]);
});

test("イベントの＋ラベル：ながらのみ・重複なし・場所は除く", () => {
  const list = [
    ng("1", "YouTube", { eventId: "e1" }),
    ng("2", "YouTube", { eventId: "e1", start: "2026-10-08T10:00", end: "2026-10-08T10:30" }),
    ng("3", "カフェ", { eventId: "e1", type: "place" }),
    ng("4", "音楽", { eventId: "e2" }),
  ];
  assert.deepEqual(nagaraLabelsOfEvent(list, "e1"), ["YouTube"]);
  assert.deepEqual(nagaraLabelMap(list).get("e2"), ["音楽"]);
  assert.deepEqual(nagaraIdsOfEvent(list, "e1"), ["1", "2", "3"]);
});

test("ラベル候補：重複除去・新しい順・種類で絞り込み", () => {
  const list = [
    ng("1", "古い", { updatedAt: "2026-10-01T00:00:00.000Z" }),
    ng("2", "新しい", { updatedAt: "2026-10-05T00:00:00.000Z" }),
    ng("3", "古い", { updatedAt: "2026-10-03T00:00:00.000Z" }),
    ng("4", "カフェ", { type: "place", updatedAt: "2026-10-04T00:00:00.000Z" }),
    ng("5", " ", { updatedAt: "2026-10-06T00:00:00.000Z" }),
  ];
  assert.deepEqual(nagaraLabelSuggestions(list), ["新しい", "カフェ", "古い"]);
  assert.deepEqual(nagaraLabelSuggestions(list, "nagara"), ["新しい", "古い"]);
  assert.deepEqual(nagaraLabelSuggestions(list, "place"), ["カフェ"]);
  assert.deepEqual(nagaraLabelSuggestions(list, undefined, 1), ["新しい"]);
});

test("ながら下書きの検証", () => {
  const d = (start: string | null, end: string | null) => ({ key: "k", id: null, label: "音楽", start, end });
  assert.equal(validateNagaraDrafts([d(null, null), d("2026-10-08T10:00", "2026-10-08T11:00")]), null);
  assert.match(validateNagaraDrafts([d("2026-10-08T10:00", null)]) ?? "", /両方/);
  assert.match(validateNagaraDrafts([d("2026-10-08T11:00", "2026-10-08T10:00")]) ?? "", /終了/);
});

test("イベント保存時のながら：新規は作成、変更なしは書かない、外したものは削除、空ラベルは捨てる", () => {
  let seq = 0;
  const makeId = () => `new${++seq}`;
  const existing = [
    ng("n1", "YouTube", { eventId: "e1" }),
    ng("n2", "音楽", { eventId: "e1" }),
    ng("n3", "カフェ", { eventId: "e1", type: "place" }),
    ng("n9", "他のイベントの", { eventId: "e2" }),
  ];
  const drafts = [
    { key: "a", id: "n1", label: "YouTube", start: null, end: null },
    { key: "b", id: null, label: "ラジオ", start: "2026-10-08T10:00", end: "2026-10-08T10:30" },
    { key: "c", id: null, label: "  ", start: null, end: null },
    { key: "d", id: null, label: "ラジオ", start: "2026-10-08T10:00", end: "2026-10-08T10:30" },
  ];
  const r = buildNagaraSave("e1", drafts, existing, "2026-10-08T12:00:00.000Z", makeId);
  assert.deepEqual(r.deleteIds, ["n2"]);
  assert.equal(r.put.length, 1);
  assert.equal(r.put[0].id, "new1");
  assert.equal(r.put[0].eventId, "e1");
  assert.equal(r.put[0].type, "nagara");
  assert.equal(r.put[0].label, "ラジオ");
});

test("イベント保存時のながら：ラベルや時間の変更は同じidで更新（作成日時を保つ）", () => {
  const existing = [ng("n1", "YouTube", { eventId: "e1", createdAt: "2026-09-01T00:00:00.000Z" })];
  const r = buildNagaraSave("e1", [{ key: "a", id: "n1", label: "YouTube", start: "2026-10-08T10:00", end: "2026-10-08T11:00" }], existing, "S", () => "x");
  assert.equal(r.put.length, 1);
  assert.equal(r.put[0].id, "n1");
  assert.equal(r.put[0].createdAt, "2026-09-01T00:00:00.000Z");
  assert.equal(r.put[0].updatedAt, "S");
  assert.deepEqual(r.deleteIds, []);
});

test("既存のながらから編集用の下書きを作る（場所は含めない）", () => {
  const list = [ng("n1", "YouTube", { eventId: "e1" }), ng("n2", "カフェ", { eventId: "e1", type: "place" })];
  assert.deepEqual(draftsFromNagara(list, "e1").map((d) => [d.id, d.label]), [["n1", "YouTube"]]);
});
