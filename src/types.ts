export type EventKind = "plan" | "actual" | "unknown";
/** "1"〜"11"（Googleカレンダーと同じ体系）。null＝色指定なし */
export type ColorId = string | null;
export type EventStatus = "active" | "cancelled";
export type EventSource = "app" | "google";

export interface CalendarEvent {
  id: string;
  title: string;
  /** ローカル時刻文字列 YYYY-MM-DDTHH:mm（UTC変換しない） */
  start: string;
  /** 終日は「最終日の翌日T00:00」の排他的終端 */
  end: string;
  allDay: boolean;
  colorId: ColorId;
  kind: EventKind;
  createdAt: string;
  updatedAt: string;
  // --- schemaVersion 2 で追加 ---
  people: string[];
  /** 順番を保持する */
  places: string[];
  memo: string;
  /** 振り返り用の区分。null＝新規アプリ記録は自動判定、Google過去データは従来区分のまま */
  subcategory: string | null;
  /** 実績が対応する予定のid（多対1） */
  planId: string | null;
  /** 予定用。キャンセルした予定は cancelled */
  status: EventStatus;
  cancelReason: string;
  /** 繰り返しから作った予定の元ルールと、その日付 */
  recurrenceId: string | null;
  recurrenceDate: string | null;
  source: EventSource;
  googleEventId: string | null;
  /** 取り込み元データを丸ごと保存 */
  original: Record<string, unknown> | null;
  importedAt: string | null;
}

/** nagara＝並行していた行動、place＝その場所にいた時間 */
export type NagaraType = "nagara" | "place";

/**
 * ながら・場所。
 * eventIdあり・時間なし＝イベント全体／eventIdあり・時間あり＝イベント内の一部／eventIdなし・時間あり＝セッション
 */
export interface Nagara {
  id: string;
  label: string;
  type: NagaraType;
  eventId: string | null;
  start: string | null;
  end: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanSnapshot {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  colorId: ColorId;
  people: string[];
  places: string[];
  memo: string;
  subcategory?: string | null;
  status: EventStatus;
  cancelReason: string;
}

/** 予定の変更履歴（保存のたびに変更前の内容を残す） */
export interface PlanRevision {
  id: string;
  planId: string;
  changedAt: string;
  snapshot: PlanSnapshot;
}

/** 繰り返しルール（曜日を選んだ決まった枠） */
export interface RecurrenceRule {
  id: string;
  title: string;
  colorId: ColorId;
  startTime: string;
  endTime: string;
  /** 0=日〜6=土 */
  weekdays: number[];
  startDate: string;
  endDate: string | null;
  active: boolean;
  /** 作成済みの日付（予定がある日＋本人が消した日）。旧版との互換のために持つ */
  generatedDates: string[];
  // --- v0.3.0 で追加（無いデータは既定値で補う） ---
  people: string[];
  /** 順番を保持する */
  places: string[];
  subcategory: string | null;
  memo: string;
  /** イベント全体のながら（部分時間は持たない） */
  nagaraLabels: string[];
  /** 祝日を除外するか */
  excludeHolidays: boolean;
  /** 本人が手で消した日（墓標）。ルール変更で消えた日は含めない */
  removedDates: string[];
}

export type StartView = "day" | "week" | "month";

export type ParentCategory = "睡眠" | "生活" | "仕事" | "自由時間" | "その他";

export interface Settings {
  schemaVersion: 2;
  /** キーは "default"（色指定なし）と "1"〜"11" */
  colorLabels: Record<string, string>;
  /** 週の始まり。0=日〜6=土（既定 1=月曜） */
  weekStartDay: number;
  /** 色キー → 親カテゴリ */
  categoryParents: Record<string, ParentCategory>;
  /** 起動時の表示（既定は週） */
  startView: StartView;
}

export interface BackupFile {
  app: "calendar-app";
  schemaVersion: 2;
  exportedAt: string;
  events: CalendarEvent[];
  nagara: Nagara[];
  revisions: PlanRevision[];
  recurrences: RecurrenceRule[];
  settings: Settings;
}
