import assert from "node:assert/strict";
import test from "node:test";
import { buildBackup, validateBackup } from "../src/backup.js";
import { defaultSettings } from "../src/constants.js";
import { fourDayKeys, formatRangeLabel } from "../src/dateUtils.js";
import { blockLines, titleTokens } from "../src/eventLogic.js";
import { markerCandidates, markersForDay, markersWithGaps } from "../src/markerLogic.js";
import { eventDefaults, migrateSettings } from "../src/migrate.js";
import {
  isOngoing, isSession, ongoingSessions, resolveNagara, sessionInterval, sessionLabelsOverlapping, sessionSegmentsForDay, validateSession,
} from "../src/nagaraLogic.js";
import { formatDelta, planActualDiff } from "../src/planLogic.js";
import { computeReview, periodOf } from "../src/reviewLogic.js";
import { buildReviewMarkdown } from "../src/reviewMarkdown.js";
import { daysAgoLabel, normalizeText, searchAll, summarizeHits, type SearchQuery } from "../src/searchLogic.js";
import type { CalendarEvent, Marker, Nagara } from "../src/types.js";

const STAMP = "2026-10-01T00:00:00.000Z";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: STAMP, updatedAt: STAMP, ...eventDefaults(), ...extra };
}

function ng(id: string, label: string, extra: Partial<Nagara> = {}): Nagara {
  return { id, label, type: "nagara", eventId: null, start: null, end: null, createdAt: STAMP, updatedAt: STAMP, ...extra };
}

function mk(id: string, label: string, at: string): Marker {
  return { id, label, at, createdAt: STAMP, updatedAt: STAMP };
}

const WEEK = periodOf("week", "2026-10-08", 1);

