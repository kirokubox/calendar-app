import { useEffect, useMemo, useRef, useState } from "react";
import { COLOR_HEX, COLOR_IDS, FIXED_NAGARA, FIXED_PLACES } from "./constants";
import { addDays, datePart, formatShortDate, joinLocal, timePart, toLocal, weekdayName } from "./dateUtils";
import {
  allDayLastDate, autoKind, buildAllDayRange, colorForTitle, deriveEndDate, isNextDay, peopleSuggestions, placeSuggestions, shiftEnd,
  subcategorySuggestions, titleSuggestions, validateEvent, type Range,
} from "./eventLogic";
import { holidayName } from "./holidays";
import { eventDefaults } from "./migrate";
import { diffSnapshots, planLabel, snapshotOf } from "./planLogic";
import { canApplyFollowing, validateRule } from "./recurrence";
import { draftsFromNagara, nagaraLabelSuggestions, validateNagaraDrafts, type NagaraDraft } from "./nagaraLogic";
import { newId } from "./storage";
import ChipInput from "./ChipInput";
import NagaraChips from "./NagaraChips";
import SessionForm from "./SessionForm";
import type { CalendarEvent, ColorId, EventKind, Nagara, PlanRevision, RecurrenceRule, Settings } from "./types";

export type ModalTab = "event" | "session";
/** 繰り返しから作った予定を編集したときの反映範囲 */
export type EditScope = "single" | "following";

interface Props {
  /** new＝新規（イベント／セッションの切り替えあり）、edit＝イベントの編集、session＝セッションの編集、rule＝繰り返しルールの追加・編集 */
  mode: "new" | "edit" | "session" | "rule";
  event: CalendarEvent | null;
  session: Nagara | null;
  range: Range | null;
  initialTab: ModalTab;
  /** 予定から「実績を入力」で開いたときの元の予定（内容の初期値とリンク先） */
  template: CalendarEvent | null;
  /** 編集中の予定の変更履歴（新しい順） */
  revisions: PlanRevision[];
  /** 編集中の予定にリンクされた実績の件数 */
  linkedActualCount: number;
  /** 編集中の実績がリンクしている予定 */
  planOfActual: CalendarEvent | null;
  /** rule モード：編集するルール（新規は既定値の入ったルール） */
  rule?: RecurrenceRule | null;
  /** 編集中の予定を作った繰り返しルール（あれば「この予定だけ／この日以降」を聞く） */
  occurrenceRule?: RecurrenceRule | null;
  events: CalendarEvent[];
  nagara: Nagara[];
  settings: Settings;
  /** 現在のローカル時刻（YYYY-MM-DDTHH:mm） */
  now: string;
  onSave: (event: CalendarEvent, drafts: NagaraDraft[], scope: EditScope) => Promise<void>;
  onSaveRule?: (rule: RecurrenceRule) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAsPlanned: (plan: CalendarEvent) => Promise<void>;
  onCancelPlan: (plan: CalendarEvent, reason: string) => Promise<void>;
  onUncancelPlan: (plan: CalendarEvent) => Promise<void>;
  onRecordActual: (plan: CalendarEvent) => void;
  onSaveSession: (n: Nagara) => Promise<void>;
  onDeleteSession: (id: string) => Promise<void>;
  onClose: () => void;
}

const KIND_LABEL: Record<EventKind, string> = { plan: "予定", actual: "実績", unknown: "不明" };
/** 曜日を月〜日の順で並べる（0=日は最後） */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DETAIL_PREF_KEY = "calendar-app:detail-open";

