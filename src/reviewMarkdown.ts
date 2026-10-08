// AI用Markdown（週・月）の生成。純粋ロジック。
import { addDays, datePart, formatShortDate, minutesToTime } from "./dateUtils.js";
import { clipRangeToDay } from "./layout.js";
import {
  buildBreakdown, buildDiffRows, cancelledInPeriod, categoryName, colorKeyOf, computeReview, formatDuration, formatPercent, formatSigned, localFromIso,
  overlapsPeriod, parentOf, periodDays, periodLabel, planChangesInPeriod, shiftPeriod, unconfirmedInPeriod, type Period,
} from "./reviewLogic.js";
import { displayTitle } from "./eventLogic.js";
import type { CalendarEvent, Nagara, PlanRevision, Settings } from "./types.js";

/** 表のセル用：`|` をエスケープし、改行は <br> にする */
export function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>");
}

function row(cells: string[]): string {
  return `| ${cells.map(mdCell).join(" | ")} |`;
}

function table(header: string[], rows: string[][]): string[] {
  return [row(header), `| ${header.map(() => "---").join(" | ")} |`, ...rows.map(row)];
}

const KIND_LABEL = { plan: "予定", actual: "実績", unknown: "不明" } as const;

function kindLabel(e: CalendarEvent): string {
  if (e.kind === "plan" && e.status === "cancelled") return "予定（キャンセル）";
  if (e.allDay) return `${KIND_LABEL[e.kind]}・終日`;
  return KIND_LABEL[e.kind];
}

function rangeCell(r: { startMin: number; endMin: number; continuesFromPrev: boolean; continuesToNext: boolean }): string {
  return `${r.continuesFromPrev ? "←" : ""}${minutesToTime(r.startMin)}–${minutesToTime(r.endMin)}${r.continuesToNext ? "→" : ""}`;
}

export interface MarkdownInput {
  events: CalendarEvent[];
  nagara: Nagara[];
  revisions: PlanRevision[];
  settings: Settings;
  period: Period;
  /** 書き出し時点のローカル時刻（YYYY-MM-DDTHH:mm）。未確定の判定にも使う */
  nowLocal: string;
}

