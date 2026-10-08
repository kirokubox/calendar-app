import { useRef, useState } from "react";
import { backupFileName, buildBackup, summarizeBackup, validateBackup, type BackupSummary } from "./backup";
import { APP_VERSION, COLOR_HEX, COLOR_IDS } from "./constants";
import { dateKeyOf } from "./dateUtils";
import type { BackupFile, CalendarEvent, Settings } from "./types";

interface Props {
  settings: Settings;
  events: CalendarEvent[];
  onBack: () => void;
  onSaveSettings: (settings: Settings) => Promise<void>;
  onRestore: (backup: BackupFile) => Promise<void>;
}

export default function SettingsView({ settings, events, onBack, onSaveSettings, onRestore }: Props) {
  const [labels, setLabels] = useState<Record<string, string>>({ ...settings.colorLabels });
  const [labelMessage, setLabelMessage] = useState("");
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary; fileName: string } | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows: Array<{ key: string; name: string }> = [
    { key: "default", name: "色指定なし" },
    ...COLOR_IDS.map((id) => ({ key: id, name: `色${id}` })),
  ];

  const saveLabels = async () => {
    setBusy(true);
    try {
      const trimmed: Record<string, string> = {};
      for (const [k, v] of Object.entries(labels)) trimmed[k] = v.trim();
      await onSaveSettings({ schemaVersion: 1, colorLabels: trimmed });
      setLabels(trimmed);
      setLabelMessage("保存しました");
    } catch (e) {
      setLabelMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const exportJson = () => {
    const now = new Date();
    const backup = buildBackup(events, settings, now.toISOString());
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(dateKeyOf(now));
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = async (file: File | undefined) => {
    setRestoreError("");
    setRestoreMessage("");
    setPending(null);
    if (!file) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setRestoreError("JSONとして読み込めませんでした（ファイルが壊れているか、JSONではありません）");
      return;
    }
    const result = validateBackup(parsed);
    if (!result.ok) {
      setRestoreError(`このファイルは復元できません：${result.reason}`);
      return;
    }
    setPending({ backup: result.backup, summary: summarizeBackup(result.backup), fileName: file.name });
  };

  const confirmRestore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await onRestore(pending.backup);
      setLabels({ ...pending.backup.settings.colorLabels });
      setRestoreMessage(`${pending.summary.count}件を読み込みました`);
      setPending(null);
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : "読み込めませんでした");
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const cancelRestore = () => {
    setPending(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="settings">
      <header className="topbar">
        <div className="topbar-row">
          <button type="button" className="text-btn" onClick={onBack}>← カレンダーへ</button>
          <h1 className="settings-title">設定</h1>
        </div>
      </header>

      <div className="settings-body">
        <section>
          <h2>色とカテゴリ名</h2>
          <p className="hint">色ごとにカテゴリ名を付けられます。名前を空にすると「他の色」に入ります。</p>
          <ul className="label-list">
            {rows.map((r) => (
              <li key={r.key}>
                <i className="dot" style={{ background: COLOR_HEX[r.key] }} />
                <span className="label-name">{r.name}</span>
                <input
                  type="text"
                  value={labels[r.key] ?? ""}
                  placeholder="（名前なし）"
                  maxLength={30}
                  onChange={(e) => { setLabels({ ...labels, [r.key]: e.target.value }); setLabelMessage(""); }}
                  aria-label={`${r.name}のカテゴリ名`}
                />
              </li>
            ))}
          </ul>
          <div className="inline-actions">
            <button type="button" className="primary-btn" onClick={saveLabels} disabled={busy}>カテゴリ名を保存</button>
            {labelMessage && <span className="hint">{labelMessage}</span>}
          </div>
        </section>

        <section>
          <h2>バックアップ</h2>
          <p className="hint">現在 {events.length} 件の予定・実績があります。</p>
          <div className="inline-actions">
            <button type="button" className="secondary-btn" onClick={exportJson}>JSONで書き出す</button>
            <label className="secondary-btn file-btn">
              JSONから復元
              <input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </div>
          {restoreError && <p className="notice error" role="alert">{restoreError}</p>}
          {restoreMessage && <p className="notice ok">{restoreMessage}</p>}
          {pending && (
            <div className="preview">
              <p><strong>{pending.fileName}</strong></p>
              <p>
                {pending.summary.count}件
                {pending.summary.from && pending.summary.to ? `（${pending.summary.from} 〜 ${pending.summary.to}）` : ""}
                ・書き出し日時 {pending.backup.exportedAt.slice(0, 16).replace("T", " ")}
              </p>
              <p className="hint">同じidの予定・実績は上書きされ、それ以外は追加されます。色とカテゴリ名の設定は上書きされます。</p>
              <div className="inline-actions">
                <button type="button" className="primary-btn" onClick={confirmRestore} disabled={busy}>この内容を読み込む</button>
                <button type="button" className="secondary-btn" onClick={cancelRestore} disabled={busy}>やめる</button>
              </div>
            </div>
          )}
        </section>

        <section>
          <h2>このアプリについて</h2>
          <ul className="about">
            <li>データはこの端末のブラウザ内にだけ保存されます。サーバーには送信されません。</li>
            <li>ブラウザのデータ消去や端末の故障で失われることがあるため、定期的に「JSONで書き出す」でバックアップしてください。</li>
            <li>バージョン {APP_VERSION}</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
