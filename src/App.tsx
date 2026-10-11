import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { COLOR_KEYS, FIXED_MARKERS, FIXED_NAGARA, FOUR_DAY_HOUR_HEIGHT, HOUR_HEIGHT, LANE_WIDTH, WEEK_HOUR_HEIGHT, defaultSettings } from "./constants";
import {
  addDays, addMinutes, addMonths, dateKeyOf, diffMinutes, formatDayLabel, formatMonthLabel, formatRangeLabel, formatWeekRangeLabel, fourDayKeys,
  startOfMonth, startOfWeek, timePart, toLocal, weekDayKeys, weekendClass,
} from "./dateUtils";
import { displayTitle, rangeForPlusButton, rangeFromTap, type Range } from "./eventLogic";
import { allDayEventsOn } from "./layout";
import { markerCandidates, markersForDay } from "./markerLogic";
import { eventDefaults } from "./migrate";
import {
  applyCancel, applyUncancel, buildAsPlanned, buildRevision, isUnconfirmed, layoutDayWithPlans, linkedPlanIds, revisionsOfPlan,
  shouldRecordRevision, unlinkActuals,
} from "./planLogic";
import {
  LARGE_GENERATION_THRESHOLD, generateMissing, newRuleDefaults, normalizeRule, reconcileRule, removableFutureOccurrences, ruleContentFromEvent,
  splitRuleFrom, withRemovedDate,
} from "./recurrence";
import { holidayName } from "./holidays";
import {
  buildNagaraSave, isSession, layoutSessions, nagaraIdsOfEvent, nagaraLabelMap, nagaraLabelSuggestions, ongoingSessions, sessionLabelsOverlapping,
  sessionSegmentsForDay, type NagaraDraft,
} from "./nagaraLogic";
import {
  commitChanges, deleteMarker, deleteNagara, getActiveSleep, getAllEvents, getAllMarkers, getAllNagara, getAllRecurrences, getAllRevisions, getSettings,
  newId, putMarker, putNagara, requestPersistentStorage, restoreAll, saveActiveSleep, saveSettings, type Changes,
} from "./storage";
import EventModal, { type EditScope, type ModalTab } from "./EventModal";
import EventBlock, { eventStyle } from "./EventBlock";
import EventViewer from "./EventViewer";
import MarkerPins from "./MarkerPins";
import MarkerSheet from "./MarkerSheet";
import MonthView from "./MonthView";
import QuickPanel from "./QuickPanel";
import ReviewView from "./ReviewView";
import type { PeriodKind } from "./reviewLogic";
import RunningBand from "./RunningBand";
import SearchView from "./SearchView";
import type { SearchQuery } from "./searchLogic";
import SettingsView from "./SettingsView";
import WeekView from "./WeekView";
import { mergeById, settingsForRestore } from "./backup";
import type { ActiveSleep, BackupFile, CalendarEvent, ColorId, Marker, Nagara, PlanRevision, RecurrenceRule, Settings } from "./types";

type ViewMode = "day" | "fourDay" | "week" | "month";
type ModalState =
  | { mode: "new"; range: Range; tab: ModalTab; template?: CalendarEvent; ongoing?: boolean }
  | { mode: "edit"; event: CalendarEvent }
  | { mode: "view"; event: CalendarEvent }
  | { mode: "session"; session: Nagara }
  | { mode: "marker"; marker: Marker }
  | { mode: "rule"; rule: RecurrenceRule }
  | null;

interface Toast {
  id: number;
  text: string;
  actions: Array<{ label: string; run: () => void }>;
}

const VIEW_MODES: ViewMode[] = ["day", "fourDay", "week", "month"];
const VIEW_LABEL: Record<ViewMode, string> = { day: "日", fourDay: "4日", week: "週", month: "月" };
const VIEW_HOUR_HEIGHT: Record<ViewMode, number> = { day: HOUR_HEIGHT, fourDay: FOUR_DAY_HOUR_HEIGHT, week: WEEK_HOUR_HEIGHT, month: HOUR_HEIGHT };
const TOAST_MS = 9000;
const EMPTY_QUERY: SearchQuery = { text: "", field: "all", from: "", to: "", kind: "all" };

