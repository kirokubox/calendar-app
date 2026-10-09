import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import {
  barSeries, barTargetId, buildBreakdown, buildDiffRows, cancelledInPeriod, categoryName, computeReview, formatDuration, formatShare, formatSigned,
  equivalentPreviousCutoff, overlapsPeriod, parseBarTarget, periodCutoff, periodDays, periodFileName, periodOf, planChangesInPeriod,
  shiftPeriod, stackedBarSeries, unconfirmedInPeriod,
} from "../src/reviewLogic.js";
import type { CalendarEvent, Nagara, PlanRevision } from "../src/types.js";

const STAMP = "2026-10-01T00:00:00.000Z";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: STAMP, updatedAt: STAMP, ...eventDefaults(), ...extra };
}

function ng(id: string, label: string, extra: Partial<Nagara> = {}): Nagara {
  return { id, label, type: "nagara", eventId: null, start: null, end: null, createdAt: STAMP, updatedAt: STAMP, ...extra };
}

// 2026-10-05 は月曜
const WEEK = periodOf("week", "2026-10-08", 1);
const WEEK_MIN = 7 * 1440;
const settings = defaultSettings();

test("期間：週（週の始まり設定）・月・前後移動・ファイル名", () => {
  assert.deepEqual(WEEK, { kind: "week", start: "2026-10-05", end: "2026-10-12" });
  assert.equal(periodOf("week", "2026-10-08", 0).start, "2026-10-04");
  const month = periodOf("month", "2026-10-31", 1);
  assert.deepEqual(month, { kind: "month", start: "2026-10-01", end: "2026-11-01" });
  assert.deepEqual(shiftPeriod(month, -1), { kind: "month", start: "2026-09-01", end: "2026-10-01" });
  assert.deepEqual(shiftPeriod(periodOf("month", "2026-12-15", 1), 1), { kind: "month", start: "2027-01-01", end: "2027-02-01" });
  assert.deepEqual(shiftPeriod(WEEK, 1), { kind: "week", start: "2026-10-12", end: "2026-10-19" });
  assert.equal(periodDays(month).length, 31);
  assert.equal(periodFileName(WEEK), "calendar-week-2026-10-05_2026-10-11.md");
  assert.equal(periodFileName(month), "calendar-month-2026-10.md");
  assert.equal(overlapsPeriod("2026-10-04T23:00", "2026-10-05T00:00", WEEK), false);
  assert.equal(overlapsPeriod("2026-10-04T23:00", "2026-10-05T00:01", WEEK), true);
});

test("集計：重なりは等分し、合計＝期間の長さ（未記録を含む）", () => {
  const events = [
    ev("a", "A", "2026-10-06T10:00", "2026-10-06T12:00", { colorId: "1" }),
    ev("b", "B", "2026-10-06T11:00", "2026-10-06T13:00", { colorId: "3" }),
  ];
  const s = computeReview(events, [], WEEK);
  assert.equal(s.periodMinutes, WEEK_MIN);
  assert.equal(s.byColor["1"], 90);
  assert.equal(s.byColor["3"], 90);
  assert.equal(s.unrecorded, WEEK_MIN - 180);
  const sum = Object.values(s.byColor).reduce((x, y) => x + y, 0) + s.unrecorded;
  assert.equal(sum, WEEK_MIN);
});

test("集計：3件の重なり・同じ時間帯の同色は合算", () => {
  const events = [
    ev("a", "A", "2026-10-06T10:00", "2026-10-06T11:00", { colorId: "1" }),
    ev("b", "B", "2026-10-06T10:00", "2026-10-06T11:00", { colorId: "1" }),
    ev("c", "C", "2026-10-06T10:00", "2026-10-06T11:00", { colorId: "2" }),
  ];
  const s = computeReview(events, [], WEEK);
  assert.equal(s.byColor["1"], 40);
  assert.equal(s.byColor["2"], 20);
});

