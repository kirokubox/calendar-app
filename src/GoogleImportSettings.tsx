import { useRef, useState } from "react";
import { parseGoogleImport, planGoogleImport, type ImportPlan } from "./googleImport";
import { newId } from "./storage";
import type { CalendarEvent } from "./types";

interface Props {
  events: CalendarEvent[];
  /** 新規・更新をまとめて1トランザクションで保存する */
  onImport: (create: CalendarEvent[], update: CalendarEvent[]) => Promise<void>;
}

interface Pending {
  fileName: string;
  plan: ImportPlan;
  total: number;
  skippedCount: number;
  skipped: string[];
  duplicates: number;
}

/** 設定画面の「Googleカレンダーから取り込む」：プレビュー（新規・更新・変更なし・保持）→確認後に読み込む */
export default function GoogleImportSettings({ events, onImport }: Props) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPending(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    setError("");
    setMessage("");
    setPending(null);
    if (!file) return;
    setBusy(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        setError("JSONとして読み込めませんでした（ファイルが壊れているか、JSONではありません）");
        return;
      }
      const result = parseGoogleImport(parsed);
      if (!result.ok) {
        setError(`このファイルは取り込めません：${result.reason}`);
        return;
      }
      const plan = planGoogleImport(result.items, events, new Date().toISOString(), newId);
      setPending({
        fileName: file.name, plan, total: result.items.length, skippedCount: result.skippedCount, skipped: result.skipped, duplicates: result.duplicates,
      });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await onImport(pending.plan.create, pending.plan.update);
      setMessage(`取り込みました（新規${pending.plan.create.length}件・更新${pending.plan.update.length}件）`);
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り込めませんでした");
    }
    setBusy(false);
  };

  return (
    <section>
      <h2>Googleカレンダーから取り込む</h2>
      <p className="hint">
        取り込み用のJSONファイルを読み込みます。取り込んだものは種別「不明」になり、振り返りでは実績と同じく集計されます。
        取り込み後にアプリで編集したものは、次回の取り込みで上書きしません。
      </p>
      <div className="inline-actions">
        <label className="secondary-btn file-btn">
          取り込みJSONを選ぶ
          <input ref={fileRef} type="file" accept="application/json,.json" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice ok">{message}</p>}
      {pending && (
        <div className="preview">
          <p><strong>{pending.fileName}</strong>（{pending.total}件）</p>
          <ul className="import-counts">
            <li>新規：{pending.plan.create.length}件</li>
            <li>更新：{pending.plan.update.length}件</li>
            <li>変更なし：{pending.plan.unchanged}件</li>
            <li>保持（アプリで編集済み）：{pending.plan.kept}件</li>
          </ul>
          {pending.skippedCount > 0 && (
            <div className="notice error">
              <p>形式が不正なため {pending.skippedCount} 件を読み飛ばします。</p>
              <ul>{pending.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          )}
          {pending.duplicates > 0 && <p className="hint">同じ googleEventId が {pending.duplicates} 件重複していたため、後のものを使います。</p>}
          <div className="inline-actions">
            <button type="button" className="primary-btn" onClick={confirm} disabled={busy || pending.plan.create.length + pending.plan.update.length === 0}>
              この内容で取り込む
            </button>
            <button type="button" className="secondary-btn" onClick={reset} disabled={busy}>やめる</button>
          </div>
        </div>
      )}
    </section>
  );
}
