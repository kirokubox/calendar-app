import assert from "node:assert/strict";
import test from "node:test";
import { eventDefaults } from "../src/migrate.js";
import {
  canApplyFollowing, generateMissing, normalizeRule, reconcileRule, removableFutureOccurrences, ruleContentFromEvent, splitRuleFrom,
  validateRule, withRemovedDate, type RecurrenceChanges,
} from "../src/recurrence.js";
import type { CalendarEvent, Nagara, RecurrenceRule } from "../src/types.js";

const OLD = "2026-10-01T00:00:00.000Z";

function rule(extra: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    id: "r1", title: "仕事", colorId: "11", startTime: "09:00", endTime: "18:00", weekdays: [1, 2, 3, 4, 5], startDate: "2026-10-01", endDate: "2026-10-31",
    active: true, generatedDates: [], people: [], places: [], subcategory: null, memo: "", nagaraLabels: [], excludeHolidays: false, removedDates: [], ...extra,
  };
}

function ev(id: string, day: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    ...eventDefaults(), id, title: "仕事", start: `${day}T09:00`, end: `${day}T18:00`, allDay: false, colorId: "11", kind: "plan",
    createdAt: OLD, updatedAt: OLD, recurrenceId: "r1", recurrenceDate: day, ...extra,
  };
}

