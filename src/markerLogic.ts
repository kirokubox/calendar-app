// マーカー（時刻だけの記録）の純粋ロジック：検証・並べ替え・経過時間・候補。
import { addDays, datePart, diffMinutes, isLocalDateTime, joinLocal, timeToMinutes, timePart } from "./dateUtils.js";
import type { Marker } from "./types.js";

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
    if (label === "" || out.includes(label)) continue;
    out.push(label);
    added++;
  }
  return out;
}

/** 表示用：当日なら時刻だけ、前日なら「前日 HH:mm」、それ以外は「M/D HH:mm」 */
export function markerTimeLabel(at: string, dayKey: string): string {
  const d = datePart(at);
  if (d === dayKey) return timePart(at);
  if (d === addDays(dayKey, -1)) return `前日 ${timePart(at)}`;
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${timePart(at)}`;
}
