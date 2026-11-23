// マーカー（時刻だけの記録）の純粋ロジック：検証・並べ替え・経過時間・候補。
import { addDays, datePart, diffMinutes, isLocalDateTime, joinLocal, timeToMinutes, timePart } from "./dateUtils.js";
import { isHoliday } from "./holidays.js";
import type { Marker } from "./types.js";

/** 名前を変えたマーカーの、古い名前 → 今の名前（保存されている名前は書き換えず、数えるときだけ同じものとして扱う） */
export const MARKER_ALIASES: Readonly<Record<string, string>> = { 家を出た: "外出" };

/** 古い名前を今の名前へそろえる（前後の空白は除く） */
export function canonicalMarkerLabel(label: string): string {
  const trimmed = label.trim();
  return MARKER_ALIASES[trimmed] ?? trimmed;
}

export const COMMUTE_MARKERS = ["外出", "会社着", "会社発", "帰宅"] as const;

export const TRAVEL_PAIRS = [
  { key: "toWork", name: "行きの通勤", start: "外出", end: "会社着" },
  { key: "fromWork", name: "帰りの通勤", start: "会社発", end: "帰宅" },
  { key: "outward", name: "外出の行き", start: "外出", end: "目的地着" },
  { key: "return", name: "外出の帰り", start: "目的地発", end: "帰宅" },
] as const;

export interface TravelPair { key: typeof TRAVEL_PAIRS[number]["key"]; name: string; start: Marker; end: Marker; minutes: number }

/** 始まりを直近のものに更新し、対応する最初の終わりだけを組にする。 */
export function pairTravelMarkers(markers: Marker[]): TravelPair[] {
  const pending = new Map<TravelPair["key"], Marker>();
  const result: TravelPair[] = [];
  for (const marker of sortMarkers(markers)) {
    const label = canonicalMarkerLabel(marker.label);
    if (TRAVEL_PAIRS.some((pair) => pair.start === label)) pending.clear();
    for (const pair of TRAVEL_PAIRS) {
      if (label === pair.start) pending.set(pair.key, marker);
      else if (label === pair.end) {
        const start = pending.get(pair.key);
        pending.delete(pair.key);
        if (!start) continue;
        const minutes = diffMinutes(start.at, marker.at);
        const sameDay = datePart(start.at) === datePart(marker.at);
        const nextMorning = datePart(marker.at) === addDays(datePart(start.at), 1) && marker.at.slice(11) < "05:00";
        if (minutes >= 0 && minutes <= 360 && (sameDay || nextMorning)) {
          result.push({ key: pair.key, name: pair.name, start, end: marker, minutes });
          for (const [key, other] of pending) if (other.id === start.id) pending.delete(key);
        }
      }
    }
  }
  return result;
}

/** 「ふだん」を決めるのに使う日数（期間の終わりから遡る） */
export const TRAVEL_USUAL_DAYS = 90;
/** 「ふだん」を決めるのに必要な回数。これより少なければ寄り道を分けない */
export const TRAVEL_USUAL_MIN_COUNT = 5;
/** ふだん（中央値）のこの倍を超えたら「寄り道あり」 */
export const TRAVEL_DETOUR_RATIO = 1.5;

export interface TravelRow extends TravelPair { detour: boolean }

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stats(rows: TravelPair[]) {
  const total = rows.reduce((sum, p) => sum + p.minutes, 0);
  return {
    count: rows.length,
    total,
    average: rows.length ? total / rows.length : 0,
    shortest: rows.length ? Math.min(...rows.map((p) => p.minutes)) : 0,
    longest: rows.length ? Math.max(...rows.map((p) => p.minutes)) : 0,
  };
}

/**
 * 組ごとの集計。ふだん＝期間の終わりまでの直近90日の回の中央値。その1.5倍を超えた回は「寄り道あり」として分ける。
 * 直近90日の回が5回未満なら分けない（usual は null）。count〜longest はふだんの回だけ、detour* は寄り道ありの回。
 */
export function travelPairSummaries(markers: Marker[], from: string, to: string) {
  const all = pairTravelMarkers(markers);
  const usualFrom = `${addDays(to, -TRAVEL_USUAL_DAYS)}T00:00`;
  return TRAVEL_PAIRS.map((def) => {
    const ofPair = all.filter((p) => p.key === def.key);
    const recent = ofPair.filter((p) => p.start.at >= usualFrom && p.start.at < `${to}T00:00`).map((p) => p.minutes);
    const usual = recent.length >= TRAVEL_USUAL_MIN_COUNT ? median(recent) : null;
    const rows: TravelRow[] = ofPair
      .filter((p) => p.start.at >= `${from}T00:00` && p.start.at < `${to}T00:00`)
      .map((p) => ({ ...p, detour: usual !== null && p.minutes > usual * TRAVEL_DETOUR_RATIO }));
    const normal = stats(rows.filter((r) => !r.detour));
    const detour = stats(rows.filter((r) => r.detour));
    return { ...def, rows, usual, ...normal, detourCount: detour.count, detourAverage: detour.average };
  });
}

