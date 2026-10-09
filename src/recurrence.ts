// 繰り返し予定の純粋ロジック：ルールの正規化・終了日までの生成・ルール変更の反映・「この日以降」の分割・墓標。
//
// 用語
// - 予定（occurrence）：ルールから作ったイベント（recurrenceId と recurrenceDate を持つ）
// - 保護：個別編集（updatedAt !== createdAt）・実績リンク・キャンセルのどれか。ルール変更で内容を変えず、消さない
// - 墓標（removedDates）：本人が手で消した日。ルールの条件に合っても作り直さない
//   ルール変更（曜日・期間・祝日除外）で消えた日は墓標にしない（条件が戻れば作り直す）
import { addDays, joinLocal, parseDateKey, timePart } from "./dateUtils.js";
import { deriveEndDate } from "./eventLogic.js";
import { isHoliday } from "./holidays.js";
import { eventDefaults } from "./migrate.js";
import type { CalendarEvent, Nagara, RecurrenceRule } from "./types.js";

/** 終了日のない旧ルールだけに使う先読み日数（新規ルールは終了日が必須） */
export const LEGACY_HORIZON_DAYS = 56;

/** 1回の保存で、この件数を超えて作るときは確認する（上限ではない） */
export const LARGE_GENERATION_THRESHOLD = 500;

/** 平日（月〜金）。0=日〜6=土 */
export const WEEKDAYS_DEFAULT = [1, 2, 3, 4, 5];

type Rec = Record<string, unknown>;

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function uniqSorted(list: Iterable<string>): string[] {
  return [...new Set(list)].sort();
}

/**
 * 保存データ（旧版のルールを含む）を現在の形にする。足りない項目は既定値。
 * removedDates が無い旧データは「作成済みなのに予定がない日」を墓標として導出する（旧版では手で消した日だけがそうなる）。
 */
export function normalizeRule(raw: Rec, events: CalendarEvent[] = []): { rule: RecurrenceRule; migrated: boolean } {
  const id = raw.id as string;
  const generatedDates = strArray(raw.generatedDates);
  const hasRemoved = Array.isArray(raw.removedDates);
  let removedDates = strArray(raw.removedDates);
  if (!hasRemoved) {
    const present = new Set(events.filter((e) => e.recurrenceId === id && e.recurrenceDate !== null).map((e) => e.recurrenceDate as string));
    removedDates = generatedDates.filter((d) => !present.has(d));
  }
  const rule: RecurrenceRule = {
    id,
    title: raw.title as string,
    colorId: (raw.colorId ?? null) as string | null,
    startTime: raw.startTime as string,
    endTime: raw.endTime as string,
    weekdays: (raw.weekdays as number[]) ?? [],
    startDate: raw.startDate as string,
    endDate: typeof raw.endDate === "string" ? raw.endDate : null,
    active: raw.active !== false,
    generatedDates,
    people: strArray(raw.people),
    places: strArray(raw.places),
    subcategory: typeof raw.subcategory === "string" && raw.subcategory.trim() !== "" ? raw.subcategory : null,
    memo: typeof raw.memo === "string" ? raw.memo : "",
    nagaraLabels: strArray(raw.nagaraLabels),
    excludeHolidays: raw.excludeHolidays === true,
    removedDates: uniqSorted(removedDates),
  };
  return { rule, migrated: !hasRemoved };
}

/** 保護された予定か（個別編集・実績リンク・キャンセル） */
export function isProtectedOccurrence(e: CalendarEvent, linked: Set<string>): boolean {
  return e.status === "cancelled" || linked.has(e.id) || e.updatedAt !== e.createdAt;
}

function linkedIds(events: CalendarEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const e of events) if (e.planId !== null) ids.add(e.planId);
  return ids;
}

/** ルールの条件（有効・期間・曜日・祝日除外）にその日が合うか。墓標は見ない */
export function ruleIncludesDate(rule: RecurrenceRule, day: string): boolean {
  return rule.active
    && day >= rule.startDate
    && (rule.endDate === null || day <= rule.endDate)
    && rule.weekdays.includes(parseDateKey(day).getDay())
    && !(rule.excludeHolidays && isHoliday(day));
}