test("4日表示：基準日の前日から2日後まで（今日が基準なら 昨日・今日・明日・明後日）", () => {
  assert.deepEqual(fourDayKeys("2026-10-11"), ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"]);
  assert.deepEqual(fourDayKeys("2026-01-01"), ["2025-12-31", "2026-01-01", "2026-01-02", "2026-01-03"]);
  assert.equal(formatRangeLabel("2026-10-10", "2026-10-13"), "10/10(土)〜10/13(火)");
});

test("設定：起動時の表示に4日を選べる。知らない値は週へ戻す", () => {
  assert.equal(migrateSettings({ ...defaultSettings(), startView: "fourDay" }).startView, "fourDay");
  assert.equal(migrateSettings({ ...defaultSettings(), startView: "five" }).startView, "week");
});

test("ブロックの行数：タイトルは最大3行。足りないときは 時刻→場所→ながら→人の行 の順に省く", () => {
  const all = { people: true, nagara: true, place: true };
  assert.deepEqual(blockLines(8, all), { titleLines: 3, peopleLine: true, nagaraLine: true, placeLine: true, timeLine: true });
  assert.deepEqual(blockLines(5, all), { titleLines: 1, peopleLine: true, nagaraLine: true, placeLine: true, timeLine: true });
  assert.deepEqual(blockLines(4, all), { titleLines: 1, peopleLine: true, nagaraLine: true, placeLine: true, timeLine: false });
  assert.deepEqual(blockLines(3, all), { titleLines: 1, peopleLine: true, nagaraLine: true, placeLine: false, timeLine: false });
  assert.deepEqual(blockLines(2, all), { titleLines: 1, peopleLine: true, nagaraLine: false, placeLine: false, timeLine: false });
  assert.deepEqual(blockLines(1, all), { titleLines: 1, peopleLine: false, nagaraLine: false, placeLine: false, timeLine: false });
  // 文字で埋め尽くさない：高さが余っていてもタイトルは3行まで
  assert.equal(blockLines(20, { people: false, nagara: false, place: false }).titleLines, 3);
  // 時刻を出さない表示（4日・週）
  assert.deepEqual(blockLines(3, { people: false, nagara: true, place: false }, { time: false }), {
    titleLines: 2, peopleLine: false, nagaraLine: true, placeLine: false, timeLine: false,
  });
  assert.equal(blockLines(0.4, all).titleLines, 1);
});

test("タイトルの区切り：→ と / で分ける", () => {
  assert.deepEqual(titleTokens("日記・振り返り→YouTube→買い物→帰宅"), ["日記・振り返り", "YouTube", "買い物", "帰宅"]);
  assert.deepEqual(titleTokens("通勤/仮眠"), ["通勤", "仮眠"]);
  assert.deepEqual(titleTokens("YouTube"), ["YouTube"]);
});

test("継続中のセッション：終了なしで保存でき、指定した時刻までとして扱う", () => {
  const open = ng("o", "YouTube", { start: "2026-10-08T20:00" });
  const closed = ng("c", "Spoon", { start: "2026-10-08T10:00", end: "2026-10-08T11:00" });
  const attached = ng("a", "音楽", { eventId: "e1" });
  assert.equal(isSession(open), true);
  assert.equal(isOngoing(open), true);
  assert.equal(isOngoing(closed), false);
  assert.equal(isOngoing(attached), false);
  assert.deepEqual(ongoingSessions([closed, open, attached]).map((n) => n.id), ["o"]);
  assert.deepEqual(sessionInterval(open, "2026-10-08T22:30"), { start: "2026-10-08T20:00", end: "2026-10-08T22:30" });
  assert.equal(sessionInterval(open, "2026-10-08T19:00"), null, "開始より前なら時間なし");
  assert.equal(resolveNagara(open, new Map()), null, "現在時刻を渡さなければ決めない");
  assert.deepEqual(resolveNagara(open, new Map(), "2026-10-08T21:00"), { start: "2026-10-08T20:00", end: "2026-10-08T21:00" });
  assert.equal(validateSession("YouTube", "2026-10-08T20:00", null), null);
  assert.equal(validateSession("", "2026-10-08T20:00", null), "ラベルを入力してください");
  assert.equal(validateSession("x", "2026-10-08T20:00", "2026-10-08T20:00"), "終了は開始より後にしてください");
});

test("継続中のセッション：日をまたいでも、それぞれの日に切り出す。長時間でも勝手に終わらない", () => {
  const open = ng("o", "YouTube", { start: "2026-10-08T20:00" });
  const now = "2026-10-10T09:30";
  assert.deepEqual(sessionSegmentsForDay([open], "2026-10-08", now).map((s) => [s.startMin, s.endMin]), [[1200, 1440]]);
  assert.deepEqual(sessionSegmentsForDay([open], "2026-10-09", now).map((s) => [s.startMin, s.endMin]), [[0, 1440]]);
  assert.deepEqual(sessionSegmentsForDay([open], "2026-10-10", now).map((s) => [s.startMin, s.endMin]), [[0, 570]]);
  assert.deepEqual(sessionSegmentsForDay([open], "2026-10-11", now), []);
  assert.deepEqual(sessionSegmentsForDay([open], "2026-10-08"), [], "現在時刻なしでは出さない（従来の呼び方を壊さない）");
});

test("集計：継続中のセッションは現在時刻（集計の終わり）まで数える", () => {
  const open = ng("o", "YouTube", { start: "2026-10-08T20:00" });
  const s = computeReview([], [open], WEEK, true, "2026-10-08T22:00");
  assert.deepEqual(s.nagaraTotals, [{ label: "YouTube", minutes: 120 }]);
});

test("集計：同じラベルのセッションとイベントのながらが重なっても、和集合で1回だけ数える", () => {
  const events = [ev("e1", "日記", "2026-10-08T20:00", "2026-10-08T21:00")];
  const nagara = [
    ng("s", "YouTube", { start: "2026-10-08T20:00", end: "2026-10-08T23:00" }),
    ng("a", "YouTube", { eventId: "e1" }),
  ];
  const s = computeReview(events, nagara, WEEK);
  assert.deepEqual(s.nagaraTotals, [{ label: "YouTube", minutes: 180 }]);
});

test("集計：セッション中にそのラベルがメインのイベントになった区間は、ながらから除き、メインとして残す", () => {
  const events = [
    ev("e1", "日記・振り返り", "2026-10-08T20:00", "2026-10-08T21:00", { colorId: "9" }),
    ev("e2", "YouTube", "2026-10-08T21:00", "2026-10-08T22:00"),
    ev("e3", "買い物→帰宅", "2026-10-08T22:00", "2026-10-08T23:00", { colorId: "3" }),
  ];
  const nagara = [ng("s", "YouTube", { start: "2026-10-08T20:00", end: "2026-10-08T23:00" })];
  const s = computeReview(events, nagara, WEEK);
  assert.deepEqual(s.nagaraTotals, [{ label: "YouTube", minutes: 180 }], "セッション＝続いていた総時間");
  assert.deepEqual(s.sideBySide, [{ label: "YouTube", asMain: 60, inFlow: 0, asNagara: 120, nagaraTotal: 180 }]);
  // 主行動 × ながら：YouTube自身が主行動の1時間は組にしない
  assert.deepEqual(s.cross.map((c) => [c.row, c.label, c.minutes]), [["3", "YouTube", 60], ["9", "YouTube", 60]]);
  // 時間構成には足さない（3時間のまま）
  assert.equal(Object.values(s.byColor).reduce((a, b) => a + b, 0), 180);
});

test("集計：複合タイトルにラベルが含まれるときは「流れに含む」。時間を均等割りしない", () => {
  const events = [ev("e1", "日記・振り返り→YouTube→買い物→帰宅", "2026-10-08T20:00", "2026-10-08T21:15", { colorId: "3" })];
  const nagara = [ng("s", "YouTube", { start: "2026-10-08T20:45", end: "2026-10-08T22:00" })];
  const s = computeReview(events, nagara, WEEK);
  assert.deepEqual(s.sideBySide, [{ label: "YouTube", asMain: 0, inFlow: 75, asNagara: 45, nagaraTotal: 75 }]);
});

test("集計：場所ごとの時間はイベントの場所欄も数える。複数の場所は別枠にして二重計上しない", () => {
  const events = [
    ev("e1", "作業", "2026-10-08T10:00", "2026-10-08T12:00", { places: ["家"] }),
    ev("e2", "昼", "2026-10-08T11:00", "2026-10-08T13:00", { places: ["家"] }),
    ev("e3", "移動→皮膚科", "2026-10-08T15:00", "2026-10-08T16:00", { places: ["新宿", "薬局"] }),
    ev("p", "予定", "2026-10-08T18:00", "2026-10-08T19:00", { kind: "plan", places: ["家"] }),
  ];
  const nagara = [ng("c", "カフェ", { type: "place", start: "2026-10-08T16:00", end: "2026-10-08T17:00" })];
  const s = computeReview(events, nagara, WEEK);
  assert.deepEqual(s.placeTotals, [
    { label: "家", minutes: 180, sharedMinutes: 0 },
    { label: "カフェ", minutes: 60, sharedMinutes: 0 },
    { label: "新宿", minutes: 0, sharedMinutes: 60 },
    { label: "薬局", minutes: 0, sharedMinutes: 60 },
  ]);
});

test("細分類の自動判定：通勤と移動を分ける。場所欄が電車・徒歩なら移動", () => {
  const events = [
    ev("a", "通勤/仮眠", "2026-10-08T07:00", "2026-10-08T08:00", { colorId: "3" }),
    ev("b", "移動→スーパー", "2026-10-08T12:00", "2026-10-08T12:30", { colorId: "3" }),
    ev("c", "ポケポケ→仮眠", "2026-10-08T13:00", "2026-10-08T14:00", { colorId: "3", places: ["電車"] }),
    ev("d", "朝食", "2026-10-08T06:00", "2026-10-08T06:30", { colorId: "3", places: ["電車"] }),
  ];
  const s = computeReview(events, [], WEEK);
  const sep = "\u0000";
  assert.equal(s.byDetail[`3${sep}通勤`], 60);
  assert.equal(s.byDetail[`3${sep}移動`], 90);
  assert.equal(s.byDetail[`3${sep}食事`], 30, "タイトルで決まるものは場所より優先");
});

test("イベントに重なっていたセッションのラベル", () => {
  const nagara = [
    ng("s1", "YouTube", { start: "2026-10-08T20:00", end: "2026-10-08T23:00" }),
    ng("s2", "Spoon", { start: "2026-10-08T22:30" }),
    ng("p", "カフェ", { type: "place", start: "2026-10-08T20:00", end: "2026-10-08T23:00" }),
    ng("a", "音楽", { eventId: "e1" }),
  ];
  assert.deepEqual(sessionLabelsOverlapping(nagara, "2026-10-08T21:00", "2026-10-08T22:00", "2026-10-08T23:30"), ["YouTube"]);
  assert.deepEqual(sessionLabelsOverlapping(nagara, "2026-10-08T22:00", "2026-10-08T23:00", "2026-10-08T23:30"), ["YouTube", "Spoon"]);
  assert.deepEqual(sessionLabelsOverlapping(nagara, "2026-10-08T23:00", "2026-10-08T23:30", "2026-10-08T23:30"), ["Spoon"]);
});

test("マーカー：時刻順に並べ、隣り合う2点の間の時間を出す（複数の目的地でも破綻しない）", () => {
  const markers = [
    mk("4", "帰宅", "2026-10-11T00:40"),
    mk("1", "家を出た", "2026-10-10T12:00"),
    mk("3", "目的地発", "2026-10-10T21:10"),
    mk("2", "目的地着", "2026-10-10T13:45"),
    mk("5", "家を出た", "2026-10-13T07:25"),
  ];
  const g = markersWithGaps(markers);
  assert.deepEqual(g.map((x) => [x.marker.label, x.prev?.label ?? null, x.gapMinutes]), [
    ["家を出た", null, null],
    ["目的地着", "家を出た", 105],
    ["目的地発", "目的地着", 445],
    ["帰宅", "目的地発", 210],
    ["家を出た", null, null],
  ]);
  assert.deepEqual(markersForDay(markers, "2026-10-10").map((x) => [x.marker.id, x.minute]), [["1", 720], ["2", 825], ["3", 1270]]);
  assert.deepEqual(markersForDay(markers, "2026-10-12"), []);
});

test("マーカーの候補：固定候補のあとに、履歴の新しい順", () => {
  const markers = [
    { ...mk("a", "開場", "2026-10-11T17:00"), updatedAt: "2026-10-11T08:00:00.000Z" },
    { ...mk("b", "開演", "2026-10-11T18:00"), updatedAt: "2026-10-11T09:00:00.000Z" },
    { ...mk("c", "帰宅", "2026-10-11T22:00"), updatedAt: "2026-10-11T13:00:00.000Z" },
  ];
  assert.deepEqual(markerCandidates(["家を出た", "帰宅"], markers), ["家を出た", "帰宅", "開演", "開場"]);
});

test("予定と実績の差", () => {
  const plan = ev("p", "デート", "2026-10-10T14:00", "2026-10-10T21:00", { kind: "plan", colorId: "5" });
  const actual = ev("a", "デート", "2026-10-10T14:15", "2026-10-10T16:30", { colorId: "5", planId: "p", people: ["めぐ"] });
  const d = planActualDiff(plan, actual);
  assert.equal(d.startDelta, 15);
  assert.equal(d.endDelta, -270);
  assert.equal(d.planMinutes, 420);
  assert.equal(d.actualMinutes, 135);
  assert.deepEqual(d.changes.map((c) => c.field), ["people"]);
  assert.equal(formatDelta(15), "+15分");
  assert.equal(formatDelta(-270), "−4時間30分");
  assert.equal(formatDelta(0), "予定どおり");
});

test("検索：タイトル・人・場所・ながら・カテゴリ・メモを横断し、新しい順に返す", () => {
  const settings = defaultSettings();
  const events = [
    ev("e1", "サウナ", "2026-10-01T19:00", "2026-10-01T21:00", { places: ["新宿"] }),
    ev("e2", "散歩/サウナ", "2026-10-08T19:00", "2026-10-08T20:30", { people: ["ゆう"], memo: "ととのった" }),
    ev("e3", "外食", "2026-10-09T18:45", "2026-10-09T19:15", { colorId: "3" }),
    ev("e4", "サウナ", "2026-10-20T19:00", "2026-10-20T21:00", { kind: "plan" }),
  ];
  const nagara = [ng("n1", "YouTube", { eventId: "e3" }), ng("s1", "ユーチューブ", { start: "2026-10-05T20:00", end: "2026-10-05T21:00" })];
  const markers = [mk("m1", "サウナ着", "2026-10-08T18:55")];
  const q = (over: Partial<SearchQuery>): SearchQuery => ({ text: "", field: "all", from: "", to: "", kind: "all", ...over });
  const ids = (over: Partial<SearchQuery>) => searchAll(events, nagara, markers, settings, q(over)).map((h) => h.id);

  assert.deepEqual(ids({}), [], "語も日付も無ければ何も出さない");
  assert.deepEqual(ids({ text: "サウナ" }), ["e4", "e2", "m1", "e1"]);
  assert.deepEqual(ids({ text: "さうな" }), ["e4", "e2", "m1", "e1"], "ひらがな・カタカナを区別しない");
  assert.deepEqual(ids({ text: "サウナ", kind: "actual" }), ["e2", "m1", "e1"]);
  assert.deepEqual(ids({ text: "サウナ", kind: "plan" }), ["e4"]);
  assert.deepEqual(ids({ text: "サウナ", from: "2026-10-05", to: "2026-10-10" }), ["e2", "m1"]);
  assert.deepEqual(ids({ text: "ゆう", field: "people" }), ["e2"]);
  assert.deepEqual(ids({ text: "新宿", field: "places" }), ["e1"]);
  assert.deepEqual(ids({ text: "youtube", field: "nagara" }), ["e3"]);
  assert.deepEqual(ids({ text: "生活", field: "category" }), ["e3"]);
  assert.deepEqual(ids({ text: "ととのった", field: "memo" }), ["e2"]);
  assert.deepEqual(ids({ text: "散歩 サウナ" }), ["e2"], "空白区切りはAND");
  assert.deepEqual(ids({ from: "2026-10-09", to: "2026-10-09" }), ["e3"], "日付だけでも絞れる");
  assert.equal(normalizeText("ＹｏｕＴｕｂｅ"), "youtube");
});

test("検索：前回日と回数。前回は予定を除き、現在以前の記録から選ぶ", () => {
  const settings = defaultSettings();
  const events = [
    ev("e1", "サウナ", "2026-10-01T19:00", "2026-10-01T21:00"),
    ev("e2", "サウナ", "2026-10-08T19:00", "2026-10-08T20:30"),
    ev("e4", "サウナ", "2026-10-20T19:00", "2026-10-20T21:00", { kind: "plan" }),
  ];
  const hits = searchAll(events, [], [], settings, { text: "サウナ", field: "all", from: "", to: "", kind: "all" });
  const s = summarizeHits(hits, "2026-10-11T22:00");
  assert.equal(s.count, 3);
  assert.equal(s.totalMinutes, 210, "予定は時間に含めない");
  assert.deepEqual(s.last, { start: "2026-10-08T19:00", daysAgo: 3 });
  assert.equal(s.first, "2026-10-01T19:00");
  assert.equal(daysAgoLabel(0), "今日");
  assert.equal(daysAgoLabel(1), "昨日");
  assert.equal(daysAgoLabel(3), "3日前");
  assert.equal(summarizeHits([], "2026-10-11T22:00").last, null);
});

test("バックアップ：マーカーと継続中のセッションが往復する。マーカーの無い旧バックアップも読める", () => {
  const events = [ev("e1", "作業", "2026-10-08T10:00", "2026-10-08T12:00")];
  const nagara = [ng("o", "YouTube", { start: "2026-10-08T20:00" })];
  const markers = [mk("m1", "家を出た", "2026-10-08T07:25")];
  const b = buildBackup(events, defaultSettings(), "2026-10-11T00:00:00.000Z", { nagara, markers });
  const r = validateBackup(JSON.parse(JSON.stringify(b)));
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.backup.markers, markers);
    assert.deepEqual(r.backup.nagara, nagara);
  }
  const old = JSON.parse(JSON.stringify(b));
  delete old.markers;
  const r2 = validateBackup(old);
  assert.ok(r2.ok);
  if (r2.ok) assert.deepEqual(r2.backup.markers, []);
  // イベントに付いたながらは、開始だけ（終了なし）を認めない
  const bad = JSON.parse(JSON.stringify(b));
  bad.nagara[0].eventId = "e1";
  assert.equal(validateBackup(bad).ok, false);
  const badMarker = JSON.parse(JSON.stringify(b));
  badMarker.markers[0].at = "2026-10-08";
  assert.equal(validateBackup(badMarker).ok, false);
});

