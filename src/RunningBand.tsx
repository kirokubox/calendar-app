import { LONG_RUNNING_MINUTES } from "./constants";
import { datePart, diffMinutes, timePart } from "./dateUtils";
import { formatDuration } from "./reviewLogic";
import type { ActiveSleep, Nagara } from "./types";

interface Props {
  sessions: Nagara[];
  sleep: ActiveSleep | null;
  /** 現在のローカル時刻（YYYY-MM-DDTHH:mm） */
  nowLocal: string;
  onOpenSession: (n: Nagara) => void;
  onEndSession: (n: Nagara) => void;
  onWake: () => void;
  onCancelSleep: () => void;
}

function sinceLabel(start: string, nowLocal: string): string {
  const day = datePart(start) === datePart(nowLocal) ? "" : `${Number(start.slice(5, 7))}/${Number(start.slice(8, 10))} `;
  const minutes = Math.max(0, diffMinutes(start, nowLocal));
  return `${day}${timePart(start)}〜・${formatDuration(minutes)}`;
}

/**
 * 継続中のセッション・睡眠を、画面の横幅いっぱいの帯で出す。
 * どの日付の列にも属さない「いま動いているもの」なので、日付を移動しても出し続ける。
 */
export default function RunningBand({ sessions, sleep, nowLocal, onOpenSession, onEndSession, onWake, onCancelSleep }: Props) {
  if (sessions.length === 0 && !sleep) return null;
  return (
    <div className="running-band" role="region" aria-label="継続中の記録">
      {sleep && (
        <div className={`running-row sleep ${diffMinutes(sleep.start, nowLocal) >= LONG_RUNNING_MINUTES ? "long" : ""}`}>
          <div className="running-main">
            <b>{sleep.nap ? "仮眠中" : "睡眠中"}</b>
            <span>{sinceLabel(sleep.start, nowLocal)}</span>
          </div>
          <button type="button" className="text-btn small" onClick={onCancelSleep} aria-label={`${sleep.nap ? "仮眠" : "睡眠"}の記録を取り消す`}>取消</button>
          <button type="button" className="primary-btn small" onClick={onWake}>起床</button>
        </div>
      )}
      {sessions.map((n) => {
        const long = diffMinutes(n.start as string, nowLocal) >= LONG_RUNNING_MINUTES;
        return (
          <div key={n.id} className={`running-row ${long ? "long" : ""}`}>
            <button type="button" className="running-main" onClick={() => onOpenSession(n)} aria-label={`${n.label}の詳細を開く`}>
              <b>{n.label}</b>
              <span>{sinceLabel(n.start as string, nowLocal)}{long ? "（長時間続いています）" : ""}</span>
            </button>
            <button type="button" className="primary-btn small" onClick={() => onEndSession(n)}>今で終了</button>
          </div>
        );
      })}
    </div>
  );
}
