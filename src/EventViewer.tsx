import { useEffect } from "react";
import { COLOR_HEX } from "./constants";
import { datePart, diffMinutes, formatShortDate, timePart } from "./dateUtils";
import { formatDelta, planActualDiff, planLabel } from "./planLogic";
import { categoryName, colorKeyOf, formatDuration, parentOf } from "./reviewLogic";
import { useBackdropClose } from "./useBackdropClose";
import type { CalendarEvent, Settings } from "./types";

interface Props {
  event: CalendarEvent;
  /** この実績のもとになった予定 */
  plan: CalendarEvent | null;
  /** 同じ予定から作った実績の件数（この実績を含む）と、その合計時間（分） */
  siblings: { count: number; minutes: number } | null;
  /** イベントに付けたながら */
  nagaraLabels: string[];
  /** この時間に重なっていたセッション */
  sessionLabels: string[];
  settings: Settings;
  onEdit: () => void;
  onClose: () => void;
}

const KIND_LABEL = { plan: "予定", actual: "実績", unknown: "不明（Googleカレンダーから取り込み）" } as const;

function whenLabel(e: CalendarEvent): string {
  const startDay = datePart(e.start);
  if (e.allDay) {
    const last = new Date(`${datePart(e.end)}T00:00:00`);
    last.setDate(last.getDate() - 1);
    const lastKey = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
    return lastKey === startDay ? `${formatShortDate(startDay)} 終日` : `${formatShortDate(startDay)}〜${formatShortDate(lastKey)} 終日`;
  }
  const endDay = datePart(e.end);
  const end = endDay === startDay ? timePart(e.end) : `${formatShortDate(endDay)} ${timePart(e.end)}`;
  return `${formatShortDate(startDay)} ${timePart(e.start)}〜${end}（${formatDuration(diffMinutes(e.start, e.end))}）`;
}

/** 実績・種別不明のイベントを読むだけの画面。編集は「編集」を押してから */
export default function EventViewer({ event, plan, siblings, nagaraLabels, sessionLabels, settings, onEdit, onClose }: Props) {
  const backdrop = useBackdropClose(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const key = colorKeyOf(event);
  const diff = plan ? planActualDiff(plan, event) : null;
  const row = (label: string, value: React.ReactNode) => (
    <div className="view-row">
      <span className="view-key">{label}</span>
      <span className="view-val">{value}</span>
    </div>
  );

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="記録の内容">
        <div className="sheet-head">
          <h2>記録の内容</h2>
          <div className="sheet-head-actions">
            <button type="button" className="primary-btn small" onClick={onEdit}>編集</button>
            <button type="button" className="text-btn" onClick={onClose}>閉じる</button>
          </div>
        </div>

        <p className="view-title">
          <i className="view-dot" style={{ background: COLOR_HEX[key] }} />
          {event.title}
        </p>
        <p className="view-when">{whenLabel(event)}</p>

        <div className="view-list">
          {row("カテゴリ", `${categoryName(key, settings)}（${parentOf(key, settings)}）${event.subcategory ? `／${event.subcategory}` : ""}`)}
          {event.people.length > 0 && row("人", event.people.join("・"))}
          {event.places.length > 0 && row("場所・移動", event.places.join(" → "))}
          {nagaraLabels.length > 0 && row("ながら", nagaraLabels.join("、"))}
          {sessionLabels.length > 0 && row("重なっていたセッション", sessionLabels.join("、"))}
          {row("種別", KIND_LABEL[event.kind])}
        </div>

        {event.memo !== "" && (
          <div className="view-memo">
            <span className="field-label">メモ</span>
            <p>{event.memo}</p>
          </div>
        )}

        {plan && diff && (
          <div className="view-plan">
            <span className="field-label"><b className="badge-plan">予</b> もとは予定でした</span>
            <p className="view-plan-label">{planLabel(plan)}</p>
            {!plan.allDay && !event.allDay && (
              <div className="view-list">
                {row("開始", `${timePart(plan.start)} → ${timePart(event.start)}（${formatDelta(diff.startDelta)}）`)}
                {row("終了", `${timePart(plan.end)} → ${timePart(event.end)}（${formatDelta(diff.endDelta)}）`)}
                {row("長さ", `${formatDuration(diff.planMinutes)} → ${formatDuration(diff.actualMinutes)}`)}
              </div>
            )}
            {diff.changes.length > 0 && (
              <div className="view-list">
                {diff.changes.map((c) => <div key={c.field}>{row(c.label, `${c.before} → ${c.after}`)}</div>)}
              </div>
            )}
            {siblings && siblings.count > 1 && (
              <p className="hint">この予定から作った実績は {siblings.count} 件、合わせて {formatDuration(siblings.minutes)}（予定は {formatDuration(diff.planMinutes)}）。</p>
            )}
            {plan.status === "cancelled" && <p className="hint">この予定はキャンセル済みです{plan.cancelReason ? `（理由：${plan.cancelReason}）` : ""}。</p>}
          </div>
        )}

        <div className="sheet-actions">
          <span className="spacer" />
          <button type="button" className="primary-btn" onClick={onEdit}>編集</button>
        </div>
      </div>
    </div>
  );
}