/** 生成する最後の日。終了日があればそこまで、旧ルール（終了日なし）は今日から56日先まで */
export function generationEnd(rule: RecurrenceRule, today: string): string {
  return rule.endDate ?? addDays(today, LEGACY_HORIZON_DAYS);
}

export function occurrenceRange(rule: Pick<RecurrenceRule, "startTime" | "endTime">, day: string): { start: string; end: string } {
  // 終了が開始以前なら翌日終了（deriveEndDate は「より前」のみ翌日なので、同時刻を別扱いにする）
  const endDay = rule.endTime === rule.startTime ? addDays(day, 1) : deriveEndDate(day, rule.startTime, rule.endTime);
  return { start: joinLocal(day, rule.startTime), end: joinLocal(endDay, rule.endTime) };
}

function ruleNagara(rule: RecurrenceRule, eventId: string, stamp: string, newId: () => string): Nagara[] {
  return uniqSorted(rule.nagaraLabels.map((l) => l.trim()).filter((l) => l !== "")).map((label) => ({
    id: newId(), label, type: "nagara", eventId, start: null, end: null, createdAt: stamp, updatedAt: stamp,
  }));
}

/** 予定の内容をルールに合わせた形（id・作成情報はそのまま） */
function applyRuleContent(e: CalendarEvent, rule: RecurrenceRule, day: string): CalendarEvent {
  const range = occurrenceRange(rule, day);
  return {
    ...e,
    title: rule.title, colorId: rule.colorId, start: range.start, end: range.end, allDay: false,
    people: [...rule.people], places: [...rule.places], subcategory: rule.subcategory, memo: rule.memo,
  };
}

function sameContent(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.title === b.title && a.colorId === b.colorId && a.start === b.start && a.end === b.end && a.allDay === b.allDay
    && JSON.stringify(a.people) === JSON.stringify(b.people) && JSON.stringify(a.places) === JSON.stringify(b.places)
    && a.subcategory === b.subcategory && a.memo === b.memo;
}

function wholeLabels(nagara: Nagara[], eventId: string): string[] {
  return uniqSorted(nagara.filter((n) => n.eventId === eventId && n.type === "nagara").map((n) => n.label.trim()).filter((l) => l !== ""));
}

export interface RecurrenceChanges {
  putRules: RecurrenceRule[];
  putEvents: CalendarEvent[];
  deleteEventIds: string[];
  putNagara: Nagara[];
  deleteNagaraIds: string[];
  /** 新しく作った予定の件数 */
  created: number;
}

function emptyChanges(): RecurrenceChanges {
  return { putRules: [], putEvents: [], deleteEventIds: [], putNagara: [], deleteNagaraIds: [], created: 0 };
}

/**
 * ルールの内容を予定へ反映する（新規作成・設定での編集・再開・起動時の生成で共通）。
 * - 今日以降の未保護の予定：条件から外れたら削除（墓標にしない）、内容が違えばルールの内容へ更新
 * - 今日（または開始日）から終了日までで、予定がなく墓標でもない日：新しく作る
 * - 今日より前の予定・保護された予定・skipIds の予定には触れない
 */
