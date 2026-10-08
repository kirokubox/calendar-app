import { useMemo } from "react";
import { WEEK_HOUR_HEIGHT, WEEK_LANE_WIDTH } from "./constants";
import { parseDateKey, weekdayName } from "./dateUtils";
import { rangeFromTap, type Range } from "./eventLogic";
import { allDayEventsOn } from "./layout";
import { isUnconfirmed, layoutDayWithPlans } from "./planLogic";
import EventBlock, { eventStyle } from "./EventBlock";
import { displayTitle } from "./eventLogic";
import { layoutSessions, sessionSegmentsForDay } from "./nagaraLogic";
import type { CalendarEvent, Nagara } from "./types";

interface Props {
  dayKeys: string[];
  events: CalendarEvent[];
  labelsByEvent: Map<string, string[]>;
  nagara: Nagara[];
  /** 実績がリンクされた予定のid */
  linked: Set<string>;
  /** 現在のローカル時刻 */
  nowLocal: string;
  todayKey: string;
  /** 現在時刻の0:00からの分 */
  nowMin: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onOpenEvent: (event: CalendarEvent) => void;
  onCreate: (range: Range) => void;
  onOpenDay: (dayKey: string) => void;
  onOpenSession: (session: Nagara) => void;
}

const SESSION_COLORS = ["#00897b", "#5e35b1", "#039be5", "#c62828", "#6d4c41", "#7cb342"];

function sessionColor(n: Nagara): string {
  if (n.type === "place") return "#ef6c00";
  let hash = 0;
  for (const ch of n.label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SESSION_COLORS[hash % SESSION_COLORS.length];
}

/** 週表示：7日分の列＋時間軸 */
export default function WeekView({ dayKeys, events, labelsByEvent, nagara, linked, nowLocal, todayKey, nowMin, scrollRef, onOpenEvent, onCreate, onOpenDay, onOpenSession }: Props) {
  const columns = useMemo(
    () => dayKeys.map((k) => ({
      key: k,
      layout: layoutDayWithPlans(events, k, linked),
      allDay: allDayEventsOn(events, k),
      sessions: layoutSessions(sessionSegmentsForDay(nagara, k)),
    })),
    [dayKeys, events, linked, nagara],
  );
  const hasAllDay = columns.some((c) => c.allDay.length > 0);

  const onColumnClick = (key: string, ev: React.MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const minutes = ((ev.clientY - rect.top) / WEEK_HOUR_HEIGHT) * 60;
    onCreate(rangeFromTap(key, Math.max(0, Math.min(1439, minutes))));
  };

  return (
    <>
      <div className="week-head">
        <span className="week-gutter" />
        {columns.map((c) => (
          <button key={c.key} type="button" className={`week-day-head ${c.key === todayKey ? "today" : ""}`} onClick={() => onOpenDay(c.key)} aria-label={`${c.key}の日表示へ`}>
            <span>{Number(c.key.slice(8, 10))}</span><small>{weekdayName(parseDateKey(c.key).getDay())}</small>
          </button>
        ))}
      </div>
      {hasAllDay && (
        <div className="week-head week-allday">
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
        <div className="timeline week-timeline" style={{ height: WEEK_HOUR_HEIGHT * 24 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="hour-label" style={{ top: h * WEEK_HOUR_HEIGHT }}>{h}:00</span>
          ))}
          <div className="week-cols" style={{ backgroundSize: `100% ${WEEK_HOUR_HEIGHT}px` }}>
            {columns.map((c) => (
              <div key={c.key} className={`week-col ${c.key === todayKey ? "today" : ""}`} onClick={(ev) => onColumnClick(c.key, ev)}>
                <div className="week-events" style={{ right: WEEK_LANE_WIDTH }}>
                {c.layout.back.map(({ seg, variant }) => (
                  <EventBlock
                    key={`${seg.event.id}-${c.key}`}
                    seg={{ ...seg, col: 0, cols: 1 }}
                    dayKey={c.key}
                    compact
                    variant={variant}
                    nagaraLabels={[]}
                    onOpen={() => onOpenEvent(seg.event)}
                  />
                ))}
                {c.layout.front.map((seg) => (
                  <EventBlock
                    key={`${seg.event.id}-${c.key}`}
                    seg={seg}
                    dayKey={c.key}
                    unconfirmed={isUnconfirmed(seg.event, linked, nowLocal)}
                    compact
                    nagaraLabels={labelsByEvent.get(seg.event.id) ?? []}
                    onOpen={() => onOpenEvent(seg.event)}
                  />
                ))}
                {c.key === todayKey && <div className="now-line" style={{ top: (nowMin / 60) * WEEK_HOUR_HEIGHT }}><i /></div>}
                </div>
                <div className="week-session-lane" style={{ width: WEEK_LANE_WIDTH }} aria-label={`${c.key}のセッション帯`}>
                  {c.sessions.map((s) => (
                    <button
                      key={`${s.nagara.id}-${c.key}`}
                      type="button"
                      className="week-session"
                      style={{
                        top: (s.startMin / 60) * WEEK_HOUR_HEIGHT,
                        height: Math.max(((s.endMin - s.startMin) / 60) * WEEK_HOUR_HEIGHT, 4),
                        left: `${(s.col / s.cols) * 100}%`,
                        width: `${100 / s.cols}%`,
                        background: sessionColor(s.nagara),
                      }}
                      aria-label={`${s.nagara.type === "place" ? "場所" : "ながら"}：${s.nagara.label}`}
                      title={s.nagara.label}
                      onClick={(ev) => { ev.stopPropagation(); onOpenSession(s.nagara); }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
