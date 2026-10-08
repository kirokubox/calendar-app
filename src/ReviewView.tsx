import { useMemo, useState } from "react";
import { COLOR_HEX, COLOR_KEYS, PARENT_CATEGORIES, PARENT_COLORS } from "./constants";
import { formatShortDate, parseDateKey } from "./dateUtils";
import { displayTitle } from "./eventLogic";
import { BarChart, PieChart, type PieSlice } from "./ReviewCharts";
import {
  DEFAULT_BAR_TARGET, barSeries, barTargetId, buildBreakdown, buildDiffRows, categoryName, computeReview, formatDuration, formatPercent, formatShare,
  formatSigned, parseBarTarget, parentOf, periodLabel, periodOf, shiftPeriod, unconfirmedInPeriod, type BarTarget, type PeriodKind,
} from "./reviewLogic";
import type { CalendarEvent, Nagara, ParentCategory, Settings } from "./types";

interface Props {
  events: CalendarEvent[];
  nagara: Nagara[];
  settings: Settings;
  nowLocal: string;
  kind: PeriodKind;
  anchor: string;
  onChange: (kind: PeriodKind, anchor: string) => void;
  onBack: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
}

const KIND_LABEL: Record<PeriodKind, string> = { week: "週", month: "月" };

/** 振り返り画面：時間構成（円グラフ）・前期間との差・棒グラフ・ながら/場所・未確定の予定 */
export default function ReviewView({ events, nagara, settings, nowLocal, kind, anchor, onChange, onBack, onOpenEvent }: Props) {
  const [drill, setDrill] = useState<ParentCategory | null>(null);
  const [target, setTarget] = useState<BarTarget>(DEFAULT_BAR_TARGET);

  const period = useMemo(() => periodOf(kind, anchor, settings.weekStartDay), [kind, anchor, settings.weekStartDay]);
  const prevPeriod = useMemo(() => shiftPeriod(period, -1), [period]);
  const stats = useMemo(() => computeReview(events, nagara, period, true), [events, nagara, period]);
  const prevStats = useMemo(() => computeReview(events, nagara, prevPeriod, false), [events, nagara, prevPeriod]);
  const breakdown = useMemo(() => buildBreakdown(stats, settings), [stats, settings]);
  const diffRows = useMemo(() => buildDiffRows(stats, prevStats, settings), [stats, prevStats, settings]);
  const bars = useMemo(() => barSeries(stats, target, settings), [stats, target, settings]);
  const unconfirmed = useMemo(() => unconfirmedInPeriod(events, period, nowLocal), [events, period, nowLocal]);

  const total = breakdown.totalMinutes;
  const todayKey = nowLocal.slice(0, 10);
  const isCurrent = periodOf(kind, todayKey, settings.weekStartDay).start === period.start;
  const futureNote = period.end > todayKey;
  const drilled = drill ? breakdown.parents.find((p) => p.name === drill) ?? null : null;

  const move = (dir: 1 | -1) => onChange(kind, shiftPeriod(period, dir).start);

  const slices: PieSlice[] = drilled
    ? drilled.children.map((c) => ({ key: c.key, label: c.name, value: c.minutes, color: COLOR_HEX[c.key] ?? COLOR_HEX.default }))
    : [
        ...breakdown.parents.map((p) => ({ key: p.name, label: p.name, value: p.minutes, color: PARENT_COLORS[p.name] })),
        { key: "未記録", label: "未記録", value: breakdown.unrecorded.minutes, color: PARENT_COLORS["未記録"] },
      ];

  const barColor = target.type === "parent" ? PARENT_COLORS[target.name] : target.type === "color" ? COLOR_HEX[target.key] ?? COLOR_HEX.default : "#EC407A";
  const nameOf = (key: string) => (key === "none" ? "主行動なし" : categoryName(key, settings));

  return (
    <div className="review">
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="text-btn" onClick={onBack}>← カレンダーへ</button>
          <h1 className="settings-title">振り返り</h1>
        </div>
        <div className="review-nav">
          <div className="segmented" role="group" aria-label="期間の単位">
            {(["week", "month"] as PeriodKind[]).map((k) => (
              <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => { setDrill(null); onChange(k, anchor); }}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label={`前の${KIND_LABEL[kind]}`} onClick={() => move(-1)}>◀</button>
          <span className="review-label">{periodLabel(period)}</span>
          <button type="button" className="icon-btn" aria-label={`次の${KIND_LABEL[kind]}`} onClick={() => move(1)}>▶</button>
          <button type="button" className="text-btn" onClick={() => onChange(kind, todayKey)} disabled={isCurrent}>今日</button>
        </div>
      </header>

      <div className="settings-body review-body">
        <section>
          <h2>時間構成{drilled ? `：${drilled.name}` : ""}</h2>
          {drilled && (
            <button type="button" className="secondary-btn small" onClick={() => setDrill(null)}>← 親カテゴリへ戻る</button>
          )}
          <PieChart slices={slices} onSelect={drilled ? undefined : (key) => { if (key !== "未記録") setDrill(key as ParentCategory); }} />
          <ul className="share-list">
            {drilled
              ? drilled.children.map((c) => (
                  <li key={c.key}>
                    <i className="dot" style={{ background: COLOR_HEX[c.key] ?? COLOR_HEX.default }} />
                    <span className="share-name">{c.name}</span>
                    <span className="share-val">{formatShare(c.minutes, total)}</span>
                  </li>
                ))
              : [
                  ...breakdown.parents.map((p) => (
                    <li key={p.name}>
                      <button type="button" className="share-btn" onClick={() => setDrill(p.name)} aria-label={`${p.name}の内訳を見る`}>
                        <i className="dot" style={{ background: PARENT_COLORS[p.name] }} />
                        <span className="share-name">{p.name}</span>
                        <span className="share-val">{formatShare(p.minutes, total)}</span>
                        <span className="share-chev">›</span>
                      </button>
                    </li>
                  )),
                  <li key="未記録" className="unrecorded">
                    <span className="share-row">
                      <i className="dot" style={{ background: PARENT_COLORS["未記録"] }} />
                      <span className="share-name">未記録</span>
                      <span className="share-val">{formatShare(breakdown.unrecorded.minutes, total)}</span>
                    </span>
                  </li>,
                ]}
          </ul>
          <p className="hint">
            実績と種別不明のイベントを集計（予定・キャンセル・終日は除く）。主行動が重なった時間は件数で等分し、合計は期間の長さに一致します。
            {futureNote ? "今日以降の分は「未記録」に含まれます。" : ""}
          </p>
        </section>

        <section>
          <h2>前期間との差</h2>
          <p className="hint">前期間：{periodLabel(prevPeriod)}</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr><th>区分</th><th>今期</th><th>前期</th><th>差</th></tr>
              </thead>
              <tbody>
                {diffRows.map((r, i) => (
                  <tr key={i} className={r.depth === 1 ? "child" : ""}>
                    <td>{r.depth === 1 ? "└ " : ""}{r.name}</td>
                    <td>{formatDuration(r.now)}</td>
                    <td>{formatDuration(r.prev)}</td>
                    <td>{formatSigned(r.diff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>日ごとの推移</h2>
          <div className="inline-actions">
            <select
              aria-label="棒グラフの対象"
              value={barTargetId(target)}
              onChange={(e) => setTarget(parseBarTarget(e.target.value))}
            >
              <optgroup label="親カテゴリ">
                {PARENT_CATEGORIES.map((p) => <option key={p} value={`parent:${p}`}>{p}</option>)}
              </optgroup>
              <optgroup label="色カテゴリ">
                {COLOR_KEYS.map((k) => <option key={k} value={`color:${k}`}>{categoryName(k, settings)}（{parentOf(k, settings)}）</option>)}
              </optgroup>
              <option value="people">人がいる時間</option>
            </select>
          </div>
          <BarChart
            color={barColor}
            bars={bars.map((b) => ({
              label: String(parseDateKey(b.date).getDate()),
              value: b.minutes,
              title: `${formatShortDate(b.date)} ${formatDuration(b.minutes)}`,
            }))}
          />
          <p className="hint">主行動のみ（ながらは含めません）。日付をまたぐ予定は0時で分けて、それぞれの日に数えます。</p>
        </section>

        <section>
          <h2>ながら・重なり</h2>
          <h3>ながら（ラベル別の合計）</h3>
          {stats.nagaraTotals.length === 0 ? <p className="hint">この期間のながらはありません。</p> : (
            <table className="data-table">
              <tbody>
                {stats.nagaraTotals.map((n) => <tr key={n.label}><td>{n.label}</td><td>{formatDuration(n.minutes)}</td></tr>)}
              </tbody>
            </table>
          )}
          <h3>主行動カテゴリ × ながら</h3>
          {stats.cross.length === 0 ? <p className="hint">なし</p> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>主行動</th><th>ながら</th><th>時間</th></tr></thead>
                <tbody>
                  {stats.cross.map((c) => (
                    <tr key={`${c.row}-${c.label}`}><td>{nameOf(c.row)}</td><td>{c.label}</td><td>{formatDuration(c.minutes)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>ながら側から見る</h3>
          <p className="hint">主行動として＝タイトルがラベルと完全一致する実績。その区間はながら側から除きます。</p>
          {stats.sideBySide.length === 0 ? <p className="hint">なし</p> : (
            <table className="data-table">
              <thead><tr><th>ラベル</th><th>主行動として</th><th>ながらとして</th></tr></thead>
              <tbody>
                {stats.sideBySide.map((s) => (
                  <tr key={s.label}><td>{s.label}</td><td>{formatDuration(s.asMain)}</td><td>{formatDuration(s.asNagara)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>場所ごとの時間</h3>
          {stats.placeTotals.length === 0 ? <p className="hint">この期間の場所はありません。</p> : (
            <table className="data-table">
              <tbody>
                {stats.placeTotals.map((p) => (
                  <tr key={p.label}><td>{p.label}</td><td>{formatDuration(p.minutes)}（{formatPercent(p.minutes, total)}）</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>未確定の予定（{unconfirmed.length}件）</h2>
          {unconfirmed.length === 0 ? <p className="hint">この期間に未確定の予定はありません。</p> : (
            <ul className="unconfirmed-list">
              {unconfirmed.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpenEvent(e)}>
                    <span className="uc-time">{formatShortDate(e.start.slice(0, 10))} {e.allDay ? "終日" : e.start.slice(11)}</span>
                    <span className="uc-title">{displayTitle(e)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
