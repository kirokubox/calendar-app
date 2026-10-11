// 検索の純粋ロジック：イベント・セッション・マーカーを横断して絞り込み、前回日と回数を出す。
import { datePart, diffDays, diffMinutes } from "./dateUtils.js";
import { categoryName, colorKeyOf, parentOf } from "./reviewLogic.js";
import type { CalendarEvent, Marker, Nagara, Settings } from "./types.js";

export type SearchField = "all" | "title" | "people" | "places" | "nagara" | "category" | "memo";

export const SEARCH_FIELD_LABEL: Record<SearchField, string> = {
  all: "すべて", title: "タイトル", people: "人", places: "場所・移動", nagara: "ながら", category: "カテゴリ", memo: "メモ",
};

export type SearchKindFilter = "all" | "actual" | "plan";

export interface SearchQuery {
  text: string;
  field: SearchField;
  /** 開始日・終了日（どちらも含む）。空文字は指定なし */
  from: string;
  to: string;
  kind: SearchKindFilter;
}

export type SearchHit =
  | { type: "event"; id: string; start: string; end: string; event: CalendarEvent; nagaraLabels: string[] }
  | { type: "session"; id: string; start: string; end: string | null; session: Nagara }
  | { type: "marker"; id: string; start: string; end: null; marker: Marker };

/** 全角・半角、大文字・小文字、ひらがな・カタカナの違いを吸収して比べる */
export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 空白で区切った語をすべて含むか（AND） */
function matches(haystacks: string[], words: string[]): boolean {
  const joined = normalizeText(haystacks.join("\n"));
  return words.every((w) => joined.includes(w));
}

function inRange(start: string, end: string | null, q: SearchQuery): boolean {
  const lastDay = datePart(end ?? start);
  if (q.from !== "" && lastDay < q.from) return false;
  if (q.to !== "" && datePart(start) > q.to) return false;
  return true;
}

/**
 * 検索。語が空で日付の指定も無いときは、何も返さない（全件を並べない）。
 * 結果は新しい順。ながらはイベントに付けたものも対象にする。
 */
export function searchAll(events: CalendarEvent[], nagara: Nagara[], markers: Marker[], settings: Settings, q: SearchQuery): SearchHit[] {
  const words = normalizeText(q.text).split(/\s+/).filter((w) => w !== "");
  if (words.length === 0 && q.from === "" && q.to === "") return [];
  const labelsByEvent = new Map<string, string[]>();
  for (const n of nagara) {
    if (n.eventId === null || n.type !== "nagara") continue;
    const list = labelsByEvent.get(n.eventId) ?? [];
    if (!list.includes(n.label)) list.push(n.label);
    labelsByEvent.set(n.eventId, list);
  }
  const want = (f: SearchField) => q.field === "all" || q.field === f;
  const hits: SearchHit[] = [];
  for (const e of events) {
    if (q.kind === "actual" && e.kind === "plan") continue;
    if (q.kind === "plan" && e.kind !== "plan") continue;
    if (!inRange(e.start, e.end, q)) continue;
    const nagaraLabels = labelsByEvent.get(e.id) ?? [];
    const key = colorKeyOf(e);
    const hay: string[] = [];
    if (want("title")) hay.push(e.title);
    if (want("people")) hay.push(...e.people);
    if (want("places")) hay.push(...e.places);
    if (want("nagara")) hay.push(...nagaraLabels);
    if (want("category")) hay.push(categoryName(key, settings), parentOf(key, settings), e.subcategory ?? "");
    if (want("memo")) hay.push(e.memo, e.cancelReason);
    if (!matches(hay, words)) continue;
    hits.push({ type: "event", id: e.id, start: e.start, end: e.end, event: e, nagaraLabels });
  }
  // セッション・マーカーは実績側の記録。予定だけに絞ったときは出さない
  if (q.kind !== "plan") {
    if (want("nagara") || want("places") || want("title")) {
      for (const n of nagara) {
        if (n.eventId !== null || n.start === null) continue;
        if (q.field === "nagara" && n.type !== "nagara") continue;
        if (q.field === "places" && n.type !== "place") continue;
        if (!inRange(n.start, n.end, q) || !matches([n.label], words)) continue;
        hits.push({ type: "session", id: n.id, start: n.start, end: n.end, session: n });
      }
    }
    if (want("title")) {
      for (const m of markers) {
        if (!inRange(m.at, null, q) || !matches([m.label], words)) continue;
        hits.push({ type: "marker", id: m.id, start: m.at, end: null, marker: m });
      }
    }
  }
  return hits.sort((a, b) => b.start.localeCompare(a.start) || a.id.localeCompare(b.id));
}

export interface SearchSummary {
  count: number;
  /** 実績・不明のイベントと、終わったセッションの合計時間（分）。予定・マーカー・終日は含めない */
  totalMinutes: number;
  /** 現在以前に始まった実績側の記録のうち、いちばん新しいもの */
  last: { start: string; daysAgo: number } | null;
  /** いちばん古い記録の開始 */
  first: string | null;
}

/** 「前回いつ」「何回」。前回は予定を除き、現在以前に始まった記録から選ぶ */
export function summarizeHits(hits: SearchHit[], nowLocal: string): SearchSummary {
  let totalMinutes = 0;
  let last: string | null = null;
  let first: string | null = null;
  for (const h of hits) {
    if (first === null || h.start < first) first = h.start;
    const isPlan = h.type === "event" && h.event.kind === "plan";
    if (!isPlan && h.start <= nowLocal && (last === null || h.start > last)) last = h.start;
    if (h.type === "event" && h.event.kind !== "plan" && !h.event.allDay && h.event.status !== "cancelled") totalMinutes += diffMinutes(h.start, h.end);
    if (h.type === "session" && h.end !== null) totalMinutes += diffMinutes(h.start, h.end);
  }
  return {
    count: hits.length,
    totalMinutes,
    last: last === null ? null : { start: last, daysAgo: diffDays(datePart(last), datePart(nowLocal)) },
    first,
  };
}

/** 例：今日／昨日／3日前 */
export function daysAgoLabel(daysAgo: number): string {
  if (daysAgo <= 0) return "今日";
  if (daysAgo === 1) return "昨日";
  return `${daysAgo}日前`;
}
