// 予定と実績の純粋ロジック（リンク判定・未確定判定・予定通りの複製・変更履歴）。繰り返しは recurrence.ts。
import { timePart } from "./dateUtils.js";
import { clipToDay, layoutColumns, type DaySegment, type PlacedSegment } from "./layout.js";
import { eventDefaults } from "./migrate.js";
import type { CalendarEvent, Nagara, PlanRevision, PlanSnapshot } from "./types.js";

/** 実績から参照されている予定のid（planIdで指されている予定） */
export function linkedPlanIds(events: CalendarEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) if (e.planId !== null) ids.add(e.planId);
  return ids;
}

/** 実績がリンクされた予定か（予定であり、実績から参照されている） */
export function isLinkedPlan(event: CalendarEvent, linked: Set<string>): boolean {
  return event.kind === "plan" && linked.has(event.id);
}

/** 過ぎた予定（終了が現在より前・有効・リンクされた実績なし）か */
export function isUnconfirmed(event: CalendarEvent, linked: Set<string>, now: string): boolean {
  return event.kind === "plan" && event.status === "active" && event.end < now && !linked.has(event.id);
}

/** 表示の区分：linked＝背面に薄い枠線／cancelled＝背面に取り消し線／normal＝通常（列分割に参加） */
export type PlanVariant = "normal" | "linked" | "cancelled";

export function planVariant(event: CalendarEvent, linked: Set<string>): PlanVariant {
  if (event.kind !== "plan") return "normal";
  if (event.status === "cancelled") return "cancelled";
  return linked.has(event.id) ? "linked" : "normal";
}

export interface PlacedBackground {
  seg: DaySegment;
  variant: PlanVariant;
}

/** その日の表示用の切り分け：通常のイベントだけを列分割し、リンク済み・キャンセルの予定は背面用に分ける */
export function layoutDayWithPlans(events: CalendarEvent[], dayKey: string, linked: Set<string>): { front: PlacedSegment[]; back: PlacedBackground[] } {
  const frontSegs: DaySegment[] = [];
  const back: PlacedBackground[] = [];
  for (const e of events) {
    const seg = clipToDay(e, dayKey);
    if (!seg) continue;
    const variant = planVariant(e, linked);
    if (variant === "normal") frontSegs.push(seg);
    else back.push({ seg, variant });
  }
  return { front: layoutColumns(frontSegs), back };
}

/** 「予定通り」：予定と同じ内容の実績（planId付き）と、ながらの複製（時間つきも同じ時間で）を作る */
export function buildAsPlanned(
  plan: CalendarEvent,
  planNagara: Nagara[],
  stamp: string,
  newId: () => string,
): { event: CalendarEvent; nagara: Nagara[] } {
  const id = newId();
  const event: CalendarEvent = {
    ...eventDefaults(),
    id,
    title: plan.title,
    start: plan.start,
    end: plan.end,
    allDay: plan.allDay,
    colorId: plan.colorId,
    kind: "actual",
    createdAt: stamp,
    updatedAt: stamp,
    people: [...plan.people],
    places: [...plan.places],
    memo: plan.memo,
    subcategory: plan.subcategory,
    planId: plan.id,
  };
  const nagara = planNagara
    .filter((n) => n.eventId === plan.id)
    .map((n): Nagara => ({ ...n, id: newId(), eventId: id, createdAt: stamp, updatedAt: stamp }));
  return { event, nagara };
}

/** 予定の変更履歴の対象項目 */
export function snapshotOf(e: CalendarEvent): PlanSnapshot {
  return {
    title: e.title, start: e.start, end: e.end, allDay: e.allDay, colorId: e.colorId,
    people: [...e.people], places: [...e.places], memo: e.memo, subcategory: e.subcategory, status: e.status, cancelReason: e.cancelReason,
  };
}

export const SNAPSHOT_LABELS: Record<keyof PlanSnapshot, string> = {
  title: "タイトル", start: "開始", end: "終了", allDay: "終日", colorId: "色", people: "人", places: "場所", memo: "メモ", subcategory: "区分", status: "状態", cancelReason: "キャンセル理由",
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface SnapshotDiff {
  field: keyof PlanSnapshot;
  label: string;
  before: string;
  after: string;
}

function show(field: keyof PlanSnapshot, v: unknown): string {
  if (Array.isArray(v)) return v.length > 0 ? v.join("、") : "（なし）";
  if (field === "allDay") return v ? "終日" : "終日でない";
  if (field === "colorId") return v === null ? "色なし" : `色${String(v)}`;
  if (field === "status") return v === "cancelled" ? "キャンセル" : "有効";
  if (v === "" || v === null || v === undefined) return "（なし）";
  return String(v);
}

/** 2つの内容の差（before → after）。変わった項目だけ */
export function diffSnapshots(before: PlanSnapshot, after: PlanSnapshot): SnapshotDiff[] {
  const result: SnapshotDiff[] = [];
  for (const field of Object.keys(SNAPSHOT_LABELS) as Array<keyof PlanSnapshot>) {
    if (same(before[field], after[field])) continue;
    result.push({ field, label: SNAPSHOT_LABELS[field], before: show(field, before[field]), after: show(field, after[field]) });
  }
  return result;
}

/** 予定の保存で履歴を残すべきか：保存前が予定で、対象項目のいずれかが変わった */
export function shouldRecordRevision(before: CalendarEvent | undefined, after: CalendarEvent): boolean {
  if (!before || before.kind !== "plan") return false;
  return diffSnapshots(snapshotOf(before), snapshotOf(after)).length > 0;
}

export function buildRevision(before: CalendarEvent, changedAt: string, newId: () => string): PlanRevision {
  return { id: newId(), planId: before.id, changedAt, snapshot: snapshotOf(before) };
}

/** その予定の履歴（新しい順） */
export function revisionsOfPlan(revisions: PlanRevision[], planId: string): PlanRevision[] {
  return revisions.filter((r) => r.planId === planId).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}

/** 予定を削除するとき、その予定を指す実績の planId を null にした実績の一覧 */
export function unlinkActuals(events: CalendarEvent[], planId: string, stamp: string): CalendarEvent[] {
  return events.filter((e) => e.planId === planId).map((e) => ({ ...e, planId: null, updatedAt: stamp }));
}

/** キャンセルを適用した予定 */
export function applyCancel(plan: CalendarEvent, reason: string, stamp: string): CalendarEvent {
  return { ...plan, status: "cancelled", cancelReason: reason.trim(), updatedAt: stamp };
}

/** キャンセルを取り消した予定 */
export function applyUncancel(plan: CalendarEvent, stamp: string): CalendarEvent {
  return { ...plan, status: "active", cancelReason: "", updatedAt: stamp };
}

/** 「予定：<タイトル 時刻>」表示用 */
export function planLabel(plan: CalendarEvent): string {
  if (plan.allDay) return `${plan.title} 終日`;
  return `${plan.title} ${timePart(plan.start)}–${timePart(plan.end)}`;
}
