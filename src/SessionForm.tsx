import { useState } from "react";
import { datePart, formatShortDate, joinLocal, timePart } from "./dateUtils";
import { deriveEndDate, isNextDay, shiftEnd } from "./eventLogic";
import type { Range } from "./eventLogic";
import { newId } from "./storage";
import type { Nagara, NagaraType } from "./types";

interface Props {
  session: Nagara | null;
  range: Range | null;
  labelSuggestions: string[];
  onSave: (n: Nagara) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const TYPE_LABEL: Record<NagaraType, string> = { nagara: "ながら", place: "場所" };

/** ながら・場所セッション（eventIdなし・時間あり）の入力 */
export default function SessionForm({ session, range, labelSuggestions, onSave, onDelete }: Props) {
  const editing = session !== null;
  const initStart = session?.start ?? range?.start ?? joinLocal("1970-01-01", "00:00");
  const initEnd = session?.end ?? range?.end ?? initStart;

  const [label, setLabel] = useState(session?.label ?? "");
  const [type, setType] = useState<NagaraType>(session?.type ?? "nagara");
  const [startDate, setStartDate] = useState(datePart(initStart));
  const [startTime, setStartTime] = useState(timePart(initStart));
  const [endDate, setEndDate] = useState(datePart(initEnd));
  const [endTime, setEndTime] = useState(timePart(initEnd));
  const [endDateTouched, setEndDateTouched] = useState(
    datePart(initEnd) !== deriveEndDate(datePart(initStart), timePart(initStart), timePart(initEnd)),
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const start = joinLocal(startDate, startTime);
  const end = joinLocal(endDate, endTime);
  const error = label.trim() === "" ? "ラベルを入力してください" : end <= start ? "終了は開始より後にしてください" : null;

  const onStartDateChange = (value: string) => {
    if (!value) return;
    const newEnd = shiftEnd(start, joinLocal(value, startTime), end);
    setStartDate(value);
    setEndDate(datePart(newEnd));
    setEndTime(timePart(newEnd));
  };

  const onStartTimeChange = (value: string) => {
    if (!value) return;
    const newEnd = shiftEnd(start, joinLocal(startDate, value), end);
    setStartTime(value);
    setEndDate(datePart(newEnd));
    setEndTime(timePart(newEnd));
  };

  const onEndTimeChange = (value: string) => {
    if (!value) return;
    setEndTime(value);
    // 終了が開始より前なら自動で翌日
    if (!endDateTouched) setEndDate(deriveEndDate(startDate, startTime, value));
  };

  const handleSave = async () => {
    if (error || busy) return;
    setBusy(true);
    setSaveError("");
    const stamp = new Date().toISOString();
    try {
      await onSave({
        id: session?.id ?? newId(),
        label: label.trim(),
        type,
        eventId: null,
        start,
        end,
        createdAt: session?.createdAt ?? stamp,
        updatedAt: stamp,
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!session || busy) return;
    if (!window.confirm(`「${session.label}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    setBusy(true);
    try {
      await onDelete(session.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "削除できませんでした");
      setBusy(false);
    }
  };

  return (
    <>
      <input
        className="title-input"
        type="text"
        placeholder="ラベル（例：YouTube、カフェ）"
        value={label}
        autoFocus={!editing}
        list="session-label-suggestions"
        onChange={(e) => setLabel(e.target.value)}
        aria-label="ラベル"
      />
      <datalist id="session-label-suggestions">
        {labelSuggestions.map((t) => <option key={t} value={t} />)}
      </datalist>

      <div className="segmented" role="group" aria-label="種類">
        {(["nagara", "place"] as NagaraType[]).map((t) => (
          <button key={t} type="button" className={type === t ? "on" : ""} aria-pressed={type === t} onClick={() => setType(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <p className="hint">{type === "nagara" ? "並行していた行動（例：作業しながらYouTube）" : "その場所にいた時間（例：カフェ、外出）"}</p>

      <div className="time-block">
        <div className="time-row">
          <span className="row-label">開始</span>
          <input className="date-small" type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} aria-label="開始日" />
          <input className="time-input" type="time" value={startTime} onChange={(e) => onStartTimeChange(e.target.value)} aria-label="開始時刻" />
        </div>
        <div className="time-row">
          <span className="row-label">終了</span>
          <input className="date-small" type="date" value={endDate} onChange={(e) => { if (e.target.value) { setEndDate(e.target.value); setEndDateTouched(true); } }} aria-label="終了日" />
          <input className="time-input" type="time" value={endTime} onChange={(e) => onEndTimeChange(e.target.value)} aria-label="終了時刻" />
          {isNextDay(startDate, endDate) && <span className="next-day">翌日</span>}
        </div>
        {!isNextDay(startDate, endDate) && endDate !== startDate && <p className="hint">終了は {formatShortDate(endDate)} です</p>}
      </div>

      {error && <p className="notice error" role="alert">{error}</p>}
      {saveError && <p className="notice error" role="alert">{saveError}</p>}

      <div className="sheet-actions">
        {editing && <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>削除</button>}
        <span className="spacer" />
        <button type="button" className="primary-btn" onClick={handleSave} disabled={!!error || busy}>保存</button>
      </div>
    </>
  );
}