test("Markdown：継続中のセッション・重なっていたセッション・場所の2列・マーカーの節", () => {
  const events = [
    ev("e1", "日記・振り返り", "2026-10-08T20:00", "2026-10-08T21:00", { colorId: "9", places: ["家"] }),
    ev("e2", "YouTube", "2026-10-08T21:00", "2026-10-08T22:00", { places: ["家"] }),
  ];
  const nagara = [ng("s", "YouTube", { start: "2026-10-08T20:00" })];
  const markers = [mk("m1", "家を出た", "2026-10-08T07:25"), mk("m2", "会社着", "2026-10-08T08:40")];
  const md = buildReviewMarkdown({
    events, nagara, revisions: [], markers, activeSleep: { start: "2026-10-08T22:10", nap: false },
    settings: defaultSettings(), period: WEEK, nowLocal: "2026-10-08T22:30",
  });
  assert.ok(md.includes("書き出し時点で継続中"));
  assert.ok(md.includes("ながらセッション「YouTube」：2026-10-08 20:00〜"));
  assert.ok(md.includes("睡眠：2026-10-08 22:10〜"));
  assert.ok(md.includes("| YouTube | 2時間30分 |"), "継続中は書き出し時刻まで");
  assert.ok(md.includes("| YouTube | 1時間 | 0分 | 1時間30分 |"), "メイン1時間・ながら1時間30分");
  assert.ok(md.includes("| 20:00–22:30 | ながらセッション（継続中） |"));
  assert.ok(md.includes("| 日記・振り返り | （セッション：YouTube） | 家 |"), "重なっていたセッションを明細に出す");
  assert.ok(md.includes("| YouTube |  | 家 |"), "タイトルと同じラベルは繰り返さない");
  assert.ok(md.includes("| 家 | 2時間 | 0分 |"));
  assert.ok(md.includes("## 6. マーカー（時刻だけの記録）"));
  assert.ok(md.includes("| 2026-10-08 | 08:40 | 会社着 | 家を出た（07:25） | 1時間15分 |"));
  assert.ok(md.includes("| 07:25 | マーカー |"));
});
