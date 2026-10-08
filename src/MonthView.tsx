import { useMemo } from "react";
import { eventStyle } from "./EventBlock";
import { monthGridWeeks, weekdayName } from "./dateUtils";
import { displayTitle, monthCellItems } from "./eventLogic";
import type { CalendarEvent } from "./types";

interface Props {
  /** 表示する月の任意の日 */
  anchor: string;
  weekStartDay: number;
  events: CalendarEvent[];
  /** 実績がリンクされた予定のid（月表示では出さない） */
  linked: Set<string>;
  todayKey: string;
  onOpenDay: (dayKey: string) => void;
}

/** 月表示：月のグリッド。各日に色付きで最大3件＋「他n件」 */
export default function MonthView({ anchor, weekStartDay, events, linked, todayKey, onOpenDay }: Props) {
  const weeks = useMemo(() => monthGridWeeks(anchor, weekStartDay), [anchor, weekStartDay]);
  const month = anchor.slice(0, 7);

  return (
    <div className="month">
      <div className="month-weekdays">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i}>{weekdayName(weekStartDay + i)}</span>
        ))}
      </div>
      <div className="month-grid" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
        {weeks.map((week) => week.map((key) => {
          const { shown, more } = monthCellItems(events, key, 3, linked);
          return (
            <button
              key={key}
              type="button"
              className={`month-cell ${key.slice(0, 7) !== month ? "other" : ""} ${key === todayKey ? "today" : ""}`}
              onClick={() => onOpenDay(key)}
              aria-label={`${key}の日表示へ`}
            >
              <span className="month-num">{Number(key.slice(8, 10))}</span>
              {shown.map((e) => (
                <span key={e.id} className={`month-item ${e.kind === "plan" ? "plan" : ""}`} style={eventStyle(e)}>{displayTitle(e)}</span>
              ))}
              {more > 0 && <span className="month-more">他{more}件</span>}
            </button>
          );
        }))}
      </div>
    </div>
  );
}
