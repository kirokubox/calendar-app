import { colorHex, planTextColor, textColorOn } from "./colors";
import { HOUR_HEIGHT } from "./constants";
import { addDays, parseDateKey, timePart } from "./dateUtils";
import { blockLines, displayTitle } from "./eventLogic";
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

/** 表示の密度：day＝日表示、four＝4日表示、week＝週表示 */
export type BlockDensity = "day" | "four" | "week";

/** 1行の高さ（px）と、枠線・余白で使う高さ（px）。CSSの .event.d-* と合わせる */
const METRICS: Record<BlockDensity, { line: number; chrome: number }> = {
  day: { line: 16, chrome: 6 },
  four: { line: 13, chrome: 4 },
  week: { line: 11, chrome: 2 },
};

interface Props {
  seg: PlacedSegment;
  dayKey: string;
  /** イベントに付けたながらのラベル */
  nagaraLabels: string[];
  density?: BlockDensity;
  /** 1時間あたりの表示高さ。表示ごとに縮尺が異なる */
  hourHeight?: number;
  /** linked＝背面に薄い枠線（実績あり）／cancelled＝背面に取り消し線 */
  variant?: PlanVariant;
  /** 過ぎたのに実績がない予定 */
  unconfirmed?: boolean;
  onOpen: () => void;
}

export default function EventBlock({ seg, dayKey, nagaraLabels, density = "day", hourHeight = HOUR_HEIGHT, variant = "normal", unconfirmed, onOpen }: Props) {
  const e = seg.event;
  const metrics = METRICS[density];
  const top = (seg.startMin / 60) * hourHeight;
  const height = Math.max(((seg.endMin - seg.startMin) / 60) * hourHeight - 1, metrics.line + metrics.chrome);
  const timeLabel = `${timePart(e.start)}${dayTag(e.start, dayKey)}–${timePart(e.end)}${dayTag(e.end, dayKey)}`;
  const people = e.people.map((p) => p.trim()).filter((p) => p !== "");
  const places = e.places.map((p) => p.trim()).filter((p) => p !== "");
  const plus = nagaraLabels.map((l) => `＋${l}`).join(" ");
  const placeText = places.join(" → ");
  // 予定から作った実績（もとは予定だった）
  const fromPlan = e.kind !== "plan" && e.planId !== null;
  const back = variant !== "normal";
  // 週表示は幅が狭いので、人・ながらはタイトルの行に続け、場所は出さない
  const wide = density !== "week";
  const lines = blockLines(
    (height - metrics.chrome) / metrics.line,
    { people: wide && people.length > 0, nagara: wide && plus !== "", place: wide && placeText !== "" },
    { time: density === "day" },
  );
  const title = lines.peopleLine ? e.title : displayTitle(e);
  const style = {
    ...eventStyle(e),
    top,
    height,
    left: `calc(${(seg.col / seg.cols) * 100}% + 1px)`,
    width: `calc(${100 / seg.cols}% - 3px)`,
    "--lh": `${metrics.line}px`,
  } as React.CSSProperties;
  const label = `${displayTitle(e)}${plus ? ` ${plus}` : ""}${placeText ? ` 場所：${placeText}` : ""} ${timeLabel}${fromPlan ? "（もとは予定）" : ""}`;

  return (
    <button
      type="button"
      className={`event d-${density} ${e.kind === "plan" ? "plan" : ""} ${back ? `back ${variant}` : ""} ${fromPlan ? "from-plan" : ""}`}
      style={style}
      onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
      title={label}
      aria-label={label}
    >
      {/* 実績がある予定の背面は枠だけにして、手前の実績の文字と重ならないようにする */}
      {variant !== "linked" && (
        <>
          {lines.peopleLine && <span className="event-line event-people">{people.join("・")}</span>}
          <span className="event-title" style={{ WebkitLineClamp: back ? 1 : lines.titleLines }}>
            {fromPlan && wide && <b className="badge-plan" aria-hidden="true">予</b>}
            {unconfirmed && <b className="badge-unconfirmed">未確定</b>}
            {title}
            {plus && !lines.nagaraLine && <small className="event-nagara"> {plus}</small>}
          </span>
          {lines.nagaraLine && <span className="event-line event-nagara">{plus}</span>}
          {lines.placeLine && <span className="event-line event-place">📍{placeText}</span>}
          {lines.timeLine && <span className="event-line event-time">{timeLabel}</span>}
        </>
      )}
    </button>
  );
}
