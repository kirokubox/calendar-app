import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { colorHex, planTextColor, textColorOn } from "./colors";
import { HOUR_HEIGHT, defaultSettings } from "./constants";
import { addDays, dateKeyOf, formatDayLabel, parseDateKey, timePart, toLocal } from "./dateUtils";
import { rangeForPlusButton, rangeFromTap, type Range } from "./eventLogic";
import { allDayEventsOn, layoutColumns, segmentsForDay, type PlacedSegment } from "./layout";
import { deleteEvent, getAllEvents, getSettings, putEvent, putEvents, requestPersistentStorage, saveSettings } from "./storage";
import EventModal from "./EventModal";
import SettingsView from "./SettingsView";
import { mergeEvents } from "./backup";
import type { BackupFile, CalendarEvent, Settings } from "./types";

type ModalState = { mode: "new"; range: Range } | { mode: "edit"; event: CalendarEvent } | null;

/** 日跨ぎイベントの時刻表示用の日付タグ。当日なら空、前日・翌日はその語、それ以外は M/D */
function dayTag(local: string, dayKey: string): string {
  const d = local.slice(0, 10);
  if (d === dayKey) return "";
  if (d === addDays(dayKey, -1)) return "(前日)";
  if (d === addDays(dayKey, 1)) return "(翌日)";
  const p = parseDateKey(d);
  return `(${p.getMonth() + 1}/${p.getDate()})`;
}

function eventStyle(e: CalendarEvent): React.CSSProperties {
  const hex = colorHex(e.colorId);
  if (e.kind === "plan") {
    return { "--c": hex, "--bg": "#ffffff", "--fg": planTextColor(hex) } as React.CSSProperties;
  }
  return { "--c": hex, "--bg": hex, "--fg": textColorOn(hex) } as React.CSSProperties;
}