export function reconcileRule(
  rule: RecurrenceRule,
  events: CalendarEvent[],
  nagara: Nagara[],
  today: string,
  stamp: string,
  newId: () => string,
  skipIds: Set<string> = new Set(),
): RecurrenceChanges {
  const out = emptyChanges();
  const linked = linkedIds(events);
  const own = events.filter((e) => e.recurrenceId === rule.id && e.recurrenceDate !== null);
  const occupied = new Set<string>();
  const removed = new Set(rule.removedDates);

  for (const e of own) {
    const day = e.recurrenceDate as string;
    if (day < today || skipIds.has(e.id) || isProtectedOccurrence(e, linked)) {
      occupied.add(day);
      continue;
    }
    if (!ruleIncludesDate(rule, day)) {
      out.deleteEventIds.push(e.id);
      out.deleteNagaraIds.push(...nagara.filter((n) => n.eventId === e.id).map((n) => n.id));
      continue;
    }
    occupied.add(day);
    const next = applyRuleContent(e, rule, day);
    const labelsChanged = JSON.stringify(wholeLabels(nagara, e.id)) !== JSON.stringify(uniqSorted(rule.nagaraLabels.map((l) => l.trim()).filter((l) => l !== "")));
    if (!sameContent(e, next)) {
      // ルール反映は手編集ではない。次回も自動更新できるよう生成日時と揃える
      out.putEvents.push({ ...next, createdAt: stamp, updatedAt: stamp });
    }
    if (labelsChanged) {
      out.deleteNagaraIds.push(...nagara.filter((n) => n.eventId === e.id && n.type === "nagara").map((n) => n.id));
      out.putNagara.push(...ruleNagara(rule, e.id, stamp, newId));
    }
  }

  const from = rule.startDate > today ? rule.startDate : today;
  const last = generationEnd(rule, today);
  for (let day = from; day <= last; day = addDays(day, 1)) {
    if (occupied.has(day) || removed.has(day) || !ruleIncludesDate(rule, day)) continue;
    const id = newId();
    const range = occurrenceRange(rule, day);
    out.putEvents.push({
      ...eventDefaults(),
      id, title: rule.title, start: range.start, end: range.end, allDay: false, colorId: rule.colorId, kind: "plan",
      createdAt: stamp, updatedAt: stamp, people: [...rule.people], places: [...rule.places], subcategory: rule.subcategory, memo: rule.memo,
      recurrenceId: rule.id, recurrenceDate: day,
    });
    out.putNagara.push(...ruleNagara(rule, id, stamp, newId));
    occupied.add(day);
    out.created++;
  }

  const generatedDates = uniqSorted([...occupied, ...rule.removedDates]);
  if (JSON.stringify(generatedDates) !== JSON.stringify(rule.generatedDates)) out.putRules.push({ ...rule, generatedDates });
  else out.putRules.push(rule);
  return out;
}

/** 起動時：有効なルールについて、足りない予定を作る（終了日まで。旧ルールは56日先まで） */
export function generateMissing(
  rules: RecurrenceRule[],
  events: CalendarEvent[],
  nagara: Nagara[],
  today: string,
  stamp: string,
  newId: () => string,
): RecurrenceChanges {
  const out = emptyChanges();
  for (const rule of rules) {
    if (!rule.active) continue;
    const c = reconcileRule(rule, events, nagara, today, stamp, newId);
    out.putEvents.push(...c.putEvents);
    out.deleteEventIds.push(...c.deleteEventIds);
    out.putNagara.push(...c.putNagara);
    out.deleteNagaraIds.push(...c.deleteNagaraIds);
    out.created += c.created;
    const changed = c.putRules[0];
    if (changed !== rule) out.putRules.push(changed);
  }
  return out;
}

/** 予定の内容からルールの内容を作る（「この日以降」用） */
export function ruleContentFromEvent(e: CalendarEvent, nagaraLabels: string[]): Pick<
  RecurrenceRule, "title" | "colorId" | "startTime" | "endTime" | "people" | "places" | "subcategory" | "memo" | "nagaraLabels"
> {
  return {
    title: e.title, colorId: e.colorId, startTime: timePart(e.start), endTime: timePart(e.end),
    people: [...e.people], places: [...e.places], subcategory: e.subcategory, memo: e.memo,
    nagaraLabels: uniqSorted(nagaraLabels.map((l) => l.trim()).filter((l) => l !== "")),
  };
}

/** 「この日以降」を選べるか：ルールがあり、その日がルールの期間内 */
export function canApplyFollowing(rule: RecurrenceRule | undefined, day: string | null): boolean {
  if (!rule || day === null) return false;
  return day >= rule.startDate && (rule.endDate === null || day <= rule.endDate);
}

