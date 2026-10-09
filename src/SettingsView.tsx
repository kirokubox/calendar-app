import { useRef, useState } from "react";
import { backupFileName, buildBackup, summarizeBackup, validateBackup, type BackupSummary } from "./backup";
import { APP_VERSION, COLOR_HEX, COLOR_IDS, PARENT_CATEGORIES } from "./constants";
import { dateKeyOf, weekdayName } from "./dateUtils";
import AiMarkdownSettings from "./AiMarkdownSettings";
import GoogleImportSettings from "./GoogleImportSettings";
import RecurrenceSettings from "./RecurrenceSettings";
import type { BackupFile, CalendarEvent, Nagara, ParentCategory, PlanRevision, RecurrenceRule, Settings, StartView } from "./types";

interface Props {
  settings: Settings;
  events: CalendarEvent[];
  nagara: Nagara[];
  revisions: PlanRevision[];
  recurrences: RecurrenceRule[];
  ruleMessage: string;
  onBack: () => void;
  onSaveSettings: (settings: Settings) => Promise<void>;
  onAddRule: () => void;
  onEditRule: (rule: RecurrenceRule) => void;
  onToggleRule: (rule: RecurrenceRule) => Promise<void>;
  onDeleteRecurrence: (rule: RecurrenceRule, deleteFuture: boolean) => Promise<void>;
  onRestore: (backup: BackupFile, sourceVersion: 1 | 2) => Promise<void>;
  onImportGoogle: (create: CalendarEvent[], update: CalendarEvent[]) => Promise<void>;
}

export default function SettingsView({
  settings, events, nagara, revisions, recurrences, ruleMessage, onBack, onSaveSettings, onAddRule, onEditRule, onToggleRule, onDeleteRecurrence, onRestore, onImportGoogle,
}: Props) {
  const [labels, setLabels] = useState<Record<string, string>>({ ...settings.colorLabels });
  const [labelMessage, setLabelMessage] = useState("");
  const [parents, setParents] = useState<Record<string, ParentCategory>>({ ...settings.categoryParents });
  const [parentMessage, setParentMessage] = useState("");
  const [weekMessage, setWeekMessage] = useState("");
  const [startMessage, setStartMessage] = useState("");
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary; fileName: string; sourceVersion: 1 | 2 } | null>(null);
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
      await onSaveSettings({ ...settings, colorLabels: trimmed });
      setLabels(trimmed);
      setLabelMessage("保存しました");
    } catch (e) {
      setLabelMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const saveParents = async () => {
    setBusy(true);
    try {
      await onSaveSettings({ ...settings, categoryParents: parents });
      setParentMessage("保存しました");
    } catch (e) {
      setParentMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const changeWeekStart = async (day: number) => {
    setBusy(true);
    try {
      await onSaveSettings({ ...settings, weekStartDay: day });
      setWeekMessage("保存しました");
    } catch (e) {
      setWeekMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const changeStartView = async (view: StartView) => {
    setBusy(true);
    try {
      await onSaveSettings({ ...settings, startView: view });
      setStartMessage("保存しました（次に開いたときから）");
    } catch (e) {
      setStartMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const exportJson = () => {
    const now = new Date();
    const backup = buildBackup(events, settings, now.toISOString(), { nagara, revisions, recurrences });
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
    setPending({ backup: result.backup, summary: summarizeBackup(result.backup), fileName: file.name, sourceVersion: result.sourceVersion });
  };

  const confirmRestore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await onRestore(pending.backup, pending.sourceVersion);
      setLabels({ ...pending.backup.settings.colorLabels });
      if (pending.sourceVersion === 2) setParents({ ...pending.backup.settings.categoryParents });
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
          <h2>親カテゴリの割り当て</h2>
          <p className="hint">色ごとに、振り返りで使う親カテゴリ（睡眠・生活・仕事・自由時間・その他）を選びます。</p>
          <ul className="label-list">
            {rows.map((r) => (
              <li key={r.key}>
                <i className="dot" style={{ background: COLOR_HEX[r.key] }} />
                <span className="label-name">{(labels[r.key] ?? "").trim() || r.name}</span>
                <select
                  value={parents[r.key] ?? "その他"}
                  aria-label={`${r.name}の親カテゴリ`}
                  onChange={(e) => { setParents({ ...parents, [r.key]: e.target.value as ParentCategory }); setParentMessage(""); }}
                >
                  {PARENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <div className="inline-actions">
            <button type="button" className="primary-btn" onClick={saveParents} disabled={busy}>親カテゴリを保存</button>
            {parentMessage && <span className="hint">{parentMessage}</span>}
          </div>
        </section>

        <section>
          <h2>週の始まり</h2>
          <div className="inline-actions">
            <select
              value={settings.weekStartDay}
              aria-label="週の始まりの曜日"
              disabled={busy}
              onChange={(e) => changeWeekStart(Number(e.target.value))}
            >
              {Array.from({ length: 7 }, (_, i) => <option key={i} value={i}>{weekdayName(i)}曜日</option>)}
            </select>
            {weekMessage && <span className="hint">{weekMessage}</span>}
          </div>
        </section>

        <section>
          <h2>起動時の表示</h2>
          <div className="inline-actions">
            <select
              value={settings.startView}
              aria-label="起動時の表示"
              disabled={busy}
              onChange={(e) => changeStartView(e.target.value as StartView)}
            >
              <option value="day">日</option>
              <option value="week">週</option>
              <option value="month">月</option>
            </select>
            {startMessage && <span className="hint">{startMessage}</span>}
          </div>
        </section>

        <RecurrenceSettings
          recurrences={recurrences}
          message={ruleMessage}
          onAdd={onAddRule}
          onEdit={onEditRule}
          onToggle={onToggleRule}
          onDelete={onDeleteRecurrence}
        />

        <AiMarkdownSettings settings={settings} events={events} nagara={nagara} revisions={revisions} />

        <GoogleImportSettings events={events} onImport={onImportGoogle} />

        <section>
          <h2>バックアップ</h2>
          <p className="hint">現在 {events.length} 件の予定・実績、{nagara.length} 件のながら・場所があります。</p>
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
              <p className="hint">
                同じidの予定・実績・ながらは上書きされ、それ以外は追加されます。色とカテゴリ名の設定は上書きされます
                {pending.sourceVersion === 1 ? "（古い形式のバックアップなので、週の始まりと親カテゴリは今の設定のままです）" : ""}。
              </p>
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