function idMaker(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

/** 変更を適用した後のイベント・ながら */
function apply(events: CalendarEvent[], nagara: Nagara[], c: RecurrenceChanges): { events: CalendarEvent[]; nagara: Nagara[] } {
  const del = new Set(c.deleteEventIds);
  const put = new Map(c.putEvents.map((e) => [e.id, e]));
  const nextEvents = [...events.filter((e) => !del.has(e.id) && !put.has(e.id)), ...put.values()];
  const delN = new Set(c.deleteNagaraIds);
  const putN = new Map(c.putNagara.map((n) => [n.id, n]));
  return { events: nextEvents, nagara: [...nagara.filter((n) => !delN.has(n.id) && !putN.has(n.id)), ...putN.values()] };
}

const days = (events: CalendarEvent[], ruleId = "r1") => events.filter((e) => e.recurrenceId === ruleId).map((e) => e.recurrenceDate as string).sort();

test("生成：終了日まで全件作る（56日で打ち切らない）・内容とながらも入る", () => {
  const r = rule({ startDate: "2026-10-01", endDate: "2027-03-31", people: ["友人"], places: ["職場"], subcategory: "定時", memo: "m", nagaraLabels: ["音楽"] });
  const c = reconcileRule(r, [], [], "2026-10-09", "s", idMaker());
  const d = c.putEvents.map((e) => e.recurrenceDate as string).sort();
  assert.equal(d[0], "2026-10-09");
  assert.equal(d[d.length - 1], "2027-03-31");
  assert.equal(c.created, d.length);
  assert.ok(d.length > 100, "約半年ぶん");
  const e = c.putEvents[0];
  assert.deepEqual([e.kind, e.people, e.places, e.subcategory, e.memo, e.createdAt === e.updatedAt], ["plan", ["友人"], ["職場"], "定時", "m", true]);
  assert.equal(c.putNagara.length, d.length, "予定ごとにながら1件");
  assert.ok(c.putNagara.every((n) => n.label === "音楽" && n.start === null));
  assert.deepEqual(c.putRules[0].generatedDates, d);
});

test("生成：終了日のない旧ルールは56日先まで・翌日に1日ぶん足す・二度目は何も作らない", () => {
  const r = rule({ endDate: null, startDate: "2026-10-01" });
  const first = reconcileRule(r, [], [], "2026-10-08", "s", idMaker());
  assert.equal(first.putEvents.map((e) => e.recurrenceDate as string).sort().slice(-1)[0], "2026-12-03");
  const state = apply([], [], first);
  const again = generateMissing([first.putRules[0]], state.events, state.nagara, "2026-10-08", "s", idMaker());
  assert.equal(again.putEvents.length, 0);
  assert.equal(again.putRules.length, 0);
  const next = generateMissing([first.putRules[0]], state.events, state.nagara, "2026-10-09", "s", idMaker());
  assert.deepEqual(next.putEvents.map((e) => e.recurrenceDate), ["2026-12-04"]);
});

test("生成：開始日・停止・曜日・翌日終了・同時刻は24時間後", () => {
  assert.deepEqual(reconcileRule(rule({ startDate: "2026-10-12", endDate: "2026-10-14" }), [], [], "2026-10-08", "s", idMaker()).putEvents.map((e) => e.recurrenceDate), ["2026-10-12", "2026-10-13", "2026-10-14"]);
  assert.equal(generateMissing([rule({ active: false })], [], [], "2026-10-08", "s", idMaker()).putEvents.length, 0);
  const sat = reconcileRule(rule({ weekdays: [6], endDate: "2026-10-16" }), [], [], "2026-10-08", "s", idMaker());
  assert.deepEqual(sat.putEvents.map((e) => e.recurrenceDate), ["2026-10-10"]);
  const night = reconcileRule(rule({ startTime: "22:00", endTime: "06:00", weekdays: [4], endDate: "2026-10-08" }), [], [], "2026-10-08", "s", idMaker());
  assert.deepEqual([night.putEvents[0].start, night.putEvents[0].end], ["2026-10-08T22:00", "2026-10-09T06:00"]);
  const same = reconcileRule(rule({ startTime: "22:00", endTime: "22:00", weekdays: [4], endDate: "2026-10-08" }), [], [], "2026-10-08", "s", idMaker());
  assert.equal(same.putEvents[0].end, "2026-10-09T22:00");
});

test("墓標：本人が消した日は作り直さない", () => {
  const r = withRemovedDate(rule({ endDate: "2026-10-16" }), "2026-10-14");
  const c = reconcileRule(r, [], [], "2026-10-12", "s", idMaker());
  assert.deepEqual(c.putEvents.map((e) => e.recurrenceDate).sort(), ["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-16"]);
  assert.ok(c.putRules[0].generatedDates.includes("2026-10-14"), "旧版互換のため作成済みにも残す");
});

test("曜日を外して戻すと、その曜日の予定が作り直される（ルール変更は墓標にしない）", () => {
  const ids = idMaker();
  const base = rule({ startDate: "2026-10-12", endDate: "2026-10-25" });
  const c0 = reconcileRule(base, [], [], "2026-10-12", "s", ids);
  let state = apply([], [], c0);
  const wed = (evs: CalendarEvent[]) => days(evs).filter((d) => new Date(`${d}T00:00:00`).getDay() === 3).length;
  assert.equal(wed(state.events), 2);
  const c1 = reconcileRule({ ...c0.putRules[0], weekdays: [1, 2, 4, 5] }, state.events, state.nagara, "2026-10-12", "s", ids);
  state = apply(state.events, state.nagara, c1);
  assert.equal(wed(state.events), 0);
  assert.deepEqual(c1.putRules[0].removedDates, []);
  const c2 = reconcileRule({ ...c1.putRules[0], weekdays: [1, 2, 3, 4, 5] }, state.events, state.nagara, "2026-10-12", "s", ids);
  state = apply(state.events, state.nagara, c2);
  assert.equal(wed(state.events), 2);
  assert.equal(new Set(days(state.events)).size, days(state.events).length, "重複なし");
});

test("ルール編集：今日以降の未保護だけ更新・条件外は削除。過去・個別編集・リンク・キャンセルは保護", () => {
  const past = ev("past", "2026-10-07");
  const plain = ev("g", "2026-10-08");
  const linkedPlan = ev("l", "2026-10-09");
  const edited = ev("e", "2026-10-12", { title: "個別", updatedAt: "2026-10-02T00:00:00.000Z" });
  const cancelled = ev("c", "2026-10-13", { status: "cancelled" });
  const offDay = ev("w", "2026-10-14");
  const actual = { ...ev("a", "2026-10-09", { kind: "actual", planId: "l" }), recurrenceId: null, recurrenceDate: null };
  const nag: Nagara[] = [{ id: "n-w", label: "音楽", type: "nagara", eventId: "w", start: null, end: null, createdAt: OLD, updatedAt: OLD }];
  const next = rule({ title: "勤務", startTime: "09:30", endTime: "17:30", weekdays: [1, 2, 4, 5], endDate: "2026-10-16", generatedDates: ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"], removedDates: ["2026-10-15"] });
  const c = reconcileRule(next, [past, plain, linkedPlan, edited, cancelled, offDay, actual], nag, "2026-10-08", "stamp", idMaker());
  assert.deepEqual([c.putEvents.find((x) => x.id === "g")?.title, c.putEvents.find((x) => x.id === "g")?.start], ["勤務", "2026-10-08T09:30"]);
  assert.ok(!c.putEvents.some((x) => ["past", "l", "e", "c"].includes(x.id)), "保護・過去は書き換えない");
  assert.deepEqual(c.deleteEventIds, ["w"], "水曜を外したので未保護の水曜は削除");
  assert.deepEqual(c.deleteNagaraIds, ["n-w"], "付いていたながらも削除");
  assert.ok(!c.putEvents.some((x) => x.recurrenceDate === "2026-10-15"), "墓標の日は作らない");
  assert.deepEqual(c.putEvents.filter((x) => x.id.startsWith("id")).map((x) => x.recurrenceDate), ["2026-10-16"]);
  assert.deepEqual(removableFutureOccurrences("r1", [linkedPlan, edited, cancelled, actual, plain], "2026-10-08"), ["g"]);
});

test("祝日除外：オンで未保護の祝日予定を消し（墓標にしない）、オフで作り直す。手で消した祝日と保護済みはそのまま", () => {
  const ids = idMaker();
  // 2026-10-12（スポーツの日）は手で消した日、11/3 は個別編集、11/23 は未保護
  const base = rule({ startDate: "2026-10-12", endDate: "2026-11-30", removedDates: ["2026-10-12"] });
  let state = apply([], [], reconcileRule(base, [], [], "2026-10-09", "s", ids));
  state.events = state.events.map((e) => (e.recurrenceDate === "2026-11-03" ? { ...e, title: "出勤", updatedAt: "x" } : e));
  const on = reconcileRule({ ...base, excludeHolidays: true }, state.events, state.nagara, "2026-10-09", "s", ids);
  const removedDays = state.events.filter((e) => on.deleteEventIds.includes(e.id)).map((e) => e.recurrenceDate);
  assert.deepEqual(removedDays, ["2026-11-23"]);
  assert.deepEqual(on.putRules[0].removedDates, ["2026-10-12"]);
  state = apply(state.events, state.nagara, on);
  const off = reconcileRule({ ...on.putRules[0], excludeHolidays: false }, state.events, state.nagara, "2026-10-09", "s", ids);
  assert.deepEqual(off.putEvents.map((e) => e.recurrenceDate), ["2026-11-23"], "10/12 は墓標なので作らない");
});

test("この日以降：ルールを分割し、以前は不変・以降は新内容。保護済みは付け替えるだけ・重複なし", () => {
  const ids = idMaker();
  const base = rule({ startDate: "2026-10-05", endDate: "2026-10-23", removedDates: ["2026-10-20"] });
  let state = apply([], [], reconcileRule(base, [], [], "2026-10-05", "s", ids));
  const r0 = { ...base, generatedDates: days(state.events).concat("2026-10-20").sort() };
  // 10/19 は個別編集済み（保護）
  state.events = state.events.map((e) => (e.recurrenceDate === "2026-10-19" ? { ...e, title: "個別", updatedAt: "x" } : e));
  const clicked = state.events.find((e) => e.recurrenceDate === "2026-10-14") as CalendarEvent;
  const edited: CalendarEvent = { ...clicked, title: "在宅", start: "2026-10-14T10:00", end: "2026-10-14T17:00", places: ["家"] };
  const content = ruleContentFromEvent(edited, ["音楽"]);
  const c = splitRuleFrom(r0, "2026-10-14", content, edited, state.events, state.nagara, "2026-10-09", "t", ids);
  const before = c.putRules.find((r) => r.id === "r1") as RecurrenceRule;
  const after = c.putRules.find((r) => r.id === c.ruleId) as RecurrenceRule;
  assert.equal(before.endDate, "2026-10-13");
  assert.deepEqual([after.startDate, after.endDate, after.title, after.startTime, after.places, after.nagaraLabels], ["2026-10-14", "2026-10-23", "在宅", "10:00", ["家"], ["音楽"]]);
  assert.deepEqual(after.removedDates, ["2026-10-20"], "以降の墓標を引き継ぐ");
  assert.ok(!c.putEvents.some((e) => e.id === clicked.id), "押した予定は呼び出し側で保存");
  // 呼び出し側の保存を模して適用
  state = apply(state.events, state.nagara, c);
  state.events = state.events.map((e) => (e.id === clicked.id ? { ...edited, recurrenceId: c.ruleId } : e));
  assert.deepEqual(days(state.events, "r1"), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13"]);
  const newDays = days(state.events, c.ruleId);
  assert.deepEqual(newDays, ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-21", "2026-10-22", "2026-10-23"]);
  const protectedOne = state.events.find((e) => e.recurrenceDate === "2026-10-19") as CalendarEvent;
  assert.equal(protectedOne.title, "個別", "保護済みは内容を変えない");
  const updated = state.events.find((e) => e.recurrenceDate === "2026-10-15") as CalendarEvent;
  assert.deepEqual([updated.title, updated.start, updated.places], ["在宅", "2026-10-15T10:00", ["家"]]);
  assert.ok(state.nagara.some((n) => n.eventId === updated.id && n.label === "音楽"));
  const early = state.events.find((e) => e.recurrenceDate === "2026-10-13") as CalendarEvent;
  assert.equal(early.title, "仕事", "境界日より前は不変");
});

test("この日以降：過去の日を選んでも、今日より前の他の予定は内容を変えない。開始日なら分割しない", () => {
  const ids = idMaker();
  const base = rule({ startDate: "2026-10-05", endDate: "2026-10-16" });
  const state = apply([], [], reconcileRule(base, [], [], "2026-10-05", "s", ids));
  const clicked = state.events.find((e) => e.recurrenceDate === "2026-10-06") as CalendarEvent;
  const edited = { ...clicked, title: "新" };
  const c = splitRuleFrom(base, "2026-10-06", ruleContentFromEvent(edited, []), edited, state.events, state.nagara, "2026-10-09", "t", ids);
  const changedTitles = c.putEvents.filter((e) => (e.recurrenceDate as string) < "2026-10-09").map((e) => e.title);
  assert.ok(changedTitles.every((t) => t === "仕事"), "過去は付け替えのみ");
  assert.ok(c.putEvents.filter((e) => (e.recurrenceDate as string) >= "2026-10-09").every((e) => e.title === "新"));
  const atStart = splitRuleFrom(base, "2026-10-05", ruleContentFromEvent(edited, []), edited, state.events, state.nagara, "2026-10-09", "t", ids);
  assert.equal(atStart.ruleId, "r1");
  assert.equal(atStart.putRules.length, 1);
  assert.equal(canApplyFollowing(base, "2026-10-20"), false, "期間外は選べない");
  assert.equal(canApplyFollowing(base, "2026-10-10"), true);
  assert.equal(canApplyFollowing(undefined, "2026-10-10"), false);
});

test("旧データの正規化：既定値を補い、作成済みなのに予定がない日を墓標として導出", () => {
  const raw = { id: "r1", title: "仕事", colorId: null, startTime: "09:00", endTime: "12:00", weekdays: [1], startDate: "2026-10-01", endDate: "2026-12-25", active: true, generatedDates: ["2026-10-05", "2026-10-12", "2026-10-19"] };
  const { rule: r, migrated } = normalizeRule(raw, [ev("x", "2026-10-05"), ev("y", "2026-10-19")]);
  assert.equal(migrated, true);
  assert.deepEqual(r.removedDates, ["2026-10-12"]);
  assert.deepEqual([r.people, r.places, r.subcategory, r.memo, r.nagaraLabels, r.excludeHolidays], [[], [], null, "", [], false]);
  const again = normalizeRule({ ...r }, []);
  assert.equal(again.migrated, false);
  assert.deepEqual(again.rule.removedDates, ["2026-10-12"]);
});

test("ルールの検証：終了日は必須", () => {
  const ok = { title: "仕事", startTime: "09:00", endTime: "18:00", weekdays: [1], startDate: "2026-10-01", endDate: "2026-12-31" };
  assert.equal(validateRule(ok), null);
  assert.notEqual(validateRule({ ...ok, endDate: null }), null);
  assert.notEqual(validateRule({ ...ok, title: " " }), null);
  assert.notEqual(validateRule({ ...ok, weekdays: [] }), null);
  assert.notEqual(validateRule({ ...ok, endDate: "2026-09-30" }), null);
  assert.equal(validateRule({ ...ok, startTime: "22:00", endTime: "06:00" }), null);
});
