import { useRef, useState } from "react";
import { backupFileName, buildBackup, summarizeBackup, validateBackup, type BackupSummary } from "./backup";
import { APP_VERSION, COLOR_HEX, COLOR_IDS, PARENT_CATEGORIES } from "./constants";
import { dateKeyOf, isDateKey, parseDateKey, timePart, toLocal, weekdayName } from "./dateUtils";
import AiMarkdownSettings from "./AiMarkdownSettings";
import IcsExportSettings from "./IcsExportSettings";
import GoogleImportSettings from "./GoogleImportSettings";
import { Icon } from "./Icon";
import { buildPhotoZip, readPhotoZip } from "./photoBackup";
import { withThumbs } from "./photos";
import { getAllPhotos } from "./storage";
import LastItemsSettings from "./LastItemsSettings";
import RecurrenceSettings from "./RecurrenceSettings";
import type { ActiveSleep, BackupFile, CalendarEvent, Marker, Nagara, ParentCategory, PlanRevision, RecurrenceRule, Settings, StartView, StoredPhoto } from "./types";

interface Props {
  settings: Settings;
  events: CalendarEvent[];
  nagara: Nagara[];
  revisions: PlanRevision[];
  recurrences: RecurrenceRule[];
  markers: Marker[];
  activeSleep: ActiveSleep | null;
  ruleMessage: string;
  onBack: () => void;
  onSaveSettings: (settings: Settings) => Promise<void>;
  onAddRule: () => void;
  onEditRule: (rule: RecurrenceRule) => void;
  onToggleRule: (rule: RecurrenceRule) => Promise<void>;
  onDeleteRecurrence: (rule: RecurrenceRule, deleteFuture: boolean) => Promise<void>;
  onRestore: (backup: BackupFile, sourceVersion: 1 | 2, photos?: StoredPhoto[]) => Promise<void>;
  onImportGoogle: (create: CalendarEvent[], update: CalendarEvent[]) => Promise<void>;
}

