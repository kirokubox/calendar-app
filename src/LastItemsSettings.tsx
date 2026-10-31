import { useState } from "react";
import { moveItem } from "./eventLogic";
import { Icon } from "./Icon";
import { migrateLastItems } from "./migrate";
import { newId } from "./storage";
import type { LastItem, Settings } from "./types";

interface Props {
  settings: Settings;
  onSaveSettings: (settings: Settings) => Promise<void>;
}

interface Draft {
  id: string;
  name: string;
  /** 入力中の文字。空は目安なし */
  target: string;
}

const toDraft = (items: LastItem[]): Draft[] => items.map((x) => ({ id: x.id, name: x.name, target: x.targetDays === null ? "" : String(x.targetDays) }));

/** 設定画面の「前回の一覧」：検索画面に出す項目の追加・名前の変更・並べ替え・削除と、目安の日数 */
export default function LastItemsSettings({ settings, onSaveSettings }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(() => toDraft(settings.lastItems));
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const change = (next: Draft[]) => { setDrafts(next); setMessage(""); };
  const patch = (i: number, p: Partial<Draft>) => change(drafts.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const badTarget = drafts.some((d) => d.target.trim() !== "" && !/^[1-9]\d{0,3}$/.test(d.target.trim()));

  const add = () => {
    const name = newName.trim();
    if (name === "") return;
    change([...drafts, { id: newId(), name, target: "" }]);
    setNewName("");
  };

  const save = async () => {
    setBusy(true);
    try {
      const items = migrateLastItems(drafts.map((d) => ({ id: d.id, name: d.name, targetDays: d.target.trim() === "" ? null : Number(d.target.trim()) })));
      await onSaveSettings({ ...settings, lastItems: items });
      setDrafts(toDraft(items));
      setMessage("保存しました");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  return (
    <section id="last-items">
      <h2>前回の一覧</h2>
      <p className="hint">
        検索画面で、言葉を入れる前に「前回から何日か」を久しぶりな順に並べる項目です（例：サウナ、散歩、美容院、シーツ替え）。
        名前で予定以外の記録（イベント・ながら・場所・マーカー）を探します。目安の日数を入れると、超えたときに色で知らせます。
      </p>
      {drafts.length === 0 && <p className="hint">項目はまだありません。</p>}
      <ul className="last-edit-list">
        {drafts.map((d, i) => (
          <li key={d.id}>
            <input
              type="text"
              className="last-edit-name"
              value={d.name}
              maxLength={30}
              placeholder="（名前が空なら保存時に消えます）"
              aria-label={`${i + 1}番目の項目の名前`}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
            <label className="last-edit-target">
              目安
              <input
                type="text"
                inputMode="numeric"
                value={d.target}
                placeholder="なし"
                maxLength={4}
                aria-label={`${d.name || `${i + 1}番目の項目`}の目安の日数`}
                onChange={(e) => patch(i, { target: e.target.value })}
              />
              日
            </label>
            <button type="button" className="chip-mini" aria-label={`${d.name}を上へ`} disabled={i === 0} onClick={() => change(moveItem(drafts, i, -1))}><Icon name="chevron-up" size={16} /></button>
            <button type="button" className="chip-mini" aria-label={`${d.name}を下へ`} disabled={i === drafts.length - 1} onClick={() => change(moveItem(drafts, i, 1))}><Icon name="chevron-down" size={16} /></button>
            <button type="button" className="chip-mini" aria-label={`${d.name}を削除`} onClick={() => change(drafts.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
          </li>
        ))}
      </ul>
      <form className="chip-add" onSubmit={(ev) => { ev.preventDefault(); add(); }}>
        <input type="text" value={newName} maxLength={30} placeholder="追加する項目（例：サウナ）" aria-label="追加する項目の名前" onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="secondary-btn small" disabled={newName.trim() === ""}>追加</button>
      </form>
      {badTarget && <p className="notice error" role="alert">目安の日数は1〜9999の整数で入れてください（空なら目安なし）。</p>}
      <div className="inline-actions">
        <button type="button" className="primary-btn" onClick={save} disabled={busy || badTarget}>前回の一覧を保存</button>
        {message && <span className="hint">{message}</span>}
      </div>
    </section>
  );
}
