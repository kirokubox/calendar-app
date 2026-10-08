import { COLOR_HEX } from "./constants.js";
import type { ColorId } from "./types.js";

export function colorHex(colorId: ColorId): string {
  return (colorId && COLOR_HEX[colorId]) || COLOR_HEX.default;
}

/** 背景色の明度から、読みやすい文字色（白／黒）を選ぶ */
export function textColorOn(hex: string): "#ffffff" | "#1f1f1f" {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#1f1f1f" : "#ffffff";
}

/** 予定（白地・枠線表示）の文字色。明るい色（バナナ等）は白地で読めないので黒寄りに暗くする */
export function planTextColor(hex: string): string {
  if (textColorOn(hex) === "#ffffff") return hex;
  const n = parseInt(hex.replace("#", ""), 16);
  const f = 0.45;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `rgb(${r}, ${g}, ${b})`;
}
