import { useState } from "react";
import { COLOR_HEX, COLOR_IDS } from "./constants";
import { dateKeyOf, weekdayName } from "./dateUtils";
import { WEEKDAYS_DEFAULT, validateRule } from "./planLogic";
import { newId } from "./storage";
import type { ColorId, RecurrenceRule, Settings } from "./types";

interface Props {
  settings: Settings;
  recurrences: RecurrenceRule[];
  onSave: (rule: RecurrenceRule) => Promise<void>;
}

interface Draft {
  id: string | null;
  title: string;
  colorId: ColorId;
  startTime: string;
  endTime: string;
  weekdays: number[];
  startDate: string;
  endDate: string;
}

function newDraft(): Draft {
  return { id: null, title: "", colorId: null, startTime: "09:00", endTime: "18:00", weekdays: [...WEEKDAYS_DEFAULT], startDate: dateKeyOf(new Date()), endDate: "" };
}

/** 曜日を月〜日の順で並べる（0=日は最後） */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function summary(r: RecurrenceRule): string {
  const days = WEEKDAY_ORDER.filter((d) => r.weekdays.includes(d)).map(weekdayName).join("");
  return `${days}　${r.startTime}〜${r.endTime}${r.endTime <= r.startTime ? "（翌日）" : ""}　${r.startDate}〜${r.endDate ?? ""}`;
}

/** 設定画面の「平日の繰り返し予定」：ルールの一覧・追加・編集・停止 */
export default function RecurrenceSettings({ settings, recurrences, onSave }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const labelOf = (key: string) => (settings.colorLabels[key] ?? "").trim();
  const sorted = [...recurrences].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title));
  const error = draft ? validateRule({ ...draft, endDate: draft.endDate === "" ? null : draft.endDate }) : null;

  const edit = (r: RecurrenceRule) => {
    setMessage("");
    setDraft({ id: r.id, title: r.title, colorId: r.colorId, startTime: r.startTime, endTime: r.endTime, weekdays: [...r.weekdays], startDate: r.startDate, endDate: r.endDate ?? "" });
  };

  const save = async () => {
    if (!draft || error) return;
    setBusy(true);
    try {
      const old = recurrences.find((r) => r.id === draft.id);
      const rule: RecurrenceRule = {
        id: old?.id ?? newId(),
        title: draft.title.trim(),
        colorId: draft.colorId,
        startTime: draft.startTime,
        endTime: draft.endTime,
        weekdays: [...draft.weekdays].sort((a, b) => a - b),
        startDate: draft.startDate,
        endDate: draft.endDate === "" ? null : draft.endDate,
        active: old?.active ?? true,
        generatedDates: old?.generatedDates ?? [],
      };
      await onSave(rule);
      setDraft(null);
      setMessage("保存しました。今日から56日先までの予定を作成しました（作成済みの日付は作り直しません）");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const toggleActive = async (r: RecurrenceRule) => {
    setBusy(true);
    try {
      await onSave({ ...r, active: !r.active });
      setMessage(r.active ? "停止しました（作成済みの予定はそのままです）" : "再開しました");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const toggleDay = (d: number) => {
    if (!draft) return;
    setDraft({ ...draft, weekdays: draft.weekdays.includes(d) ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d] });
  };

  return (
    <section>
      <h2>平日の繰り返し予定</h2>
      <p className="hint">決まった枠（仕事など）を、起動時に今日から56日先まで予定として作ります。作った予定を削除しても復活しません。ルールを変えても、作成済みの予定は変わりません。</p>
      {sorted.length === 0 && <p className="hint">ルールはまだありません。</p>}
      <ul className="rule-list">
        {sorted.map((r) => (
          <li key={r.id} className={r.active ? "" : "off"}>
            <i className="dot" style={{ background: COLOR_HEX[r.colorId ?? "default"], width: 14, height: 14, borderRadius: "50%", flex: "none" }} />
            <span className="rule-main"><strong>{r.title}{r.active ? "" : "（停止中）"}</strong>{summary(r)}</span>
            <button type="button" className="secondary-btn small" disabled={busy} onClick={() => edit(r)}>編集</button>
            <button type="button" className="secondary-btn small" disabled={busy} onClick={() => toggleActive(r)}>{r.active ? "停止" : "再開"}</button>
          </li>
        ))}
      </ul>
      {!draft && (
        <div className="inline-actions">
          <button type="button" className="secondary-btn" onClick={() => { setMessage(""); setDraft(newDraft()); }}>ルールを追加</button>
          {message && <span className="hint">{message}</span>}
        </div>
      )}
      {draft && (
        <div className="rule-form">
          <input type="text" placeholder="タイトル（例：仕事）" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="ルールのタイトル" />
          <div className="rule-row">
            <span className="row-label">色</span>
            <select value={draft.colorId ?? "default"} aria-label="ルールの色" onChange={(e) => setDraft({ ...draft, colorId: e.target.value === "default" ? null : e.target.value })}>
              <option value="default">{labelOf("default") || "色指定なし"}</option>
              {COLOR_IDS.map((id) => <option key={id} value={id}>{labelOf(id) || `色${id}`}</option>)}
            </select>
          </div>
          <div className="rule-row">
            <span className="row-label">時刻</span>
            <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} aria-label="開始時刻" />
            〜
            <input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} aria-label="終了時刻" />
            {draft.endTime !== "" && draft.endTime <= draft.startTime && <span className="next-day">翌日</span>}
          </div>
          <div className="rule-row">
            <span className="row-label">曜日</span>
            <div className="weekday-chips" role="group" aria-label="曜日">
              {WEEKDAY_ORDER.map((d) => (
                <button key={d} type="button" className={draft.weekdays.includes(d) ? "on" : ""} aria-pressed={draft.weekdays.includes(d)} onClick={() => toggleDay(d)}>{weekdayName(d)}</button>
              ))}
            </div>
          </div>
          <div className="rule-row">
            <span className="row-label">開始日</span>
            <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} aria-label="開始日" />
          </div>
          <div className="rule-row">
            <span className="row-label">終了日</span>
            <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} aria-label="終了日（任意）" />
            <span className="hint">任意</span>
          </div>
          {error && <p className="notice error" role="alert">{error}</p>}
          <div className="inline-actions">
            <button type="button" className="primary-btn" disabled={busy || !!error} onClick={save}>保存</button>
            <button type="button" className="secondary-btn" disabled={busy} onClick={() => setDraft(null)}>やめる</button>
          </div>
        </div>
      )}
    </section>
  );
}
