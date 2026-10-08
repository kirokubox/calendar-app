// 振り返りのグラフ（SVG自作。ライブラリは使わない）。
import { formatDuration } from "./reviewLogic";
import type { StackedDay } from "./reviewLogic";

export interface PieSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface PieProps {
  slices: PieSlice[];
  onSelect?: (key: string) => void;
}

const R = 80;
const C = 90;

function point(angle: number): [number, number] {
  return [C + R * Math.sin(angle), C - R * Math.cos(angle)];
}

/** 円グラフ。スライスのタップで onSelect を呼ぶ */
export function PieChart({ slices, onSelect }: PieProps) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const live = slices.filter((s) => s.value > 0);
  let angle = 0;
  return (
    <svg className="pie" viewBox="0 0 180 180" role="img" aria-label="時間構成の円グラフ">
      {total <= 0 && <circle cx={C} cy={C} r={R} fill="#eceff1" />}
      {live.length === 1 && (
        <circle cx={C} cy={C} r={R} fill={live[0].color} onClick={() => onSelect?.(live[0].key)} style={{ cursor: onSelect ? "pointer" : "default" }}>
          <title>{`${live[0].label} ${formatDuration(live[0].value)}`}</title>
        </circle>
      )}
      {live.length > 1 &&
        live.map((s) => {
          const a0 = angle;
          angle += (s.value / total) * Math.PI * 2;
          const [x0, y0] = point(a0);
          const [x1, y1] = point(angle);
          const large = angle - a0 > Math.PI ? 1 : 0;
          return (
            <path
              key={s.key}
              d={`M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`}
              fill={s.color}
              stroke="#fff"
              strokeWidth={1}
              onClick={() => onSelect?.(s.key)}
              style={{ cursor: onSelect ? "pointer" : "default" }}
            >
              <title>{`${s.label} ${formatDuration(s.value)}`}</title>
            </path>
          );
        })}
    </svg>
  );
}

export interface Bar {
  label: string;
  value: number;
  title: string;
}

interface BarProps {
  bars: Bar[];
  color: string;
}

const W = 320;
const H = 150;
const PAD_L = 4;
const PAD_B = 18;
const PAD_T = 14;

/** 棒グラフ（日ごとの推移）。縦軸は分を時間として扱う */
export function BarChart({ bars, color }: BarProps) {
  const max = Math.max(60, ...bars.map((b) => b.value));
  const slot = (W - PAD_L) / Math.max(1, bars.length);
  const plotH = H - PAD_B - PAD_T;
  const labelEvery = bars.length > 10 ? 5 : 1;
  const showValues = bars.length <= 7;
  return (
    <svg className="bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="日ごとの棒グラフ">
      <line x1={PAD_L} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="#cfd8dc" />
      <text x={PAD_L} y={10} fontSize={8} fill="#6b7280">{`最大 ${formatDuration(max)}`}</text>
      {bars.map((b, i) => {
        const h = (b.value / max) * plotH;
        const x = PAD_L + i * slot + slot * 0.15;
        const w = slot * 0.7;
        return (
          <g key={i}>
            <rect x={x} y={H - PAD_B - h} width={w} height={Math.max(h, b.value > 0 ? 1 : 0)} fill={color} rx={1.5}>
              <title>{b.title}</title>
            </rect>
            {showValues && b.value > 0 && (
              <text x={x + w / 2} y={H - PAD_B - h - 2} fontSize={8} textAnchor="middle" fill="#374151">{(b.value / 60).toFixed(1)}h</text>
            )}
            {i % labelEvery === 0 && (
              <text x={x + w / 2} y={H - 5} fontSize={8} textAnchor="middle" fill="#6b7280">{b.label}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** 区分別の積み上げ棒グラフ。 */
export function StackedBarChart({ days }: { days: StackedDay[] }) {
  const totals = days.map((d) => d.segments.reduce((sum, s) => sum + s.minutes, 0));
  const max = Math.max(60, ...totals);
  const slot = (W - PAD_L) / Math.max(1, days.length);
  const plotH = H - PAD_B - PAD_T;
  const labelEvery = days.length > 10 ? 5 : 1;
  return (
    <svg className="bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="日ごとの積み上げ棒グラフ">
      <line x1={PAD_L} x2={W} y1={H - PAD_B} y2={H - PAD_B} stroke="#cfd8dc" />
      <text x={PAD_L} y={10} fontSize={8} fill="#6b7280">{`最大 ${formatDuration(max)}`}</text>
      {days.map((day, i) => {
        const x = PAD_L + i * slot + slot * 0.15;
        const w = slot * 0.7;
        let used = 0;
        return (
          <g key={day.date}>
            {day.segments.map((s) => {
              const h = (s.minutes / max) * plotH;
              const y = H - PAD_B - used - h;
              used += h;
              return (
                <rect key={s.key} x={x} y={y} width={w} height={Math.max(h, s.minutes > 0 ? 1 : 0)} fill={s.color} rx={1}>
                  <title>{`${day.date} ${s.label} ${formatDuration(s.minutes)}`}</title>
                </rect>
              );
            })}
            {i % labelEvery === 0 && <text x={x + w / 2} y={H - 5} fontSize={8} textAnchor="middle" fill="#6b7280">{Number(day.date.slice(8, 10))}</text>}
          </g>
        );
      })}
    </svg>
  );
}
