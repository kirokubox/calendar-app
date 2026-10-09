import type { ParentCategory, Settings } from "./types.js";

export const APP_VERSION = "0.3.1";
export const BACKUP_APP_NAME = "calendar-app";

export const COLOR_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"] as const;

/** Googleカレンダーの色 */
export const COLOR_HEX: Record<string, string> = {
  "1": "#7986CB",
  "2": "#33B679",
  "3": "#8E24AA",
  "4": "#E67C73",
  "5": "#F6BF26",
  "6": "#F4511E",
  "7": "#039BE5",
  "8": "#616161",
  "9": "#3F51B5",
  "10": "#0B8043",
  "11": "#D50000",
  default: "#4285F4",
};

export const HOUR_HEIGHT = 56;
/** 週表示は7日と約16時間をスマホ1画面で見渡せる密度にする */
export const WEEK_HOUR_HEIGHT = 40;
/** 週表示の各日右端に置くセッション帯 */
export const WEEK_LANE_WIDTH = 8;
/** 日表示の右端のセッションレーンの幅（px） */
export const LANE_WIDTH = 30;

export const PARENT_CATEGORIES: ParentCategory[] = ["睡眠", "生活", "仕事", "自由時間", "その他"];

/** 色キー（"default" と "1"〜"11"）の一覧 */
export const COLOR_KEYS = ["default", ...COLOR_IDS] as const;

export function defaultCategoryParents(): Record<string, ParentCategory> {
  const parents: Record<string, ParentCategory> = {};
  for (const key of COLOR_KEYS) parents[key] = "その他";
  parents["1"] = "睡眠";
  parents["3"] = "生活";
  parents["11"] = "仕事";
  parents.default = "自由時間";
  parents["2"] = "自由時間";
  parents["5"] = "自由時間";
  parents["9"] = "自由時間";
  return parents;
}

/** 振り返りの円グラフ用：親カテゴリの色（評価を連想させない中立色） */
export const PARENT_COLORS: Record<string, string> = {
  睡眠: "#5C6BC0",
  生活: "#26A69A",
  仕事: "#EF5350",
  自由時間: "#FFB300",
  その他: "#8D6E63",
  未記録: "#B0BEC5",
};

export const DB_SCHEMA_VERSION = 2;

/** ながらの固定候補（履歴候補・自由入力と併用） */
export const FIXED_NAGARA = ["YouTube", "音楽", "Spoon", "アニメ"];
/** 場所の固定候補（履歴候補・自由入力と併用） */
export const FIXED_PLACES = ["家", "職場", "カフェ"];

export function defaultSettings(): Settings {
  return {
    schemaVersion: 2,
    weekStartDay: 1,
    startView: "week",
    categoryParents: defaultCategoryParents(),
    colorLabels: {
      default: "趣味・遊び",
      "1": "睡眠",
      "2": "友達",
      "3": "生活",
      "4": "",
      "5": "彼女・マチアプ",
      "6": "",
      "7": "",
      "8": "",
      "9": "発信・開発",
      "10": "",
      "11": "仕事",
    },
  };
}
