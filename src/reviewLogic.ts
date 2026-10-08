// 振り返り（集計）の純粋ロジック：期間・主行動の等分スイープ・未記録・前期間差・棒グラフ・ながら交差・書式。
import { PARENT_CATEGORIES } from "./constants.js";
import { addDays, addMonths, diffDays, formatMonthLabel, formatShortDate, startOfMonth, startOfWeek, toLocal } from "./dateUtils.js";
import { eventMap, resolveNagara } from "./nagaraLogic.js";
import { diffSnapshots, isUnconfirmed, linkedPlanIds, snapshotOf, type SnapshotDiff } from "./planLogic.js";
import type { CalendarEvent, Nagara, ParentCategory, PlanRevision, Settings } from "./types.js";

// ---------- 期間 ----------

export type PeriodKind = "week" | "month";

export interface Period {
  kind: PeriodKind;
  /** 初日（YYYY-MM-DD） */
  start: string;
  /** 終了日の翌日（排他的終端） */
  end: string;
}

/** anchor を含む週（週の始まりは weekStartDay）／月 */
export function periodOf(kind: PeriodKind, anchor: string, weekStartDay: number): Period {
  if (kind === "week") {
    const start = startOfWeek(anchor, weekStartDay);
    return { kind, start, end: addDays(start, 7) };
  }
  const start = startOfMonth(anchor);
  return { kind, start, end: addMonths(start, 1) };
}

/** 前後の期間（dir=-1 で前、1 で次） */
export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  if (p.kind === "week") {
    const start = addDays(p.start, 7 * dir);
    return { kind: "week", start, end: addDays(start, 7) };
  }
  const start = addMonths(p.start, dir);
  return { kind: "month", start, end: addMonths(start, 1) };
}

export function periodDays(p: Period): string[] {
  const n = diffDays(p.start, p.end);
  return Array.from({ length: n }, (_, i) => addDays(p.start, i));
}

export function periodLabel(p: Period): string {
  return p.kind === "month" ? formatMonthLabel(p.start) : `${formatShortDate(p.start)}〜${formatShortDate(addDays(p.end, -1))}`;
}

/** 書き出しのファイル名。週：calendar-week-開始日_最終日.md／月：calendar-month-YYYY-MM.md */
export function periodFileName(p: Period): string {
  return p.kind === "month" ? `calendar-month-${p.start.slice(0, 7)}.md` : `calendar-week-${p.start}_${addDays(p.end, -1)}.md`;
}

/** 期間にかかるか */
export function overlapsPeriod(start: string, end: string, p: Period): boolean {
  return start < `${p.end}T00:00` && end > `${p.start}T00:00`;
}

// ---------- カテゴリ ----------

export function colorKeyOf(e: { colorId: string | null }): string {
  return e.colorId ?? "default";
}

/** 色カテゴリの名前。空名は「他の色（色n）」 */
export function categoryName(key: string, settings: Settings): string {
  const label = (settings.colorLabels[key] ?? "").trim();
  if (label !== "") return label;
  return key === "default" ? "他の色（色指定なし）" : `他の色（色${key}）`;
}

export function parentOf(key: string, settings: Settings): ParentCategory {
  return settings.categoryParents[key] ?? "その他";
}

// ---------- 集計 ----------

/** 主行動として集計する対象：実績・種別不明の時間指定イベント（終日・キャンセル・予定は除く） */
export function isMainEvent(e: CalendarEvent): boolean {
  return (e.kind === "actual" || e.kind === "unknown") && !e.allDay && e.status !== "cancelled";
}

/** ローカル時刻文字列 → 通し分（タイムゾーン・夏時間の影響を受けない） */
function absMin(local: string): number {
  return (
    Date.UTC(Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 1, Number(local.slice(8, 10)), Number(local.slice(11, 13)), Number(local.slice(14, 16))) / 60000
  );
}

