import { useMemo } from "react";
import { HOUR_HEIGHT } from "./constants";
import { formatShortDate } from "./dateUtils";
import { rangeFromTap, type Range } from "./eventLogic";
import { allDayEventsOn, layoutColumns, segmentsForDay } from "./layout";
import EventBlock, { eventStyle } from "./EventBlock";
import { displayTitle } from "./eventLogic";
import type { CalendarEvent } from "./types";

interface Props {
  dayKeys: string[];
  events: CalendarEvent[];
  labelsByEvent: Map<string, string[]>;
  todayKey: string;
  /** 現在時刻の0:00からの分 */
  nowMin: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onOpenEvent: (event: CalendarEvent) => void;
  onCreate: (range: Range) => void;
  onOpenDay: (dayKey: string) => void;
}

/** 週表示：7日分の列＋時間軸 */
export default function WeekView({ dayKeys, events, labelsByEvent, todayKey, nowMin, scrollRef, onOpenEvent, onCreate, onOpenDay }: Props) {
  const columns = useMemo(
    () => dayKeys.map((k) => ({ key: k, segments: layoutColumns(segmentsForDay(events, k)), allDay: allDayEventsOn(events, k) })),
    [dayKeys, events],
  );
  const hasAllDay = columns.some((c) => c.allDay.length > 0);

  const onColumnClick = (key: string, ev: React.MouseEvent<HTMLDivElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const minutes = ((ev.clientY - rect.top) / HOUR_HEIGHT) * 60;
    onCreate(rangeFromTap(key, Math.max(0, Math.min(1439, minutes))));
  };

  return (
    <>
      <div className="week-head">
        <span className="week-gutter" />
        {columns.map((c) => (
          <button key={c.key} type="button" className={`week-day-head ${c.key === todayKey ? "today" : ""}`} onClick={() => onOpenDay(c.key)} aria-label={`${formatShortDate(c.key)}の日表示へ`}>
            {formatShortDate(c.key)}
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
        <div className="timeline" style={{ height: HOUR_HEIGHT * 24 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="hour-label" style={{ top: h * HOUR_HEIGHT }}>{h}:00</span>
          ))}
          <div className="week-cols" style={{ backgroundSize: `100% ${HOUR_HEIGHT}px` }}>
            {columns.map((c) => (
              <div key={c.key} className={`week-col ${c.key === todayKey ? "today" : ""}`} onClick={(ev) => onColumnClick(c.key, ev)}>
                {c.segments.map((seg) => (
                  <EventBlock
                    key={`${seg.event.id}-${c.key}`}
                    seg={seg}
                    dayKey={c.key}
                    compact
                    nagaraLabels={labelsByEvent.get(seg.event.id) ?? []}
                    onOpen={() => onOpenEvent(seg.event)}
                  />
                ))}
                {c.key === todayKey && <div className="now-line" style={{ top: (nowMin / 60) * HOUR_HEIGHT }}><i /></div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