test("集計：期間の境目で切る・日跨ぎは0時で分けて日ごとに数える", () => {
  const events = [
    ev("before", "前週から", "2026-10-04T23:00", "2026-10-05T01:00", { colorId: "1" }),
    ev("night", "睡眠", "2026-10-06T22:00", "2026-10-07T02:00", { colorId: "1" }),
    ev("after", "翌週へ", "2026-10-11T23:00", "2026-10-12T05:00", { colorId: "1" }),
  ];
  const s = computeReview(events, [], WEEK);
  assert.equal(s.byColor["1"], 60 + 240 + 60);
  assert.equal(s.perDay[0].byColor["1"], 60, "10/5 は 0:00〜1:00 だけ");
  assert.equal(s.perDay[1].byColor["1"], 120);
  assert.equal(s.perDay[2].byColor["1"], 120);
  assert.equal(s.perDay[6].byColor["1"], 60);
  const dayTotal = s.perDay.reduce((sum, d) => sum + d.unrecorded + Object.values(d.byColor).reduce((x, y) => x + y, 0), 0);
  assert.equal(dayTotal, WEEK_MIN);
});

test("集計：予定・キャンセル・終日は対象外、種別不明は対象", () => {
  const events = [
    ev("plan", "予定", "2026-10-06T10:00", "2026-10-06T11:00", { kind: "plan" }),
    ev("cancel", "中止", "2026-10-06T10:00", "2026-10-06T11:00", { status: "cancelled" }),
    ev("allday", "終日", "2026-10-06T00:00", "2026-10-07T00:00", { allDay: true }),
    ev("unknown", "不明", "2026-10-06T12:00", "2026-10-06T13:00", { kind: "unknown", colorId: "9" }),
  ];
  const s = computeReview(events, [], WEEK);
  assert.deepEqual(s.byColor, { "9": 60 });
});

test("集計：人がいる時間は主行動のうち人が付いたもの（等分後）", () => {
  const events = [
    ev("a", "散歩", "2026-10-06T10:00", "2026-10-06T12:00", { people: ["めぐ"] }),
    ev("b", "仕事", "2026-10-06T11:00", "2026-10-06T12:00"),
  ];
  const s = computeReview(events, [], WEEK);
  assert.equal(s.peopleMinutes, 90);
  assert.equal(s.perDay[1].people, 90);
  const bar = barSeries(s, { type: "people" }, settings);
  assert.equal(bar[1].minutes, 90);
  assert.equal(bar.length, 7);
});

test("親カテゴリ・色カテゴリの階層と、空名の表示", () => {
  const events = [
    ev("a", "寝る", "2026-10-06T00:00", "2026-10-06T08:00", { colorId: "1" }),
    ev("b", "遊ぶ", "2026-10-06T10:00", "2026-10-06T12:00"),
    ev("c", "謎", "2026-10-06T13:00", "2026-10-06T14:00", { colorId: "4" }),
  ];
  const s = computeReview(events, [], WEEK);
  const bd = buildBreakdown(s, settings);
  assert.deepEqual(bd.parents.map((p) => [p.name, p.minutes]), [["睡眠", 480], ["自由時間", 120], ["その他", 60]]);
  assert.equal(bd.parents[2].children[0].name, "他の色（色4）");
  assert.equal(categoryName("default", { ...settings, colorLabels: { ...settings.colorLabels, default: "" } }), "他の色（色指定なし）");
  assert.equal(bd.unrecorded.minutes, WEEK_MIN - 660);
  const bar = barSeries(s, { type: "parent", name: "睡眠" }, settings);
  assert.equal(bar[1].minutes, 480);
  assert.equal(barSeries(s, { type: "color", key: "default" }, settings)[1].minutes, 120);
  assert.deepEqual(parseBarTarget(barTargetId({ type: "parent", name: "仕事" })), { type: "parent", name: "仕事" });
  assert.deepEqual(parseBarTarget("color:7"), { type: "color", key: "7" });
});

