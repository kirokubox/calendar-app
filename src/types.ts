export type EventKind = "plan" | "actual" | "unknown";
/** "1"〜"11"（Googleカレンダーと同じ体系）。null＝色指定なし */
export type ColorId = string | null;

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
}

export interface Settings {
  schemaVersion: 1;
  /** キーは "default"（色指定なし）と "1"〜"11" */
  colorLabels: Record<string, string>;
}

export interface BackupFile {
  app: "calendar-app";
  schemaVersion: 1;
  exportedAt: string;
  events: CalendarEvent[];
  settings: Settings;
}