interface Span {
  s: number;
  t: number;
}
interface MainSpan extends Span {
  ev: CalendarEvent;
  key: string;
  people: boolean;
  title: string;
}
interface LabelSpan extends Span {
  label: string;
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.s - b.s || a.t - b.t);
  const out: Span[] = [];
  for (const sp of sorted) {
    const last = out[out.length - 1];
    if (last && sp.s <= last.t) last.t = Math.max(last.t, sp.t);
    else out.push({ s: sp.s, t: sp.t });
  }
  return out;
}

/**
 * ながら・場所を集計に使う時間（期間で切る前）。
 * 付いているイベントが集計対象（主行動）でなければ null。ただし終日の実績に付いたものは、ながら自身が時間を持つ場合だけ使う。
 */
export function reviewNagaraInterval(n: Nagara, events: Map<string, CalendarEvent>): { start: string; end: string } | null {
  if (n.eventId !== null) {
    const ev = events.get(n.eventId);
    if (!ev || ev.kind === "plan" || ev.status === "cancelled") return null;
    if (ev.allDay && (n.start === null || n.end === null)) return null;
  }
  return resolveNagara(n, events);
}

export interface DayStat {
  date: string;
  byColor: Record<string, number>;
  people: number;
  unrecorded: number;
}

export interface LabelMinutes {
  label: string;
  minutes: number;
}

export interface CrossRow {
  /** 主行動の色キー。主行動がない時間は "none" */
  row: string;
  label: string;
  minutes: number;
}

export interface SideBySide {
  label: string;
  /** 主行動として（タイトルが完全一致する実績）の時間 */
  asMain: number;
  /** ながらとして。主行動がラベルと一致する区間は除く */
  asNagara: number;
  /** ながらとしての合計（除く前） */
  nagaraTotal: number;
}

export interface ReviewStats {
  periodMinutes: number;
  unrecorded: number;
  byColor: Record<string, number>;
  /** 人がいる時間（主行動のうち people が空でないもの。等分後） */
  peopleMinutes: number;
  perDay: DayStat[];
  nagaraTotals: LabelMinutes[];
  placeTotals: LabelMinutes[];
  cross: CrossRow[];
  sideBySide: SideBySide[];
}

const SEP = "\u0000";

/**
 * 期間の集計。主行動同士の重なりは、同時に存在する件数で等分する（分単位のスイープ）。
 * 期間内に絞ってから計算し、日の境目（0時）でも区切って日ごとの値も出す。
 * detail=false のときは、ながら・場所の集計を省く（前期間の差だけが欲しいとき）。
 */