/** 画面に見せる日付（10月12日（月）。今年以外は年を付ける）。保存値・ファイルの中身には使わない */
function displayDate(key: string): string {
  if (!isDateKey(key)) return key;
  const d = parseDateKey(key);
  const year = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}年`;
  return `${year}${d.getMonth() + 1}月${d.getDate()}日（${weekdayName(d.getDay())}）`;
}

/** バックアップを保存した日時（ISO文字列）を、端末の時刻で見せる */
function displayDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const local = toLocal(d);
  return `${displayDate(local.slice(0, 10))} ${timePart(local)}`;
}

type SettingScreen = "home" | "start" | "week" | "plan" | "labels" | "parents" | "bedtime" | "last" | "recurrence" | "ai" | "ics" | "google" | "backup" | "about";
const SCREEN_TITLE: Record<SettingScreen, string> = {
  home: "設定", start: "起動時の表示", week: "週の始まり", plan: "予定だけで使う",
  labels: "色とカテゴリ名", parents: "親カテゴリの割り当て", bedtime: "就寝予定の時刻",
  last: "前回からの日数", recurrence: "繰り返し", ai: "AI用書き出し", ics: ".icsの書き出し",
  google: "Googleの取り込み", backup: "バックアップ", about: "このアプリについて",
};

function SettingRow({ label, value, onClick }: { label: string; value?: string; onClick: () => void }) {
  return <button type="button" className="setting-row" onClick={onClick}><span className="setting-row-name">{label}</span>{value && <span className="setting-row-value">{value}</span>}<Icon name="chevron-right" size={18} /></button>;
}

/** オン・オフはその場で切り替える（一般アプリの設定と同じ。開かない。v1.2.0） */
function SwitchRow({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting-row switch-row">
      <span className="setting-row-name">{label}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** 選ぶものの一覧（押すとすぐ反映。選んでいるものに印。v1.2.0。前はブラウザ標準の選択欄） */
function ChoiceList<T extends string | number>({ options, value, disabled, onPick }: { options: Array<{ value: T; label: string }>; value: T; disabled?: boolean; onPick: (v: T) => void }) {
  return (
    <div className="settings-menu choice-list" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className="setting-row" disabled={disabled} onClick={() => onPick(o.value)}>
          <span className="setting-row-name">{o.label}</span>
          {o.value === value && <span className="choice-check" aria-hidden="true">✓</span>}
        </button>
      ))}
    </div>
  );
}

export default function SettingsView({
  settings, events, nagara, revisions, recurrences, markers, activeSleep, ruleMessage, onBack, onSaveSettings, onAddRule, onEditRule, onToggleRule, onDeleteRecurrence, onRestore, onImportGoogle,
}: Props) {
  const [labels, setLabels] = useState<Record<string, string>>({ ...settings.colorLabels });
  const [labelMessage, setLabelMessage] = useState("");
  const [parents, setParents] = useState<Record<string, ParentCategory>>({ ...settings.categoryParents });
  const [parentMessage, setParentMessage] = useState("");
  const [weekMessage, setWeekMessage] = useState("");
  const [startMessage, setStartMessage] = useState("");
  const [planOnlyMessage, setPlanOnlyMessage] = useState("");
  const [weekdayBedtime, setWeekdayBedtime] = useState(settings.weekdayBedtime ?? "");
  const [holidayBedtime, setHolidayBedtime] = useState(settings.holidayBedtime ?? "");
  const [bedtimeMessage, setBedtimeMessage] = useState("");
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary; fileName: string; sourceVersion: 1 | 2; photos: StoredPhoto[] } | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** 復元のたびに増やし、「前回の一覧」の編集中の内容を読み直す */
  const [restoreCount, setRestoreCount] = useState(0);
  const [screen, setScreen] = useState<SettingScreen>("home");
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

  const saveBedtimes = async () => {
    setBusy(true);
    try {
      await onSaveSettings({
        ...settings,
        weekdayBedtime: weekdayBedtime || null,
        holidayBedtime: holidayBedtime || null,
      });
      setBedtimeMessage("保存しました");
    } catch (e) {
      setBedtimeMessage(e instanceof Error ? e.message : "保存できませんでした");
    }
    setBusy(false);
  };

  const exportJson = () => {
    const now = new Date();
    const backup = buildBackup(events, settings, now.toISOString(), { nagara, revisions, recurrences, markers });
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

  const exportZip = async () => {
    setBusy(true);
    try {
      const now = new Date();
      const blob = await buildPhotoZip(events, settings, { nagara, revisions, recurrences, markers }, await getAllPhotos(), now);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `calendar-backup-${dateKeyOf(now)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setRestoreError(e instanceof Error ? e.message : "写真つきで保存できませんでした"); }
    setBusy(false);
  };

  const onFile = async (file: File | undefined) => {
    setRestoreError("");
    setRestoreMessage("");
    setPending(null);
    if (!file) return;
    let parsed: unknown;
    let photos: StoredPhoto[] = [];
    try {
      if (file.name.toLowerCase().endsWith(".zip")) {
        const zip = await readPhotoZip(file);
        parsed = zip.backup;
        photos = await withThumbs(zip.photos);
      } else parsed = JSON.parse(await file.text());
    } catch {
      setRestoreError("ファイルを読み込めませんでした（壊れているか、バックアップのファイルではありません）");
      return;
    }
    const result = validateBackup(parsed);
    if (!result.ok) {
      setRestoreError(`このファイルは復元できません：${result.reason}`);
      return;
    }
    setPending({ backup: result.backup, summary: summarizeBackup(result.backup), fileName: file.name, sourceVersion: result.sourceVersion, photos });
  };

  const confirmRestore = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await onRestore(pending.backup, pending.sourceVersion, pending.photos);
      setLabels({ ...pending.backup.settings.colorLabels });
      if (pending.sourceVersion === 2) setParents({ ...pending.backup.settings.categoryParents });
      const restoredSettings = pending.sourceVersion === 2 ? pending.backup.settings : settings;
      setWeekdayBedtime(restoredSettings.weekdayBedtime ?? "");
      setHolidayBedtime(restoredSettings.holidayBedtime ?? "");
      setRestoreCount((n) => n + 1);
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
          <button type="button" className="icon-btn" aria-label={screen === "home" ? "カレンダーへ戻る" : "設定へ戻る"} onClick={screen === "home" ? onBack : () => setScreen("home")}><Icon name="chevron-left" size={24} /></button>
          <h1 className="settings-title">{SCREEN_TITLE[screen]}</h1>
        </div>
      </header>

      <div className="settings-body">
        {screen === "home" && <>
          <section className="settings-menu"><h2>表示</h2>
            <SettingRow label="起動時の表示" value={{ day: "日", week: "週", month: "月" }[settings.startView]} onClick={() => setScreen("start")} />
            <SettingRow label="週の始まり" value={`${weekdayName(settings.weekStartDay)}曜日`} onClick={() => setScreen("week")} />
            <SwitchRow label="予定だけで使う" checked={settings.planOnly === true} disabled={busy} onChange={(checked) => {
              setBusy(true);
              void onSaveSettings({ ...settings, planOnly: checked }).then(() => setPlanOnlyMessage("")).catch((err) => setPlanOnlyMessage(err instanceof Error ? err.message : "保存できませんでした")).finally(() => setBusy(false));
            }} />
            <p className="settings-foot">オンにすると実績・ながら・マーカーの入力を隠し、振り返りは予定で数えます。</p>
            {planOnlyMessage && <p className="settings-foot" role="alert">{planOnlyMessage}</p>}
          </section>
          <section className="settings-menu"><h2>記録</h2>
            <SettingRow label="色とカテゴリ名" onClick={() => setScreen("labels")} />
            <SettingRow label="親カテゴリの割り当て" onClick={() => setScreen("parents")} />
            <SettingRow label="就寝予定の時刻" value={`仕事前 ${settings.weekdayBedtime ?? "未設定"}・休日前 ${settings.holidayBedtime ?? "未設定"}`} onClick={() => setScreen("bedtime")} />
            <SettingRow label="前回からの日数の項目" onClick={() => setScreen("last")} />
            <SettingRow label="繰り返し" onClick={() => setScreen("recurrence")} />
          </section>
          <section className="settings-menu"><h2>データ</h2>
            <SettingRow label="バックアップ" onClick={() => setScreen("backup")} />
            <SettingRow label="AI用書き出し" onClick={() => setScreen("ai")} />
            <SettingRow label="ほかのカレンダーへ書き出す" onClick={() => setScreen("ics")} />
            <SettingRow label="Googleカレンダーから取り込む" onClick={() => setScreen("google")} />
          </section>
          <section className="settings-menu"><h2>このアプリについて</h2><SettingRow label="バージョン" value={APP_VERSION} onClick={() => setScreen("about")} /></section>
        </>}
        {screen === "labels" && <section>
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
        </section>}

        {screen === "parents" && <section>
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
        </section>}

        {screen === "week" && <section>
          <ChoiceList options={Array.from({ length: 7 }, (_, i) => ({ value: i, label: `${weekdayName(i)}曜日` }))} value={settings.weekStartDay} disabled={busy} onPick={(d) => void changeWeekStart(d)} />
          {weekMessage && <p className="settings-foot" role="status">{weekMessage}</p>}
        </section>}

        {screen === "start" && <section>
          <ChoiceList<StartView> options={[{ value: "day", label: "日" }, { value: "week", label: "週" }, { value: "month", label: "月" }]} value={settings.startView} disabled={busy} onPick={(v) => void changeStartView(v)} />
          <p className="settings-foot">次に開いたときから、この表示で始まります。</p>
          {startMessage && <p className="settings-foot" role="status">{startMessage}</p>}
        </section>}

        {screen === "bedtime" && <section>
          <p className="hint">明日が休み（土日・祝日・有休）なら休日前の時刻を使います。0:00〜4:59は前の日の夜の続きです。</p>
          <div className="bedtime-settings">
            <label><span>仕事前</span><input type="time" value={weekdayBedtime} onChange={(e) => { setWeekdayBedtime(e.target.value); setBedtimeMessage(""); }} /></label>
            <label><span>休日前</span><input type="time" value={holidayBedtime} onChange={(e) => { setHolidayBedtime(e.target.value); setBedtimeMessage(""); }} /></label>
          </div>
          <div className="inline-actions">
            <button type="button" className="primary-btn" onClick={saveBedtimes} disabled={busy}>就寝予定を保存</button>
            <button type="button" className="text-btn small" onClick={() => { setWeekdayBedtime(""); setHolidayBedtime(""); setBedtimeMessage(""); }} disabled={busy}>両方クリア</button>
            {bedtimeMessage && <span className="hint">{bedtimeMessage}</span>}
          </div>
        </section>}

        {screen === "last" && <LastItemsSettings key={restoreCount} settings={settings} onSaveSettings={onSaveSettings} />}

        {screen === "recurrence" && <RecurrenceSettings
          recurrences={recurrences}
          message={ruleMessage}
          onAdd={onAddRule}
          onEdit={onEditRule}
          onToggle={onToggleRule}
          onDelete={onDeleteRecurrence}
        />}

        {screen === "ai" && <AiMarkdownSettings settings={settings} events={events} nagara={nagara} revisions={revisions} markers={markers} activeSleep={activeSleep} />}

        {screen === "ics" && <IcsExportSettings events={events} />}

        {screen === "google" && <GoogleImportSettings events={events} onImport={onImportGoogle} />}

        {screen === "backup" && <section>
          <p className="hint">現在 {events.length} 件の予定・実績、{nagara.length} 件のながら・場所、{markers.length} 件のマーカーがあります。</p>
          <div className="settings-menu">
            <button type="button" className="setting-row" onClick={exportJson}><span className="setting-row-name">バックアップを保存</span><span className="setting-row-value">写真なし</span></button>
            <button type="button" className="setting-row" onClick={() => void exportZip()} disabled={busy}><span className="setting-row-name">写真つきで保存</span></button>
            <label className="setting-row file-row">
              <span className="setting-row-name">バックアップから読み込む</span>
              <input ref={fileRef} type="file" accept="application/json,.json,application/zip,.zip" onChange={(e) => { void onFile(e.target.files?.[0]); }} />
            </label>
          </div>
          <p className="settings-foot">写真なしのバックアップには写真の本体が入りません。写真も残すときは「写真つきで保存」を使ってください。</p>
          {restoreError && <p className="notice error" role="alert">{restoreError}</p>}
          {restoreMessage && <p className="notice ok">{restoreMessage}</p>}
          {pending && (
            <div className="preview">
              <p><strong>{pending.fileName}</strong></p>
              <p>
                {pending.summary.count}件
                {pending.summary.from && pending.summary.to ? `（${displayDate(pending.summary.from)}〜${displayDate(pending.summary.to)}）` : ""}
                ・保存した日時 {displayDateTime(pending.backup.exportedAt)}
              </p>
              <p className="hint">
                同じ予定・実績・ながら・マーカーは上書きされ、それ以外は追加されます。色とカテゴリ名・前回の一覧の設定は上書きされます
                {pending.sourceVersion === 1 ? "（古い形式のバックアップなので、週の始まり・親カテゴリ・前回の一覧は今の設定のままです）" : ""}。
              </p>
              <div className="inline-actions">
                <button type="button" className="primary-btn" onClick={confirmRestore} disabled={busy}>この内容を読み込む</button>
                <button type="button" className="secondary-btn" onClick={cancelRestore} disabled={busy}>やめる</button>
              </div>
            </div>
          )}
        </section>}

        {screen === "about" && <section>
          <ul className="about">
            <li>データはこの端末のブラウザ内にだけ保存されます。サーバーには送信されません。</li>
            <li>ブラウザのデータ消去や端末の故障で失われることがあるため、定期的に「バックアップを保存」でバックアップしてください。</li>
            <li>バージョン {APP_VERSION}</li>
          </ul>
        </section>}
      </div>
    </div>
  );
}