test("前期間との差：今期・前期・差", () => {
  const cur = computeReview([ev("a", "寝る", "2026-10-06T00:00", "2026-10-06T08:00", { colorId: "1" })], [], WEEK);
  const prevPeriod = shiftPeriod(WEEK, -1);
  const prev = computeReview(
    [ev("p", "寝る", "2026-09-29T00:00", "2026-09-29T06:00", { colorId: "1" }), ev("q", "仕事", "2026-09-30T09:00", "2026-09-30T10:00", { colorId: "11" })],
    [], prevPeriod, false,
  );
  const rows = buildDiffRows(cur, prev, settings);
  const sleep = rows.find((r) => r.name === "睡眠" && r.depth === 0)!;
  assert.deepEqual([sleep.now, sleep.prev, sleep.diff], [480, 360, 120]);
  const work = rows.find((r) => r.name === "仕事" && r.depth === 0)!;
  assert.deepEqual([work.now, work.prev, work.diff], [0, 60, -60]);
  assert.equal(rows[rows.length - 1].name, "未記録");
});

test("ながら：ラベル別合計・主行動カテゴリとの重なり（主行動なし含む）・イベント継承", () => {
  const events = [ev("e1", "作業", "2026-10-06T10:00", "2026-10-06T12:00", { colorId: "11" })];
  const nagara = [
    ng("n1", "YouTube", { eventId: "e1" }),
    ng("n2", "音楽", { start: "2026-10-06T11:00", end: "2026-10-06T13:00" }),
  ];
  const s = computeReview(events, nagara, WEEK);
  assert.deepEqual(s.nagaraTotals.map((n) => [n.label, n.minutes]), [["YouTube", 120], ["音楽", 120]]);
  const get = (row: string, label: string) => s.cross.find((c) => c.row === row && c.label === label)?.minutes;
  assert.equal(get("11", "YouTube"), 120);
  assert.equal(get("11", "音楽"), 60);
  assert.equal(get("none", "音楽"), 60, "12〜13時は主行動なし");
  for (const n of s.nagaraTotals) {
    assert.equal(s.cross.filter((c) => c.label === n.label).reduce((x, y) => x + y.minutes, 0), n.minutes, "ラベルごとに、行の合計＝ながらの合計");
  }
});

test("ながら：重なった主行動の間は等分して主行動カテゴリへ配る", () => {
  const events = [
    ev("a", "A", "2026-10-06T10:00", "2026-10-06T11:00", { colorId: "1" }),
    ev("b", "B", "2026-10-06T10:00", "2026-10-06T11:00", { colorId: "11" }),
  ];
  const s = computeReview(events, [ng("n", "音楽", { start: "2026-10-06T10:00", end: "2026-10-06T11:00" })], WEEK);
  assert.deepEqual(s.cross.map((c) => [c.row, c.minutes]).sort(), [["1", 30], ["11", 30]]);
});

test("ながら側から見る：タイトル完全一致の主行動の区間はながら側から除く", () => {
  const events = [ev("m", "動画", "2026-10-06T14:00", "2026-10-06T15:00"), ev("o", "動画を観る", "2026-10-06T15:00", "2026-10-06T16:00")];
  const nagara = [ng("n", "動画", { start: "2026-10-06T14:30", end: "2026-10-06T15:30" })];
  const s = computeReview(events, nagara, WEEK);
  const side = s.sideBySide.find((x) => x.label === "動画")!;
  assert.equal(side.nagaraTotal, 60);
  assert.equal(side.asMain, 60, "完全一致のイベントだけ（「動画を観る」は含まない）");
  assert.equal(side.asNagara, 30, "14:30〜15:00 は主行動と一致するので除く");
});

