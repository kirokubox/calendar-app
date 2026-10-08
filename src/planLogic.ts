// 予定と実績の純粋ロジック（リンク判定・未確定判定・予定通りの複製・変更履歴・繰り返し生成）。
import { addDays, joinLocal, parseDateKey, timePart } from "./dateUtils.js";
import { deriveEndDate } from "./eventLogic.js";
import { clipToDay, layoutColumns, type DaySegment, type PlacedSegment } from "./layout.js";
import { eventDefaults } from "./migrate.js";
import type { CalendarEvent, Nagara, PlanRevision, PlanSnapshot, RecurrenceRule } from "./types.js";

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

/** 繰り返し予定の先読み日数 */
export const RECURRENCE_HORIZON_DAYS = 56;

/** 平日（月〜金）。0=日〜6=土 */
export const WEEKDAYS_DEFAULT = [1, 2, 3, 4, 5];

/**
 * 有効ルールについて、today から horizon 日先まで（両端を含む）の該当曜日に予定を生成する。
 * generatedDates に記録済みの日付は作らない（ユーザーが削除しても復活しない）。終了時刻が開始以前なら翌日終了。
 * 返す rules は generatedDates が増えたルールだけ。
 */
export function generateRecurrenceEvents(
  rules: RecurrenceRule[],
  today: string,
  stamp: string,
  newId: () => string,
  horizonDays = RECURRENCE_HORIZON_DAYS,
): { events: CalendarEvent[]; rules: RecurrenceRule[] } {
  const events: CalendarEvent[] = [];
  const changed: RecurrenceRule[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    const done = new Set(rule.generatedDates);
    const added: string[] = [];
    for (let i = 0; i <= horizonDays; i++) {
      const day = addDays(today, i);
      if (day < rule.startDate) continue;
      if (rule.endDate !== null && day > rule.endDate) continue;
      if (!rule.weekdays.includes(parseDateKey(day).getDay())) continue;
      if (done.has(day)) continue;
      // 終了が開始以前なら翌日終了（deriveEndDate は「より前」のみ翌日なので、同時刻を別扱いにする）
      const endDay = rule.endTime === rule.startTime ? addDays(day, 1) : deriveEndDate(day, rule.startTime, rule.endTime);
      events.push({
        ...eventDefaults(),
        id: newId(),
        title: rule.title,
        start: joinLocal(day, rule.startTime),
        end: joinLocal(endDay, rule.endTime),
        allDay: false,
        colorId: rule.colorId,
        kind: "plan",
        createdAt: stamp,
        updatedAt: stamp,
        recurrenceId: rule.id,
        recurrenceDate: day,
      });
      added.push(day);
    }
    if (added.length > 0) changed.push({ ...rule, generatedDates: [...rule.generatedDates, ...added] });
  }
  return { events, rules: changed };
}

function occurrenceRange(rule: RecurrenceRule, day: string): { start: string; end: string } {
  const endDay = rule.endTime === rule.startTime ? addDays(day, 1) : deriveEndDate(day, rule.startTime, rule.endTime);
  return { start: joinLocal(day, rule.startTime), end: joinLocal(endDay, rule.endTime) };
}

function ruleIncludesDate(rule: RecurrenceRule, day: string): boolean {
  return rule.active
    && day >= rule.startDate
    && (rule.endDate === null || day <= rule.endDate)
    && rule.weekdays.includes(parseDateKey(day).getDay());
}

/**
 * ルール編集を未来の未確定な予定へ反映する。
 * 自動生成後に手編集された予定（updatedAt !== createdAt）、実績リンク済み、キャンセル済みは保護する。
 * generatedDates にあるのに予定がない日は、本人が削除した日として再生成しない。
 */
export function reconcileRecurrenceRule(
  oldRule: RecurrenceRule | undefined,
  nextRule: RecurrenceRule,
  events: CalendarEvent[],
  today: string,
  stamp: string,
  newId: () => string,
  horizonDays = RECURRENCE_HORIZON_DAYS,
): { rule: RecurrenceRule; putEvents: CalendarEvent[]; deleteEventIds: string[] } {
  const linked = linkedPlanIds(events);
  const own = events.filter((e) => e.recurrenceId === nextRule.id && e.recurrenceDate !== null);
  const byDate = new Map(own.map((e) => [e.recurrenceDate!, e]));
  const done = new Set(oldRule?.generatedDates ?? nextRule.generatedDates);
  const putEvents: CalendarEvent[] = [];
  const deleteEventIds: string[] = [];

  for (const e of own) {
    const day = e.recurrenceDate!;
    if (day < today) continue;
    const protectedOccurrence = e.status === "cancelled" || linked.has(e.id) || e.updatedAt !== e.createdAt;
    if (protectedOccurrence) continue;
    if (!ruleIncludesDate(nextRule, day)) {
      deleteEventIds.push(e.id);
      continue;
    }
    const range = occurrenceRange(nextRule, day);
    putEvents.push({
      ...e,
      title: nextRule.title,
      colorId: nextRule.colorId,
      start: range.start,
      end: range.end,
      updatedAt: stamp,
      // ルール反映は手編集ではない。次回も自動更新できるよう生成日時と揃える。
      createdAt: stamp,
    });
  }

  for (let i = 0; i <= horizonDays; i++) {
    const day = addDays(today, i);
    if (!ruleIncludesDate(nextRule, day) || byDate.has(day) || done.has(day)) continue;
    const range = occurrenceRange(nextRule, day);
    putEvents.push({
      ...eventDefaults(),
      id: newId(), title: nextRule.title, start: range.start, end: range.end, allDay: false,
      colorId: nextRule.colorId, kind: "plan", createdAt: stamp, updatedAt: stamp,
      recurrenceId: nextRule.id, recurrenceDate: day,
    });
    done.add(day);
  }

  // 既存の生成済み日を保持することで、削除済みの予定を復活させない。
  for (const e of own) done.add(e.recurrenceDate!);
  return { rule: { ...nextRule, generatedDates: [...done].sort() }, putEvents, deleteEventIds };
}

/** ルール削除時に一緒に消してよい、未来の未編集・未確定予定 */
export function removableFutureOccurrences(ruleId: string, events: CalendarEvent[], today: string): string[] {
  const linked = linkedPlanIds(events);
  return events
    .filter((e) => e.recurrenceId === ruleId && e.recurrenceDate !== null && e.recurrenceDate >= today)
    .filter((e) => e.status === "active" && !linked.has(e.id) && e.updatedAt === e.createdAt)
    .map((e) => e.id);
}

/** ルール入力の検証。問題なければ null */
export function validateRule(rule: Pick<RecurrenceRule, "title" | "startTime" | "endTime" | "weekdays" | "startDate" | "endDate">): string | null {
  if (rule.title.trim() === "") return "タイトルを入力してください";
  if (rule.startTime === "" || rule.endTime === "") return "開始・終了時刻を入力してください";
  if (rule.weekdays.length === 0) return "曜日を1つ以上選んでください";
  if (rule.startDate === "") return "開始日を入力してください";
  if (rule.endDate !== null && rule.endDate < rule.startDate) return "終了日が開始日より前になっています";
  return null;
}
