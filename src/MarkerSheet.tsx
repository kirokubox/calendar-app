import { useEffect, useMemo, useState } from "react";
import { datePart, joinLocal, timePart } from "./dateUtils";
import { markerTimeLabel, markersWithGaps, validateMarker } from "./markerLogic";
import { formatDuration } from "./reviewLogic";
import { useBackdropClose } from "./useBackdropClose";
import type { Marker } from "./types";

interface Props {
  marker: Marker;
  markers: Marker[];
  candidates: string[];
  onSave: (m: Marker) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

/** マーカーの確認と修正：ラベル・時刻の変更、削除。前後のマーカーとの間の時間も出す */
export default function MarkerSheet({ marker, markers, candidates, onSave, onDelete, onClose }: Props) {
  const [label, setLabel] = useState(marker.label);
  const [date, setDate] = useState(datePart(marker.at));
  const [time, setTime] = useState(timePart(marker.at));
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const backdrop = useBackdropClose(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const at = joinLocal(date, time);
  const error = validateMarker(label, at);

  // 入力中の時刻で並べ直して、前後のマーカーとの間の時間を出す
  const around = useMemo(() => {
    const list = markersWithGaps([...markers.filter((m) => m.id !== marker.id), { ...marker, at }]);
    const i = list.findIndex((g) => g.marker.id === marker.id);
    return { self: list[i], next: i >= 0 && i + 1 < list.length && list[i + 1].prev?.id === marker.id ? list[i + 1] : null };
  }, [markers, marker, at]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    if (busy) return;
    setBusy(true);
    setSaveError("");
    try {
      await action();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : fallback);
      setBusy(false);
    }
  };

  const handleSave = () => {
    if (error) return;
    void run(() => onSave({ ...marker, label: label.trim(), at, updatedAt: new Date().toISOString() }), "保存できませんでした");
  };

  const handleDelete = () => {
    if (!window.confirm(`マーカー「${marker.label}」を削除しますか？`)) return;
    void run(() => onDelete(marker.id), "削除できませんでした");
  };

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="マーカー">
        <div className="sheet-head">
          <h2>マーカー</h2>
          <div className="sheet-head-actions">
            <button type="button" className="primary-btn small" onClick={handleSave} disabled={!!error || busy}>保存</button>
            <button type="button" className="text-btn" onClick={onClose}>閉じる</button>
          </div>
        </div>
        <input className="title-input" type="text" value={label} list="marker-label-suggestions" onChange={(e) => setLabel(e.target.value)} aria-label="ラベル" />
        <datalist id="marker-label-suggestions">
          {candidates.map((c) => <option key={c} value={c} />)}
        </datalist>
        <div className="time-row">
          <span className="row-label">時刻</span>
          <input className="date-small" type="date" value={date} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} aria-label="日付" />
          <input className="time-input" type="time" value={time} onChange={(e) => { if (e.target.value) setTime(e.target.value); }} aria-label="時刻" />
        </div>
        <div className="view-list">
          <div className="view-row">
            <span className="view-key">直前</span>
            <span className="view-val">
              {around.self?.prev && around.self.gapMinutes !== null
                ? `${around.self.prev.label}（${markerTimeLabel(around.self.prev.at, date)}）から ${formatDuration(around.self.gapMinutes)}`
                : "（24時間以内のマーカーなし）"}
            </span>
          </div>
          <div className="view-row">
            <span className="view-key">次</span>
            <span className="view-val">
              {around.next && around.next.gapMinutes !== null
                ? `${around.next.marker.label}（${markerTimeLabel(around.next.marker.at, date)}）まで ${formatDuration(around.next.gapMinutes)}`
                : "（24時間以内のマーカーなし）"}
            </span>
          </div>
        </div>
        <p className="hint">時刻だけの記録です。時間は塗らず、時間構成の集計にも入りません。</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        {saveError && <p className="notice error" role="alert">{saveError}</p>}
        <div className="sheet-actions">
          <button type="button" className="danger-btn" onClick={handleDelete} disabled={busy}>削除</button>
          <span className="spacer" />
          <button type="button" className="primary-btn" onClick={handleSave} disabled={!!error || busy}>保存</button>
        </div>
      </div>
    </div>
  );
}