/** 直前のマーカーからの経過時間を出す上限（これより離れていたら、つながりとして扱わない） */
export const MARKER_GAP_LIMIT_MINUTES = 24 * 60;

export function validateMarker(label: string, at: string): string | null {
  if (label.trim() === "") return "ラベルを入力してください";
  if (!isLocalDateTime(at)) return "時刻を入力してください";
  return null;
}

/** 時刻順（同じ時刻は作成順） */
export function sortMarkers(markers: Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.at.localeCompare(b.at) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export interface MarkerWithGap {
  marker: Marker;
  /** 直前のマーカー（24時間以内）。無ければ null */
  prev: Marker | null;
  /** 直前のマーカーからの分。prev が null なら null */
  gapMinutes: number | null;
}

/**
 * 時刻順に並べ、直前のマーカーからの経過時間を付ける。
 * どの組み合わせが「移動」かは決めない。隣り合う2点の間だけを出すので、目的地がいくつあっても破綻しない。
 */
export function markersWithGaps(markers: Marker[]): MarkerWithGap[] {
  const sorted = sortMarkers(markers);
  return sorted.map((marker, i) => {
    const before = i > 0 ? sorted[i - 1] : null;
    const gap = before ? diffMinutes(before.at, marker.at) : null;
    if (before === null || gap === null || gap > MARKER_GAP_LIMIT_MINUTES) return { marker, prev: null, gapMinutes: null };
    return { marker, prev: before, gapMinutes: gap };
  });
}

/** その日のマーカー（時刻順）と、0:00からの分 */
export function markersForDay(markers: Marker[], dayKey: string): Array<{ marker: Marker; minute: number }> {
  return sortMarkers(markers.filter((m) => datePart(m.at) === dayKey)).map((marker) => ({ marker, minute: timeToMinutes(timePart(marker.at)) }));
}

/** 期間（start〜end の日付キー。end は排他的）にかかるマーカー */
export function markersInRange(markers: Marker[], startKey: string, endKey: string): Marker[] {
  const from = joinLocal(startKey, "00:00");
  const to = joinLocal(endKey, "00:00");
  return sortMarkers(markers.filter((m) => m.at >= from && m.at < to));
}

/** ラベル候補：固定候補を先に、続けて履歴の新しい順（重複なし） */
export function markerCandidates(fixed: string[], markers: Marker[], historyCount = 6): string[] {
  const out = [...fixed];
  const sorted = [...markers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let added = 0;
  for (const m of sorted) {
    if (added >= historyCount) break;
    const label = m.label.trim();
    // 名前を変えた古い名前（家を出た）は、今の名前と二重にならないよう候補に出さない
    if (label === "" || out.includes(label) || out.includes(canonicalMarkerLabel(label))) continue;
    out.push(label);
    added++;
  }
  return out;
}

/** 今日の通勤マーカーから、次に記録する候補を1つ返す。休日・帰宅後は候補なし。 */
export function nextCommuteMarker(markers: Marker[], todayKey: string): string | null {
  const todayCommute = sortMarkers(markers.filter((m) => datePart(m.at) === todayKey && (COMMUTE_MARKERS as readonly string[]).includes(canonicalMarkerLabel(m.label))));
  if (todayCommute.length === 0) {
    const day = new Date(`${todayKey}T00:00:00`).getDay();
    return day === 0 || day === 6 || isHoliday(todayKey) ? null : COMMUTE_MARKERS[0];
  }
  const last = todayCommute[todayCommute.length - 1];
  const index = COMMUTE_MARKERS.indexOf(canonicalMarkerLabel(last.label) as typeof COMMUTE_MARKERS[number]);
  return index >= 0 && index < COMMUTE_MARKERS.length - 1 ? COMMUTE_MARKERS[index + 1] : null;
}

/** 表示用：当日なら時刻だけ、前日なら「前日 HH:mm」、それ以外は「M/D HH:mm」 */
export function markerTimeLabel(at: string, dayKey: string): string {
  const d = datePart(at);
  if (d === dayKey) return timePart(at);
  if (d === addDays(dayKey, -1)) return `前日 ${timePart(at)}`;
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${timePart(at)}`;
}