test("ながら・場所：予定に付いたものは対象外、同ラベルの重なりは1つにまとめる、場所は別表", () => {
  const events = [
    ev("plan", "予定", "2026-10-06T10:00", "2026-10-06T11:00", { kind: "plan" }),
    ev("act", "実績", "2026-10-06T10:00", "2026-10-06T11:00"),
  ];
  const nagara = [
    ng("n1", "YouTube", { eventId: "plan" }),
    ng("n2", "音楽", { eventId: "act" }),
    ng("n3", "音楽", { start: "2026-10-06T10:30", end: "2026-10-06T11:30" }),
    ng("p1", "カフェ", { type: "place", start: "2026-10-06T09:00", end: "2026-10-06T10:00" }),
    ng("p2", "カフェ", { type: "place", start: "2026-10-06T09:30", end: "2026-10-06T10:30" }),
  ];
  const s = computeReview(events, nagara, WEEK);
  assert.deepEqual(s.nagaraTotals, [{ label: "音楽", minutes: 90 }]);
  assert.deepEqual(s.placeTotals, [{ label: "カフェ", minutes: 90 }]);
  assert.equal(s.cross.some((c) => c.label === "カフェ"), false, "場所はながらの重なりに入れない");
});

test("書式：時間・割合・差", () => {
  assert.equal(formatDuration(2535), "42時間15分");
  assert.equal(formatDuration(10080), "168時間");
  assert.equal(formatDuration(15), "15分");
  assert.equal(formatShare(2535, 10080), "42時間15分 / 168時間（25.1%）");
  assert.equal(formatSigned(65), "+1時間5分");
  assert.equal(formatSigned(-30), "−30分");
  assert.equal(formatSigned(0), "±0分");
});

test("未確定の予定は期間内のものだけ・キャンセルの一覧", () => {
  const events = [
    ev("u1", "会議", "2026-10-06T10:00", "2026-10-06T11:00", { kind: "plan" }),
    ev("u2", "別週", "2026-10-20T10:00", "2026-10-20T11:00", { kind: "plan" }),
    ev("c1", "中止", "2026-10-07T10:00", "2026-10-07T11:00", { kind: "plan", status: "cancelled" }),
  ];
  assert.deepEqual(unconfirmedInPeriod(events, WEEK, "2026-11-01T00:00").map((e) => e.id), ["u1"]);
  assert.deepEqual(cancelledInPeriod(events, WEEK).map((e) => e.id), ["c1"]);
});

test("予定の変更：履歴の変更前と次の状態との差", () => {
  const plan = ev("p", "会議", "2026-10-06T14:00", "2026-10-06T15:00", { kind: "plan" });
  const snap = (start: string, end: string) => ({
    title: "会議", start, end, allDay: false, colorId: null, people: [], places: [], memo: "", status: "active" as const, cancelReason: "",
  });
  const revisions: PlanRevision[] = [
    { id: "r1", planId: "p", changedAt: "2026-10-01T00:00:00.000Z", snapshot: snap("2026-10-06T10:00", "2026-10-06T11:00") },
    { id: "r2", planId: "p", changedAt: "2026-10-02T00:00:00.000Z", snapshot: snap("2026-10-06T13:00", "2026-10-06T14:00") },
  ];
  const changes = planChangesInPeriod([plan], revisions, WEEK);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].diffs.find((d) => d.field === "start")!.after, "2026-10-06T13:00");
  assert.equal(changes[1].diffs.find((d) => d.field === "start")!.after, "2026-10-06T14:00");
  assert.equal(planChangesInPeriod([plan], revisions, periodOf("week", "2026-12-01", 1)).length, 0);
});

