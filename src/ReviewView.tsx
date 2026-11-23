import { useMemo, useState } from "react";
import { COLOR_KEYS, PARENT_CATEGORIES, PARENT_COLORS } from "./constants";
import { formatShortDate } from "./dateUtils";
import { displayTitle } from "./eventLogic";
import { Icon } from "./Icon";
import { travelPairSummaries } from "./markerLogic";
import { monthlyTrend, yearMonths, yearPeople, yearPlaces } from "./yearLogic";
import { PieChart, StackedBarChart, type PieSlice } from "./ReviewCharts";
import { availableReviewSections, hiddenReviewSections, isReviewSectionVisible } from "./reviewSections";
import {
  DEFAULT_BAR_TARGET, barTargetId, buildBreakdown, buildDiffRows, categoryName, computeReview, formatDuration, formatPercent, formatShare,
  detailColor, equivalentPreviousCutoff, formatSigned, parseBarTarget, parentOf, periodCutoff, periodLabel, periodOf, planOnlyReviewEvents, shiftPeriod, stackedBarSeries,
  unconfirmedInPeriod, type BarTarget, type PeriodKind,
} from "./reviewLogic";
import type { CalendarEvent, Marker, Nagara, ParentCategory, Settings } from "./types";

interface Props {
  events: CalendarEvent[];
  nagara: Nagara[];
  markers: Marker[];
  settings: Settings;
  nowLocal: string;
  kind: PeriodKind;
  anchor: string;
  onChange: (kind: PeriodKind, anchor: string) => void;
  onBack: () => void;
  onOpenEvent: (event: CalendarEvent) => void;
  /** 人の名前を押したとき：その人との記録を検索画面で開く */
  onOpenPerson: (name: string) => void;
  onSaveSettings: (settings: Settings) => Promise<void>;
}

const KIND_LABEL: Record<PeriodKind, string> = { week: "週", month: "月", year: "年" };

