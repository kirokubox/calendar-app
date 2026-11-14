// 人ごとの集計の純粋ロジック：振り返り画面の「人」の節で使う。
import { datePart } from "./dateUtils.js";
import { isMainEvent, type Period } from "./reviewLogic.js";
import type { CalendarEvent } from "./types.js";

export interface PersonRow {
  name: string;
  /** 期間内に、その人がいた時間（同じ人の記録が重なった分は1回だけ数える） */
  minutes: number;
  /** 期間内に、その人がいた日数（0時をまたぐ記録は両方の日に数える） */
  days: number;
  /** 期間内の記録の件数 */
  count: number;
  /** 最後に会った日（期間に関係なく、現在時刻までに始まった記録から）。無ければ null */
  lastDate: string | null;
}

/** ローカル時刻文字列 → 通し分（タイムゾーン・夏時間の影響を受けない） */
function absMin(local: string): number {
  return (
    Date.UTC(Number(local.slice(0, 4)), Number(local.slice(5, 7)) - 1, Number(local.slice(8, 10)), Number(local.slice(11, 13)), Number(local.slice(14, 16))) / 60000
  );
}

function unionMinutes(spans: Array<[number, number]>): number {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [s, t] of sorted) {
    if (t <= end) continue;
    total += t - Math.max(s, end);
    end = t;
  }
  return total;
}

function namesOf(e: CalendarEvent): string[] {
  return [...new Set(e.people.map((p) => p.trim()).filter((p) => p !== ""))];
}

/**
 * 期間内の実績（主行動として数える記録）を、人ごとにまとめる。
 * 2人以上いる記録は、それぞれの人に同じ時間を入れる（等分しない）。
 * cutoff は集計の終わり（現在の期間は現在時刻）。nowLocal は「最後に会った日」を決める現在時刻。
 * 並びは時間の長い順、同じなら名前順。
 */
export function peopleInPeriod(events: CalendarEvent[], period: Period, cutoff: string, nowLocal: string): PersonRow[] {
  const P0 = absMin(`${period.start}T00:00`);
  const P1 = Math.max(P0, Math.min(absMin(`${period.end}T00:00`), absMin(cutoff)));
  const spans = new Map<string, Array<[number, number]>>();
  const dayIndexes = new Map<string, Set<number>>();
  const counts = new Map<string, number>();
  const last = new Map<string, string>();

  for (const e of events) {
    if (!isMainEvent(e)) continue;
    const names = namesOf(e);
    if (names.length === 0) continue;
    if (e.start <= nowLocal) {
      const day = datePart(e.start);
      for (const n of names) if ((last.get(n) ?? "") < day) last.set(n, day);
    }
    const s = Math.max(absMin(e.start), P0);
    const t = Math.min(absMin(e.end), P1);
    if (t <= s) continue;
    const first = Math.floor((s - P0) / 1440);
    const final = Math.floor((t - 1 - P0) / 1440);
    for (const n of names) {
      spans.set(n, [...(spans.get(n) ?? []), [s, t]]);
      counts.set(n, (counts.get(n) ?? 0) + 1);
      const set = dayIndexes.get(n) ?? new Set<number>();
      for (let d = first; d <= final; d++) set.add(d);
      dayIndexes.set(n, set);
    }
  }

  return [...spans.entries()]
    .map(([name, list]) => ({
      name,
      minutes: unionMinutes(list),
      days: dayIndexes.get(name)?.size ?? 0,
      count: counts.get(name) ?? 0,
      lastDate: last.get(name) ?? null,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "ja"));
}