export default function App() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [dayKey, setDayKey] = useState(() => dateKeyOf(new Date()));
  const [view, setView] = useState<"calendar" | "settings">("calendar");
  const [modal, setModal] = useState<ModalState>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const nowLocal = toLocal(now);
  const todayKey = dateKeyOf(now);
  const isToday = dayKey === todayKey;

  useEffect(() => {
    requestPersistentStorage();
    Promise.all([getAllEvents(), getSettings()])
      .then(([evs, st]) => {
        setEvents(evs);
        setSettings(st);
        setLoaded(true);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "データを読み込めませんでした"));
  }, []);

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

  // 日を変えたとき・読み込み完了時・設定から戻ったときに自動スクロール（今日＝現在時刻付近、他の日＝7:00付近）
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !loaded || view !== "calendar") return;
    if (dayKey === dateKeyOf(new Date())) {
      const n = new Date();
      const y = ((n.getHours() * 60 + n.getMinutes()) / 60) * HOUR_HEIGHT;
      el.scrollTop = Math.max(0, y - el.clientHeight * 0.4);
    } else {
      el.scrollTop = 7 * HOUR_HEIGHT;
    }
  }, [dayKey, loaded, view]);

  const segments = useMemo(() => layoutColumns(segmentsForDay(events, dayKey)), [events, dayKey]);
  const allDayEvents = useMemo(() => allDayEventsOn(events, dayKey), [events, dayKey]);

  const openNew = useCallback((range: Range) => setModal({ mode: "new", range }), []);

  const onPlus = () => openNew(rangeForPlusButton(events, dayKey, toLocal(new Date())));

  const onAreaClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const minutes = ((ev.clientY - rect.top) / HOUR_HEIGHT) * 60;
    openNew(rangeFromTap(dayKey, Math.max(0, Math.min(1439, minutes))));
  };

  const handleSave = async (event: CalendarEvent) => {
    await putEvent(event);
    setEvents((prev) => [...prev.filter((e) => e.id !== event.id), event]);
    setModal(null);
  };

  const handleDelete = async (id: string) => {
    await deleteEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setModal(null);
  };

  const handleSaveSettings = async (next: Settings) => {
    await saveSettings(next);
    setSettings(next);
  };

  const handleRestore = async (backup: BackupFile) => {
    await putEvents(backup.events);
    await saveSettings(backup.settings);
    setEvents((prev) => mergeEvents(prev, backup.events));
    setSettings(backup.settings);
  };

  if (loadError) {
    return (
      <div className="app">
        <p className="notice error">データを読み込めませんでした：{loadError}</p>
      </div>
    );
  }

  if (view === "settings") {
    return (
      <div className="app">
        <SettingsView
          settings={settings}
          events={events}
          onBack={() => setView("calendar")}
          onSaveSettings={handleSaveSettings}
          onRestore={handleRestore}
        />
      </div>
    );
  }

  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="icon-btn" aria-label="前日" onClick={() => setDayKey(addDays(dayKey, -1))}>◀</button>
          <label className="date-jump" title="日付を選ぶ">
            <span className="date-label">{formatDayLabel(dayKey)}</span>
            <input
              type="date"
              value={dayKey}
              aria-label="日付ジャンプ"
              onChange={(e) => { if (e.target.value) setDayKey(e.target.value); }}
            />
          </label>
          <button type="button" className="icon-btn" aria-label="翌日" onClick={() => setDayKey(addDays(dayKey, 1))}>▶</button>
          <span className="spacer" />
          <button type="button" className="text-btn" onClick={() => setDayKey(todayKey)} disabled={isToday}>今日</button>
          <button type="button" className="icon-btn" aria-label="設定" onClick={() => setView("settings")}>⚙</button>
        </div>
      </header>

      {allDayEvents.length > 0 && (
        <div className="allday">
          <span className="allday-label">終日</span>
          <div className="allday-list">
            {allDayEvents.map((e) => (
              <button key={e.id} type="button" className={`allday-chip ${e.kind === "plan" ? "plan" : ""}`} style={eventStyle(e)} onClick={() => setModal({ mode: "edit", event: e })}>
                {e.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="scroll" ref={scrollRef}>
        <div className="timeline" style={{ height: HOUR_HEIGHT * 24 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="hour-label" style={{ top: h * HOUR_HEIGHT }}>{h}:00</span>
          ))}
          <div className="events-area" ref={areaRef} onClick={onAreaClick} style={{ backgroundSize: `100% ${HOUR_HEIGHT}px` }}>
            {segments.map((seg) => (
              <EventBlock key={`${seg.event.id}-${dayKey}`} seg={seg} dayKey={dayKey} onOpen={() => setModal({ mode: "edit", event: seg.event })} />
            ))}
            {isToday && <div className="now-line" style={{ top: (nowMin / 60) * HOUR_HEIGHT }}><i /></div>}
          </div>
        </div>
      </div>

      <button type="button" className="fab" aria-label="予定・実績を追加" onClick={onPlus}>＋</button>

      {modal && (
        <EventModal
          key={modal.mode === "edit" ? modal.event.id : `new-${modal.range.start}`}
          mode={modal.mode}
          event={modal.mode === "edit" ? modal.event : null}
          range={modal.mode === "new" ? modal.range : null}
          events={events}
          settings={settings}
          now={nowLocal}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function EventBlock({ seg, dayKey, onOpen }: { seg: PlacedSegment; dayKey: string; onOpen: () => void }) {
  const e = seg.event;
  const top = (seg.startMin / 60) * HOUR_HEIGHT;
  const height = Math.max(((seg.endMin - seg.startMin) / 60) * HOUR_HEIGHT - 1, 16);
  const showTime = height >= 34;
  const timeLabel = `${timePart(e.start)}${dayTag(e.start, dayKey)}–${timePart(e.end)}${dayTag(e.end, dayKey)}`;
  return (
    <button
      type="button"
      className={`event ${e.kind === "plan" ? "plan" : ""}`}
      style={{
        ...eventStyle(e),
        top,
        height,
        left: `calc(${(seg.col / seg.cols) * 100}% + 1px)`,
        width: `calc(${100 / seg.cols}% - 3px)`,
      }}
      onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
      title={`${e.title} ${timeLabel}`}
    >
      <span className="event-title">{e.title}</span>
      {showTime && <span className="event-time">{timeLabel}</span>}
    </button>
  );
}

