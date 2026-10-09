import assert from "node:assert/strict";
import test from "node:test";
import { monthCellItems } from "../src/eventLogic.js";
import { eventDefaults } from "../src/migrate.js";
import {
  applyCancel, applyUncancel, buildAsPlanned, buildRevision, diffSnapshots, isLinkedPlan, isUnconfirmed,
  layoutDayWithPlans, linkedPlanIds, planLabel, planVariant, revisionsOfPlan, shouldRecordRevision, snapshotOf, unlinkActuals,
} from "../src/planLogic.js";
import type { CalendarEvent, Nagara } from "../src/types.js";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "plan", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...eventDefaults(), ...extra };
}

function ng(id: string, label: string, extra: Partial<Nagara> = {}): Nagara {
  return { id, label, type: "nagara", eventId: null, start: null, end: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...extra };
}

function idMaker(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

test("リンク判定：planIdで参照された予定がリンク済み", () => {
  const events = [
    ev("p1", "会議", "2026-10-08T10:00", "2026-10-08T11:00"),
    ev("p2", "散歩", "2026-10-08T12:00", "2026-10-08T13:00"),
    ev("a1", "会議", "2026-10-08T10:05", "2026-10-08T11:00", { kind: "actual", planId: "p1" }),
  ];
  const linked = linkedPlanIds(events);
  assert.deepEqual([...linked], ["p1"]);
  assert.equal(isLinkedPlan(events[0], linked), true);
  assert.equal(isLinkedPlan(events[1], linked), false);
  assert.equal(isLinkedPlan(events[2], linked), false);
  assert.equal(planVariant(events[0], linked), "linked");
  assert.equal(planVariant(events[1], linked), "normal");
  assert.equal(planVariant(ev("c", "x", "2026-10-08T10:00", "2026-10-08T11:00", { status: "cancelled" }), linked), "cancelled");
});

test("未確定判定：過ぎた・有効・リンクなしの予定だけ", () => {
  const now = "2026-10-08T12:00";
  const none = new Set<string>();
  assert.equal(isUnconfirmed(ev("a", "x", "2026-10-08T10:00", "2026-10-08T11:00"), none, now), true);
  assert.equal(isUnconfirmed(ev("a", "x", "2026-10-08T10:00", "2026-10-08T12:00"), none, now), false, "終了＝現在はまだ過ぎていない");
  assert.equal(isUnconfirmed(ev("a", "x", "2026-10-08T13:00", "2026-10-08T14:00"), none, now), false, "未来");
  assert.equal(isUnconfirmed(ev("a", "x", "2026-10-08T10:00", "2026-10-08T11:00"), new Set(["a"]), now), false, "リンク済み");
  assert.equal(isUnconfirmed(ev("a", "x", "2026-10-08T10:00", "2026-10-08T11:00", { status: "cancelled" }), none, now), false, "キャンセル");
  assert.equal(isUnconfirmed(ev("a", "x", "2026-10-08T10:00", "2026-10-08T11:00", { kind: "actual" }), none, now), false, "実績");
});

test("日の切り分け：リンク済み・キャンセルは列分割に参加せず背面", () => {
  const events = [
    ev("p1", "会議", "2026-10-08T10:00", "2026-10-08T11:00"),
    ev("a1", "会議", "2026-10-08T10:00", "2026-10-08T11:00", { kind: "actual", planId: "p1" }),
    ev("c1", "中止", "2026-10-08T10:00", "2026-10-08T11:00", { status: "cancelled" }),
    ev("n1", "別件", "2026-10-08T10:30", "2026-10-08T11:30", { kind: "actual" }),
  ];
  const { front, back } = layoutDayWithPlans(events, "2026-10-08", linkedPlanIds(events));
  assert.deepEqual(front.map((s) => s.event.id).sort(), ["a1", "n1"]);
  assert.equal(front[0].cols, 2, "前面の2件だけで2列");
  assert.deepEqual(back.map((b) => [b.seg.event.id, b.variant]).sort(), [["c1", "cancelled"], ["p1", "linked"]]);
});

test("月表示：リンク済みの予定とキャンセルは出さない", () => {
  const events = [
    ev("p1", "会議", "2026-10-08T10:00", "2026-10-08T11:00"),
    ev("a1", "会議", "2026-10-08T10:00", "2026-10-08T11:00", { kind: "actual", planId: "p1" }),
    ev("c1", "中止", "2026-10-08T12:00", "2026-10-08T13:00", { status: "cancelled" }),
    ev("p2", "未確定", "2026-10-08T14:00", "2026-10-08T15:00"),
  ];
  const cell = monthCellItems(events, "2026-10-08", 3, linkedPlanIds(events));
  assert.deepEqual(cell.shown.map((e) => e.id), ["a1", "p2"]);
});

test("予定通り：同内容の実績をplanId付きで作り、ながらも複製する", () => {
  const plan = ev("p1", "めぐちゃんと散歩", "2026-10-08T10:00", "2026-10-08T11:00", {
    colorId: "5", people: ["めぐちゃん"], places: ["公園", "カフェ"], memo: "メモ", recurrenceId: "r1", recurrenceDate: "2026-10-08",
  });
  const nagara = [
    ng("n1", "YouTube", { eventId: "p1" }),
    ng("n2", "音楽", { eventId: "p1", start: "2026-10-08T10:10", end: "2026-10-08T10:30" }),
    ng("n3", "他のイベント", { eventId: "other" }),
  ];
  const { event, nagara: copies } = buildAsPlanned(plan, nagara, "2026-10-08T12:00:00.000Z", idMaker());
  assert.equal(event.kind, "actual");
  assert.equal(event.planId, "p1");
  assert.notEqual(event.id, "p1");
  assert.deepEqual([event.title, event.start, event.end, event.colorId, event.memo], [plan.title, plan.start, plan.end, "5", "メモ"]);
  assert.deepEqual(event.people, ["めぐちゃん"]);
  assert.deepEqual(event.places, ["公園", "カフェ"]);
  assert.equal(event.status, "active");
  assert.equal(event.recurrenceId, null, "繰り返しの印は実績に引き継がない");
  assert.equal(copies.length, 2);
  assert.ok(copies.every((c) => c.eventId === event.id && c.id !== "n1" && c.id !== "n2"));
  assert.deepEqual(copies.map((c) => [c.label, c.start, c.end]), [["YouTube", null, null], ["音楽", "2026-10-08T10:10", "2026-10-08T10:30"]]);
  // 元は変わらない
  assert.equal(plan.people[0], "めぐちゃん");
});

test("履歴差分判定：対象項目が変わったときだけ、予定の変更前を残す", () => {
  const before = ev("p1", "会議", "2026-10-08T10:00", "2026-10-08T11:00");
  assert.equal(shouldRecordRevision(before, { ...before, updatedAt: "later", kind: "plan" }), false, "updatedAtだけ変わっても残さない");
  assert.equal(shouldRecordRevision(before, { ...before, title: "会議2" }), true);
  assert.equal(shouldRecordRevision(before, { ...before, start: "2026-10-08T10:30" }), true);
  assert.equal(shouldRecordRevision(before, { ...before, people: ["A"] }), true);
  assert.equal(shouldRecordRevision(before, { ...before, status: "cancelled" }), true);
  assert.equal(shouldRecordRevision(before, { ...before, cancelReason: "雨" }), true);
  assert.equal(shouldRecordRevision(before, { ...before, colorId: "3" }), true);
  assert.equal(shouldRecordRevision(undefined, before), false, "新規は履歴なし");
  assert.equal(shouldRecordRevision({ ...before, kind: "actual" }, { ...before, title: "x", kind: "actual" }), false, "実績は対象外");

  const rev = buildRevision(before, "2026-10-08T00:00:00.000Z", idMaker());
  assert.equal(rev.planId, "p1");
  assert.equal(rev.snapshot.title, "会議");
  const diffs = diffSnapshots(rev.snapshot, snapshotOf({ ...before, title: "会議2", people: ["A"], status: "cancelled" }));
  assert.deepEqual(diffs.map((d) => [d.label, d.before, d.after]), [
    ["タイトル", "会議", "会議2"],
    ["人", "（なし）", "A"],
    ["状態", "有効", "キャンセル"],
  ]);
  assert.deepEqual(diffSnapshots(rev.snapshot, snapshotOf(before)), []);
});

test("キャンセルと取り消し・履歴の取り出し・削除時のリンク解除", () => {
  const plan = ev("p1", "会議", "2026-10-08T10:00", "2026-10-08T11:00");
  const cancelled = applyCancel(plan, " 雨 ", "s1");
  assert.deepEqual([cancelled.status, cancelled.cancelReason], ["cancelled", "雨"]);
  const back = applyUncancel(cancelled, "s2");
  assert.deepEqual([back.status, back.cancelReason], ["active", ""]);

  const mk = idMaker();
  const revs = [buildRevision(plan, "2026-10-08T01:00:00.000Z", mk), buildRevision(plan, "2026-10-08T03:00:00.000Z", mk), buildRevision({ ...plan, id: "p2" }, "2026-10-08T02:00:00.000Z", mk)];
  assert.deepEqual(revisionsOfPlan(revs, "p1").map((r) => r.changedAt), ["2026-10-08T03:00:00.000Z", "2026-10-08T01:00:00.000Z"]);

  const events = [plan, ev("a1", "会議", "2026-10-08T10:00", "2026-10-08T11:00", { kind: "actual", planId: "p1" }), ev("a2", "別", "2026-10-08T12:00", "2026-10-08T13:00", { kind: "actual", planId: "p2" })];
  const unlinked = unlinkActuals(events, "p1", "s3");
  assert.deepEqual(unlinked.map((e) => [e.id, e.planId]), [["a1", null]]);
  assert.equal(planLabel(plan), "会議 10:00–11:00");
  assert.equal(planLabel(ev("p", "旅行", "2026-10-08T00:00", "2026-10-09T00:00", { allDay: true })), "旅行 終日");
});
