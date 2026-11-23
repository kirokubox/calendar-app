import { useState } from "react";
import { addChipValue, moveItem, recentQuickCandidates } from "./eventLogic";
import { Icon } from "./Icon";

interface Props {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  /** 順番を上下で入れ替えられるか（場所） */
  reorderable?: boolean;
  listId: string;
  /** 選んだ色で最近使った名前（新しい順）。ワンタップ候補の先頭に出す */
  priority?: string[];
}

/** 人・場所の入力：入力して追加するチップ式。候補はdatalistと、よく使うもののワンタップ追加で出す */
export default function ChipInput({ label, values, onChange, suggestions, placeholder, reorderable, listId, priority = [] }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);

  const add = (value: string) => {
    onChange(addChipValue(values, value));
    setText("");
    setOpen(false);
  };

  // 候補は「＋」を先頭に、最近使った5つだけ（2026-11-23 本人「＋が一番左、横スクロールは直近の5つでいい」）
  const quick = recentQuickCandidates(priority, suggestions, values);

  return (
    <div className="chip-input">
      <span className="field-label">{label}</span>
      {values.length > 0 && (
        <ul className="chip-list">
          {values.map((v, i) => (
            <li key={v} className="chip">
              {reorderable && (
                <>
                  <button type="button" className="chip-mini" aria-label={`${v}を前へ`} disabled={i === 0} onClick={() => onChange(moveItem(values, i, -1))}><Icon name="chevron-up" size={16} /></button>
                  <button type="button" className="chip-mini" aria-label={`${v}を後ろへ`} disabled={i === values.length - 1} onClick={() => onChange(moveItem(values, i, 1))}><Icon name="chevron-down" size={16} /></button>
                </>
              )}
              <span className="chip-text">{v}</span>
              <button type="button" className="chip-mini" aria-label={`${v}を外す`} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="quick-list"><button type="button" className="quick quick-add" aria-label={`${label}を新しく追加`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>＋</button>{quick.map((s) => <button key={s} type="button" className="quick" onClick={() => add(s)}>{s}</button>)}</div>
      {open && <div className="chip-add">
        <input
          type="text"
          value={text}
          list={listId}
          placeholder={placeholder}
          aria-label={`${label}を追加`}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text.trim() !== "") add(text); }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); add(text); }
          }}
        />
        <button type="button" className="secondary-btn small" onClick={() => add(text)} disabled={text.trim() === ""}>追加</button>
      </div>}
      <datalist id={listId}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
