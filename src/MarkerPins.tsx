import { timePart } from "./dateUtils";
import type { Marker } from "./types";

interface Props {
  items: Array<{ marker: Marker; minute: number }>;
  hourHeight: number;
  /** full＝ラベルと時刻、label＝ラベルだけ、dot＝印だけ（週表示） */
  mode: "full" | "label" | "dot";
  onOpen: (marker: Marker) => void;
}

/** 時間軸の上に、マーカー（時刻だけの記録）を点と細い線で出す。時間は塗らない */
export default function MarkerPins({ items, hourHeight, mode, onOpen }: Props) {
  return (
    <>
      {items.map(({ marker, minute }) => (
        <div key={marker.id} className={`marker-pin m-${mode}`} style={{ top: (minute / 60) * hourHeight }}>
          <button
            type="button"
            className="marker-tag"
            onClick={(ev) => { ev.stopPropagation(); onOpen(marker); }}
            aria-label={`マーカー：${marker.label} ${timePart(marker.at)}`}
            title={`${marker.label} ${timePart(marker.at)}`}
          >
            <i aria-hidden="true">◆</i>
            {mode !== "dot" && <span>{marker.label}{mode === "full" ? ` ${timePart(marker.at)}` : ""}</span>}
          </button>
        </div>
      ))}
    </>
  );
}