export function computeReview(events: CalendarEvent[], nagara: Nagara[], period: Period, detail = true): ReviewStats {
  const P0 = absMin(`${period.start}T00:00`);
  const P1 = absMin(`${period.end}T00:00`);
  const days = Math.round((P1 - P0) / 1440);
  const dayKeys = periodDays(period);
  const lo = `${period.start}T00:00`;
  const hi = `${period.end}T00:00`;

  const mains: MainSpan[] = [];
  for (const e of events) {
    if (!isMainEvent(e) || !(e.start < hi && e.end > lo)) continue;
    const s = Math.max(absMin(e.start), P0);
    const t = Math.min(absMin(e.end), P1);
    if (t <= s) continue;
    mains.push({ s, t, ev: e, key: colorKeyOf(e), people: e.people.length > 0, title: e.title.trim() });
  }

  // ながら・場所：ラベルごとに期間内の区間をまとめる（同じラベルの重なりは1つに）
  const nagaraSpans = new Map<string, Span[]>();
  const placeSpans = new Map<string, Span[]>();
  if (detail) {
    const evMap = eventMap(events);
    for (const n of nagara) {
      const label = n.label.trim();
      if (label === "") continue;
      const iv = reviewNagaraInterval(n, evMap);
      if (!iv || !(iv.start < hi && iv.end > lo)) continue;
      const s = Math.max(absMin(iv.start), P0);
      const t = Math.min(absMin(iv.end), P1);
      if (t <= s) continue;
      const target = n.type === "place" ? placeSpans : nagaraSpans;
      const list = target.get(label) ?? [];
      list.push({ s, t });
      target.set(label, list);
    }
  }
  const mergedNagara: LabelSpan[] = [];
  const nagaraTotals: LabelMinutes[] = [];
  for (const [label, spans] of nagaraSpans) {
    let total = 0;
    for (const sp of mergeSpans(spans)) {
      mergedNagara.push({ label, s: sp.s, t: sp.t });
      total += sp.t - sp.s;
    }
    nagaraTotals.push({ label, minutes: total });
  }
  const placeTotals: LabelMinutes[] = [];
  for (const [label, spans] of placeSpans) {
    placeTotals.push({ label, minutes: mergeSpans(spans).reduce((sum, sp) => sum + (sp.t - sp.s), 0) });
  }
  const byMinutesDesc = (a: LabelMinutes, b: LabelMinutes) => b.minutes - a.minutes || a.label.localeCompare(b.label);
  nagaraTotals.sort(byMinutesDesc);
  placeTotals.sort(byMinutesDesc);

  // スイープ（境目＝主行動・ながらの開始終了＋日の境目）
  const points = new Set<number>([P0, P1]);
  for (let d = 1; d < days; d++) points.add(P0 + d * 1440);
  for (const m of mains) {
    points.add(m.s);
    points.add(m.t);
  }
  for (const l of mergedNagara) {
    points.add(l.s);
    points.add(l.t);
  }
  const pts = [...points].sort((a, b) => a - b);
  mains.sort((a, b) => a.s - b.s);
  mergedNagara.sort((a, b) => a.s - b.s);

  const byColor: Record<string, number> = {};
  let unrecorded = 0;
  let peopleMinutes = 0;
  const perDay: DayStat[] = dayKeys.map((date) => ({ date, byColor: {}, people: 0, unrecorded: 0 }));
  const crossMap = new Map<string, number>();
  const mainByTitle = new Map<string, number>();
  const nagaraOnly = new Map<string, number>();
  const nagaraLabelSet = new Set(nagaraTotals.map((x) => x.label));

  let mi = 0;
  let li = 0;
  let activeM: MainSpan[] = [];
  let activeL: LabelSpan[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const len = pts[i + 1] - a;
    if (len <= 0) continue;
    while (mi < mains.length && mains[mi].s <= a) activeM.push(mains[mi++]);
    while (li < mergedNagara.length && mergedNagara[li].s <= a) activeL.push(mergedNagara[li++]);
    activeM = activeM.filter((m) => m.t > a);
    activeL = activeL.filter((l) => l.t > a);
    const day = perDay[Math.min(days - 1, Math.floor((a - P0) / 1440))];
    const k = activeM.length;
    if (k === 0) {
      unrecorded += len;
      day.unrecorded += len;
    } else {
      const share = len / k;
      for (const m of activeM) {
        byColor[m.key] = (byColor[m.key] ?? 0) + share;
        day.byColor[m.key] = (day.byColor[m.key] ?? 0) + share;
        if (m.people) {
          peopleMinutes += share;
          day.people += share;
        }
        if (detail && nagaraLabelSet.has(m.title)) mainByTitle.set(m.title, (mainByTitle.get(m.title) ?? 0) + share);
      }
    }
    if (!detail) continue;
    for (const l of activeL) {
      if (k === 0) {
        const ck = `none${SEP}${l.label}`;
        crossMap.set(ck, (crossMap.get(ck) ?? 0) + len);
      } else {
        const share = len / k;
        for (const m of activeM) {
          const ck = `${m.key}${SEP}${l.label}`;
          crossMap.set(ck, (crossMap.get(ck) ?? 0) + share);
        }
      }
      if (!activeM.some((m) => m.title === l.label)) nagaraOnly.set(l.label, (nagaraOnly.get(l.label) ?? 0) + len);
    }
  }

  const cross: CrossRow[] = [];
  for (const [k, minutes] of crossMap) {
    const [row, label] = k.split(SEP);
    cross.push({ row, label, minutes });
  }
  cross.sort((a, b) => b.minutes - a.minutes || a.row.localeCompare(b.row) || a.label.localeCompare(b.label));
  const sideBySide: SideBySide[] = nagaraTotals.map((n) => ({
    label: n.label,
    asMain: mainByTitle.get(n.label) ?? 0,
    asNagara: nagaraOnly.get(n.label) ?? 0,
    nagaraTotal: n.minutes,
  }));

  return { periodMinutes: P1 - P0, unrecorded, byColor, peopleMinutes, perDay, nagaraTotals, placeTotals, cross, sideBySide };
}