/** 振り返り画面：時間構成（円グラフ）・前期間との差・棒グラフ・ながら/場所・未確定の予定 */
export default function ReviewView({ events, nagara, markers, settings, nowLocal, kind, anchor, onChange, onBack, onOpenEvent, onOpenPerson, onSaveSettings }: Props) {
  const [drill, setDrill] = useState<ParentCategory | null>(null);
  const [target, setTarget] = useState<BarTarget>(DEFAULT_BAR_TARGET);
  const [openTravel, setOpenTravel] = useState<string | null>(null);
  const [includeRoutine, setIncludeRoutine] = useState(false);
  const [showAllPeople, setShowAllPeople] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  const [editingSections, setEditingSections] = useState(false);

  const period = useMemo(() => periodOf(kind, anchor, settings.weekStartDay), [kind, anchor, settings.weekStartDay]);
  const reviewEvents = useMemo(() => settings.planOnly ? planOnlyReviewEvents(events) : events, [events, settings.planOnly]);
  const reviewNagara = useMemo(() => settings.planOnly ? [] : nagara, [settings.planOnly, nagara]);
  const prevPeriod = useMemo(() => shiftPeriod(period, -1), [period]);
  const cutoff = useMemo(() => periodCutoff(period, nowLocal), [period, nowLocal]);
  const prevCutoff = useMemo(() => equivalentPreviousCutoff(period, prevPeriod, nowLocal), [period, prevPeriod, nowLocal]);
  const stats = useMemo(() => computeReview(reviewEvents, reviewNagara, period, true, cutoff), [reviewEvents, reviewNagara, period, cutoff]);
  const prevStats = useMemo(() => computeReview(reviewEvents, reviewNagara, prevPeriod, false, prevCutoff), [reviewEvents, reviewNagara, prevPeriod, prevCutoff]);
  const breakdown = useMemo(() => buildBreakdown(stats, settings), [stats, settings]);
  const diffRows = useMemo(() => buildDiffRows(stats, prevStats, settings), [stats, prevStats, settings]);
  const stackedBars = useMemo(() => stackedBarSeries(stats, target, settings), [stats, target, settings]);
  const trendBars = useMemo(() => kind === "year" ? monthlyTrend(stackedBars) : stackedBars, [kind, stackedBars]);
  const months = useMemo(() => kind === "year" ? yearMonths(stats, settings) : [], [kind, stats, settings]);
  const topPeople = useMemo(() => yearPeople(reviewEvents, period, cutoff, nowLocal, includeRoutine, settings), [reviewEvents, period, cutoff, nowLocal, includeRoutine, settings]);
  const topPlaces = useMemo(() => yearPlaces(stats, reviewEvents, reviewNagara, period, cutoff, includeRoutine, settings), [stats, reviewEvents, reviewNagara, period, cutoff, includeRoutine, settings]);
  const travel = useMemo(() => travelPairSummaries(markers, period.start, period.end), [markers, period]);
  const nagaraBars = useMemo(() => stats.perDay.map((d) => ({
    date: d.date,
    segments: stats.nagaraTotals
      .map((n) => ({ key: n.label, label: n.label, minutes: d.byNagara[n.label] ?? 0, color: detailColor(`nagara:${n.label}`) }))
      .filter((s) => s.minutes > 0),
  })), [stats]);
  const unconfirmed = useMemo(() => settings.planOnly ? [] : unconfirmedInPeriod(events, period, nowLocal), [events, period, nowLocal, settings.planOnly]);

  const total = breakdown.totalMinutes;
  const todayKey = nowLocal.slice(0, 10);
  const isCurrent = periodOf(kind, todayKey, settings.weekStartDay).start === period.start;
  const partialPeriod = cutoff < `${period.end}T00:00`;
  const drilled = drill ? breakdown.parents.find((p) => p.name === drill) ?? null : null;

  const move = (dir: 1 | -1) => onChange(kind, shiftPeriod(period, dir).start);

  // 予定だけで使うときは「記録していない」ではなく「予定が無い」時間なので、名前だけ変える（数え方は同じ）
  const unrecordedLabel = settings.planOnly ? "予定なし" : "未記録";
  const slices: PieSlice[] = drilled
    ? drilled.children.map((c) => ({ key: c.key, label: c.name, value: c.minutes, color: c.color }))
    : [
        ...breakdown.parents.map((p) => ({ key: p.name, label: p.name, value: p.minutes, color: PARENT_COLORS[p.name] })),
        { key: "未記録", label: unrecordedLabel, value: breakdown.unrecorded.minutes, color: PARENT_COLORS["未記録"] },
      ];

  const nameOf = (key: string) => (key === "none" ? "主行動なし" : categoryName(key, settings));
  const visible = (key: string) => isReviewSectionVisible(settings, key);
  const toggleSection = (key: string) => {
    const current = hiddenReviewSections(settings);
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    void onSaveSettings({ ...settings, hiddenReviewSections: next });
  };

  // 人・場所の「除く／含める」（v1.0.0で上の段から各節の中へ移した。本人「人と場所を含めるの機能の違い意味がわかんない」）
  const routineFilter = (
    <div className="review-routine-filter">
      <span>仕事・家・移動を</span>
      <div className="segmented" role="group" aria-label="仕事・家・職場・移動・通勤を数えるか">
        <button type="button" className={!includeRoutine ? "on" : ""} aria-pressed={!includeRoutine} onClick={() => { setIncludeRoutine(false); setShowAllPeople(false); setShowAllPlaces(false); }}>除く</button>
        <button type="button" className={includeRoutine ? "on" : ""} aria-pressed={includeRoutine} onClick={() => { setIncludeRoutine(true); setShowAllPeople(false); setShowAllPlaces(false); }}>含める</button>
      </div>
      <p className="hint">{includeRoutine ? "仕事の記録・家・職場・移動・通勤もすべて数えます。" : "仕事の記録・家・職場・移動・通勤を数えず、誰と・どこで過ごしたかを見やすくします。"}</p>
    </div>
  );

  return (
    <div className="review">
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="text-btn" onClick={onBack}><Icon name="arrow-left" size={18} />カレンダーへ</button>
          <h1 className="settings-title">振り返り</h1>
        </div>
        <div className="review-nav">
          <div className="segmented" role="group" aria-label="期間の単位">
            {(["week", "month", "year"] as PeriodKind[]).map((k) => (
              <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => { setDrill(null); onChange(k, anchor); }}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="review-period">
          <button type="button" className="icon-btn" aria-label={`前の${KIND_LABEL[kind]}`} onClick={() => move(-1)}><Icon name="chevron-left" /></button>
          <span className="review-label">{periodLabel(period)}</span>
          <button type="button" className="icon-btn" aria-label={`次の${KIND_LABEL[kind]}`} onClick={() => move(1)}><Icon name="chevron-right" /></button>
          <button type="button" className="text-btn review-today" onClick={() => onChange(kind, todayKey)} disabled={isCurrent}>今日</button>
          </div>
        </div>
      </header>

      <div className="settings-body review-body">
        {settings.planOnly && <p className="hint">予定で数えています（キャンセルした予定を除く）。</p>}
        {kind === "year" && <section>
          <h2>12か月の時間構成</h2>
          <div className="year-months">
            {months.map((m) => <button type="button" key={m.month} className="year-month" onClick={() => onChange("month", `${m.month}-01`)} aria-label={`${Number(m.month.slice(5))}月の振り返りへ`}>
              <span className="year-month-bar">{[...PARENT_CATEGORIES, "未記録" as const].map((name) => {
                const minutes = name === "未記録" ? m.unrecorded : m.parents[name];
                return <i key={name} title={`${name === "未記録" ? unrecordedLabel : name} ${formatDuration(minutes)}`} style={{ height: `${m.total ? minutes / m.total * 100 : 0}%`, background: PARENT_COLORS[name] }} />;
              })}</span>
              <span>{Number(m.month.slice(5))}月</span>
            </button>)}
          </div>
          <p className="hint">月を押すと、その月の振り返りを開きます。未来の月には時間を入れません。</p>
        </section>}
        <section>
          <h2>時間構成{drilled ? `：${drilled.name}` : ""}</h2>
          {drilled && (
            <button type="button" className="secondary-btn small" onClick={() => setDrill(null)}><Icon name="arrow-left" size={16} />親カテゴリへ戻る</button>
          )}
          <PieChart slices={slices} onSelect={drilled ? undefined : (key) => { if (key !== "未記録") setDrill(key as ParentCategory); }} />
          <ul className="share-list">
            {drilled
              ? drilled.children.map((c) => (
                  <li key={c.key}>
                    <i className="dot" style={{ background: c.color }} />
                    <span className="share-name">{c.name}</span>
                    <span className="share-val">
                      {formatDuration(c.minutes)}<br />全体 {formatPercent(c.minutes, total)}／{drilled.name}内 {formatPercent(c.minutes, drilled.minutes)}
                    </span>
                  </li>
                ))
              : [
                  ...breakdown.parents.map((p) => (
                    <li key={p.name}>
                      <button type="button" className="share-btn" onClick={() => setDrill(p.name)} aria-label={`${p.name}の内訳を見る`}>
                        <i className="dot" style={{ background: PARENT_COLORS[p.name] }} />
                        <span className="share-name">{p.name}</span>
                        <span className="share-val">{formatShare(p.minutes, total)}</span>
                        <span className="share-chev"><Icon name="chevron-right" size={16} /></span>
                      </button>
                    </li>
                  )),
                  <li key="未記録" className="unrecorded">
                    <span className="share-row">
                      <i className="dot" style={{ background: PARENT_COLORS["未記録"] }} />
                      <span className="share-name">{unrecordedLabel}</span>
                      <span className="share-val">{formatShare(breakdown.unrecorded.minutes, total)}</span>
                    </span>
                  </li>,
                ]}
          </ul>
          <p className="hint">
            {settings.planOnly ? "キャンセルしていない予定" : "実績と種別不明のイベント（予定・キャンセルは除く）"}を集計（終日は除く）。主行動が重なった時間は件数で等分し、合計は期間の長さに一致します。
            {partialPeriod ? "現在の期間は、未来を除いて現在時刻までを集計しています。" : ""}
          </p>
        </section>

        {visible("diff") && <section>
          <h2>前期間との差</h2>
          <p className="hint">前期間：{periodLabel(prevPeriod)}{partialPeriod ? "（今期と同じ経過時間まで）" : ""}</p>
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
        </section>}

        {visible("trend") && <section>
          <h2>{kind === "year" ? "月ごとの推移" : "日ごとの推移"}</h2>
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
          <StackedBarChart days={trendBars} monthly={kind === "year"} />
          <div className="stack-legend">
            {[...new Map(trendBars.flatMap((d) => d.segments).map((s) => [s.key, s])).values()].map((s) => (
              <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>
            ))}
          </div>
          <p className="hint">主行動のみ（ながらは含めません）。日付をまたぐ予定は0時で分けて、それぞれの日に数えます。</p>
        </section>}

        {visible("nagara") && <section>
          <h2>ながら・重なり</h2>
          <h3>ながら（ラベル別の合計・日ごとの推移）</h3>
          {stats.nagaraTotals.length === 0 ? <p className="hint">この期間のながらはありません。</p> : (
            <table className="data-table">
              <tbody>
                {stats.nagaraTotals.map((n) => <tr key={n.label}><td>{n.label}</td><td>{formatDuration(n.minutes)}</td></tr>)}
              </tbody>
            </table>
          )}
          {stats.nagaraTotals.length > 0 && (
            <div className="nagara-trend">
              <StackedBarChart days={kind === "year" ? monthlyTrend(nagaraBars) : nagaraBars} monthly={kind === "year"} />
              <div className="stack-legend">
                {stats.nagaraTotals.map((n) => (
                  <span key={n.label}><i style={{ background: detailColor(`nagara:${n.label}`) }} />{n.label}</span>
                ))}
              </div>
              <p className="hint">同じ時間に複数のながらがある場合は、それぞれの時間として積み上がります。</p>
            </div>
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
          <p className="hint">
            主行動＝タイトルがラベルと同じ実績。流れに含む＝「A→B」「A▶B」「A/B」のタイトルの一部にラベルが出てくる実績の長さ（そのうちどれだけかは分かりません）。
            ながら＝ながらの時間から、その2つに重なる区間を除いた時間。
          </p>
          {stats.sideBySide.length === 0 ? <p className="hint">なし</p> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>ラベル</th><th>主行動</th><th>流れに含む</th><th>ながら</th></tr></thead>
                <tbody>
                  {stats.sideBySide.map((s) => (
                    <tr key={s.label}><td>{s.label}</td><td>{formatDuration(s.asMain)}</td><td>{formatDuration(s.inFlow)}</td><td>{formatDuration(s.asNagara)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>}

        {visible("place") && <section>
          <h2>場所</h2>
          <h3>場所の大分類ごとの時間</h3>
          <p className="hint">イベントの入力で選んだ大分類でまとめます。場所が複数でも大分類が1つなら、その大分類だけに入ります。大分類を選んでいない場所は「未分類」です（家・職場・電車・徒歩などは自動）。</p>
          {stats.placeKindTotals.length === 0 ? <p className="hint">この期間の場所はありません。</p> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>大分類</th><th>その大分類だけ</th><th>複数のうち</th></tr></thead>
                <tbody>
                  {stats.placeKindTotals.map((p) => (
                    <tr key={p.label}>
                      <td>{p.label}</td>
                      <td>{formatDuration(p.minutes)}（{formatPercent(p.minutes, total)}）</td>
                      <td>{p.sharedMinutes > 0 ? formatDuration(p.sharedMinutes) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>場所・移動ごとの時間</h3>
          {routineFilter}
          <p className="hint">その場所だけ＝場所が1つのイベントと場所セッション。複数のうち＝場所を複数持つイベントの長さ（内訳は分からないので、足し合わせません）。</p>
          {topPlaces.length === 0 ? <p className="hint">この条件の場所はありません。</p> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>場所</th><th>その場所だけ</th><th>複数のうち</th></tr></thead>
                <tbody>
                  {(showAllPlaces ? topPlaces : topPlaces.slice(0, 10)).map((p) => (
                    <tr key={p.label}>
                      <td>{p.label}</td>
                      <td>{formatDuration(p.minutes)}（{formatPercent(p.minutes, total)}）</td>
                      <td>{p.sharedMinutes > 0 ? formatDuration(p.sharedMinutes) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {topPlaces.length > 10 && <button type="button" className="text-btn" onClick={() => setShowAllPlaces(!showAllPlaces)}>{showAllPlaces ? "上位10件に戻す" : `すべて見る（${topPlaces.length}件）`}</button>}
        </section>}

        {visible("travel") && <section>
          <h2>移動（マーカーの組）</h2>
          <p className="hint">対応する始まりと終わりが6時間以内のときだけ数えます。時間構成には含めません。ふだん（直近90日の真ん中の長さ）の1.5倍を超えた回は「寄り道あり」として分けます。</p>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>組</th><th>回数</th><th>平均</th><th>最短</th><th>最長</th><th>寄り道あり</th></tr></thead><tbody>
            {travel.map((r) => <tr key={r.key}><td><button type="button" className="person-link" onClick={() => setOpenTravel(openTravel === r.key ? null : r.key)}>{r.name}</button></td><td>{r.count}</td><td>{formatDuration(r.average)}</td><td>{formatDuration(r.shortest)}</td><td>{formatDuration(r.longest)}</td><td>{r.detourCount > 0 ? `${r.detourCount}回・平均${formatDuration(r.detourAverage)}` : "—"}</td></tr>)}
          </tbody></table></div>
          {travel.filter((r) => r.key === openTravel).map((r) => <div key={r.key} className="table-scroll"><h3>{r.name}：日ごとの一覧</h3><table className="data-table"><thead><tr><th>日付</th><th>時刻</th><th>かかった時間</th></tr></thead><tbody>
            {r.rows.map((p) => <tr key={p.start.id}><td>{formatShortDate(p.start.at.slice(0, 10))}</td><td>{p.start.at.slice(11)}〜{p.end.at.slice(11)}</td><td>{formatDuration(p.minutes)}{p.detour ? "（寄り道あり）" : ""}</td></tr>)}
          </tbody></table></div>)}
        </section>}

        {visible("people") && <section>
          <h2>人</h2>
          {routineFilter}
          <p className="hint">{settings.planOnly ? "予定" : "実績"}のうち、人を入れた記録を人ごとにまとめます。2人以上いる記録は、それぞれの人に同じ時間が入ります（足し合わせると実際より長くなります）。最後の日は、期間に関係なく今日までの記録から出します。名前を押すと、その人との記録を検索で開きます。</p>
          {topPeople.length === 0 ? <p className="hint">この条件に、人を入れた記録はありません。</p> : (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>人</th><th>時間</th><th>日数（件数）</th><th>最後に会った日</th></tr></thead>
                <tbody>
                  {(showAllPeople ? topPeople : topPeople.slice(0, 10)).map((p) => (
                    <tr key={p.name}>
                      <td><button type="button" className="person-link" onClick={() => onOpenPerson(p.name)}>{p.name}</button></td>
                      <td>{formatDuration(p.minutes)}</td>
                      <td>{p.days}日（{p.count}件）</td>
                      <td>{p.lastDate ? formatShortDate(p.lastDate) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {topPeople.length > 10 && <button type="button" className="text-btn" onClick={() => setShowAllPeople(!showAllPeople)}>{showAllPeople ? "上位10件に戻す" : `すべて見る（${topPeople.length}件）`}</button>}
        </section>}

        {visible("unconfirmed") && <section>
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
        </section>}

        <section className="review-section-choices">
          <button type="button" className="review-choice-trigger" onClick={() => setEditingSections(!editingSections)}>表示する項目<Icon name="chevron-right" size={16} /></button>
          {editingSections && <div className="review-choice-list">{availableReviewSections(settings).map(([key, label]) => <button type="button" key={key} className="review-choice-row" aria-pressed={visible(key)} onClick={() => toggleSection(key)}><span>{label}</span><span>{visible(key) ? "オン" : "オフ"}</span></button>)}</div>}
        </section>
      </div>
    </div>
  );
}
