// AI用Markdown（週・月）の生成。純粋ロジック。
import { addDays, datePart, formatShortDate, minutesToTime } from "./dateUtils.js";
import { clipRangeToDay } from "./layout.js";
import {
  buildBreakdown, buildDiffRows, cancelledInPeriod, categoryName, colorKeyOf, computeReview, equivalentPreviousCutoff, formatDuration, formatPercent, formatSigned, localFromIso, periodCutoff,
  overlapsPeriod, parentOf, periodDays, periodLabel, planChangesInPeriod, shiftPeriod, unconfirmedInPeriod, upcomingInPeriod, type Period,
} from "./reviewLogic.js";
import { displayTitle, titleTokens } from "./eventLogic.js";
import { markerTimeLabel, markersInRange, markersWithGaps } from "./markerLogic.js";
import { isOngoing, ongoingSessions, sessionInterval, sessionLabelsOverlapping } from "./nagaraLogic.js";
import { planLabel } from "./planLogic.js";
import type { ActiveSleep, CalendarEvent, Marker, Nagara, PlanRevision, Settings } from "./types.js";

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
  /** マーカー（時刻だけの記録）。無ければ空として扱う */
  markers?: Marker[];
  /** 記録中の睡眠（就寝を押して、まだ起床を押していない） */
  activeSleep?: ActiveSleep | null;
  settings: Settings;
  period: Period;
  /** 書き出し時点のローカル時刻（YYYY-MM-DDTHH:mm）。未確定の判定にも使う */
  nowLocal: string;
}

