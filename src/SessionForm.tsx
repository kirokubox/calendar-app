import { useState } from "react";
import { addMinutes, datePart, formatShortDate, joinLocal, timePart } from "./dateUtils";
import { deriveEndDate, isNextDay, shiftEnd } from "./eventLogic";
import type { Range } from "./eventLogic";
import { validateSession } from "./nagaraLogic";
import { newId } from "./storage";
import type { Nagara, NagaraType } from "./types";

interface Props {
  session: Nagara | null;
  range: Range | null;
  labelSuggestions: string[];
  /** 現在のローカル時刻（YYYY-MM-DDTHH:mm） */
  now: string;
  /** 新規のとき、終了を入れない「継続中」から始めるか（開始は現在時刻にする） */
  defaultOngoing?: boolean;
  onSave: (n: Nagara) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const TYPE_LABEL: Record<NagaraType, string> = { nagara: "ながら", place: "場所" };

/** ながらセッション（eventIdなし・時間あり）の入力。終了を入れない「継続中」でも保存できる */
export default function SessionForm({ session, range, labelSuggestions, now, defaultOngoing = false, onSave, onDelete }: Props) {
  const editing = session !== null;
  const startsOngoing = editing ? session.end === null : defaultOngoing;
  const initStart = session?.start ?? (startsOngoing ? now : range?.start) ?? now;
  // 継続中から「時刻を指定」へ切り替えたときの終了の初期値は、現在時刻（開始以前なら開始の1時間後）
  const fallbackEnd = now > initStart ? now : addMinutes(initStart, 60);
  const initEnd = session?.end ?? (startsOngoing ? fallbackEnd : range?.end ?? fallbackEnd);

  const [label, setLabel] = useState(session?.label ?? "");
  const [type, setType] = useState<NagaraType>(session?.type ?? "nagara");
  const [ongoing, setOngoing] = useState(startsOngoing);
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
  const error = validateSession(label, start, ongoing ? null : end);
  // 場所セッションは新しく作らない（場所はイベントの場所欄へ入れる）。すでにあるものは種類を見せて編集できるままにする
  const showType = editing && session.type === "place";

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

  const save = async (endValue: string | null) => {
    if (busy) return;
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
        end: endValue,
        createdAt: session?.createdAt ?? stamp,
        updatedAt: stamp,
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  };

  const handleSave = () => { if (!error) void save(ongoing ? null : end); };

  /** 今で終了：現在時刻を終了にして保存する（開始以前なら開始の1分後） */
  const handleEndNow = () => {
    if (label.trim() === "") return;
    void save(now > start ? now : addMinutes(start, 1));
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
        placeholder="ラベル（例：YouTube、音楽）"
        value={label}
        autoFocus={!editing}
        list="session-label-suggestions"
        onChange={(e) => setLabel(e.target.value)}
        aria-label="ラベル"
      />
      <datalist id="session-label-suggestions">
        {labelSuggestions.map((t) => <option key={t} value={t} />)}
      </datalist>

      {showType && (
        <div className="segmented" role="group" aria-label="種類">
          {(["nagara", "place"] as NagaraType[]).map((t) => (
            <button key={t} type="button" className={type === t ? "on" : ""} aria-pressed={type === t} onClick={() => setType(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <p className="hint">
        {type === "nagara"
          ? "そのラベルが続いていた時間帯です（例：YouTubeを流していた 20:00〜23:00）。途中でそれがメインになった時間は、イベントとして別に残せます。"
          : "その場所にいた時間（例：カフェ、外出）"}
      </p>

      <div className="time-block">
        <div className="time-row">
          <span className="row-label">開始</span>
          <input className="date-small" type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} aria-label="開始日" />
          <input className="time-input" type="time" value={startTime} onChange={(e) => onStartTimeChange(e.target.value)} aria-label="開始時刻" />
        </div>
        <div className="time-row">
          <span className="row-label">終了</span>
          <div className="segmented" role="group" aria-label="終了の入れ方">
            <button type="button" className={ongoing ? "on" : ""} aria-pressed={ongoing} onClick={() => setOngoing(true)}>継続中</button>
            <button type="button" className={!ongoing ? "on" : ""} aria-pressed={!ongoing} onClick={() => setOngoing(false)}>時刻を指定</button>
          </div>
        </div>
        {ongoing ? (
          <p className="hint">終了は入れずに保存します。終わったら、画面上部の帯の「今で終了」を押します。勝手には終わりません。</p>
        ) : (
          <>
            <div className="time-row">
              <span className="row-label" />
              <input className="date-small" type="date" value={endDate} onChange={(e) => { if (e.target.value) { setEndDate(e.target.value); setEndDateTouched(true); } }} aria-label="終了日" />
              <input className="time-input" type="time" value={endTime} onChange={(e) => onEndTimeChange(e.target.value)} aria-label="終了時刻" />
              {isNextDay(startDate, endDate) && <span className="next-day">翌日</span>}
            </div>
            {!isNextDay(startDate, endDate) && endDate !== startDate && <p className="hint">終了は {formatShortDate(endDate)} です</p>}
          </>
        )}
      </div>

      {error && label.trim() !== "" && <p className="notice error" role="alert">{error}</p>}
      {saveError && <p className="notice error" role="alert">{saveError}</p>}

      <div className="sheet-actions">
        {editing && <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>削除</button>}
        <span className="spacer" />
        {editing && session.end === null && (
          <button type="button" className="secondary-btn" onClick={handleEndNow} disabled={busy || label.trim() === ""}>今で終了</button>
        )}
        <button type="button" className="primary-btn" onClick={handleSave} disabled={!!error || busy}>保存</button>
      </div>
    </>
  );
}
