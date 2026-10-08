import { useState } from "react";
import { dateKeyOf, toLocal } from "./dateUtils";
import { periodFileName, periodLabel, periodOf, shiftPeriod, type PeriodKind } from "./reviewLogic";
import { buildReviewMarkdown } from "./reviewMarkdown";
import type { CalendarEvent, Nagara, PlanRevision, Settings } from "./types";

interface Props {
  settings: Settings;
  events: CalendarEvent[];
  nagara: Nagara[];
  revisions: PlanRevision[];
}

/** 設定画面の「AI用Markdown」：週・月を選んで .md を書き出す */
export default function AiMarkdownSettings({ settings, events, nagara, revisions }: Props) {
  const [kind, setKind] = useState<PeriodKind>("week");
  const [anchor, setAnchor] = useState(() => dateKeyOf(new Date()));
  const [message, setMessage] = useState("");

  const period = periodOf(kind, anchor, settings.weekStartDay);

  const build = () => buildReviewMarkdown({ events, nagara, revisions, settings, period, nowLocal: toLocal(new Date()) });

  const download = () => {
    const blob = new Blob([build()], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = periodFileName(period);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`${periodFileName(period)} を書き出しました`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(build());
      setMessage("クリップボードにコピーしました");
    } catch {
      setMessage("コピーできませんでした。「書き出す」を使ってください");
    }
  };

  return (
    <section>
      <h2>AI用Markdown（週・月）</h2>
      <p className="hint">期間の時間構成・ながら・未確定の予定・日ごとの明細をまとめたMarkdownを書き出します。AIへの相談に貼れます。</p>
      <div className="inline-actions">
        <div className="segmented" role="group" aria-label="期間の単位">
          {(["week", "month"] as PeriodKind[]).map((k) => (
            <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => { setKind(k); setMessage(""); }}>
              {k === "week" ? "週" : "月"}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" aria-label="前の期間" onClick={() => { setAnchor(shiftPeriod(period, -1).start); setMessage(""); }}>◀</button>
        <span className="review-label">{periodLabel(period)}</span>
        <button type="button" className="icon-btn" aria-label="次の期間" onClick={() => { setAnchor(shiftPeriod(period, 1).start); setMessage(""); }}>▶</button>
      </div>
      <div className="inline-actions">
        <button type="button" className="primary-btn" onClick={download}>Markdownを書き出す</button>
        <button type="button" className="secondary-btn" onClick={copy}>コピー</button>
        {message && <span className="hint">{message}</span>}
      </div>
    </section>
  );
}
