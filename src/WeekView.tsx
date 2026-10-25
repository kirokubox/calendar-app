import { useMemo } from "react";
import { FOUR_DAY_HOUR_HEIGHT, FOUR_DAY_LANE_WIDTH, WEEK_HOUR_HEIGHT } from "./constants";
import { parseDateKey, weekdayName, weekendClass } from "./dateUtils";
import { rangeFromTap, type Range } from "./eventLogic";
import { holidayName, shortHolidayName } from "./holidays";
import { allDayEventsOn } from "./layout";
import { markersForDay } from "./markerLogic";
import { layoutSessions, sessionSegmentsForDay } from "./nagaraLogic";
import { isUnconfirmed, layoutDayWithPlans } from "./planLogic";
import EventBlock, { eventStyle } from "./EventBlock";
import MarkerPins from "./MarkerPins";
import { displayTitle } from "./eventLogic";
import type { CalendarEvent, Marker, Nagara } from "./types";

interface Props {
  /** week＝7日（俯瞰用。タイトル中心）、four＝4日（ながら・場所・セッション帯まで読める） */
  density: "week" | "four";
  dayKeys: string[];
  events: CalendarEvent[];
  nagara: Nagara[];
  markers: Marker[];
  labelsByEvent: Map<string, string[]>;
  /** 実績がリンクされた予定のid */
  linked: Set<string>;
  /** 現在のローカル時刻 */
  nowLocal: string;
  todayKey: string;
  /** 現在時刻の0:00からの分 */
  nowMin: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenSession: (n: Nagara) => void;
  onOpenMarker: (m: Marker) => void;
  onCreate: (range: Range) => void;
  onOpenDay: (dayKey: string) => void;
}

/** 複数日の表示（週＝7日、4日）：日ごとの列＋時間軸 */
export default function WeekView({
  density, dayKeys, events, nagara, markers, labelsByEvent, linked, nowLocal, todayKey, nowMin, scrollRef, onOpenEvent, onOpenSession, onOpenMarker, onCreate, onOpenDay,
}: Props) {
  const four = density === "four";
  const hourHeight = four ? FOUR_DAY_HOUR_HEIGHT : WEEK_HOUR_HEIGHT;
  const laneWidth = four ? FOUR_DAY_LANE_WIDTH : 0;
  const columns = useMemo(
    () => dayKeys.map((k) => ({
      key: k,
      layout: layoutDayWithPlans(events, k, linked),
      allDay: allDayEventsOn(events, k).filter((event) => !(event.kind === "plan" && linked.has(event.id))),
      sessions: four ? layoutSessions(sessionSegmentsForDay(nagara, k, nowLocal)) : [],
      markers: markersForDay(markers, k),
    })),
    [dayKeys, events, linked, nagara, markers, four, nowLocal],
  );
  const hasAllDay = columns.some((c) => c.allDay.length > 0);
  const gridColumns = { gridTemplateColumns: `var(--gutter) repeat(${dayKeys.length}, minmax(0, 1fr))` };

  const onColumnClick = (key: string, ev: React.MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const minutes = ((ev.clientY - rect.top) / hourHeight) * 60;
    onCreate(rangeFromTap(key, Math.max(0, Math.min(1439, minutes))));
  };

  return (
    <>
      <div className={`week-head ${four ? "four" : ""}`} style={gridColumns}>
        <span className="week-gutter" />
        {columns.map((c) => {
          const holiday = holidayName(c.key);
          return (
            <button
              key={c.key}
              type="button"
              className={`week-day-head ${weekendClass(c.key)} ${c.key === todayKey ? "today" : ""} ${holiday ? "holiday" : ""}`}
              onClick={() => onOpenDay(c.key)}
              aria-label={`${c.key}${holiday ? `（${holiday}）` : ""}の日表示へ`}
              title={holiday ?? undefined}
            >
              <span>{Number(c.key.slice(8, 10))}</span><small>{holiday ? shortHolidayName(holiday) : weekdayName(parseDateKey(c.key).getDay())}</small>
            </button>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="week-head week-allday" style={gridColumns}>
          <span className="week-gutter allday-label">終日</span>
          {columns.map((c) => (
            <div key={c.key} className="week-allday-cell">
              {c.allDay.map((e) => (
                <button key={e.id} type="button" className={`allday-chip tiny ${e.kind === "plan" ? "plan" : ""}`} style={eventStyle(e)} onClick={() => onOpenEvent(e)}>
                  {displayTitle(e)}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="scroll" ref={scrollRef}>
        <div className="timeline week-timeline" style={{ height: hourHeight * 24 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="hour-label" style={{ top: h * hourHeight }}>{h}:00</span>
          ))}
          <div className="week-cols" style={{ backgroundSize: `100% ${hourHeight}px`, gridTemplateColumns: `repeat(${dayKeys.length}, minmax(0, 1fr))` }}>
            {columns.map((c) => (
              <div key={c.key} className={`week-col ${c.key === todayKey ? "today" : ""}`} onClick={(ev) => onColumnClick(c.key, ev)}>
                <div className="week-events" style={{ right: laneWidth }}>
                  {c.layout.back.map(({ seg, variant }) => (
                    <EventBlock
                      key={`${seg.event.id}-${c.key}`}
                      seg={{ ...seg, col: 0, cols: 1 }}
                      dayKey={c.key}
                      density={density}
                      hourHeight={hourHeight}
                      variant={variant}
                      nagaraLabels={[]}
                      onOpen={() => onOpenEvent(seg.event)}
                    />
                  ))}
                  {c.layout.front.map((seg) => (
                    <EventBlock
                      key={`${seg.event.id}-${c.key}-${seg.startMin}-${seg.endMin}`}
                      seg={seg}
                      dayKey={c.key}
                      unconfirmed={isUnconfirmed(seg.event, linked, nowLocal)}
                      density={density}
                      hourHeight={hourHeight}
                      nagaraLabels={labelsByEvent.get(seg.event.id) ?? []}
                      onOpen={() => onOpenEvent(seg.event)}
                    />
                  ))}
                  <MarkerPins items={c.markers} hourHeight={hourHeight} mode={four ? "label" : "dot"} onOpen={onOpenMarker} />
                  {c.key === todayKey && <div className="now-line" style={{ top: (nowMin / 60) * hourHeight }}><i /></div>}
                </div>
                {four && (
                  <div className="week-lane" style={{ width: laneWidth }}>
                    {c.sessions.map((s) => {
                      const n = s.nagara;
                      const top = (s.startMin / 60) * hourHeight;
                      const height = Math.max(((s.endMin - s.startMin) / 60) * hourHeight - 1, 12);
                      return (
                        <button
                          key={`${n.id}-${c.key}`}
                          type="button"
                          className={`session ${n.type} ${n.end === null ? "ongoing" : ""}`}
                          style={{ top, height, left: `${(s.col / s.cols) * 100}%`, width: `calc(${100 / s.cols}% - 1px)` }}
                          title={`${n.type === "place" ? "場所" : "ながら"}：${n.label}`}
                          aria-label={`${n.type === "place" ? "場所" : "ながら"}セッション：${n.label}`}
                          onClick={(ev) => { ev.stopPropagation(); onOpenSession(n); }}
                        >
                          <span>{n.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
