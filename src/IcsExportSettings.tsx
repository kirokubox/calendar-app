import { useState } from "react";
import { dateKeyOf } from "./dateUtils";
import { buildIcs, icsFileName, icsTargets } from "./icsExport";
import type { CalendarEvent } from "./types";

/** 設定画面の「ほかのカレンダー用の書き出し」（.ics。v0.10.0） */
export default function IcsExportSettings({ events }: { events: CalendarEvent[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const count = icsTargets(events, from || null, to || null).length;

  const exportIcs = () => {
    const now = new Date();
    const text = buildIcs(events, { from: from || null, to: to || null, exportedAt: now.toISOString() });
    const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = icsFileName(dateKeyOf(now));
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section>
      <h2>ほかのカレンダー用の書き出し</h2>
      <p className="hint">
        Googleカレンダーやスマホのカレンダーに読み込める形（.ics）で書き出します。予定と実績の両方が入ります（キャンセルした予定は入れません）。
        ながら・マーカーは入りません。予定か実績かは、それぞれの説明欄に書きます。
      </p>
      <div className="inline-actions">
        <label className="field-inline">
          <span>開始日</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field-inline">
          <span>終了日</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <p className="hint">空のままなら全期間です。いまの条件で {count} 件。</p>
      <div className="inline-actions">
        <button type="button" className="secondary-btn" onClick={exportIcs} disabled={count === 0}>
          書き出す
        </button>
      </div>
    </section>
  );
}
