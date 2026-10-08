import { colorHex, planTextColor, textColorOn } from "./colors";
import { HOUR_HEIGHT } from "./constants";
import { addDays, parseDateKey, timePart } from "./dateUtils";
import { displayTitle } from "./eventLogic";
import type { PlacedSegment } from "./layout";
import type { PlanVariant } from "./planLogic";
import type { CalendarEvent } from "./types";

/** 日跨ぎイベントの時刻表示用の日付タグ。当日なら空、前日・翌日はその語、それ以外は M/D */
export function dayTag(local: string, dayKey: string): string {
  const d = local.slice(0, 10);
  if (d === dayKey) return "";
  if (d === addDays(dayKey, -1)) return "(前日)";
  if (d === addDays(dayKey, 1)) return "(翌日)";
  const p = parseDateKey(d);
  return `(${p.getMonth() + 1}/${p.getDate()})`;
}

export function eventStyle(e: CalendarEvent): React.CSSProperties {
  const hex = colorHex(e.colorId);
  if (e.kind === "plan") {
    return { "--c": hex, "--bg": "#ffffff", "--fg": planTextColor(hex) } as React.CSSProperties;
  }
  return { "--c": hex, "--bg": hex, "--fg": textColorOn(hex) } as React.CSSProperties;
}

interface Props {
  seg: PlacedSegment;
  dayKey: string;
  /** 「＋ラベル」に出すながらのラベル */
  nagaraLabels: string[];
  /** 週表示用：時刻を出さず小さく表示する */
  compact?: boolean;
  /** 1時間あたりの表示高さ。日表示と週表示で縮尺が異なる */
  hourHeight?: number;
  /** linked＝背面に薄い枠線（実績あり）／cancelled＝背面に取り消し線 */
  variant?: PlanVariant;
  /** 過ぎたのに実績がない予定 */
  unconfirmed?: boolean;
  onOpen: () => void;
}

export default function EventBlock({ seg, dayKey, nagaraLabels, compact, hourHeight = HOUR_HEIGHT, variant = "normal", unconfirmed, onOpen }: Props) {
  const e = seg.event;
  const top = (seg.startMin / 60) * hourHeight;
  const height = Math.max(((seg.endMin - seg.startMin) / 60) * hourHeight - 1, 16);
  const showTime = !compact && height >= 34;
  const timeLabel = `${timePart(e.start)}${dayTag(e.start, dayKey)}–${timePart(e.end)}${dayTag(e.end, dayKey)}`;
  const title = displayTitle(e);
  const plus = nagaraLabels.map((l) => `＋${l}`).join(" ");
  return (
    <button
      type="button"
      className={`event ${e.kind === "plan" ? "plan" : ""} ${compact ? "compact" : ""} ${variant !== "normal" ? `back ${variant}` : ""}`}
      style={{
        ...eventStyle(e),
        top,
        height,
        left: `calc(${(seg.col / seg.cols) * 100}% + 1px)`,
        width: `calc(${100 / seg.cols}% - 3px)`,
      }}
      onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
      title={`${title}${plus ? ` ${plus}` : ""} ${timeLabel}`}
    >
      <span className="event-title">
        {unconfirmed && <b className="badge-unconfirmed">未確定</b>}
        {title}
        {plus && <small className="event-nagara"> {plus}</small>}
      </span>
      {showTime && <span className="event-time">{timeLabel}</span>}
    </button>
  );
}
