import { useMemo } from "react";
import { WEEK_HOUR_HEIGHT } from "./constants";
import { parseDateKey, weekdayName, weekendClass } from "./dateUtils";
import { rangeFromTap, type Range } from "./eventLogic";
import { holidayName, shortHolidayName } from "./holidays";
import { allDayEventsOn } from "./layout";
import { isUnconfirmed, layoutDayWithPlans } from "./planLogic";
import EventBlock, { eventStyle } from "./EventBlock";
import { displayTitle } from "./eventLogic";
import type { CalendarEvent } from "./types";

interface Props {
  dayKeys: string[];
  events: CalendarEvent[];
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
  onCreate: (range: Range) => void;
  onOpenDay: (dayKey: string) => void;
}

/** 週表示：7日分の列＋時間軸 */
export default function WeekView({ dayKeys, events, labelsByEvent, linked, nowLocal, todayKey, nowMin, scrollRef, onOpenEvent, onCreate, onOpenDay }: Props) {
  const columns = useMemo(
    () => dayKeys.map((k) => ({
      key: k,
      layout: layoutDayWithPlans(events, k, linked),
      allDay: allDayEventsOn(events, k),
    })),
    [dayKeys, events, linked],
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
                <div className="week-events">
                {c.layout.back.map(({ seg, variant }) => (
                  <EventBlock
                    key={`${seg.event.id}-${c.key}`}
                    seg={{ ...seg, col: 0, cols: 1 }}
                    dayKey={c.key}
                    compact
                    hourHeight={WEEK_HOUR_HEIGHT}
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
                    hourHeight={WEEK_HOUR_HEIGHT}
                    nagaraLabels={labelsByEvent.get(seg.event.id) ?? []}
                    onOpen={() => onOpenEvent(seg.event)}
                  />
                ))}
                {c.key === todayKey && <div className="now-line" style={{ top: (nowMin / 60) * WEEK_HOUR_HEIGHT }}><i /></div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
