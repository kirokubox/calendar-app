import { useState } from "react";
import { COLOR_HEX } from "./constants";
import { formatShortDate, weekdayName } from "./dateUtils";
import type { RecurrenceRule } from "./types";

interface Props {
  recurrences: RecurrenceRule[];
  /** 直前の操作の結果（保存・停止・削除） */
  message: string;
  onAdd: () => void;
  onEdit: (rule: RecurrenceRule) => void;
  onToggle: (rule: RecurrenceRule) => Promise<void>;
  onDelete: (rule: RecurrenceRule, deleteFuture: boolean) => Promise<void>;
}

/** 曜日を月〜日の順で並べる（0=日は最後） */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function summary(r: RecurrenceRule): string {
  const days = WEEKDAY_ORDER.filter((d) => r.weekdays.includes(d)).map(weekdayName).join("");
  const period = `${formatShortDate(r.startDate)}〜${r.endDate ? formatShortDate(r.endDate) : "終了日未設定（56日先まで）"}`;
  return `${days}${r.excludeHolidays ? "（祝日除く）" : ""}　${r.startTime}〜${r.endTime}${r.endTime <= r.startTime ? "（翌日）" : ""}　${period}`;
}

/** 設定画面の「繰り返し予定」：ルールの一覧。追加・編集は共通の入力モーダルで開く */
export default function RecurrenceSettings({ recurrences, message, onAdd, onEdit, onToggle, onDelete }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sorted = [...recurrences].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const remove = (r: RecurrenceRule) => {
    const deleteFuture = window.confirm("ルールと一緒に、今日以降の未編集予定も削除しますか？\n\nOK：ルール＋未来の未編集予定\nキャンセル：次の確認でルールだけ削除できます");
    if (!deleteFuture && !window.confirm("ルールだけ削除しますか？\n作成済みの予定は残ります。")) return;
    void run(() => onDelete(r, deleteFuture));
  };

  return (
    <section>
      <h2>繰り返し予定</h2>
      <p className="hint">
        選んだ曜日の予定を、開始日（または今日）から終了日まで作ります。ルールを編集すると、今日以降の未編集の予定へ反映します。
        個別に変えた・キャンセルした・実績がある予定と、手で消した日はそのままです。カレンダー上の予定からも「この予定だけ／この日以降」で編集できます。
      </p>
      <div className="inline-actions">
        <button type="button" className="secondary-btn" disabled={busy} onClick={onAdd}>ルールを追加</button>
        {message && <span className="hint">{message}</span>}
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {sorted.length === 0 && <p className="hint">ルールはまだありません。</p>}
      <ul className="rule-list">
        {sorted.map((r) => (
          <li key={r.id} className={r.active ? "" : "off"}>
            <i className="dot" style={{ background: COLOR_HEX[r.colorId ?? "default"], width: 14, height: 14, borderRadius: "50%", flex: "none" }} />
            <span className="rule-main"><strong>{r.title}{r.active ? "" : "（停止中）"}</strong>{summary(r)}</span>
            <button type="button" className="secondary-btn small" disabled={busy} onClick={() => onEdit(r)}>編集</button>
            <button type="button" className="secondary-btn small" disabled={busy} onClick={() => void run(() => onToggle(r))}>{r.active ? "停止" : "再開"}</button>
            <button type="button" className="danger-btn small" disabled={busy} onClick={() => remove(r)}>削除</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
