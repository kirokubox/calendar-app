// ながら・場所の純粋ロジック（解決・セッションの切り出し・候補・保存内容の組み立て）。
import { clipRangeToDay, layoutColumns, type DayRange, type Placed } from "./layout.js";
import type { CalendarEvent, Nagara, NagaraType } from "./types.js";

export interface Interval {
  start: string;
  end: string;
}

export function eventMap(events: CalendarEvent[]): Map<string, CalendarEvent> {
  return new Map(events.map((e) => [e.id, e]));
}

/** セッション＝イベントに属さず、自分の時間を持つもの */
export function isSession(n: Nagara): boolean {
  return n.eventId === null && n.start !== null && n.end !== null;
}

/**
 * ながら・場所の実際の時間を決める。
 * 自分の時間があればそれ、eventIdだけならイベントの時間を継承（イベントの時刻変更に追従）。決められなければ null。
 */
export function resolveNagara(n: Nagara, events: Map<string, CalendarEvent>): Interval | null {
  if (n.start !== null && n.end !== null) return { start: n.start, end: n.end };
  if (n.eventId !== null) {
    const e = events.get(n.eventId);
    if (e) return { start: e.start, end: e.end };
  }
  return null;
}

export interface SessionSegment extends DayRange {
  nagara: Nagara;
}

/** その日にかかるセッションの切り出し（日表示のレーン用）。開始順 */
export function sessionSegmentsForDay(nagara: Nagara[], dayKey: string): SessionSegment[] {
  const result: SessionSegment[] = [];
  for (const n of nagara) {
    if (!isSession(n)) continue;
    const r = clipRangeToDay(n.start as string, n.end as string, dayKey);
    if (r) result.push({ nagara: n, ...r });
  }
  return result.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
}

/** レーン内で重なったセッションを横に並べる */
export function layoutSessions(segments: SessionSegment[]): Array<Placed<SessionSegment>> {
  return layoutColumns(segments);
}

export function nagaraOfEvent(nagara: Nagara[], eventId: string): Nagara[] {
  return nagara.filter((n) => n.eventId === eventId);
}

/** イベントのブロックに出す「＋ラベル」用。ながら（placeは除く）のラベルを重複なしで */
export function nagaraLabelsOfEvent(nagara: Nagara[], eventId: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const n of nagaraOfEvent(nagara, eventId)) {
    const label = n.label.trim();
    if (n.type !== "nagara" || label === "" || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  return result;
}

/** ラベル候補：重複除去・新しい順。type を渡すとその種類だけ */
export function nagaraLabelSuggestions(nagara: Nagara[], type?: NagaraType, limit = 100): string[] {
  const sorted = nagara
    .filter((n) => type === undefined || n.type === type)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const n of sorted) {
    const label = n.label.trim();
    if (label === "" || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
    if (result.length >= limit) break;
  }
  return result;
}

/** 入力シート上のながらの下書き。id が null なら新規 */
export interface NagaraDraft {
  key: string;
  id: string | null;
  label: string;
  /** 両方 null＝イベント全体 */
  start: string | null;
  end: string | null;
}

/** 下書きの検証。保存できないときは理由、できるときは null */
export function validateNagaraDrafts(drafts: NagaraDraft[]): string | null {
  for (const d of drafts) {
    if ((d.start === null) !== (d.end === null)) return `「${d.label}」の時間は開始と終了の両方を指定してください`;
    if (d.start !== null && d.end !== null && d.end <= d.start) return `「${d.label}」の終了は開始より後にしてください`;
  }
  return null;
}

/**
 * イベント保存時のながらの書き込み内容を作る。
 * 下書きに無い既存のながらは削除、ラベルが空のものは捨てる。同じ（ラベル・時間）の重複は1つにまとめる。
 */
export function buildNagaraSave(
  eventId: string,
  drafts: NagaraDraft[],
  existing: Nagara[],
  stamp: string,
  makeId: () => string,
): { put: Nagara[]; deleteIds: string[] } {
  const mine = existing.filter((n) => n.eventId === eventId && n.type === "nagara");
  const byId = new Map(mine.map((n) => [n.id, n]));
  const keepIds = new Set<string>();
  const put: Nagara[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const label = d.label.trim();
    if (label === "") continue;
    const dup = `${label}|${d.start ?? ""}|${d.end ?? ""}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    const old = d.id !== null ? byId.get(d.id) : undefined;
    if (old) keepIds.add(old.id);
    const next: Nagara = {
      id: old?.id ?? makeId(),
      label,
      type: "nagara",
      eventId,
      start: d.start,
      end: d.end,
      createdAt: old?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    // 変更がなければ書き込まない（更新日時を動かさない）
    if (old && old.label === next.label && old.start === next.start && old.end === next.end) continue;
    put.push(next);
  }
  return { put, deleteIds: mine.filter((n) => !keepIds.has(n.id)).map((n) => n.id) };
}

/** 既存のながらを下書きにする（編集シートの初期値） */
export function draftsFromNagara(nagara: Nagara[], eventId: string): NagaraDraft[] {
  return nagaraOfEvent(nagara, eventId)
    .filter((n) => n.type === "nagara")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((n) => ({ key: n.id, id: n.id, label: n.label, start: n.start, end: n.end }));
}

/** イベント削除時に一緒に削除するながらのid */
export function nagaraIdsOfEvent(nagara: Nagara[], eventId: string): string[] {
  return nagaraOfEvent(nagara, eventId).map((n) => n.id);
}

/** イベントid → 「＋ラベル」用のラベル一覧（表示用にまとめて引く） */
export function nagaraLabelMap(nagara: Nagara[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const n of nagara) {
    if (n.eventId === null || n.type !== "nagara") continue;
    const label = n.label.trim();
    if (label === "") continue;
    const list = map.get(n.eventId) ?? [];
    if (!list.includes(label)) list.push(label);
    map.set(n.eventId, list);
  }
  return map;
}
