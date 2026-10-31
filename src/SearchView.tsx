import { useMemo, useState } from "react";
import { COLOR_HEX } from "./constants";
import { Icon } from "./Icon";
import { datePart, formatShortDate, timePart } from "./dateUtils";
import { displayTitle } from "./eventLogic";
import { buildLastRows, lastDateLabel } from "./lastLogic";
import { categoryName, colorKeyOf, formatDuration } from "./reviewLogic";
import {
  SEARCH_FIELD_LABEL, daysAgoLabel, searchAll, summarizeHits, type SearchField, type SearchHit, type SearchKindFilter, type SearchQuery,
} from "./searchLogic";
import type { CalendarEvent, Marker, Nagara, Settings } from "./types";

interface Props {
  events: CalendarEvent[];
  nagara: Nagara[];
  markers: Marker[];
  settings: Settings;
  nowLocal: string;
  /** 検索の条件は画面を行き来しても残す */
  query: SearchQuery;
  onQuery: (q: SearchQuery) => void;
  onBack: () => void;
  /** 「前回」の一覧の項目を設定画面で編集する */
  onEditLastItems: () => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onOpenSession: (n: Nagara) => void;
  onOpenMarker: (m: Marker) => void;
}

const FIELDS: SearchField[] = ["all", "title", "people", "places", "nagara", "category", "memo"];
const KINDS: Array<{ id: SearchKindFilter; label: string }> = [
  { id: "all", label: "すべて" }, { id: "actual", label: "実績だけ" }, { id: "plan", label: "予定だけ" },
];
const PAGE = 60;

function whenOf(h: SearchHit): string {
  const day = formatShortDate(datePart(h.start));
  if (h.type === "marker") return `${day} ${timePart(h.start)}`;
  if (h.type === "event" && h.event.allDay) return `${day} 終日`;
  if (h.end === null) return `${day} ${timePart(h.start)}〜（継続中）`;
  const sameDay = datePart(h.end) === datePart(h.start);
  return `${day} ${timePart(h.start)}〜${sameDay ? "" : `${formatShortDate(datePart(h.end))} `}${timePart(h.end)}`;
}

