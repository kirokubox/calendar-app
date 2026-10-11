import { useState } from "react";
import type { ActiveSleep } from "./types";

interface Props {
  markerCandidates: string[];
  /** ながらを始める候補（すでに継続中のラベルは除いてある） */
  sessionCandidates: string[];
  sleep: ActiveSleep | null;
  onMarker: (label: string) => void;
  onStartSession: (label: string) => void;
  onSleep: (nap: boolean) => void;
  onWake: () => void;
  onClose: () => void;
}

/**
 * 「いま」を1〜2タップで残す小さなパネル。入力シートは開かず、押した時点の時刻でそのまま保存する。
 * マーカー（時刻だけ）・ながらの開始（継続中のセッション）・就寝と起床。
 */
export default function QuickPanel({ markerCandidates, sessionCandidates, sleep, onMarker, onStartSession, onSleep, onWake, onClose }: Props) {
  const [markerText, setMarkerText] = useState("");
  const [sessionText, setSessionText] = useState("");

  return (
    <>
      <div className="quick-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="quick-panel" role="dialog" aria-label="いまの時刻で記録">
        <div className="quick-head">
          <strong>いまの時刻で記録</strong>
          <button type="button" className="text-btn small" onClick={onClose}>閉じる</button>
        </div>

        <span className="field-label">マーカー（時刻だけ）</span>
        <div className="quick-list">
          {markerCandidates.map((label) => (
            <button key={label} type="button" className="quick solid" onClick={() => onMarker(label)}>{label}</button>
          ))}
        </div>
        <form className="chip-add" onSubmit={(ev) => { ev.preventDefault(); if (markerText.trim() !== "") onMarker(markerText.trim()); }}>
          <input type="text" value={markerText} placeholder="自由入力（例：開場）" aria-label="マーカーの自由入力" onChange={(e) => setMarkerText(e.target.value)} />
          <button type="submit" className="secondary-btn small" disabled={markerText.trim() === ""}>記録</button>
        </form>

        <span className="field-label">ながらを始める（終わったら上の帯で「今で終了」）</span>
        <div className="quick-list">
          {sessionCandidates.map((label) => (
            <button key={label} type="button" className="quick solid nagara" onClick={() => onStartSession(label)}>＋{label}</button>
          ))}
        </div>
        <form className="chip-add" onSubmit={(ev) => { ev.preventDefault(); if (sessionText.trim() !== "") onStartSession(sessionText.trim()); }}>
          <input type="text" value={sessionText} placeholder="自由入力（例：ラジオ）" aria-label="ながらの自由入力" onChange={(e) => setSessionText(e.target.value)} />
          <button type="submit" className="secondary-btn small" disabled={sessionText.trim() === ""}>開始</button>
        </form>

        <span className="field-label">睡眠</span>
        <div className="quick-list">
          {sleep ? (
            <button type="button" className="quick solid sleep" onClick={onWake}>起床（{sleep.nap ? "仮眠" : "睡眠"}を記録する）</button>
          ) : (
            <>
              <button type="button" className="quick solid sleep" onClick={() => onSleep(false)}>就寝</button>
              <button type="button" className="quick solid sleep" onClick={() => onSleep(true)}>仮眠を始める</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
