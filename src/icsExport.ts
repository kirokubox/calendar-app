// ほかのカレンダー用の書き出し（.ics。v0.10.0）。純粋ロジック。
// Googleカレンダー・iPhoneのカレンダーなどへ読み込めるので、アプリをやめても記録が残る「逃げ道」になる。
import { addDays } from "./dateUtils.js";
import type { CalendarEvent } from "./types.js";

export interface IcsOptions {
  /** 期間（YYYY-MM-DD。どちらも含む）。null は制限なし */
  from: string | null;
  to: string | null;
  /** 書き出した時刻（DTSTAMP。UTCのISO文字列） */
  exportedAt: string;
}

/** 対象：予定と実績・種別不明（キャンセルは除く）。期間にかかるもの */
export function icsTargets(events: CalendarEvent[], from: string | null, to: string | null): CalendarEvent[] {
  return events
    .filter((e) => e.status !== "cancelled")
    .filter((e) => (from === null || e.end.slice(0, 10) >= from) && (to === null || e.start.slice(0, 10) <= to))
    .sort((a, b) => a.start.localeCompare(b.start));
}

// RFC 5545 の文字のエスケープ（\ ; , と改行）
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// 1行は75オクテットまで。超える分は「改行＋空白」で折り返す（日本語は1文字3バイト）
function fold(line: string): string {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  if (bytes(line) <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes(current + ch) > limit) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// ローカル時刻 YYYY-MM-DDTHH:mm → 20261118T130000（時差を付けない＝読み込んだ端末の時刻として扱われる）
function localStamp(local: string): string {
  return `${local.slice(0, 4)}${local.slice(5, 7)}${local.slice(8, 10)}T${local.slice(11, 13)}${local.slice(14, 16)}00`;
}

function utcStamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z?$/, "Z");
}

function dateStamp(dateKey: string): string {
  return dateKey.replace(/-/g, "");
}

/** 説明欄：種別・人・メモをまとめる（ほかのカレンダーには「予定と実績」の区別がないため、文字で残す） */
export function icsDescription(e: CalendarEvent): string {
  const kind = e.kind === "plan" ? "予定" : e.kind === "actual" ? "実績" : "種別不明";
  const lines = [`キロクカレンダー：${kind}`];
  if (e.people.length > 0) lines.push(`人：${e.people.join("、")}`);
  if (e.memo.trim() !== "") lines.push(e.memo.trim());
  return lines.join("\n");
}

export function buildIcs(events: CalendarEvent[], options: IcsOptions): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//kirokubox//calendar-app//JA", "CALSCALE:GREGORIAN", "X-WR-CALNAME:キロクカレンダー"];
  for (const e of icsTargets(events, options.from, options.to)) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@calendar-app.kirokubox`);
    lines.push(`DTSTAMP:${utcStamp(options.exportedAt)}`);
    if (e.allDay) {
      // 終日の終わりは「次の日」（その日を含まない）で書く決まり
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(e.start.slice(0, 10))}`);
      lines.push(`DTEND;VALUE=DATE:${dateStamp(addDays(e.end.slice(0, 10), 1))}`);
    } else {
      lines.push(`DTSTART:${localStamp(e.start)}`);
      lines.push(`DTEND:${localStamp(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title || "（タイトルなし）")}`);
    if (e.places.length > 0) lines.push(`LOCATION:${escapeText(e.places.join(" → "))}`);
    lines.push(`DESCRIPTION:${escapeText(icsDescription(e))}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function icsFileName(dateKey: string): string {
  return `kiroku-calendar-${dateKey}.ics`;
}