test("性能：3,300件の月集計が一瞬で終わり、合計が期間の長さに一致する", () => {
  const events: CalendarEvent[] = [];
  const two = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; i < 3300; i++) {
    const day = 1 + (i % 28);
    const h = (i * 7) % 22;
    events.push(ev(`e${i}`, `t${i % 40}`, `2026-10-${two(day)}T${two(h)}:00`, `2026-10-${two(day)}T${two(h + 1)}:30`, { colorId: String(1 + (i % 11)) }));
  }
  const started = Date.now();
  const s = computeReview(events, [], periodOf("month", "2026-10-15", 1));
  assert.ok(Date.now() - started < 2000);
  const sum = Object.values(s.byColor).reduce((x, y) => x + y, 0) + s.unrecorded;
  assert.ok(Math.abs(sum - s.periodMinutes) < 1e-6);
});

test("現在期間：未来を未記録へ含めず、前期間も同じ経過時間まで比較", () => {
  const cutoff = periodCutoff(WEEK, "2026-10-08T20:00");
  const s = computeReview([], [], WEEK, true, cutoff);
  assert.equal(s.periodMinutes, 3 * 1440 + 20 * 60);
  assert.equal(s.unrecorded, s.periodMinutes);
  const prev = shiftPeriod(WEEK, -1);
  assert.equal(equivalentPreviousCutoff(WEEK, prev, "2026-10-08T20:00"), "2026-10-01T20:00");
});

test("新規アプリ記録だけ区分化し、仕事は定時2区間と残業へ分割する", () => {
  const events = [
    ev("work", "仕事", "2026-10-06T08:30", "2026-10-06T18:00", { colorId: "11", source: "app" }),
    ev("nap", "仮眠", "2026-10-07T13:00", "2026-10-07T13:30", { colorId: "1", source: "app" }),
    ev("past", "通勤/仮眠", "2026-10-08T07:00", "2026-10-08T08:00", { colorId: "3", source: "google" }),
  ];
  const s = computeReview(events, [], WEEK);
  const details = Object.fromEntries(Object.entries(s.byDetail).map(([k, v]) => [k.split("\0")[1], v]));
  assert.equal(details["定時"], 8 * 60 - 15);
  assert.equal(details["残業"], 105);
  assert.equal(details["仮眠"], 30);
  assert.equal(details[""], 60, "Google過去データは再分類しない");
  const stacks = stackedBarSeries(s, { type: "parent", name: "仕事" }, settings);
  assert.deepEqual(stacks[1].segments.map((x) => x.label).sort(), ["定時", "残業"]);
});

test("祝日の仕事は休日出勤。細分類なしの行は、同じ色に別の細分類があるときだけ「（細分類なし）」と表示し、合算しない", () => {
  const events = [
    ev("holiday", "仕事", "2026-10-12T09:00", "2026-10-12T12:00", { colorId: "11", source: "app" }),
    ev("g-sleep", "睡眠", "2026-10-12T00:00", "2026-10-12T06:00", { colorId: "1", source: "google" }),
    ev("a-sleep", "睡眠", "2026-10-13T00:00", "2026-10-13T06:00", { colorId: "1", source: "app" }),
    ev("g-life", "生活", "2026-10-13T07:00", "2026-10-13T08:00", { colorId: "3", source: "google" }),
  ];
  const week = periodOf("week", "2026-10-12", 1);
  const s = computeReview(events, [], week);
  const details = Object.fromEntries(Object.entries(s.byDetail).map(([k, v]) => [k.split(" ")[1] || `(${k.split(" ")[0]})`, v]));
  assert.equal(details["休日出勤"], 180);
  const bd = buildBreakdown(s, settings);
  const sleep = bd.parents.find((p) => p.name === "睡眠");
  assert.deepEqual(sleep?.children.map((c) => [c.name, c.minutes]).sort(), [["睡眠", 360], ["睡眠（細分類なし）", 360]]);
  const life = bd.parents.find((p) => p.name === "生活");
  assert.deepEqual(life?.children.map((c) => c.name), ["生活"], "比べる相手がなければ色カテゴリ名のまま");
  const rows = buildDiffRows(s, computeReview([], [], shiftPeriod(week, -1), false), settings);
  assert.ok(rows.some((r) => r.name === "睡眠（細分類なし）" && r.depth === 1));
});
