import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HOUR_HEIGHT, LANE_WIDTH, WEEK_HOUR_HEIGHT, defaultSettings } from "./constants";
import {
  addDays, addMonths, dateKeyOf, formatDayLabel, weekendClass, formatMonthLabel, formatWeekRangeLabel, startOfMonth, startOfWeek, toLocal, weekDayKeys,
} from "./dateUtils";
import { displayTitle, rangeForPlusButton, rangeFromTap, type Range } from "./eventLogic";
import { allDayEventsOn } from "./layout";
import {
  applyCancel, applyUncancel, buildAsPlanned, buildRevision, isUnconfirmed, layoutDayWithPlans, linkedPlanIds, revisionsOfPlan,
  shouldRecordRevision, unlinkActuals,
} from "./planLogic";
import {
  LARGE_GENERATION_THRESHOLD, generateMissing, newRuleDefaults, normalizeRule, reconcileRule, removableFutureOccurrences, ruleContentFromEvent,
  splitRuleFrom, withRemovedDate,
} from "./recurrence";
import { holidayName } from "./holidays";
import { buildNagaraSave, layoutSessions, nagaraIdsOfEvent, nagaraLabelMap, sessionSegmentsForDay, type NagaraDraft } from "./nagaraLogic";
import {
  commitChanges, deleteNagara, getAllEvents, getAllNagara, getAllRecurrences, getAllRevisions, getSettings, newId, putNagara,
  requestPersistentStorage, restoreAll, saveSettings, type Changes,
} from "./storage";
import EventModal, { type EditScope, type ModalTab } from "./EventModal";
import EventBlock, { eventStyle } from "./EventBlock";
import MonthView from "./MonthView";
import ReviewView from "./ReviewView";
import type { PeriodKind } from "./reviewLogic";
import SettingsView from "./SettingsView";
import WeekView from "./WeekView";
import { mergeById, settingsForRestore } from "./backup";
import type { BackupFile, CalendarEvent, Nagara, PlanRevision, RecurrenceRule, Settings } from "./types";

type ViewMode = "day" | "week" | "month";
type ModalState =
  | { mode: "new"; range: Range; tab: ModalTab; template?: CalendarEvent }
  | { mode: "edit"; event: CalendarEvent }
  | { mode: "session"; session: Nagara }
  | { mode: "rule"; rule: RecurrenceRule }
  | null;

const VIEW_LABEL: Record<ViewMode, string> = { day: "日", week: "週", month: "月" };