/** 睡眠の記録に使う色：親カテゴリが「睡眠」の色（無ければ色1） */
function sleepColorId(settings: Settings): ColorId {
  const key = COLOR_KEYS.find((k) => settings.categoryParents[k] === "睡眠") ?? "1";
  return key === "default" ? null : key;
}

export default function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [nagara, setNagara] = useState<Nagara[]>([]);
  const [revisions, setRevisions] = useState<PlanRevision[]>([]);
  const [recurrences, setRecurrences] = useState<RecurrenceRule[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [activeSleep, setActiveSleep] = useState<ActiveSleep | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [dayKey, setDayKey] = useState(() => dateKeyOf(new Date()));
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [ruleMessage, setRuleMessage] = useState("");
  const [view, setView] = useState<"calendar" | "settings" | "review" | "search">("calendar");
  const [reviewKind, setReviewKind] = useState<PeriodKind>("week");
  const [reviewAnchor, setReviewAnchor] = useState(() => dateKeyOf(new Date()));
  const [searchQuery, setSearchQuery] = useState<SearchQuery>(EMPTY_QUERY);
  const [modal, setModal] = useState<ModalState>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const recurrenceDone = useRef(false);
  /** 読み込み時に旧形式から補った（保存し直す）ルール */
  const migratedRuleIds = useRef<Set<string>>(new Set());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const toastSeq = useRef(0);

  const nowLocal = toLocal(now);
  const todayKey = dateKeyOf(now);
  const weekStartDay = settings.weekStartDay;

  useEffect(() => {
    requestPersistentStorage();
    Promise.all([getAllEvents(), getAllNagara(), getAllRevisions(), getAllRecurrences(), getSettings(), getAllMarkers(), getActiveSleep()])
      .then(([evs, ng, revs, recs, st, mks, sleep]) => {
        setEvents(evs);
        setNagara(ng);
        setRevisions(revs);
        // 旧版のルールは既定値を補い、墓標（本人が消した日）を導出する
        const normalized = recs.map((r) => normalizeRule(r as unknown as Record<string, unknown>, evs));
        migratedRuleIds.current = new Set(normalized.filter((n) => n.migrated).map((n) => n.rule.id));
        setRecurrences(normalized.map((n) => n.rule));
        setMarkers(mks);
        setActiveSleep(sleep);
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

  // 現在時刻（赤線・継続中の経過時間）を更新。画面に戻ったときも更新
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

  // 保存後の「取り消す・時刻を直す」は、しばらくしたら自動で消す
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((t) => (t && t.id === toast.id ? null : t)), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = (text: string, actions: Toast["actions"] = []) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, actions });
  };

  const weekKeys = useMemo(() => weekDayKeys(dayKey, weekStartDay), [dayKey, weekStartDay]);
  const fourKeys = useMemo(() => fourDayKeys(dayKey), [dayKey]);
  const isCurrent =
    viewMode === "day" || viewMode === "fourDay" ? dayKey === todayKey
    : viewMode === "week" ? startOfWeek(dayKey, weekStartDay) === startOfWeek(todayKey, weekStartDay)
    : startOfMonth(dayKey) === startOfMonth(todayKey);

  // 表示・日を変えたとき・読み込み完了時・設定から戻ったときに自動スクロール（今日を含む＝現在時刻付近、他＝7:00付近）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !loaded || view !== "calendar" || viewMode === "month") return;
    const today = dateKeyOf(new Date());
    const includesToday = viewMode === "day" ? dayKey === today : viewMode === "fourDay" ? fourKeys.includes(today) : weekKeys.includes(today);
    const hourHeight = VIEW_HOUR_HEIGHT[viewMode];
    if (includesToday) {
      const n = new Date();
      const y = ((n.getHours() * 60 + n.getMinutes()) / 60) * hourHeight;
      el.scrollTop = Math.max(0, y - el.clientHeight * 0.4);
    } else {
      el.scrollTop = 7 * hourHeight;
    }
  }, [dayKey, loaded, view, viewMode, weekKeys, fourKeys]);

  const linked = useMemo(() => linkedPlanIds(events), [events]);
  const dayLayout = useMemo(() => layoutDayWithPlans(events, dayKey, linked), [events, dayKey, linked]);
  const allDayEvents = useMemo(() => allDayEventsOn(events, dayKey), [events, dayKey]);
  const sessionSegs = useMemo(() => layoutSessions(sessionSegmentsForDay(nagara, dayKey, nowLocal)), [nagara, dayKey, nowLocal]);
  const dayMarkers = useMemo(() => markersForDay(markers, dayKey), [markers, dayKey]);
  const labelsByEvent = useMemo(() => nagaraLabelMap(nagara), [nagara]);
  const running = useMemo(() => ongoingSessions(nagara), [nagara]);
  const markerLabels = useMemo(() => markerCandidates(FIXED_MARKERS, markers), [markers]);
  const sessionLabels = useMemo(() => {
    const busy = new Set(running.map((n) => n.label));
    const recent = nagaraLabelSuggestions(nagara.filter(isSession), "nagara", 4);
    return [...new Set([...FIXED_NAGARA, ...recent])].filter((l) => !busy.has(l));
  }, [nagara, running]);

  const openNew = useCallback((range: Range, tab: ModalTab = "event", ongoing = false) => setModal({ mode: "new", range, tab, ongoing }), []);

  /** 実績・種別不明はまず閲覧モード、予定は従来どおり操作つきの編集シート */
  const openEvent = useCallback((e: CalendarEvent) => setModal(e.kind === "plan" ? { mode: "edit", event: e } : { mode: "view", event: e }), []);

  // ＋ボタン：今日を見ているときにセッションへ切り替えたら、終了を入れない「継続中」から始める
  const onPlus = () => openNew(rangeForPlusButton(events, dayKey, toLocal(new Date())), "event", dayKey === todayKey);

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

  const storeSession = async (n: Nagara) => {
    await putNagara(n);
    setNagara((prev) => [...prev.filter((x) => x.id !== n.id), n]);
  };

  const removeSession = async (id: string) => {
    await deleteNagara(id);
    setNagara((prev) => prev.filter((n) => n.id !== id));
  };

  const handleSaveSession = async (n: Nagara) => {
    await storeSession(n);
    setModal(null);
  };

  const handleDeleteSession = async (id: string) => {
    await removeSession(id);
    setModal(null);
  };

  const reportError = (e: unknown) => showToast(e instanceof Error ? `保存できませんでした：${e.message}` : "保存できませんでした");

  /** ながらを始める：終了を入れない「継続中」のセッションを、いまの時刻で作る */
  const startSession = async (label: string) => {
    setQuickOpen(false);
    const stamp = new Date().toISOString();
    const n: Nagara = { id: newId(), label, type: "nagara", eventId: null, start: toLocal(new Date()), end: null, createdAt: stamp, updatedAt: stamp };
    try {
      await storeSession(n);
      showToast(`「${label}」を ${timePart(n.start as string)} から記録中`, [
        { label: "取り消す", run: () => { void removeSession(n.id).catch(reportError); setToast(null); } },
        { label: "時刻を直す", run: () => { setModal({ mode: "session", session: n }); setToast(null); } },
      ]);
    } catch (e) {
      reportError(e);
    }
  };

  /** 今で終了：継続中のセッションに、いまの時刻を終了として入れる（あとから直せる） */
  const endSession = async (n: Nagara) => {
    const current = toLocal(new Date());
    const start = n.start as string;
    const ended: Nagara = { ...n, end: current > start ? current : addMinutes(start, 1), updatedAt: new Date().toISOString() };
    try {
      await storeSession(ended);
      showToast(`「${n.label}」を ${timePart(ended.end as string)} で終了`, [
        { label: "元に戻す", run: () => { void storeSession(n).catch(reportError); setToast(null); } },
        { label: "時刻を直す", run: () => { setModal({ mode: "session", session: ended }); setToast(null); } },
      ]);
    } catch (e) {
      reportError(e);
    }
  };

  const storeMarker = async (m: Marker) => {
    await putMarker(m);
    setMarkers((prev) => [...prev.filter((x) => x.id !== m.id), m]);
  };

  const removeMarker = async (id: string) => {
    await deleteMarker(id);
    setMarkers((prev) => prev.filter((m) => m.id !== id));
  };

  /** マーカー：入力シートを開かず、いまの時刻でそのまま保存する */
  const addMarker = async (label: string) => {
    setQuickOpen(false);
    const stamp = new Date().toISOString();
    const m: Marker = { id: newId(), label, at: toLocal(new Date()), createdAt: stamp, updatedAt: stamp };
    try {
      await storeMarker(m);
      showToast(`「${label}」${timePart(m.at)} を記録`, [
        { label: "取り消す", run: () => { void removeMarker(m.id).catch(reportError); setToast(null); } },
        { label: "時刻を直す", run: () => { setModal({ mode: "marker", marker: m }); setToast(null); } },
      ]);
    } catch (e) {
      reportError(e);
    }
  };

  const changeSleep = async (sleep: ActiveSleep | null) => {
    await saveActiveSleep(sleep);
    setActiveSleep(sleep);
  };

  /** 就寝・仮眠：記録中の睡眠を始める（起床を押すまで、イベントはまだ作らない） */
  const startSleep = async (nap: boolean) => {
    setQuickOpen(false);
    const sleep: ActiveSleep = { start: toLocal(new Date()), nap };
    try {
      await changeSleep(sleep);
      showToast(`${nap ? "仮眠" : "就寝"} ${timePart(sleep.start)} を記録`, [
        { label: "取り消す", run: () => { void changeSleep(null).catch(reportError); setToast(null); } },
      ]);
    } catch (e) {
      reportError(e);
    }
  };

  /** 起床：就寝からいままでを、睡眠（仮眠）の実績イベントとして塗る */
  const wake = async () => {
    setQuickOpen(false);
    const sleep = activeSleep;
    if (!sleep) return;
    const current = toLocal(new Date());
    const stamp = new Date().toISOString();
    const title = sleep.nap ? "仮眠" : "睡眠";
    const event: CalendarEvent = {
      ...eventDefaults(),
      id: newId(), title, start: sleep.start, end: current > sleep.start ? current : addMinutes(sleep.start, 1), allDay: false,
      colorId: sleepColorId(settings), kind: "actual", subcategory: title, createdAt: stamp, updatedAt: stamp,
    };
    try {
      await commit({ putEvents: [event] });
      await changeSleep(null);
      showToast(`${title} ${timePart(event.start)}–${timePart(event.end)} を記録`, [
        { label: "開く", run: () => { setModal({ mode: "view", event }); setToast(null); } },
      ]);
    } catch (e) {
      reportError(e);
    }
  };

  const cancelSleep = () => {
    if (!activeSleep) return;
    if (!window.confirm(`記録中の${activeSleep.nap ? "仮眠" : "睡眠"}を取り消しますか？\n（${activeSleep.start.replace("T", " ")} から。睡眠の記録は作られません）`)) return;
    void changeSleep(null).catch(reportError);
  };

  const handleSaveMarker = async (m: Marker) => {
    await storeMarker(m);
    setModal(null);
  };

  const handleDeleteMarker = async (id: string) => {
    await removeMarker(id);
    setModal(null);
  };

  const handleSaveSettings = async (next: Settings) => {
    await saveSettings(next);
    setSettings(next);
  };

  const handleRestore = async (backup: BackupFile, sourceVersion: 1 | 2) => {
    const nextSettings = settingsForRestore(backup, sourceVersion, settings);
    await restoreAll({
      events: backup.events, nagara: backup.nagara, revisions: backup.revisions, recurrences: backup.recurrences, markers: backup.markers, settings: nextSettings,
    });
    setEvents((prev) => mergeById(prev, backup.events));
    setNagara((prev) => mergeById(prev, backup.nagara));
    setRevisions((prev) => mergeById(prev, backup.revisions));
    setRecurrences((prev) => mergeById(prev, backup.recurrences));
    setMarkers((prev) => mergeById(prev, backup.markers));
    setSettings(nextSettings);
  };

  const step = (dir: 1 | -1) => {
    setDayKey(
      viewMode === "day" ? addDays(dayKey, dir)
      : viewMode === "fourDay" ? addDays(dayKey, 4 * dir)
      : viewMode === "week" ? addDays(dayKey, 7 * dir)
      : addMonths(dayKey, dir),
    );
  };

  const onTouchStart = (ev: React.TouchEvent) => {
    const t = ev.touches[0];
    if (t) touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (ev: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    const t = ev.changedTouches[0];
    if (!start || !t || modal !== null || quickOpen) return;
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

  const closeModal = () => setModal(null);
  let modalEl: React.ReactNode = null;
  if (modal?.mode === "view") {
    // 閲覧中に内容が変わっても、いまの記録を出す
    const e = events.find((x) => x.id === modal.event.id) ?? modal.event;
    const plan = e.planId ? events.find((x) => x.id === e.planId) ?? null : null;
    const sameplan = e.planId ? events.filter((x) => x.planId === e.planId) : [];
    const attached = labelsByEvent.get(e.id) ?? [];
    modalEl = (
      <EventViewer
        key={`view-${e.id}`}
        event={e}
        plan={plan}
        siblings={plan ? { count: sameplan.length, minutes: sameplan.reduce((sum, x) => sum + (x.allDay ? 0 : diffMinutes(x.start, x.end)), 0) } : null}
        nagaraLabels={attached}
        sessionLabels={e.allDay ? [] : sessionLabelsOverlapping(nagara, e.start, e.end, nowLocal).filter((l) => !attached.includes(l))}
        settings={settings}
        onEdit={() => setModal({ mode: "edit", event: e })}
        onClose={closeModal}
      />
    );
  } else if (modal?.mode === "marker") {
    modalEl = (
      <MarkerSheet
        key={`marker-${modal.marker.id}`}
        marker={modal.marker}
        markers={markers}
        candidates={markerLabels}
        onSave={handleSaveMarker}
        onDelete={handleDeleteMarker}
        onClose={closeModal}
      />
    );
  } else if (modal) {
    modalEl = (
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
        sessionOngoing={modal.mode === "new" ? modal.ongoing ?? false : false}
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
        onClose={closeModal}
      />
    );
  }

  const toastEl = toast && (
    <div className="toast" role="status">
      <span className="toast-text">{toast.text}</span>
      {toast.actions.map((a) => <button key={a.label} type="button" className="toast-btn" onClick={a.run}>{a.label}</button>)}
      <button type="button" className="toast-btn close" aria-label="閉じる" onClick={() => setToast(null)}>×</button>
    </div>
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
          onOpenEvent={openEvent}
        />
        {modalEl}
        {toastEl}
      </div>
    );
  }

  if (view === "search") {
    return (
      <div className="app">
        <SearchView
          events={events}
          nagara={nagara}
          markers={markers}
          settings={settings}
          nowLocal={nowLocal}
          query={searchQuery}
          onQuery={setSearchQuery}
          onBack={() => setView("calendar")}
          onOpenEvent={openEvent}
          onOpenSession={(n) => setModal({ mode: "session", session: n })}
          onOpenMarker={(m) => setModal({ mode: "marker", marker: m })}
        />
        {modalEl}
        {toastEl}
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
          markers={markers}
          activeSleep={activeSleep}
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
        {toastEl}
      </div>
    );
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayHoliday = viewMode === "day" ? holidayName(dayKey) : null;
  const headLabel =
    viewMode === "day" ? formatDayLabel(dayKey)
    : viewMode === "fourDay" ? formatRangeLabel(fourKeys[0], fourKeys[3])
    : viewMode === "week" ? formatWeekRangeLabel(dayKey, weekStartDay)
    : formatMonthLabel(dayKey);
  const stepName = viewMode === "fourDay" ? "4日間" : VIEW_LABEL[viewMode];
  const multiDay = viewMode === "week" || viewMode === "fourDay";

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="icon-btn" aria-label={`前の${stepName}`} onClick={() => step(-1)}>◀</button>
          <label className="date-jump" title="日付を選ぶ">
            <span className={`date-label ${multiDay ? "small" : ""} ${viewMode === "day" ? weekendClass(dayKey) : ""} ${dayHoliday ? "holiday" : ""}`}>{headLabel}{dayHoliday && <small className="date-holiday">{dayHoliday}</small>}</span>
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
            {VIEW_MODES.map((m) => (
              <button key={m} type="button" className={viewMode === m ? "on" : ""} aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>
                {VIEW_LABEL[m]}
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn search-btn" aria-label="検索" onClick={() => setView("search")}>🔍</button>
        </div>
      </header>

      <RunningBand
        sessions={running}
        sleep={activeSleep}
        nowLocal={nowLocal}
        onOpenSession={(n) => setModal({ mode: "session", session: n })}
        onEndSession={(n) => void endSession(n)}
        onWake={() => void wake()}
        onCancelSleep={cancelSleep}
      />

      <div className="calendar-swipe-area" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {viewMode === "day" && allDayEvents.length > 0 && (
        <div className="allday">
          <span className="allday-label">終日</span>
          <div className="allday-list">
            {allDayEvents.map((e) => (
              <button key={e.id} type="button" className={`allday-chip ${e.kind === "plan" ? "plan" : ""}`} style={eventStyle(e)} onClick={() => openEvent(e)}>
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
                  onOpen={() => openEvent(seg.event)}
                />
              ))}
              {dayLayout.front.map((seg) => (
                <EventBlock
                  key={`${seg.event.id}-${dayKey}`}
                  seg={seg}
                  dayKey={dayKey}
                  unconfirmed={isUnconfirmed(seg.event, linked, nowLocal)}
                  nagaraLabels={labelsByEvent.get(seg.event.id) ?? []}
                  onOpen={() => openEvent(seg.event)}
                />
              ))}
              <MarkerPins items={dayMarkers} hourHeight={HOUR_HEIGHT} mode="full" onOpen={(m) => setModal({ mode: "marker", marker: m })} />
              {dayKey === todayKey && <div className="now-line" style={{ top: (nowMin / 60) * HOUR_HEIGHT }}><i /></div>}
            </div>
            <div
              className="lane"
              ref={laneRef}
              onClick={onLaneClick}
              aria-label="ながらセッションのレーン"
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
                    className={`session ${n.type} ${n.end === null ? "ongoing" : ""}`}
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

      {multiDay && (
        <WeekView
          density={viewMode === "fourDay" ? "four" : "week"}
          dayKeys={viewMode === "fourDay" ? fourKeys : weekKeys}
          events={events}
          nagara={nagara}
          markers={markers}
          labelsByEvent={labelsByEvent}
          linked={linked}
          nowLocal={nowLocal}
          todayKey={todayKey}
          nowMin={nowMin}
          scrollRef={scrollRef}
          onOpenEvent={openEvent}
          onOpenSession={(n) => setModal({ mode: "session", session: n })}
          onOpenMarker={(m) => setModal({ mode: "marker", marker: m })}
          onCreate={(range) => openNew(range)}
          onOpenDay={openDay}
        />
      )}

      {viewMode === "month" && (
        <MonthView anchor={dayKey} weekStartDay={weekStartDay} events={events} linked={linked} todayKey={todayKey} onOpenDay={openDay} />
      )}
      </div>

      <button type="button" className="fab fab-quick" aria-label="いまの時刻で記録（マーカー・ながら・睡眠）" aria-expanded={quickOpen} onClick={() => setQuickOpen((v) => !v)}>◆</button>
      <button type="button" className="fab" aria-label="予定・実績を追加" onClick={onPlus}>＋</button>

      {quickOpen && (
        <QuickPanel
          markerCandidates={markerLabels}
          sessionCandidates={sessionLabels}
          sleep={activeSleep}
          onMarker={(label) => void addMarker(label)}
          onStartSession={(label) => void startSession(label)}
          onSleep={(nap) => void startSleep(nap)}
          onWake={() => void wake()}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {modalEl}
      {toastEl}
    </div>
  );
}