/** 週・月のAI用Markdown。構成：冒頭／時間構成／ながら・重なり／未確定・キャンセル・変更／日ごとの明細／マーカー */
export function buildReviewMarkdown(input: MarkdownInput): string {
  const { events, nagara, revisions, settings, period, nowLocal } = input;
  const markers = input.markers ?? [];
  const prevPeriod = shiftPeriod(period, -1);
  const cutoff = periodCutoff(period, nowLocal);
  const cur = computeReview(events, nagara, period, true, cutoff);
  const prev = computeReview(events, nagara, prevPeriod, false, equivalentPreviousCutoff(period, prevPeriod, nowLocal));
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
  out.push("  - 記録のない経過時間は「未記録」。現在の期間は未来を除き、現在時刻までを分母にする");
  out.push("  - ながら・場所は主行動とは別の並行集計で、時間構成の合計には含めない");
  out.push("  - イベントのタイトルは、その時間にメインだった行動（「A→B」は行動の流れ、「A/B」は並び）。流れの中の切り替え時刻は記録していないので、時間を均等割りして読まない");
  out.push("  - ながらセッションは、そのラベル（YouTubeなど）が続いていた時間帯。ずっと「ながら」だったという意味ではない。セッション中に同じラベルがイベントのタイトルに出てくる区間は、そのラベルがメインだった（またはメインを含む流れだった）と読む");
  out.push("  - ながらの時間は、セッションとイベントに付けたながらを時間区間の和集合で数える（同じラベルが重なっても二重に数えない）");
  out.push("  - 明細の「ながら」列の（セッション：〜）は、そのイベントの時間に重なっていたセッション。イベントごとにながらを入れ直していなくても、ここから読める");
  out.push("  - 場所・移動は、イベントの場所欄（電車・徒歩などの移動手段を含む）と場所セッションから数える。場所が複数あるイベントは内訳が分からないので、別の列に分ける");
  out.push("  - マーカーは時刻だけの記録（家を出た・目的地着など）。時間構成には足さない。マーカーが無いことは「しなかった」ではなく「時刻未記録」");
  out.push("  - 日ごとの明細は実績・不明、ながら・場所セッション、マーカーだけ。予定は「3. 予定」と「4. キャンセルと予定の変更」に分けて載せる（予定を実績として読まない）");
  out.push("  - 明細の「予定」列は、その実績が対応する予定（予定通り・実績を入力で記録したもの）");
  out.push("  - 数値は事実の記録であり、良し悪しの評価は含まない。集中度・理解度・楽しさは時間からは分からない");
  const running = ongoingSessions(nagara);
  if (running.length > 0 || input.activeSleep) {
    out.push("- 書き出し時点で継続中（終了が未記録。書き出し時刻までとして数えている）：");
    for (const n of running) out.push(`  - ${n.type === "place" ? "場所" : "ながら"}セッション「${n.label}」：${(n.start as string).replace("T", " ")}〜`);
    if (input.activeSleep) out.push(`  - ${input.activeSleep.nap ? "仮眠" : "睡眠"}：${input.activeSleep.start.replace("T", " ")}〜（起床が未記録のため、時間構成にはまだ入っていない）`);
  }
  out.push("");

  // 2. 時間構成
  out.push("## 1. 時間構成（親カテゴリ → 細分類）", "");
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
  out.push("主行動として＝タイトルがラベルと完全一致する実績・不明の時間。主行動の流れに含む＝「A→B」「A/B」のタイトルの一部にラベルが出てくる実績・不明の時間（イベント全体の長さ。そのうちどれだけがそのラベルかは分からない）。ながらとして＝ながらの時間から、上の2つに重なる区間を除いた時間。", "");
  out.push(
    ...(cur.sideBySide.length > 0
      ? table(
          ["ラベル", "主行動として", "主行動の流れに含む（配分不明）", "ながらとして"],
          cur.sideBySide.map((s) => [s.label, formatDuration(s.asMain), formatDuration(s.inFlow), formatDuration(s.asNagara)]),
        )
      : ["（なし）"]),
    "",
  );
  out.push("### 場所（ごとの時間）", "");
  out.push("その場所だけ＝場所が1つのイベントと場所セッションの時間（重なりは1回だけ数える）。複数の場所のうちの1つ＝場所を複数持つイベントの長さ（そのうちどれだけがその場所かは分からない。足し合わせない）。", "");
  out.push(
    ...(cur.placeTotals.length > 0
      ? table(["場所", "その場所だけ", "複数の場所のうちの1つ"], cur.placeTotals.map((p) => [p.label, formatDuration(p.minutes), formatDuration(p.sharedMinutes)]))
      : ["（なし）"]),
    "",
  );

  // 4. 未確定・キャンセル・変更
  const unconfirmed = unconfirmedInPeriod(events, period, nowLocal);
  const upcoming = upcomingInPeriod(events, period, nowLocal);
  const planTime = (e: CalendarEvent) => e.allDay
    ? `${datePart(e.start)} 終日`
    : `${e.start.replace("T", " ")}〜${datePart(e.end) === datePart(e.start) ? e.end.slice(11) : e.end.replace("T", " ")}`;
  out.push("## 3. 予定（実績の明細とは別枠）", "");
  out.push(`### 未確定の予定（${unconfirmed.length}件）`, "");
  out.push("過ぎたのに、対応する実績がない予定。", "");
  out.push(
    ...(unconfirmed.length > 0
      ? table(["日時", "タイトル"], unconfirmed.map((e) => [planTime(e), displayTitle(e)]))
      : ["（なし）"]),
    "",
  );
  out.push(`### これからの予定（${upcoming.length}件）`, "");
  out.push("書き出し時点でまだ終わっていない予定。", "");
  out.push(...(upcoming.length > 0 ? table(["日時", "タイトル"], upcoming.map((e) => [planTime(e), displayTitle(e)])) : ["（なし）"]), "");
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
  // 明細は実績・不明だけ（予定は3・4節）。対応する予定は「予定」列で文脈として残す
  const inPeriod = events.filter((e) => e.kind !== "plan" && overlapsPeriod(e.start, e.end, period));
  const planById = new Map(events.filter((e) => e.kind === "plan").map((e) => [e.id, e]));
  const nagaraByEvent = new Map<string, Nagara[]>();
  // 継続中のセッションは、書き出し時刻までとして載せる
  const sessions: Array<{ n: Nagara; start: string; end: string }> = [];
  for (const n of nagara) {
    if (n.eventId !== null) {
      const list = nagaraByEvent.get(n.eventId) ?? [];
      list.push(n);
      nagaraByEvent.set(n.eventId, list);
    } else {
      const iv = sessionInterval(n, nowLocal);
      if (iv && overlapsPeriod(iv.start, iv.end, period)) sessions.push({ n, ...iv });
    }
  }
  const periodMarkers = markersInRange(markers, period.start, period.end);
  const header = ["時刻", "種別", "カテゴリ", "人", "タイトル", "ながら", "場所・移動", "メモ", "予定"];
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
      // 重なっていたセッション（イベントに付けたながら・タイトルそのものと同じラベルは繰り返さない）
      const tokens = titleTokens(e.title);
      const over = e.allDay ? [] : sessionLabelsOverlapping(nagara, e.start, e.end, nowLocal).filter((l) => !labels.includes(l) && !tokens.includes(l));
      const nagaraCell = [labels.join("、"), over.length > 0 ? `（セッション：${over.join("、")}）` : ""].filter((x) => x !== "").join(" ");
      rows.push({
        sort,
        cells: [
          time, kindLabel(e), `${categoryName(key, settings)}（${parentOf(key, settings)}）`, e.people.join("・"), e.title, nagaraCell, places.join(" → "), e.memo,
          e.planId && planById.has(e.planId) ? planLabel(planById.get(e.planId) as CalendarEvent) : "",
        ],
      });
    }
    for (const s of sessions) {
      const r = clipRangeToDay(s.start, s.end, day);
      if (!r) continue;
      const kind = `${s.n.type === "place" ? "場所" : "ながら"}セッション${isOngoing(s.n) ? "（継続中）" : ""}`;
      rows.push({ sort: r.startMin, cells: [rangeCell(r), kind, "", "", s.n.label, "", "", "", ""] });
    }
    for (const m of periodMarkers) {
      if (datePart(m.at) !== day) continue;
      const minute = Number(m.at.slice(11, 13)) * 60 + Number(m.at.slice(14, 16));
      rows.push({ sort: minute, cells: [minutesToTime(minute), "マーカー", "", "", m.label, "", "", "", ""] });
    }
    rows.sort((a, b) => a.sort - b.sort);
    out.push(...(rows.length > 0 ? table(header, rows.map((r) => r.cells)) : ["（なし）"]), "");
  }

  // 6. マーカー
  out.push("## 6. マーカー（時刻だけの記録）", "");
  out.push("隣り合う2つのマーカーの間の時間を出す（24時間を超えて離れたものはつなげない）。どの組み合わせが移動かは決めていない。", "");
  const gaps = markersWithGaps(markers).filter((g) => g.marker.at >= `${period.start}T00:00` && g.marker.at < `${period.end}T00:00`);
  out.push(
    ...(gaps.length > 0
      ? table(
          ["日付", "時刻", "マーカー", "直前のマーカー", "直前からの時間"],
          gaps.map((g) => [
            datePart(g.marker.at), g.marker.at.slice(11), g.marker.label,
            g.prev ? `${g.prev.label}（${markerTimeLabel(g.prev.at, datePart(g.marker.at))}）` : "",
            g.gapMinutes === null ? "" : formatDuration(g.gapMinutes),
          ]),
        )
      : ["（なし）"]),
    "",
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
