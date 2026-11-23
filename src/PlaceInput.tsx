import { useRef, useState } from "react";
import { PLACE_KINDS } from "./constants";
import { addChipValue, moveItem, recentQuickCandidates } from "./eventLogic";
import { Icon } from "./Icon";
import { formatPlace, parsePlace } from "./placeLogic";
import type { PlaceKind } from "./types";

interface Props {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: string[];
  fixed: string[];
  listId: string;
  priority?: string[];
  previous?: string[];
}

/**
 * 場所・移動の入力：大分類（家・職場・作業場・飲食店・外出先・移動）を選び、詳しい名前を自由に入れて追加する。
 * 1件は「大分類＞名前」の文字で持つ（大分類だけ・名前だけでもよい）。順番は上下で入れ替えられる。
 */
export default function PlaceInput({ values, onChange, suggestions, fixed, listId, priority = [], previous = [] }: Props) {
  const [kind, setKind] = useState<PlaceKind | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const add = (value: string) => {
    if (value.trim() === "") return;
    onChange(addChipValue(values, value));
    setText("");
    setOpen(false);
    setKind(null);
  };
  // 候補から「飲食店＞サイゼリヤ」のような大分類つきを選んだときは、そのまま使う
  const addDraft = () => add(parsePlace(text).kind ? text : formatPlace(kind, text));

  /**
   * よく使う候補を押したとき。大分類つきはそのまま追加。大分類のない昔の名前は、大分類を選んでいればそれを付けて追加し、
   * 選んでいなければ名前欄に入れる（大分類を選んでから追加できる）
   */
  const pickQuick = (s: string) => {
    if (parsePlace(s).kind) add(s);
    else if (kind) add(formatPlace(kind, s));
    else {
      setOpen(true);
      setText(s);
      inputRef.current?.focus();
    }
  };

  // 候補は「＋」を先頭に、最近使った5つだけ。使ったことが無いときだけ固定の候補（家・職場など）で埋める
  const quick = recentQuickCandidates(priority, [...suggestions, ...fixed], values);
  const canAdd = kind !== null || text.trim() !== "";

  return (
    <div className="chip-input place-input">
      <span className="field-label">場所・移動</span>
      {values.length > 0 && (
        <ul className="chip-list">
          {values.map((v, i) => (
            <li key={v} className="chip place-chip">
              <button type="button" className="place-chip-text" aria-expanded={activeChip === v} onClick={() => setActiveChip(activeChip === v ? null : v)}>{v}</button>
              {activeChip === v && <>
                <button type="button" className="place-chip-move" disabled={i === 0} onClick={() => onChange(moveItem(values, i, -1))}>前へ</button>
                <button type="button" className="place-chip-move" disabled={i === values.length - 1} onClick={() => onChange(moveItem(values, i, 1))}>後ろへ</button>
              </>}
              <button type="button" className="chip-mini" aria-label={`${v}を外す`} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="x" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="place-kinds" role="group" aria-label="場所の大分類">
        {PLACE_KINDS.map((k) => (
          <button key={k} type="button" className={`place-kind${kind === k ? " selected" : ""}`} aria-pressed={kind === k} onPointerDown={(e) => e.preventDefault()} onClick={() => setKind(kind === k ? null : k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="quick-list place-quick-list"><button type="button" className="quick quick-add" aria-label="場所を新しく追加" aria-expanded={open} onClick={() => setOpen((value) => !value)}>＋</button>{previous.length > 0 && <button type="button" className="quick" onClick={() => onChange([...values, ...previous])}>さっきと同じ</button>}{quick.map((s) => <button key={s} type="button" className="quick" onPointerDown={(e) => e.preventDefault()} onClick={() => pickQuick(s)}>{s}</button>)}</div>
      {open && <div className="chip-add">
        <input
          ref={inputRef}
          type="text"
          value={text}
          list={listId}
          placeholder={kind ? `${kind}の名前（なくてもよい）` : "大分類を選んで、店名・駅名など"}
          aria-label="場所・移動を追加"
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => {
            // 入れかけの名前は、ほかへ移ったときに追加する。大分類のボタンは入力欄からフォーカスを奪わない（onPointerDown）が、念のため除く
            if (text.trim() === "" || (e.relatedTarget instanceof HTMLElement && e.relatedTarget.classList.contains("place-kind"))) return;
            addDraft();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addDraft(); }
          }}
        />
        <button type="button" className="secondary-btn small" onClick={addDraft} disabled={!canAdd}>追加</button>
      </div>}
      <datalist id={listId}>
        {[...suggestions, ...fixed.filter((f) => !suggestions.includes(f))].map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}