/**
 * 「この日以降」：ルールを fromDate で分割し、fromDate 以降を新しい内容にする。
 * - 元のルールは終了日を fromDate の前日にする（それより前の予定・墓標は触らない）
 * - fromDate 以降の予定（保護済みを含む）は新しいルールへ付け替える。保護済みの内容は変えない
 * - 編集した予定（edited）は呼び出し側で保存する。ここでは付け替え先のidだけ返し、内容は変えない
 * - fromDate が元のルールの開始日以前なら、分割せず元のルールの内容を変える
 */
export function splitRuleFrom(
  rule: RecurrenceRule,
  fromDate: string,
  content: ReturnType<typeof ruleContentFromEvent>,
  edited: CalendarEvent,
  events: CalendarEvent[],
  nagara: Nagara[],
  today: string,
  stamp: string,
  newId: () => string,
): RecurrenceChanges & { ruleId: string } {
  const skip = new Set([edited.id]);
  if (fromDate <= rule.startDate) {
    const next: RecurrenceRule = { ...rule, ...content };
    const c = reconcileRule(next, events, nagara, today, stamp, newId, skip);
    return { ...c, ruleId: rule.id };
  }
  const before: RecurrenceRule = {
    ...rule,
    endDate: addDays(fromDate, -1),
    removedDates: rule.removedDates.filter((d) => d < fromDate),
    generatedDates: rule.generatedDates.filter((d) => d < fromDate),
  };
  const after: RecurrenceRule = {
    ...rule,
    ...content,
    id: newId(),
    startDate: fromDate,
    removedDates: rule.removedDates.filter((d) => d >= fromDate),
    generatedDates: [],
  };
  const repointed = new Map<string, CalendarEvent>();
  const nextEvents = events.map((e) => {
    if (e.recurrenceId !== rule.id || e.recurrenceDate === null || e.recurrenceDate < fromDate) return e;
    const moved = { ...e, recurrenceId: after.id };
    if (e.id !== edited.id) repointed.set(e.id, moved);
    return moved;
  });
  const c = reconcileRule(after, nextEvents, nagara, today, stamp, newId, skip);
  const puts = new Map(repointed);
  for (const e of c.putEvents) puts.set(e.id, e);
  for (const id of c.deleteEventIds) puts.delete(id);
  return { ...c, putRules: [before, ...c.putRules], putEvents: [...puts.values()], ruleId: after.id };
}

/** 本人が予定を手で消したとき：その日を墓標にしたルール */
export function withRemovedDate(rule: RecurrenceRule, day: string): RecurrenceRule {
  return { ...rule, removedDates: uniqSorted([...rule.removedDates, day]), generatedDates: uniqSorted([...rule.generatedDates, day]) };
}

/** ルール削除時に一緒に消してよい、未来の未保護の予定 */
export function removableFutureOccurrences(ruleId: string, events: CalendarEvent[], today: string): string[] {
  const linked = linkedIds(events);
  return events
    .filter((e) => e.recurrenceId === ruleId && e.recurrenceDate !== null && e.recurrenceDate >= today)
    .filter((e) => !isProtectedOccurrence(e, linked))
    .map((e) => e.id);
}

/** ルール入力の検証。問題なければ null。終了日は必須 */
export function validateRule(rule: Pick<RecurrenceRule, "title" | "startTime" | "endTime" | "weekdays" | "startDate" | "endDate">): string | null {
  if (rule.title.trim() === "") return "タイトルを入力してください";
  if (rule.startTime === "" || rule.endTime === "") return "開始・終了時刻を入力してください";
  if (rule.weekdays.length === 0) return "曜日を1つ以上選んでください";
  if (rule.startDate === "") return "開始日を入力してください";
  if (rule.endDate === null || rule.endDate === "") return "終了日を入力してください";
  if (rule.endDate < rule.startDate) return "終了日が開始日より前になっています";
  return null;
}

/** 新しいルールの既定値 */
export function newRuleDefaults(id: string, today: string): RecurrenceRule {
  return {
    id, title: "", colorId: null, startTime: "09:00", endTime: "18:00", weekdays: [...WEEKDAYS_DEFAULT], startDate: today, endDate: null,
    active: true, generatedDates: [], people: [], places: [], subcategory: null, memo: "", nagaraLabels: [], excludeHolidays: false, removedDates: [],
  };
}