/** 週・月のAI用Markdown。構成：冒頭／時間構成／ながら・重なり／未確定・キャンセル・変更／日ごとの明細 */
export function buildReviewMarkdown(input: MarkdownInput): string {
  const { events, nagara, revisions, settings, period, nowLocal } = input;
  const prevPeriod = shiftPeriod(period, -1);
  const cur = computeReview(events, nagara, period, true);
  const prev = computeReview(events, nagara, prevPeriod, false);
  const total = cur.periodMinutes;
  const lastDay = addDays(period.end, -1);
  const out: string[] = [];

  // 1. 冒頭
  out.push(`# カレンダー ${period.kind === "week" ? "週" : "月"}次レポート：${periodLabel(period)}`, "");
  out.push(`- 期間：${period.start} 〜 ${lastDay}（${formatDuration(total)}）`);
  out.push(`- 書き出し日時：${nowLocal.replace("T", " ")}`);
  out.push("- 集計ルール：");
  out.push("  - 対象は種別が「実績」または「不明」の時間指定イベント。予定・キャンセル・終日は含めない");
  out.push("  - Googleカレンダーから取り込んだイベントは種別「不明」だが、実績と同じく集計に含める");
  out.push("  - 期間の境目と日付の境目（0時）で切る。睡眠など日跨ぎは、それぞれの日に数える");
  out.push("  - 主行動が重なった時間は、同時にある件数で等分する（二重計上しない）");
  out.push("  - 記録のない時間は「未記録」。合計は期間の長さに一致する" + (period.end > nowLocal.slice(0, 10) ? "（今日以降の分も未記録に含まれる）" : ""));
  out.push("  - ながら・場所は主行動とは別の並行集計で、時間構成の合計には含めない");
  out.push("  - 数値は事実の記録であり、良し悪しの評価は含まない");
  out.push("");

  // 2. 時間構成
  out.push("## 1. 時間構成（親カテゴリ → 色カテゴリ）", "");
  const diffRows = buildDiffRows(cur, prev, settings);
  const timeRows = diffRows.map((r) => {
    const name = r.depth === 1 ? `　└ ${r.name}` : r.name;
    return [name, formatDuration(r.now), formatPercent(r.now, total), formatDuration(r.prev), formatSigned(r.diff)];
  });
  out.push(...table(["区分", "今期", "割合", `前期間（${periodLabel(prevPeriod)}）`, "差"], timeRows));
  out.push("");
  out.push(`- 人がいる時間（主行動のうち人が付いたもの）：${formatDuration(cur.peopleMinutes)}（${formatPercent(cur.peopleMinutes, total)}）`);
  out.push("");

  // 3. ながら・重なり
  out.push("## 2. ながら・重なり", "");
  out.push("### ながら（ラベル別の合計）", "");
  out.push(...(cur.nagaraTotals.length > 0 ? table(["ラベル", "時間"], cur.nagaraTotals.map((n) => [n.label, formatDuration(n.minutes)])) : ["（なし）"]), "");
  out.push("### 主行動カテゴリ × ながらラベル", "");
  out.push(
    ...(cur.cross.length > 0
      ? table(
          ["主行動カテゴリ", "ながらラベル", "時間"],
          cur.cross.map((c) => [c.row === "none" ? "主行動なし" : categoryName(c.row, settings), c.label, formatDuration(c.minutes)]),
        )
      : ["（なし）"]),
    "",
  );
  out.push("### ながら側から見る", "");
  out.push("主行動として＝タイトルがラベルと完全一致する実績・不明の時間。ながらとして＝その区間を除いた時間。", "");
  out.push(
    ...(cur.sideBySide.length > 0
      ? table(["ラベル", "主行動として", "ながらとして"], cur.sideBySide.map((s) => [s.label, formatDuration(s.asMain), formatDuration(s.asNagara)]))
      : ["（なし）"]),
    "",
  );
  out.push("### 場所（ごとの時間）", "");
  out.push(...(cur.placeTotals.length > 0 ? table(["場所", "時間"], cur.placeTotals.map((p) => [p.label, formatDuration(p.minutes)])) : ["（なし）"]), "");

  // 4. 未確定・キャンセル・変更
  const unconfirmed = unconfirmedInPeriod(events, period, nowLocal);
  out.push(`## 3. 未確定の予定（${unconfirmed.length}件）`, "");
  out.push(
    ...(unconfirmed.length > 0
      ? table(["日時", "タイトル"], unconfirmed.map((e) => [`${e.start.replace("T", " ")}〜${datePart(e.end) === datePart(e.start) ? e.end.slice(11) : e.end.replace("T", " ")}`, displayTitle(e)]))
      : ["（なし）"]),
    "",
  );
  const cancelled = cancelledInPeriod(events, period);
  out.push(`## 4. キャンセルと予定の変更`, "");
  out.push(`### キャンセルした予定（${cancelled.length}件）`, "");
  out.push(
    ...(cancelled.length > 0 ? table(["日時", "タイトル", "理由"], cancelled.map((e) => [e.start.replace("T", " "), displayTitle(e), e.cancelReason || "（なし）"])) : ["（なし）"]),
    "",
  );
  const changes = planChangesInPeriod(events, revisions, period);
  out.push(`### 予定の変更（${changes.length}件・変更前 → 変更後）`, "");
  out.push(
    ...(changes.length > 0
      ? table(["変更日時", "予定", "変更内容"], changes.map((c) => [localFromIso(c.changedAt).replace("T", " "), c.title, c.diffs.map((d) => `${d.label}：${d.before} → ${d.after}`).join("／")]))
      : ["（なし）"]),
    "",
  );

  // 5. 日ごとの明細
  out.push("## 5. 日ごとの明細", "");
  const inPeriod = events.filter((e) => overlapsPeriod(e.start, e.end, period));
  const nagaraByEvent = new Map<string, Nagara[]>();
  const sessions: Nagara[] = [];
  for (const n of nagara) {
    if (n.eventId !== null) {
      const list = nagaraByEvent.get(n.eventId) ?? [];
      list.push(n);
      nagaraByEvent.set(n.eventId, list);
    } else if (n.start !== null && n.end !== null && overlapsPeriod(n.start, n.end, period)) {
      sessions.push(n);
    }
  }
  const header = ["時刻", "種別", "カテゴリ", "人", "タイトル", "ながら", "場所", "メモ"];
  for (const day of periodDays(period)) {
    out.push(`### ${day} ${formatShortDate(day).replace(/^\d+\/\d+/, "")}`, "");
    const rows: Array<{ sort: number; cells: string[] }> = [];
    for (const e of inPeriod) {
      let time: string;
      let sort: number;
      if (e.allDay) {
        if (!(datePart(e.start) <= day && day < datePart(e.end))) continue;
        time = "終日";
        sort = -1;
      } else {
        const r = clipRangeToDay(e.start, e.end, day);
        if (!r) continue;
        time = rangeCell(r);
        sort = r.startMin;
      }
      const attached = nagaraByEvent.get(e.id) ?? [];
      const labels = [...new Set(attached.filter((n) => n.type === "nagara").map((n) => n.label.trim()).filter((l) => l !== ""))];
      const places = [...new Set([...e.places, ...attached.filter((n) => n.type === "place").map((n) => n.label)].map((p) => p.trim()).filter((p) => p !== ""))];
      const key = colorKeyOf(e);
      rows.push({
        sort,
        cells: [
          time, kindLabel(e), `${categoryName(key, settings)}（${parentOf(key, settings)}）`, e.people.join("・"), e.title, labels.join("、"), places.join(" → "), e.memo,
        ],
      });
    }
    for (const n of sessions) {
      const r = clipRangeToDay(n.start as string, n.end as string, day);
      if (!r) continue;
      rows.push({ sort: r.startMin, cells: [rangeCell(r), n.type === "place" ? "場所セッション" : "ながらセッション", "", "", n.label, "", "", ""] });
    }
    rows.sort((a, b) => a.sort - b.sort);
    out.push(...(rows.length > 0 ? table(header, rows.map((r) => r.cells)) : ["（なし）"]), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
