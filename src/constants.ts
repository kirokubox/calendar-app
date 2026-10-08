import type { Settings } from "./types.js";

export const APP_VERSION = "0.1.0";
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

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
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
