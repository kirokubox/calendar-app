import { useEffect, useMemo, useState } from "react";
import { COLOR_HEX, COLOR_IDS } from "./constants";
import { addDays, datePart, formatShortDate, joinLocal, timePart } from "./dateUtils";
import {
  allDayLastDate, autoKind, buildAllDayRange, colorForTitle, deriveEndDate, isNextDay, peopleSuggestions, placeSuggestions, shiftEnd,
  titleSuggestions, validateEvent, type Range,
} from "./eventLogic";
import { eventDefaults } from "./migrate";
import { draftsFromNagara, nagaraLabelSuggestions, validateNagaraDrafts, type NagaraDraft } from "./nagaraLogic";
import { newId } from "./storage";
import ChipInput from "./ChipInput";
import NagaraChips from "./NagaraChips";
import SessionForm from "./SessionForm";
import type { CalendarEvent, ColorId, EventKind, Nagara, Settings } from "./types";

export type ModalTab = "event" | "session";

interface Props {
  /** new＝新規（イベント／セッションの切り替えあり）、edit＝イベントの編集、session＝セッションの編集 */
  mode: "new" | "edit" | "session";
  event: CalendarEvent | null;
  session: Nagara | null;
  range: Range | null;
  initialTab: ModalTab;
  events: CalendarEvent[];
  nagara: Nagara[];
  settings: Settings;
  /** 現在のローカル時刻（YYYY-MM-DDTHH:mm） */
  now: string;
  onSave: (event: CalendarEvent, drafts: NagaraDraft[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSaveSession: (n: Nagara) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onClose: () => void;
}

const KIND_LABEL: Record<EventKind, string> = { plan: "予定", actual: "実績", unknown: "不明" };

export default function EventModal({
  mode, event, session, range, initialTab, events, nagara, settings, now, onSave, onDelete, onSaveSession, onDeleteSession, onClose,
}: Props) {
  const editing = mode === "edit" && event !== null;
  const [tab, setTab] = useState<ModalTab>(mode === "session" ? "session" : initialTab);
  const [people, setPeople] = useState<string[]>(event?.people ?? []);
  const [places, setPlaces] = useState<string[]>(event?.places ?? []);
  const [memo, setMemo] = useState(event?.memo ?? "");
  const [drafts, setDrafts] = useState<NagaraDraft[]>(() => (event ? draftsFromNagara(nagara, event.id) : []));
  const initStart = event?.start ?? range?.start ?? now;
  const initEnd = event?.end ?? range?.end ?? now;
  const initAllDay = event?.allDay ?? false;

  const [title, setTitle] = useState(event?.title ?? "");
  const [allDay, setAllDay] = useState(initAllDay);
  const [startDate, setStartDate] = useState(datePart(initStart));
  const [startTime, setStartTime] = useState(initAllDay ? "09:00" : timePart(initStart));
  const [endDate, setEndDate] = useState(initAllDay ? datePart(initStart) : datePart(initEnd));
  const [endTime, setEndTime] = useState(initAllDay ? "10:00" : timePart(initEnd));
  // 終日の最終日（含む）
  const [lastDate, setLastDate] = useState(initAllDay ? allDayLastDate(initEnd) : datePart(initStart));
  const [endDateTouched, setEndDateTouched] = useState(
    initAllDay ? true : datePart(initEnd) !== deriveEndDate(datePart(initStart), timePart(initStart), timePart(initEnd)),
  );
  const [colorId, setColorId] = useState<ColorId>(event?.colorId ?? null);
  const [colorTouched, setColorTouched] = useState(false);
  const [kindChoice, setKindChoice] = useState<EventKind | null>(editing ? event.kind : null);
  const [showDetail, setShowDetail] = useState(false);
  const [showOtherColors, setShowOtherColors] = useState(
    () => event?.colorId != null && !(settings.colorLabels[event.colorId] ?? "").trim(),
  );
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const suggestions = useMemo(() => titleSuggestions(events), [events]);
  const peopleList = useMemo(() => peopleSuggestions(events), [events]);
  const placeList = useMemo(() => placeSuggestions(events), [events]);
  const nagaraList = useMemo(() => nagaraLabelSuggestions(nagara, "nagara"), [nagara]);
  const sessionLabelList = useMemo(() => nagaraLabelSuggestions(nagara), [nagara]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = allDay ? buildAllDayRange(startDate, lastDate).start : joinLocal(startDate, startTime);
  const end = allDay ? buildAllDayRange(startDate, lastDate).end : joinLocal(endDate, endTime);
  const error = validateEvent(title, start, end, allDay) ?? validateNagaraDrafts(drafts);
  const autoJudged = !editing && kindChoice === null;
  const kind: EventKind = kindChoice ?? autoKind(start, now);

  const onTitleChange = (value: string) => {
    setTitle(value);
    if (!editing && !colorTouched) {
      const c = colorForTitle(events, value);
      if (c !== undefined) setColorId(c);
    }
  };

  const onStartDateChange = (value: string) => {
    if (!value) return;
    if (allDay) {
      const delta = Math.round((new Date(`${value}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000);
      setStartDate(value);
      setLastDate(addDays(lastDate, delta));
      return;
    }
    const newEnd = shiftEnd(joinLocal(startDate, startTime), joinLocal(value, startTime), joinLocal(endDate, endTime));
    setStartDate(value);
    setEndDate(datePart(newEnd));
    setEndTime(timePart(newEnd));
  };

  const onStartTimeChange = (value: string) => {
    if (!value) return;
    const newEnd = shiftEnd(joinLocal(startDate, startTime), joinLocal(startDate, value), joinLocal(endDate, endTime));
    setStartTime(value);
    setEndDate(datePart(newEnd));
    setEndTime(timePart(newEnd));
  };

  const onEndTimeChange = (value: string) => {
    if (!value) return;
    setEndTime(value);
    if (!endDateTouched) setEndDate(deriveEndDate(startDate, startTime, value));
  };

  const onEndDateChange = (value: string) => {
    if (!value) return;
    setEndDate(value);
    setEndDateTouched(true);
  };

  const onToggleAllDay = (checked: boolean) => {
    setAllDay(checked);
    if (checked) {
      setLastDate(startDate);
    } else {
      setEndDate(deriveEndDate(startDate, startTime, endTime));
      setEndDateTouched(false);
    }
  };

  const pickColor = (c: ColorId) => {
    setColorId(c);
    setColorTouched(true);
  };

  const handleSave = async () => {
    if (error || busy) return;
    setBusy(true);
    setSaveError("");
    const stamp = new Date().toISOString();
    const next: CalendarEvent = {
      ...(event ?? eventDefaults()),
      people,
      places,
      memo,
      id: event?.id ?? newId(),
      title: title.trim(),
      start,
      end,
      allDay,
      colorId,
      kind,
      createdAt: event?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    try {
      await onSave(next, drafts);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存できませんでした");
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!event || busy) return;
    if (!window.confirm(`「${event.title}」を削除しますか？\nこの操作は元に戻せません。`)) return;
    setBusy(true);
    try {
      await onDelete(event.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "削除できませんでした");
      setBusy(false);
    }
  };

  const labelOf = (id: string) => (settings.colorLabels[id] ?? "").trim();
  const defaultLabel = (settings.colorLabels.default ?? "").trim() || "色なし";
  const namedIds = COLOR_IDS.filter((id) => labelOf(id) !== "");
  const unnamedIds = COLOR_IDS.filter((id) => labelOf(id) === "");

  const chip = (id: ColorId, label: string) => {
    const selected = colorId === id;
    return (
      <button
        key={id ?? "default"}
        type="button"
        className={`color-chip ${selected ? "selected" : ""}`}
        aria-pressed={selected}
        onClick={() => pickColor(id)}
      >
        <i style={{ background: COLOR_HEX[id ?? "default"] }} />
        {label}
      </button>
    );
  };

  return (
    <div className="modal-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={editing ? "予定・実績を編集" : "予定・実績を追加"}>
        <div className="sheet-head">
          <h2>{editing || mode === "session" ? "編集" : "新規作成"}</h2>
          <button type="button" className="text-btn" onClick={onClose}>閉じる</button>
        </div>

        {mode === "new" && (
          <div className="segmented tabs" role="tablist" aria-label="入力の種類">
            <button type="button" role="tab" aria-selected={tab === "event"} className={tab === "event" ? "on" : ""} onClick={() => setTab("event")}>イベント</button>
            <button type="button" role="tab" aria-selected={tab === "session"} className={tab === "session" ? "on" : ""} onClick={() => setTab("session")}>ながら・場所セッション</button>
          </div>
        )}

        {mode !== "session" && (
        <div className="pane" hidden={tab !== "event"}>
        <input
          className="title-input"
          type="text"
          placeholder="タイトル"
          value={title}
          autoFocus={!editing}
          list="title-suggestions"
          onChange={(e) => onTitleChange(e.target.value)}
          aria-label="タイトル"
        />
        <datalist id="title-suggestions">
          {suggestions.map((t) => <option key={t} value={t} />)}
        </datalist>

        <label className="check-row">
          <input type="checkbox" checked={allDay} onChange={(e) => onToggleAllDay(e.target.checked)} />
          終日
        </label>

        {allDay ? (
          <div className="time-block">
            <div className="time-row">
              <span className="row-label">開始日</span>
              <input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} aria-label="開始日" />
            </div>
            <div className="time-row">
              <span className="row-label">終了日</span>
              <input type="date" value={lastDate} onChange={(e) => e.target.value && setLastDate(e.target.value)} aria-label="終了日" />
            </div>
          </div>
        ) : (
          <div className="time-block">
            <div className="time-row">
              <span className="row-label">開始</span>
              <input className="date-small" type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)} aria-label="開始日" />
              <input className="time-input" type="time" value={startTime} onChange={(e) => onStartTimeChange(e.target.value)} aria-label="開始時刻" />
            </div>
            <div className="time-row">
              <span className="row-label">終了</span>
              <input className="date-small" type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} aria-label="終了日" />
              <input className="time-input" type="time" value={endTime} onChange={(e) => onEndTimeChange(e.target.value)} aria-label="終了時刻" />
              {isNextDay(startDate, endDate) && <span className="next-day">翌日</span>}
            </div>
            {!isNextDay(startDate, endDate) && endDate !== startDate && (
              <p className="hint">終了は {formatShortDate(endDate)} です</p>
            )}
          </div>
        )}

        <div className="color-section">
          <span className="row-label">色</span>
          <div className="color-chips">
            {chip(null, defaultLabel)}
            {namedIds.map((id) => chip(id, labelOf(id)))}
          </div>
          {unnamedIds.length > 0 && (
            <>
              <button type="button" className="link-btn" onClick={() => setShowOtherColors((v) => !v)} aria-expanded={showOtherColors}>
                {showOtherColors ? "他の色を閉じる" : "他の色"}
              </button>
              {showOtherColors && <div className="color-chips">{unnamedIds.map((id) => chip(id, "名前なし"))}</div>}
            </>
          )}
        </div>

        <NagaraChips drafts={drafts} onChange={setDrafts} suggestions={nagaraList} eventStart={allDay ? joinLocal(startDate, "09:00") : start} eventEnd={allDay ? joinLocal(startDate, "10:00") : end} />

        <button type="button" className="link-btn detail-toggle" onClick={() => setShowDetail((v) => !v)} aria-expanded={showDetail}>
          {showDetail ? "詳細を閉じる" : "詳細"}
        </button>
        {showDetail && (
          <div className="detail">
            <ChipInput label="人" values={people} onChange={setPeople} suggestions={peopleList} placeholder="例：めぐちゃん" listId="people-suggestions" />
            <ChipInput label="場所（順番あり）" values={places} onChange={setPlaces} suggestions={placeList} placeholder="例：カフェ" reorderable listId="place-suggestions" />
            <label className="field-label" htmlFor="memo-input">メモ</label>
            <textarea id="memo-input" className="memo-input" rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} />
            <span className="field-label">種別</span>
            <div className="segmented">
              {(["plan", "actual"] as EventKind[]).concat(kind === "unknown" ? ["unknown" as EventKind] : []).map((k) => (
                <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKindChoice(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {autoJudged && <p className="hint">時刻から自動判定しています</p>}
          </div>
        )}

        {error && <p className="notice error" role="alert">{error}</p>}
        {saveError && <p className="notice error" role="alert">{saveError}</p>}

        <div className="sheet-actions">
          {editing && <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>削除</button>}
          <span className="spacer" />
          <button type="button" className="primary-btn" onClick={handleSave} disabled={!!error || busy}>保存</button>
        </div>
        </div>
        )}

        {mode !== "edit" && (
          <div className="pane" hidden={tab !== "session"}>
            <SessionForm session={session} range={range} labelSuggestions={sessionLabelList} onSave={onSaveSession} onDelete={onDeleteSession} />
          </div>
        )}
      </div>
    </div>
  );
}
