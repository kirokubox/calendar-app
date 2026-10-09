import { useState } from "react";
import { addChipValue, moveItem, quickCandidates } from "./eventLogic";

interface Props {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: string[];
  placeholder?: string;
  /** 順番を上下で入れ替えられるか（場所） */
  reorderable?: boolean;
  listId: string;
  /** 固定候補（履歴候補より先に出す） */
  fixed?: string[];
}

/** 人・場所の入力：入力して追加するチップ式。候補はdatalistと、よく使うもののワンタップ追加で出す */
export default function ChipInput({ label, values, onChange, suggestions, placeholder, reorderable, listId, fixed = [] }: Props) {
  const [text, setText] = useState("");

  const add = (value: string) => {
    onChange(addChipValue(values, value));
    setText("");
  };

  const quick = quickCandidates(fixed, suggestions, values);

  return (
    <div className="chip-input">
      <span className="field-label">{label}</span>
      {values.length > 0 && (
        <ul className="chip-list">
          {values.map((v, i) => (
            <li key={v} className="chip">
              {reorderable && (
                <>
                  <button type="button" className="chip-mini" aria-label={`${v}を前へ`} disabled={i === 0} onClick={() => onChange(moveItem(values, i, -1))}>▲</button>
                  <button type="button" className="chip-mini" aria-label={`${v}を後ろへ`} disabled={i === values.length - 1} onClick={() => onChange(moveItem(values, i, 1))}>▼</button>
                </>
              )}
              <span className="chip-text">{v}</span>
              <button type="button" className="chip-mini" aria-label={`${v}を外す`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="chip-add">
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
      </div>
      <datalist id={listId}>
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