// ---------- 階層（親 → 色カテゴリ） ----------

export interface BreakdownChild {
  key: string;
  name: string;
  minutes: number;
  ratio: number;
}
export interface BreakdownParent {
  name: ParentCategory;
  minutes: number;
  ratio: number;
  children: BreakdownChild[];
}
export interface Breakdown {
  totalMinutes: number;
  parents: BreakdownParent[];
  unrecorded: { minutes: number; ratio: number };
}

const EPS = 1e-9;

export function buildBreakdown(stats: ReviewStats, settings: Settings): Breakdown {
  const total = stats.periodMinutes;
  const ratio = (m: number) => (total > 0 ? m / total : 0);
  const parents: BreakdownParent[] = PARENT_CATEGORIES.map((name) => ({ name, minutes: 0, ratio: 0, children: [] }));
  const byName = new Map(parents.map((p) => [p.name as string, p]));
  for (const [key, minutes] of Object.entries(stats.byColor)) {
    if (minutes <= EPS) continue;
    const p = byName.get(parentOf(key, settings)) ?? byName.get("その他")!;
    p.minutes += minutes;
    p.children.push({ key, name: categoryName(key, settings), minutes, ratio: ratio(minutes) });
  }
  for (const p of parents) {
    p.ratio = ratio(p.minutes);
    p.children.sort((a, b) => b.minutes - a.minutes || a.key.localeCompare(b.key));
  }
  return {
    totalMinutes: total,
    parents: parents.filter((p) => p.minutes > EPS),
    unrecorded: { minutes: stats.unrecorded, ratio: ratio(stats.unrecorded) },
  };
}

// ---------- 前期間との差 ----------

export interface DiffRow {
  name: string;
  now: number;
  prev: number;
  diff: number;
  /** 色カテゴリ行は 1（親の下）、親・未記録は 0 */
  depth: 0 | 1;
}

/** 今期・前期・差（評価の言葉は付けない）。親カテゴリの下に色カテゴリ、最後に未記録 */
export function buildDiffRows(cur: ReviewStats, prev: ReviewStats, settings: Settings): DiffRow[] {
  const keys = new Set([...Object.keys(cur.byColor), ...Object.keys(prev.byColor)]);
  const rows: DiffRow[] = [];
  for (const parent of PARENT_CATEGORIES) {
    const kids = [...keys]
      .filter((k) => parentOf(k, settings) === parent)
      .map((k) => ({ k, now: cur.byColor[k] ?? 0, prev: prev.byColor[k] ?? 0 }))
      .filter((x) => x.now > EPS || x.prev > EPS)
      .sort((a, b) => b.now - a.now || a.k.localeCompare(b.k));
    if (kids.length === 0) continue;
    const now = kids.reduce((s, x) => s + x.now, 0);
    const pv = kids.reduce((s, x) => s + x.prev, 0);
    rows.push({ name: parent, now, prev: pv, diff: now - pv, depth: 0 });
    for (const x of kids) rows.push({ name: categoryName(x.k, settings), now: x.now, prev: x.prev, diff: x.now - x.prev, depth: 1 });
  }
  rows.push({ name: "未記録", now: cur.unrecorded, prev: prev.unrecorded, diff: cur.unrecorded - prev.unrecorded, depth: 0 });
  return rows;
}

// ---------- 棒グラフ ----------

export type BarTarget = { type: "parent"; name: ParentCategory } | { type: "color"; key: string } | { type: "people" };

export const DEFAULT_BAR_TARGET: BarTarget = { type: "parent", name: "睡眠" };

export function barTargetId(t: BarTarget): string {
  return t.type === "parent" ? `parent:${t.name}` : t.type === "color" ? `color:${t.key}` : "people";
}

