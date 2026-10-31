// 検索画面の「前回」の一覧：設定で登録した項目ごとに、前回からの日数を出して久しぶりな順に並べる。
import { parseDateKey } from "./dateUtils.js";
import { searchAll, summarizeHits } from "./searchLogic.js";
import type { CalendarEvent, LastItem, Marker, Nagara, Settings } from "./types.js";

export interface LastRow {
  item: LastItem;
  /** 前回（予定を除き、現在以前に始まった記録のうち新しいもの）。一度も無ければ null */
  last: { start: string; daysAgo: number } | null;
  /** 目安の日数を超えているか */
  over: boolean;
}

/** 目安の日数を超えたか。ちょうど目安の日数の日はまだ超えていない */
export function isOverTarget(daysAgo: number, targetDays: number | null): boolean {
  return targetDays !== null && daysAgo > targetDays;
}

/**
 * 久しぶりな順（前回からの日数が多いものが上）。同じ日数は登録した順。
 * 記録が一度も無い項目は一番下に、登録した順でまとめる。
 */
export function sortLastRows(rows: LastRow[]): LastRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row.last === null || b.row.last === null) {
        if (a.row.last === b.row.last) return a.index - b.index;
        return a.row.last === null ? 1 : -1;
      }
      return b.row.last.daysAgo - a.row.last.daysAgo || a.index - b.index;
    })
    .map((x) => x.row);
}

/** 登録した項目ごとに、語＝項目名・すべての項目・実績だけで検索して前回を出し、久しぶりな順に並べる */
export function buildLastRows(items: LastItem[], events: CalendarEvent[], nagara: Nagara[], markers: Marker[], settings: Settings, nowLocal: string): LastRow[] {
  const rows = items.map((item) => {
    const hits = searchAll(events, nagara, markers, settings, { text: item.name, field: "all", from: "", to: "", kind: "actual" });
    const last = summarizeHits(hits, nowLocal).last;
    return { item, last, over: last !== null && isOverTarget(last.daysAgo, item.targetDays) };
  });
  return sortLastRows(rows);
}

/** 例：10/26（今年以外は 2025/10/26） */
export function lastDateLabel(dateKey: string, nowLocal: string): string {
  const d = parseDateKey(dateKey);
  const sameYear = dateKey.slice(0, 4) === nowLocal.slice(0, 4);
  return `${sameYear ? "" : `${d.getFullYear()}/`}${d.getMonth() + 1}/${d.getDate()}`;
}