function readDetailPref(): boolean {
  try {
    return window.localStorage.getItem(DETAIL_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDetailPref(open: boolean): void {
  try {
    window.localStorage.setItem(DETAIL_PREF_KEY, open ? "1" : "0");
  } catch {
    // 保存できない環境では覚えない
  }
}

function sortedLabels(drafts: NagaraDraft[]): string {
  return JSON.stringify(drafts.map((d) => `${d.label.trim()}|${d.start ?? ""}|${d.end ?? ""}`).sort());
}

export default function EventModal({
  mode, event, session, range, initialTab, template, revisions, linkedActualCount, planOfActual, rule, occurrenceRule, events, nagara, settings, now,
  onSave, onSaveRule, onDelete, onAsPlanned, onCancelPlan, onUncancelPlan, onRecordActual, onSaveSession, onDeleteSession, onClose,
}: Props) {
  const isRule = mode === "rule" && rule != null;
  const editing = mode === "edit" && event !== null;
  const [tab, setTab] = useState<ModalTab>(mode === "session" ? "session" : initialTab);
  // 編集なら元のイベント、「実績を入力」なら元の予定の内容を初期値にする
  const src = event ?? template;
  const [people, setPeople] = useState<string[]>(isRule ? rule.people : src?.people ?? []);
  const [places, setPlaces] = useState<string[]>(isRule ? rule.places : src?.places ?? []);
  const [memo, setMemo] = useState(isRule ? rule.memo : src?.memo ?? "");
  const [subcategory, setSubcategory] = useState((isRule ? rule.subcategory : src?.subcategory) ?? "");
  const initialDrafts = useMemo<NagaraDraft[]>(() => {
    if (isRule) return rule.nagaraLabels.map((label) => ({ key: newId(), id: null, label, start: null, end: null }));
    if (event) return draftsFromNagara(nagara, event.id);
    if (template) return draftsFromNagara(nagara, template.id).map((d) => ({ ...d, key: newId(), id: null }));
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [drafts, setDrafts] = useState<NagaraDraft[]>(initialDrafts);
  const initStart = src?.start ?? range?.start ?? now;
  const initEnd = src?.end ?? range?.end ?? now;
  const initAllDay = src?.allDay ?? false;

  const [title, setTitle] = useState(isRule ? rule.title : src?.title ?? "");
  const [allDay, setAllDay] = useState(initAllDay);
  const [startDate, setStartDate] = useState(datePart(initStart));
  const [startTime, setStartTime] = useState(isRule ? rule.startTime : initAllDay ? "09:00" : timePart(initStart));
  const [endDate, setEndDate] = useState(initAllDay ? datePart(initStart) : datePart(initEnd));
  const [endTime, setEndTime] = useState(isRule ? rule.endTime : initAllDay ? "10:00" : timePart(initEnd));
  // 終日の最終日（含む）
  const [lastDate, setLastDate] = useState(initAllDay ? allDayLastDate(initEnd) : datePart(initStart));
  const [endDateTouched, setEndDateTouched] = useState(
    initAllDay ? true : datePart(initEnd) !== deriveEndDate(datePart(initStart), timePart(initStart), timePart(initEnd)),
  );
  const [colorId, setColorId] = useState<ColorId>(isRule ? rule.colorId : src?.colorId ?? null);
  const [colorTouched, setColorTouched] = useState(false);
  const [kindChoice, setKindChoice] = useState<EventKind | null>(editing ? event.kind : template ? "actual" : null);
  // 繰り返しルールの項目
  const [weekdays, setWeekdays] = useState<number[]>(isRule ? rule.weekdays : []);
  const [ruleStart, setRuleStart] = useState(isRule ? rule.startDate : "");
  const [ruleEnd, setRuleEnd] = useState(isRule ? rule.endDate ?? "" : "");
  const [excludeHolidays, setExcludeHolidays] = useState(isRule ? rule.excludeHolidays : false);

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showRevisions, setShowRevisions] = useState(false);
  const hasDetail = people.length > 0 || places.length > 0 || memo !== "" || subcategory !== "" || drafts.length > 0;
  const [showDetail, setShowDetail] = useState(() => isRule || hasDetail || readDetailPref());
  const [showOtherColors, setShowOtherColors] = useState(() => {
    const c = isRule ? rule.colorId : event?.colorId;
    return c != null && !(settings.colorLabels[c] ?? "").trim();
  });
  const [askScope, setAskScope] = useState<CalendarEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState("");

  const suggestions = useMemo(() => titleSuggestions(events), [events]);
  const peopleList = useMemo(() => peopleSuggestions(events), [events]);
  const placeList = useMemo(() => placeSuggestions(events), [events]);
  const subcategoryList = useMemo(() => subcategorySuggestions(events), [events]);
  const nagaraList = useMemo(() => nagaraLabelSuggestions(nagara, "nagara"), [nagara]);
  const sessionLabelList = useMemo(() => nagaraLabelSuggestions(nagara), [nagara]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = allDay ? buildAllDayRange(startDate, lastDate).start : joinLocal(startDate, startTime);
  const end = allDay ? buildAllDayRange(startDate, lastDate).end : joinLocal(endDate, endTime);
  const ruleDraft = { title, startTime, endTime, weekdays, startDate: ruleStart, endDate: ruleEnd === "" ? null : ruleEnd };
  const error = isRule
    ? validateRule(ruleDraft)
    : validateEvent(title, start, end, allDay) ?? validateNagaraDrafts(drafts);
  const autoJudged = !editing && kindChoice === null;
  const kind: EventKind = kindChoice ?? autoKind(start, now);

  const onTitleChange = (value: string) => {
    setTitle(value);
    if (!editing && !colorTouched && !(isRule && rule.title !== "")) {
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
    if (isRule) {
      setStartTime(value);
      return;
    }
    const newEnd = shiftEnd(joinLocal(startDate, startTime), joinLocal(startDate, value), joinLocal(endDate, endTime));
    setStartTime(value);
    setEndDate(datePart(newEnd));
    setEndTime(timePart(newEnd));
  };

  const onEndTimeChange = (value: string) => {
    if (!value) return;
    setEndTime(value);
    if (!isRule && !endDateTouched) setEndDate(deriveEndDate(startDate, startTime, value));
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

  const toggleDetail = () => {
    const next = !showDetail;
    setShowDetail(next);
    writeDetailPref(next);
  };

  const toggleDay = (d: number) => setWeekdays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  /** 保存処理の共通の入口：二重保存を防ぎ、エラーを表示する */
  const runSave = async (action: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setSaveError("");
    try {
      await action();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存できませんでした");
    }
    savingRef.current = false;
    setBusy(false);
  };

  const buildEvent = (): CalendarEvent => {
    const stamp = new Date().toISOString();
    return {
      ...(event ?? eventDefaults()),
      people,
      places,
      memo,
      subcategory: subcategory.trim() || null,
      id: event?.id ?? newId(),
      title: title.trim(),
      start,
      end,
      allDay,
      colorId,
      kind,
      createdAt: event?.createdAt ?? stamp,
      updatedAt: stamp,
      planId: event ? event.planId : template?.id ?? null,
    };
  };

  const handleSave = () => {
    if (error || busy) return;
    if (isRule) {
      const next: RecurrenceRule = {
        ...rule,
        title: title.trim(),
        colorId,
        startTime,
        endTime,
        weekdays: [...weekdays].sort((a, b) => a - b),
        startDate: ruleStart,
        endDate: ruleEnd,
        excludeHolidays,
        people,
        places,
        subcategory: subcategory.trim() || null,
        memo,
        nagaraLabels: [...new Set(drafts.map((d) => d.label.trim()).filter((l) => l !== ""))],
      };
      void runSave(async () => { if (onSaveRule) await onSaveRule(next); });
      return;
    }
    const next = buildEvent();
    if (editing && event.recurrenceId !== null && occurrenceRule) {
      const unchanged = JSON.stringify(snapshotOf(event)) === JSON.stringify(snapshotOf(next)) && event.kind === next.kind
        && sortedLabels(drafts) === sortedLabels(initialDrafts);
      if (unchanged) {
        // 何も変えていない保存で「個別編集」扱いにしない
        onClose();
        return;
      }
      setAskScope(next);
      return;
    }
    void runSave(() => onSave(next, drafts, "single"));
  };

  const saveWithScope = (scope: EditScope) => {
    if (!askScope) return;
    void runSave(() => onSave(askScope, drafts, scope));
  };

  // 「この日以降」は内容の変更だけ。日付・終日・種別を変えたときは「この予定だけ」
  const followingBlockedReason = (() => {
    if (!askScope || !event) return null;
    if (!canApplyFollowing(occurrenceRule ?? undefined, event.recurrenceDate)) return "ルールの期間外の予定です";
    if (askScope.allDay || datePart(askScope.start) !== event.recurrenceDate) return "日付を変えたときは、この予定だけに反映します";
    if (askScope.kind !== event.kind) return "種別を変えたときは、この予定だけに反映します";
    if (drafts.some((d) => d.start !== null)) return "時間を指定したながらは、この予定だけに反映します";
    return null;
  })();

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

  /** 予定の操作（予定通り・キャンセル・取り消し）を実行する */
  const runPlanAction = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setSaveError("");
    try {
      await action();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "操作できませんでした");
      setBusy(false);
    }
  };

  const isPlan = editing && event.kind === "plan";
  const refPlan = editing ? planOfActual : template;
  const currentSnapshot = event ? snapshotOf(event) : null;
  const holiday = !isRule && !allDay ? holidayName(startDate) : null;

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

  const heading = isRule ? (rule.title === "" && rule.generatedDates.length === 0 ? "繰り返し予定を追加" : "繰り返し予定を編集") : editing || mode === "session" ? "編集" : "新規作成";
  const showTopSave = mode !== "session" && tab === "event" && askScope === null;

  return (
    <div className="modal-backdrop">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={heading}>
        <div className="sheet-head">
          <h2>{heading}</h2>
          <div className="sheet-head-actions">
            {showTopSave && <button type="button" className="primary-btn small" onClick={handleSave} disabled={!!error || busy}>保存</button>}
            <button type="button" className="text-btn" onClick={onClose}>閉じる</button>
          </div>
        </div>

        {mode === "new" && (
          <div className="segmented tabs" role="tablist" aria-label="入力の種類">
            <button type="button" role="tab" aria-selected={tab === "event"} className={tab === "event" ? "on" : ""} onClick={() => setTab("event")}>イベント</button>
            <button type="button" role="tab" aria-selected={tab === "session"} className={tab === "session" ? "on" : ""} onClick={() => setTab("session")}>ながら・場所セッション</button>
          </div>
        )}

        {mode !== "session" && (
        <div className="pane" hidden={tab !== "event"}>
        {isPlan && event.status === "cancelled" && (
          <>
            <p className="cancel-note">この予定はキャンセルされています{event.cancelReason ? `（理由：${event.cancelReason}）` : ""}</p>
            <div className="plan-actions">
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => runPlanAction(() => onUncancelPlan(event))}>キャンセルを取り消す</button>
            </div>
          </>
        )}
        {isPlan && event.status === "active" && (
          <div className="plan-actions">
            <button type="button" className="primary-btn" disabled={busy} onClick={() => runPlanAction(() => onAsPlanned(event))}>予定通り</button>
            <button type="button" className="secondary-btn" disabled={busy} onClick={() => onRecordActual(event)}>実績を入力</button>
            <button type="button" className="secondary-btn" disabled={busy} onClick={() => setShowCancel((v) => !v)} aria-expanded={showCancel}>キャンセル</button>
            {showCancel && (
              <div className="plan-reason">
                <input type="text" placeholder="理由（任意）" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} aria-label="キャンセルの理由" />
                <button type="button" className="danger-btn" disabled={busy} onClick={() => runPlanAction(() => onCancelPlan(event, cancelReason))}>キャンセルする</button>
              </div>
            )}
            {linkedActualCount > 0 && <span className="hint">この予定に実績が {linkedActualCount} 件あります</span>}
          </div>
        )}
        {editing && occurrenceRule && <p className="hint">繰り返し予定「{occurrenceRule.title}」から作った予定です</p>}
        {refPlan && <p className="plan-ref">予定：{planLabel(refPlan)}</p>}
        <input
          className="title-input"
          type="text"
          placeholder={isRule ? "タイトル（例：仕事）" : "タイトル"}
          value={title}
          autoFocus={!editing && !isRule}
          list="title-suggestions"
          onChange={(e) => onTitleChange(e.target.value)}
          aria-label="タイトル"
        />
        <datalist id="title-suggestions">
          {suggestions.map((t) => <option key={t} value={t} />)}
        </datalist>

        {isRule ? (
          <div className="time-block">
            <div className="time-row">
              <span className="row-label">時刻</span>
              <input className="time-input" type="time" value={startTime} onChange={(e) => onStartTimeChange(e.target.value)} aria-label="開始時刻" />
              〜
              <input className="time-input" type="time" value={endTime} onChange={(e) => onEndTimeChange(e.target.value)} aria-label="終了時刻" />
              {endTime !== "" && endTime <= startTime && <span className="next-day">翌日</span>}
            </div>
            <div className="time-row">
              <span className="row-label">曜日</span>
              <div className="weekday-chips" role="group" aria-label="曜日">
                {WEEKDAY_ORDER.map((d) => (
                  <button key={d} type="button" className={weekdays.includes(d) ? "on" : ""} aria-pressed={weekdays.includes(d)} onClick={() => toggleDay(d)}>{weekdayName(d)}</button>
                ))}
              </div>
            </div>
            <div className="time-row">
              <span className="row-label">開始日</span>
              <input type="date" value={ruleStart} onChange={(e) => setRuleStart(e.target.value)} aria-label="開始日" />
            </div>
            <div className="time-row">
              <span className="row-label">終了日</span>
              <input type="date" value={ruleEnd} onChange={(e) => setRuleEnd(e.target.value)} aria-label="終了日" />
              <span className="hint">必須。この日まで予定を作ります</span>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={excludeHolidays} onChange={(e) => setExcludeHolidays(e.target.checked)} />
              祝日を除く
            </label>
          </div>
        ) : (
          <>
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
                  {holiday && <span className="holiday-tag">{holiday}</span>}
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
          </>
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

        <button type="button" className="link-btn detail-toggle" onClick={toggleDetail} aria-expanded={showDetail}>
          {showDetail ? "詳細を閉じる" : `詳細${hasDetail ? "（入力あり）" : ""}`}
        </button>
        {showDetail && (
          <div className="detail">
            <div className="detail-grid">
              <div className="detail-col">
                <NagaraChips
                  drafts={drafts}
                  onChange={setDrafts}
                  suggestions={nagaraList}
                  fixed={FIXED_NAGARA}
                  allowTime={!isRule}
                  eventStart={allDay || isRule ? joinLocal(startDate, "09:00") : start}
                  eventEnd={allDay || isRule ? joinLocal(startDate, "10:00") : end}
                />
                <div className="chip-input">
                  <label className="field-label" htmlFor="subcategory-input">細分類（任意）</label>
                  <input
                    id="subcategory-input"
                    className="title-input compact-input"
                    type="text"
                    list="subcategory-suggestions"
                    placeholder={isRule ? "例：定時" : "空欄なら新規の実績を自動分類"}
                    value={subcategory}
                    onChange={(e) => setSubcategory(e.target.value)}
                  />
                  <datalist id="subcategory-suggestions">
                    {subcategoryList.map((x) => <option key={x} value={x} />)}
                  </datalist>
                  {subcategoryList.length > 0 && (
                    <div className="quick-list">
                      {subcategoryList.filter((x) => x !== subcategory.trim()).slice(0, 5).map((x) => (
                        <button key={x} type="button" className="quick" onClick={() => setSubcategory(x)}>{x}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="detail-col">
                <ChipInput label="人" values={people} onChange={setPeople} suggestions={peopleList} placeholder="例：友人" listId="people-suggestions" />
                <ChipInput
                  label="場所（順番あり）"
                  values={places}
                  onChange={setPlaces}
                  suggestions={placeList}
                  fixed={FIXED_PLACES}
                  placeholder="例：店名"
                  reorderable
                  listId="place-suggestions"
                />
              </div>
            </div>
            <label className="field-label" htmlFor="memo-input">メモ</label>
            <textarea id="memo-input" className="memo-input" rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} />
            {!isRule && (
              <>
                <span className="field-label">種別</span>
                <div className="segmented">
                  {(["plan", "actual"] as EventKind[]).concat(kind === "unknown" ? ["unknown" as EventKind] : []).map((k) => (
                    <button key={k} type="button" className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKindChoice(k)}>
                      {KIND_LABEL[k]}
                    </button>
                  ))}
                </div>
                {autoJudged && <p className="hint">時刻から自動判定しています</p>}
              </>
            )}
          </div>
        )}

        {isPlan && currentSnapshot && (
          <div className="revisions">
            <button type="button" className="link-btn" onClick={() => setShowRevisions((v) => !v)} aria-expanded={showRevisions}>
              変更履歴({revisions.length})
            </button>
            {showRevisions && (
              revisions.length === 0 ? <p className="hint">変更の履歴はまだありません</p> : (
                <ul className="revision-list">
                  {revisions.map((r) => {
                    const diffs = diffSnapshots(r.snapshot, currentSnapshot);
                    return (
                      <li key={r.id}>
                        <span className="rev-time">{toLocal(new Date(r.changedAt)).replace("T", " ")} に変更</span>
                        <span className="rev-diff">変更前：{r.snapshot.title} {r.snapshot.allDay ? "終日" : `${r.snapshot.start.slice(5, 16).replace("T", " ")}〜${r.snapshot.end.slice(5, 16).replace("T", " ")}`}</span>
                        {diffs.length === 0 ? <span className="rev-diff">現在と同じ内容です</span> : diffs.map((d) => (
                          <span className="rev-diff" key={d.field}>・{d.label}：{d.before} → {d.after}</span>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              )
            )}
          </div>
        )}

        {error && <p className="notice error" role="alert">{error}</p>}
        {saveError && <p className="notice error" role="alert">{saveError}</p>}

        {askScope ? (
          <div className="scope-choice" role="group" aria-label="繰り返し予定の変更範囲">
            <p className="scope-title">繰り返し予定の変更をどこまで反映しますか？</p>
            <div className="inline-actions">
              <button type="button" className="secondary-btn" disabled={busy} onClick={() => saveWithScope("single")}>この予定だけ</button>
              <button type="button" className="primary-btn" disabled={busy || followingBlockedReason !== null} onClick={() => saveWithScope("following")}>この日以降</button>
              <button type="button" className="text-btn" disabled={busy} onClick={() => setAskScope(null)}>戻る</button>
            </div>
            <p className="hint">
              {followingBlockedReason ?? "この日以降：この予定と、今日以降の未編集の予定を同じ内容にします。個別に変えた・キャンセルした・実績がある予定はそのままです。"}
            </p>
          </div>
        ) : (
          <div className="sheet-actions">
            {editing && <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>削除</button>}
            <span className="spacer" />
            <button type="button" className="primary-btn" onClick={handleSave} disabled={!!error || busy}>保存</button>
          </div>
        )}
        </div>
        )}

        {mode !== "edit" && mode !== "rule" && (
          <div className="pane" hidden={tab !== "session"}>
            <SessionForm session={session} range={range} labelSuggestions={sessionLabelList} onSave={onSaveSession} onDelete={onDeleteSession} />
          </div>
        )}
      </div>
    </div>
  );
}
