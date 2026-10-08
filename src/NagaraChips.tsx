import { useState } from "react";
import { timePart } from "./dateUtils";
import type { NagaraDraft } from "./nagaraLogic";
import { newId } from "./storage";

interface Props {
  drafts: NagaraDraft[];
  onChange: (drafts: NagaraDraft[]) => void;
  suggestions: string[];
  /** イベントの現在の開始・終了。時間を指定するときの初期値 */
  eventStart: string;
  eventEnd: string;
}

function chipTime(d: NagaraDraft): string {
  return d.start !== null && d.end !== null ? ` ${timePart(d.start)}–${timePart(d.end)}` : "";
}

/** イベントの基本画面のながら欄：ラベルを入力して追加するチップ式。チップをタップすると時間（任意）を設定できる */
export default function NagaraChips({ drafts, onChange, suggestions, eventStart, eventEnd }: Props) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const add = (value: string) => {
    const label = value.trim();
    setText("");
    if (label === "") return;
    // 時間なし（イベント全体）の同名がすでにあれば追加しない
    if (drafts.some((d) => d.label === label && d.start === null)) return;
    onChange([...drafts, { key: newId(), id: null, label, start: null, end: null }]);
  };

  const update = (key: string, patch: Partial<NagaraDraft>) => onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const remove = (key: string) => {
    onChange(drafts.filter((d) => d.key !== key));
    if (selected === key) setSelected(null);
  };

  const quick = suggestions.filter((s) => !drafts.some((d) => d.label === s)).slice(0, 6);
  const sel = drafts.find((d) => d.key === selected) ?? null;

  return (
    <div className="chip-input nagara-chips">
      <span className="field-label">ながら</span>
      {drafts.length > 0 && (
        <ul className="chip-list">
          {drafts.map((d) => (
            <li key={d.key} className={`chip nagara-chip ${selected === d.key ? "selected" : ""}`}>
              <button
                type="button"
                className="chip-body"
                aria-pressed={selected === d.key}
                aria-label={`${d.label}の時間を設定`}
                onClick={() => setSelected(selected === d.key ? null : d.key)}
              >
                ＋{d.label}{chipTime(d)}
              </button>
              <button type="button" className="chip-mini" aria-label={`${d.label}を外す`} onClick={() => remove(d.key)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {sel && (
        <div className="nagara-time">
          <label className="check-row">
            <input
              type="checkbox"
              checked={sel.start !== null}
              onChange={(e) => update(sel.key, e.target.checked ? { start: eventStart, end: eventEnd } : { start: null, end: null })}
            />
            時間を指定（オフ＝イベント全体）
          </label>
          {sel.start !== null && sel.end !== null && (
            <div className="time-row">
              <input
                className="date-small"
                type="datetime-local"
                value={sel.start}
                aria-label={`${sel.label}の開始`}
                onChange={(e) => e.target.value && update(sel.key, { start: e.target.value })}
              />
              <span>〜</span>
              <input
                className="date-small"
                type="datetime-local"
                value={sel.end}
                aria-label={`${sel.label}の終了`}
                onChange={(e) => e.target.value && update(sel.key, { end: e.target.value })}
              />
            </div>
          )}
        </div>
      )}
      <div className="chip-add">
        <input
          type="text"
          value={text}
          list="nagara-label-suggestions"
          placeholder="例：YouTube"
          aria-label="ながらを追加"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => add(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(text); }
          }}
        />
        <button type="button" className="secondary-btn small" onClick={() => add(text)} disabled={text.trim() === ""}>追加</button>
      </div>
      <datalist id="nagara-label-suggestions">
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      {quick.length > 0 && (
        <div className="quick-list">
          {quick.map((s) => <button key={s} type="button" className="quick" onClick={() => add(s)}>＋{s}</button>)}
        </div>
      )}
    </div>
  );
}