export default function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [nagara, setNagara] = useState<Nagara[]>([]);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);
  const [recurrences, setRecurrences] = useState<RecurrenceRule[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [dayKey, setDayKey] = useState(() => dateKeyOf(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [ruleMessage, setRuleMessage] = useState("");
  const [view, setView] = useState<"calendar" | "settings" | "review">("calendar");
  const [reviewKind, setReviewKind] = useState<PeriodKind>("week");
  const [reviewAnchor, setReviewAnchor] = useState(() => dateKeyOf(new Date()));
  const [modal, setModal] = useState<ModalState>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const recurrenceDone = useRef(false);
  /** 読み込み時に旧形式から補った（保存し直す）ルール */
  const migratedRuleIds = useRef<Set<string>>(new Set());
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const nowLocal = toLocal(now);
  const todayKey = dateKeyOf(now);
  const weekStartDay = settings.weekStartDay;

  useEffect(() => {
    requestPersistentStorage();
    Promise.all([getAllEvents(), getAllNagara(), getAllRevisions(), getAllRecurrences(), getSettings()])
      .then(([evs, ng, revs, recs, st]) => {
        setEvents(evs);
        setNagara(ng);
        setRevisions(revs);
        // 旧版のルールは既定値を補い、墓標（本人が消した日）を導出する
        const normalized = recs.map((r) => normalizeRule(r as unknown as Record<string, unknown>, evs));
        migratedRuleIds.current = new Set(normalized.filter((n) => n.migrated).map((n) => n.rule.id));
        setRecurrences(normalized.map((n) => n.rule));
        setSettings(st);
        setViewMode(st.startView);
        setLoaded(true);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "データを読み込めませんでした"));
  }, []);

  // 起動時に、有効な繰り返しルールの足りない予定を終了日まで作る（1回だけ）。旧形式のルールはここで保存し直す
  useEffect(() => {
    if (!loaded || recurrenceDone.current) return;
    recurrenceDone.current = true;
    const gen = generateMissing(recurrences, events, nagara, dateKeyOf(new Date()), new Date().toISOString(), newId);
    const changedIds = new Set(gen.putRules.map((r) => r.id));
    const putRecurrences = [...gen.putRules, ...recurrences.filter((r) => !changedIds.has(r.id) && migratedRuleIds.current.has(r.id))];
    if (putRecurrences.length === 0 && gen.putEvents.length === 0) return;
    const changes: Changes = {
      putEvents: gen.putEvents, deleteEventIds: gen.deleteEventIds, putNagara: gen.putNagara, deleteNagaraIds: gen.deleteNagaraIds, putRecurrences,
    };
    commitChanges(changes).then(() => applyChanges(changes)).catch(() => { recurrenceDone.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // 現在時刻（赤線）を更新。画面に戻ったときも更新
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, 30000);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const weekKeys = useMemo(() => weekDayKeys(dayKey, weekStartDay), [dayKey, weekStartDay]);
  const isCurrent =
    viewMode === "day" ? dayKey === todayKey
    : viewMode === "week" ? startOfWeek(dayKey, weekStartDay) === startOfWeek(todayKey, weekStartDay)
    : startOfMonth(dayKey) === startOfMonth(todayKey);

  // 表示・日を変えたとき・読み込み完了時・設定から戻ったときに自動スクロール（今日を含む＝現在時刻付近、他＝7:00付近）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !loaded || view !== "calendar" || viewMode === "month") return;
    const today = dateKeyOf(new Date());
    const includesToday = viewMode === "day" ? dayKey === today : weekKeys.includes(today);
    if (includesToday) {
      const n = new Date();
      const hourHeight = viewMode === "week" ? WEEK_HOUR_HEIGHT : HOUR_HEIGHT;
      const y = ((n.getHours() * 60 + n.getMinutes()) / 60) * hourHeight;
      el.scrollTop = Math.max(0, y - el.clientHeight * 0.4);
    } else {
      el.scrollTop = 7 * (viewMode === "week" ? WEEK_HOUR_HEIGHT : HOUR_HEIGHT);
    }
  }, [dayKey, loaded, view, viewMode, weekKeys]);

  const linked = useMemo(() => linkedPlanIds(events), [events]);
  const dayLayout = useMemo(() => layoutDayWithPlans(events, dayKey, linked), [events, dayKey, linked]);
  const allDayEvents = useMemo(() => allDayEventsOn(events, dayKey), [events, dayKey]);
  const sessionSegs = useMemo(() => layoutSessions(sessionSegmentsForDay(nagara, dayKey)), [nagara, dayKey]);
  const labelsByEvent = useMemo(() => nagaraLabelMap(nagara), [nagara]);

  const openNew = useCallback((range: Range, tab: ModalTab = "event") => setModal({ mode: "new", range, tab }), []);

  const onPlus = () => openNew(rangeForPlusButton(events, dayKey, toLocal(new Date())));

  const minutesAt = (ev: React.MouseEvent<HTMLDivElement>, el: HTMLDivElement | null) => {
    const rect = el?.getBoundingClientRect();
    if (!rect) return null;
    return Math.max(0, Math.min(1439, ((ev.clientY - rect.top) / HOUR_HEIGHT) * 60));
  };

  const onAreaClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const minutes = minutesAt(ev, areaRef.current);
    if (minutes !== null) openNew(rangeFromTap(dayKey, minutes));
  };

  /** レーンの空き部分をタップ：その時間でセッションの新規入力を開く */
  const onLaneClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const minutes = minutesAt(ev, laneRef.current);
    if (minutes !== null) openNew(rangeFromTap(dayKey, minutes), "session");
  };

  /** 保存した変更を画面の状態へ反映する */
  const applyChanges = (c: Changes) => {
    const delE = new Set(c.deleteEventIds ?? []);
    const putE = c.putEvents ?? [];
    const putEIds = new Set(putE.map((p) => p.id));
    setEvents((prev) => [...prev.filter((e) => !delE.has(e.id) && !putEIds.has(e.id)), ...putE]);
    const delN = new Set(c.deleteNagaraIds ?? []);
    const putN = c.putNagara ?? [];
    if (delN.size > 0 || putN.length > 0) setNagara((prev) => [...prev.filter((n) => !delN.has(n.id) && !putN.some((p) => p.id === n.id)), ...putN]);
    const delR = new Set(c.deleteRevisionIds ?? []);
    const putR = c.putRevisions ?? [];
    if (delR.size > 0 || putR.length > 0) setRevisions((prev) => [...prev.filter((r) => !delR.has(r.id) && !putR.some((p) => p.id === r.id)), ...putR]);
    const putC = c.putRecurrences ?? [];
    const delC = new Set(c.deleteRecurrenceIds ?? []);
    if (putC.length > 0 || delC.size > 0) setRecurrences((prev) => [...prev.filter((r) => !delC.has(r.id) && !putC.some((p) => p.id === r.id)), ...putC]);
  };

  const commit = async (c: Changes) => {
    await commitChanges(c);
    applyChanges(c);
  };

  const handleSave = async (event: CalendarEvent, drafts: NagaraDraft[], scope: EditScope) => {
    const stamp = new Date().toISOString();
    const { put, deleteIds } = buildNagaraSave(event.id, drafts, nagara, stamp, newId);
    const before = events.find((e) => e.id === event.id);
    // 予定の内容が変わったら、変更前の状態を履歴に残す
    const putRevisions = before && shouldRecordRevision(before, event) ? [buildRevision(before, stamp, newId)] : [];
    const rule = scope === "following" ? recurrences.find((r) => r.id === event.recurrenceId) : undefined;
    if (rule && event.recurrenceDate) {
      // この日以降：ルールを分割し、押した予定はルールに沿った予定として保存する
      const content = ruleContentFromEvent(event, drafts.filter((d) => d.start === null).map((d) => d.label));
      const split = splitRuleFrom(rule, event.recurrenceDate, content, event, events, nagara, dateKeyOf(new Date()), stamp, newId);
      const saved: CalendarEvent = { ...event, recurrenceId: split.ruleId, createdAt: stamp, updatedAt: stamp };
      await commit({
        putEvents: [...split.putEvents, saved], deleteEventIds: split.deleteEventIds,
        putNagara: [...split.putNagara, ...put], deleteNagaraIds: [...split.deleteNagaraIds, ...deleteIds],
        putRevisions, putRecurrences: split.putRules,
      });
      setModal(null);
      return;
    }
    await commit({ putEvents: [event], putNagara: put, deleteNagaraIds: deleteIds, putRevisions });
    setModal(null);
  };

  /** イベント削除：付随するながら・変更履歴も削除し、この予定を指していた実績の planId を外す */
  const handleDelete = async (id: string) => {
    const stamp = new Date().toISOString();
    const target = events.find((e) => e.id === id);
    const rule = target?.recurrenceId ? recurrences.find((r) => r.id === target.recurrenceId) : undefined;
    await commit({
      // 繰り返しの予定を手で消した日は墓標にして、作り直さない
      putRecurrences: rule && target?.recurrenceDate ? [withRemovedDate(rule, target.recurrenceDate)] : [],
      deleteEventIds: [id],
      deleteNagaraIds: nagaraIdsOfEvent(nagara, id),
      deleteRevisionIds: revisions.filter((r) => r.planId === id).map((r) => r.id),
      putEvents: unlinkActuals(events, id, stamp),
    });
    setModal(null);
  };

  /** 予定通り：同じ内容の実績（ながらも複製）を作ってリンクする */
  const handleAsPlanned = async (plan: CalendarEvent) => {
    const { event, nagara: copies } = buildAsPlanned(plan, nagara, new Date().toISOString(), newId);
    await commit({ putEvents: [event], putNagara: copies });
    setModal(null);
  };

  /** キャンセル・取り消し：変更前の状態を履歴に残す */
  const handleCancelPlan = async (plan: CalendarEvent, reason: string) => {
    const stamp = new Date().toISOString();
    await commit({ putEvents: [applyCancel(plan, reason, stamp)], putRevisions: [buildRevision(plan, stamp, newId)] });
    setModal(null);
  };

  const handleUncancelPlan = async (plan: CalendarEvent) => {
    const stamp = new Date().toISOString();
    await commit({ putEvents: [applyUncancel(plan, stamp)], putRevisions: [buildRevision(plan, stamp, newId)] });
    setModal(null);
  };

  /** 繰り返しルールの保存（追加・編集・再開）。今日以降の未保護の予定へ反映し、終了日まで作る */
  const handleSaveRule = async (rule: RecurrenceRule) => {
    const c = reconcileRule(rule, events, nagara, dateKeyOf(new Date()), new Date().toISOString(), newId);
    if (c.created > LARGE_GENERATION_THRESHOLD && !window.confirm(`${c.created}件の予定を作ります。よろしいですか？`)) return;
    await commit({ putRecurrences: c.putRules, putEvents: c.putEvents, deleteEventIds: c.deleteEventIds, putNagara: c.putNagara, deleteNagaraIds: c.deleteNagaraIds });
    setRuleMessage(`保存しました（新しく${c.created}件、更新${c.putEvents.length - c.created}件、削除${c.deleteEventIds.length}件）`);
    setModal(null);
  };

  /** 停止・再開。停止は新規生成だけを止め、すでに作った予定は残す */
  const handleToggleRule = async (rule: RecurrenceRule) => {
    if (rule.active) {
      await commit({ putRecurrences: [{ ...rule, active: false }] });
      setRuleMessage("停止しました（作成済みの予定はそのままです）");
      return;
    }
    await handleSaveRule({ ...rule, active: true });
  };

  const handleDeleteRecurrence = async (rule: RecurrenceRule, deleteFuture: boolean) => {
    const deleteEventIds = deleteFuture ? removableFutureOccurrences(rule.id, events, dateKeyOf(new Date())) : [];
    const ids = new Set(deleteEventIds);
    await commit({ deleteRecurrenceIds: [rule.id], deleteEventIds, deleteNagaraIds: nagara.filter((n) => n.eventId !== null && ids.has(n.eventId)).map((n) => n.id) });
    setRuleMessage(deleteFuture ? "ルールと未来の未編集予定を削除しました" : "ルールだけ削除しました");
  };

  /** Googleカレンダーの取り込み：新規・更新を1トランザクションでまとめて保存する */
  const handleImportGoogle = async (create: CalendarEvent[], update: CalendarEvent[]) => {
    await commit({ putEvents: [...create, ...update] });
  };

  const handleSaveSession = async (n: Nagara) => {
    await putNagara(n);
    setNagara((prev) => [...prev.filter((x) => x.id !== n.id), n]);
    setModal(null);
  };

  const handleDeleteSession = async (id: string) => {
    await deleteNagara(id);
    setNagara((prev) => prev.filter((n) => n.id !== id));
    setModal(null);
  };

  const handleSaveSettings = async (next: Settings) => {
    await saveSettings(next);
    setSettings(next);
  };

  const handleRestore = async (backup: BackupFile, sourceVersion: 1 | 2) => {
    const nextSettings = settingsForRestore(backup, sourceVersion, settings);
    await restoreAll({ events: backup.events, nagara: backup.nagara, revisions: backup.revisions, recurrences: backup.recurrences, settings: nextSettings });
    setEvents((prev) => mergeById(prev, backup.events));
    setNagara((prev) => mergeById(prev, backup.nagara));
    setRevisions((prev) => mergeById(prev, backup.revisions));
    setRecurrences((prev) => mergeById(prev, backup.recurrences));
    setSettings(nextSettings);
  };

  const step = (dir: 1 | -1) => {
    setDayKey(viewMode === "day" ? addDays(dayKey, dir) : viewMode === "week" ? addDays(dayKey, 7 * dir) : addMonths(dayKey, dir));
  };

  const onTouchStart = (ev: React.TouchEvent) => {
    const t = ev.touches[0];
    if (t) touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (ev: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t = ev.changedTouches[0];
    if (!start || !t || modal !== null) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    step(dx < 0 ? 1 : -1);
  };

  const openDay = (key: string) => {
    setDayKey(key);
    setViewMode("day");
  };

  if (loadError) {
    return (
      <div className="app">
        <p className="notice error">データを読み込めませんでした：{loadError}</p>
      </div>
    );
  }

  const modalEl = modal && (
      <EventModal
        key={modal.mode === "edit" ? modal.event.id : modal.mode === "session" ? modal.session.id : modal.mode === "rule" ? `rule-${modal.rule.id}` : `new-${modal.range.start}-${modal.template?.id ?? ""}`}
        mode={modal.mode}
        rule={modal.mode === "rule" ? modal.rule : null}
        occurrenceRule={modal.mode === "edit" && modal.event.recurrenceId ? recurrences.find((r) => r.id === modal.event.recurrenceId) ?? null : null}
        onSaveRule={handleSaveRule}
        event={modal.mode === "edit" ? modal.event : null}
        session={modal.mode === "session" ? modal.session : null}
        range={modal.mode === "new" ? modal.range : null}
        initialTab={modal.mode === "new" ? modal.tab : "event"}
        template={modal.mode === "new" ? modal.template ?? null : null}
        revisions={modal.mode === "edit" ? revisionsOfPlan(revisions, modal.event.id) : []}
        linkedActualCount={modal.mode === "edit" ? events.filter((e) => e.planId === modal.event.id).length : 0}
        planOfActual={modal.mode === "edit" && modal.event.planId ? events.find((e) => e.id === modal.event.planId) ?? null : null}
        events={events}
        nagara={nagara}
        settings={settings}
        now={nowLocal}
        onSave={handleSave}
        onDelete={handleDelete}
        onAsPlanned={handleAsPlanned}
        onCancelPlan={handleCancelPlan}
        onUncancelPlan={handleUncancelPlan}
        onRecordActual={(plan) => setModal({ mode: "new", range: { start: plan.start, end: plan.end }, tab: "event", template: plan })}
        onSaveSession={handleSaveSession}
        onDeleteSession={handleDeleteSession}
        onClose={() => setModal(null)}
      />
  );

  if (view === "review") {
    return (
      <div className="app">
        <ReviewView
          events={events}
          nagara={nagara}
          settings={settings}
          nowLocal={nowLocal}
          kind={reviewKind}
          anchor={reviewAnchor}
          onChange={(k, a) => { setReviewKind(k); setReviewAnchor(a); }}
          onBack={() => setView("calendar")}
          onOpenEvent={(e) => setModal({ mode: "edit", event: e })}
        />
        {modalEl}
      </div>
    );
  }

  if (view === "settings") {
    return (
      <div className="app">
        <SettingsView
          settings={settings}
          events={events}
          nagara={nagara}
          revisions={revisions}
          recurrences={recurrences}
          ruleMessage={ruleMessage}
          onBack={() => { setRuleMessage(""); setView("calendar"); }}
          onSaveSettings={handleSaveSettings}
          onAddRule={() => { setRuleMessage(""); setModal({ mode: "rule", rule: newRuleDefaults(newId(), dateKeyOf(new Date())) }); }}
          onEditRule={(rule) => { setRuleMessage(""); setModal({ mode: "rule", rule }); }}
          onToggleRule={handleToggleRule}
          onDeleteRecurrence={handleDeleteRecurrence}
          onRestore={handleRestore}
          onImportGoogle={handleImportGoogle}
        />
        {modalEl}
      </div>
    );
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayHoliday = viewMode === "day" ? holidayName(dayKey) : null;
  const headLabel = viewMode === "day" ? formatDayLabel(dayKey) : viewMode === "week" ? formatWeekRangeLabel(dayKey, weekStartDay) : formatMonthLabel(dayKey);
  const stepName = VIEW_LABEL[viewMode];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="icon-btn" aria-label={`前の${stepName}`} onClick={() => step(-1)}>◀</button>
          <label className="date-jump" title="日付を選ぶ">
            <span className={`date-label ${viewMode === "week" ? "small" : ""} ${viewMode === "day" ? weekendClass(dayKey) : ""} ${dayHoliday ? "holiday" : ""}`}>{headLabel}{dayHoliday && <small className="date-holiday">{dayHoliday}</small>}</span>
            <input
              type="date"
              value={dayKey}
              aria-label="日付ジャンプ"
              onChange={(e) => { if (e.target.value) setDayKey(e.target.value); }}
            />
          </label>
          <button type="button" className="icon-btn" aria-label={`次の${stepName}`} onClick={() => step(1)}>▶</button>
          <span className="spacer" />
          <button type="button" className="text-btn" onClick={() => setDayKey(todayKey)} disabled={isCurrent}>今日</button>
          <button type="button" className="icon-btn" aria-label="振り返り" onClick={() => { setReviewAnchor(dayKey); setView("review"); }}>📊</button>
          <button type="button" className="icon-btn" aria-label="設定" onClick={() => setView("settings")}>⚙</button>
        </div>
        <div className="view-switch">
          <div className="segmented" role="group" aria-label="表示の切り替え">
            {(["day", "week", "month"] as ViewMode[]).map((m) => (
              <button key={m} type="button" className={viewMode === m ? "on" : ""} aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>
                {VIEW_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="calendar-swipe-area" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {viewMode === "day" && allDayEvents.length > 0 && (
        <div className="allday">
          <span className="allday-label">終日</span>
          <div className="allday-list">
            {allDayEvents.map((e) => (
              <button key={e.id} type="button" className={`allday-chip ${e.kind === "plan" ? "plan" : ""}`} style={eventStyle(e)} onClick={() => setModal({ mode: "edit", event: e })}>
                {displayTitle(e)}
              </button>
            ))}
          </div>
        </div>
      )}

      {viewMode === "day" && (
        <div className="scroll" ref={scrollRef}>
          <div className="timeline" style={{ height: HOUR_HEIGHT * 24 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="hour-label" style={{ top: h * HOUR_HEIGHT }}>{h}:00</span>
            ))}
            <div
              className="events-area"
              ref={areaRef}
              onClick={onAreaClick}
              style={{ backgroundSize: `100% ${HOUR_HEIGHT}px`, right: LANE_WIDTH }}
            >
              {dayLayout.back.map(({ seg, variant }) => (
                <EventBlock
                  key={`${seg.event.id}-${dayKey}`}
                  seg={{ ...seg, col: 0, cols: 1 }}
                  dayKey={dayKey}
                  variant={variant}
                  nagaraLabels={[]}
                  onOpen={() => setModal({ mode: "edit", event: seg.event })}
                />
              ))}
              {dayLayout.front.map((seg) => (
                <EventBlock
                  key={`${seg.event.id}-${dayKey}`}
                  seg={seg}
                  dayKey={dayKey}
                  unconfirmed={isUnconfirmed(seg.event, linked, nowLocal)}
                  nagaraLabels={labelsByEvent.get(seg.event.id) ?? []}
                  onOpen={() => setModal({ mode: "edit", event: seg.event })}
                />
              ))}
              {dayKey === todayKey && <div className="now-line" style={{ top: (nowMin / 60) * HOUR_HEIGHT }}><i /></div>}
            </div>
            <div
              className="lane"
              ref={laneRef}
              onClick={onLaneClick}
              aria-label="ながら・場所セッションのレーン"
              style={{ width: LANE_WIDTH, backgroundSize: `100% ${HOUR_HEIGHT}px` }}
            >
              {sessionSegs.map((s) => {
                const n = s.nagara;
                const top = (s.startMin / 60) * HOUR_HEIGHT;
                const height = Math.max(((s.endMin - s.startMin) / 60) * HOUR_HEIGHT - 1, 14);
                return (
                  <button
                    key={`${n.id}-${dayKey}`}
                    type="button"
                    className={`session ${n.type}`}
                    style={{ top, height, left: `${(s.col / s.cols) * 100}%`, width: `calc(${100 / s.cols}% - 1px)` }}
                    title={`${n.type === "place" ? "場所" : "ながら"}：${n.label}`}
                    onClick={(ev) => { ev.stopPropagation(); setModal({ mode: "session", session: n }); }}
                  >
                    <span>{n.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {viewMode === "week" && (
        <WeekView
          dayKeys={weekKeys}
          events={events}
          labelsByEvent={labelsByEvent}
          linked={linked}
          nowLocal={nowLocal}
          todayKey={todayKey}
          nowMin={nowMin}
          scrollRef={scrollRef}
          onOpenEvent={(e) => setModal({ mode: "edit", event: e })}
          onCreate={(range) => openNew(range)}
          onOpenDay={openDay}
        />
      )}

      {viewMode === "month" && (
        <MonthView anchor={dayKey} weekStartDay={weekStartDay} events={events} linked={linked} todayKey={todayKey} onOpenDay={openDay} />
      )}
      </div>

      <button type="button" className="fab" aria-label="予定・実績を追加" onClick={onPlus}>＋</button>

      {modalEl}
    </div>
  );
}