/** 検索画面：タイトル・人・場所・ながら・カテゴリ・メモを横断し、新しい順のカードで出す。前回日と回数も出す */
export default function SearchView({ events, nagara, markers, settings, nowLocal, query, onQuery, onBack, onEditLastItems, onOpenEvent, onOpenSession, onOpenMarker }: Props) {
  const [limit, setLimit] = useState(PAGE);
  const hits = useMemo(() => searchAll(events, nagara, markers, settings, query), [events, nagara, markers, settings, query]);
  const summary = useMemo(() => summarizeHits(hits, nowLocal), [hits, nowLocal]);
  const set = (patch: Partial<SearchQuery>) => { setLimit(PAGE); onQuery({ ...query, ...patch }); };
  const active = query.text.trim() !== "" || query.from !== "" || query.to !== "";
  // 言葉も期間も空のときだけ計算する（項目ごとに全件を見るので、検索中は計算しない）
  const lastRows = useMemo(
    () => (active ? [] : buildLastRows(settings.lastItems, events, nagara, markers, settings, nowLocal)),
    [active, events, nagara, markers, settings, nowLocal],
  );

  return (
    <div className="review">
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="text-btn" onClick={onBack}><Icon name="arrow-left" size={18} />カレンダーへ</button>
          <h1 className="settings-title">検索</h1>
        </div>
        <div className="search-form">
          <input
            className="title-input"
            type="search"
            placeholder="例：サウナ、店の名前、人の名前"
            value={query.text}
            autoFocus={query.text === ""}
            aria-label="検索する言葉"
            onChange={(e) => set({ text: e.target.value })}
          />
          <div className="quick-list" role="group" aria-label="探す項目">
            {FIELDS.map((f) => (
              <button key={f} type="button" className={`quick ${query.field === f ? "on" : ""}`} aria-pressed={query.field === f} onClick={() => set({ field: f })}>
                {SEARCH_FIELD_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="time-row">
            <span className="row-label">期間</span>
            <input className="date-small" type="date" value={query.from} aria-label="期間の開始日" onChange={(e) => set({ from: e.target.value })} />
            〜
            <input className="date-small" type="date" value={query.to} aria-label="期間の終了日" onChange={(e) => set({ to: e.target.value })} />
            {(query.from !== "" || query.to !== "") && <button type="button" className="text-btn small" onClick={() => set({ from: "", to: "" })}>期間を外す</button>}
          </div>
          <div className="quick-list" role="group" aria-label="種別">
            {KINDS.map((k) => (
              <button key={k.id} type="button" className={`quick ${query.kind === k.id ? "on" : ""}`} aria-pressed={query.kind === k.id} onClick={() => set({ kind: k.id })}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="settings-body review-body search-body">
        {!active ? (
          <>
            <section className="last-panel" aria-label="前回の一覧">
              <div className="last-head">
                <h2>前回</h2>
                <button type="button" className="text-btn small" onClick={onEditLastItems}>項目を編集</button>
              </div>
              {lastRows.length === 0 ? (
                <p className="hint">設定の「前回の一覧」に行動（例：サウナ、散歩、美容院）を登録すると、ここに前回から何日かが久しぶりな順に並びます。</p>
              ) : (
                <ul className="last-list">
                  {lastRows.map((r) => (
                    <li key={r.item.id}>
                      <button
                        type="button"
                        className={`last-row ${r.over ? "over" : ""} ${r.last === null ? "none" : ""}`}
                        onClick={() => set({ text: r.item.name, field: "all", from: "", to: "" })}
                      >
                        <span className="last-name">{r.item.name}</span>
                        <span className="last-when">
                          {r.last ? `${daysAgoLabel(r.last.daysAgo)}（${lastDateLabel(datePart(r.last.start), nowLocal)}）` : "まだ記録がありません"}
                        </span>
                        {r.item.targetDays !== null && <span className="last-target">目安 {r.item.targetDays}日{r.over ? "を超えています" : ""}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="hint">言葉を入れるか、期間を選ぶと探します。空白で区切ると、すべてを含むものに絞ります。ひらがな・カタカナ、全角・半角は区別しません。</p>
          </>
        ) : (
          <>
            <div className="search-summary" role="status">
              <p><strong>{summary.count}件</strong>{summary.totalMinutes > 0 ? `・合わせて ${formatDuration(summary.totalMinutes)}` : ""}{query.from !== "" || query.to !== "" ? "（選んだ期間の中で）" : ""}</p>
              {summary.last ? (
                <p>前回：{formatShortDate(datePart(summary.last.start))}（{daysAgoLabel(summary.last.daysAgo)}）</p>
              ) : summary.count > 0 ? <p>前回：まだありません（予定だけです）</p> : null}
              {summary.first && summary.count > 1 && <p className="hint">いちばん古い記録：{formatShortDate(datePart(summary.first))}</p>}
            </div>
            {hits.length === 0 && <p className="hint">見つかりませんでした。</p>}
            <ul className="search-list">
              {hits.slice(0, limit).map((h) => {
                if (h.type === "event") {
                  const e = h.event;
                  return (
                    <li key={`e-${h.id}`}>
                      <button type="button" className={`search-card ${e.kind === "plan" ? "plan" : ""}`} onClick={() => onOpenEvent(e)}>
                        <span className="search-when">{whenOf(h)}</span>
                        <span className="search-title">
                          <i className="view-dot" style={{ background: COLOR_HEX[colorKeyOf(e)] }} />
                          {displayTitle(e)}
                        </span>
                        <span className="search-meta">
                          {[
                            e.kind === "plan" ? (e.status === "cancelled" ? "予定（キャンセル）" : "予定") : null,
                            categoryName(colorKeyOf(e), settings) + (e.subcategory ? `／${e.subcategory}` : ""),
                            h.nagaraLabels.length > 0 ? `＋${h.nagaraLabels.join(" ＋")}` : null,
                            e.places.length > 0 ? `📍${e.places.join(" → ")}` : null,
                          ].filter((x) => x !== null).join("　")}
                        </span>
                        {e.memo !== "" && <span className="search-memo">{e.memo}</span>}
                      </button>
                    </li>
                  );
                }
                if (h.type === "session") {
                  return (
                    <li key={`s-${h.id}`}>
                      <button type="button" className="search-card" onClick={() => onOpenSession(h.session)}>
                        <span className="search-when">{whenOf(h)}</span>
                        <span className="search-title">{h.session.label}</span>
                        <span className="search-meta">{h.session.type === "place" ? "場所セッション" : "ながらセッション"}</span>
                      </button>
                    </li>
                  );
                }
                return (
                  <li key={`m-${h.id}`}>
                    <button type="button" className="search-card" onClick={() => onOpenMarker(h.marker)}>
                      <span className="search-when">{whenOf(h)}</span>
                      <span className="search-title">◆ {h.marker.label}</span>
                      <span className="search-meta">マーカー</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hits.length > limit && (
              <button type="button" className="secondary-btn" onClick={() => setLimit(limit + PAGE)}>さらに表示（残り {hits.length - limit} 件）</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