export function parseBarTarget(id: string): BarTarget {
  if (id === "people") return { type: "people" };
  if (id.startsWith("color:")) return { type: "color", key: id.slice(6) };
  const name = id.slice(7);
  return { type: "parent", name: (PARENT_CATEGORIES as string[]).includes(name) ? (name as ParentCategory) : "睡眠" };
}

/** 日ごとの分（主行動のみ。ながらは含めない） */
export function barSeries(stats: ReviewStats, target: BarTarget, settings: Settings): Array<{ date: string; minutes: number }> {
  return stats.perDay.map((d) => {
    let minutes = 0;
    if (target.type === "people") minutes = d.people;
    else if (target.type === "color") minutes = d.byColor[target.key] ?? 0;
    else for (const [key, m] of Object.entries(d.byColor)) if (parentOf(key, settings) === target.name) minutes += m;
    return { date: d.date, minutes };
  });
}

// ---------- 未確定・予定の変更 ----------

/** 期間にかかる未確定の予定（開始順） */
export function unconfirmedInPeriod(events: CalendarEvent[], period: Period, nowLocal: string): CalendarEvent[] {
  const linked = linkedPlanIds(events);
  return events
    .filter((e) => overlapsPeriod(e.start, e.end, period) && isUnconfirmed(e, linked, nowLocal))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

/** 期間にかかるキャンセルした予定（開始順） */
export function cancelledInPeriod(events: CalendarEvent[], period: Period): CalendarEvent[] {
  return events
    .filter((e) => e.kind === "plan" && e.status === "cancelled" && overlapsPeriod(e.start, e.end, period))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

export interface PlanChange {
  planId: string;
  title: string;
  changedAt: string;
  diffs: SnapshotDiff[];
}

/**
 * 予定の変更（変更前→後）。各履歴の「変更前」と、次の履歴（無ければ現在の予定）との差。
 * 変更前または変更後の予定が期間にかかるものだけ。変更日時の古い順。
 */
export function planChangesInPeriod(events: CalendarEvent[], revisions: PlanRevision[], period: Period): PlanChange[] {
  const evMap = eventMap(events);
  const byPlan = new Map<string, PlanRevision[]>();
  for (const r of revisions) {
    const list = byPlan.get(r.planId) ?? [];
    list.push(r);
    byPlan.set(r.planId, list);
  }
  const out: PlanChange[] = [];
  for (const [planId, list] of byPlan) {
    const ev = evMap.get(planId);
    if (!ev) continue;
    list.sort((a, b) => a.changedAt.localeCompare(b.changedAt));
    for (let i = 0; i < list.length; i++) {
      const before = list[i].snapshot;
      const after = i + 1 < list.length ? list[i + 1].snapshot : snapshotOf(ev);
      if (!overlapsPeriod(before.start, before.end, period) && !overlapsPeriod(after.start, after.end, period)) continue;
      const diffs = diffSnapshots(before, after);
      if (diffs.length > 0) out.push({ planId, title: after.title, changedAt: list[i].changedAt, diffs });
    }
  }
  return out.sort((a, b) => a.changedAt.localeCompare(b.changedAt));
}

/** ISO（UTC）の変更日時 → ローカル表示用 YYYY-MM-DDTHH:mm */
export function localFromIso(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 16) : toLocal(d);
}

// ---------- 書式 ----------

/** 例：42時間15分／168時間／15分／0分 */
export function formatDuration(minutes: number): string {
  const m = Math.round(Math.abs(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}分`;
  return r === 0 ? `${h}時間` : `${h}時間${r}分`;
}

export function formatPercent(minutes: number, total: number): string {
  return total > 0 ? `${((minutes / total) * 100).toFixed(1)}%` : "0.0%";
}

/** 例：42時間15分 / 168時間（25.1%） */
export function formatShare(minutes: number, total: number): string {
  return `${formatDuration(minutes)} / ${formatDuration(total)}（${formatPercent(minutes, total)}）`;
}

/** 差：+1時間5分／−30分／±0分 */
export function formatSigned(diff: number): string {
  const m = Math.round(diff);
  if (m === 0) return "±0分";
  return `${m > 0 ? "+" : "−"}${formatDuration(m)}`;
}
