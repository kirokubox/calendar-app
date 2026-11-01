import { MOVING_PLACE, PLACE_KINDS, PLACE_SEP } from "./constants.js";
import type { PlaceKind } from "./types.js";

/** 大分類が分からない場所の表示名 */
export const UNCLASSIFIED = "未分類";

export function isPlaceKind(value: unknown): value is PlaceKind {
  return typeof value === "string" && (PLACE_KINDS as string[]).includes(value);
}

export interface ParsedPlace {
  /** 大分類。入力で選んでいない古い記録は null */
  kind: PlaceKind | null;
  /** 詳しい名前（店名など）。大分類だけのときは空 */
  detail: string;
}

/**
 * 場所欄の1件を分ける。「飲食店＞サイゼリヤ」→ 飲食店・サイゼリヤ、「家」→ 家・空。
 * 区切りの前が大分類でなければ（例：「カフェ＞ドトール」）、全体を詳しい名前として扱う。
 */
export function parsePlace(raw: string): ParsedPlace {
  const text = raw.trim();
  if (isPlaceKind(text)) return { kind: text, detail: "" };
  const i = text.indexOf(PLACE_SEP);
  if (i > 0) {
    const head = text.slice(0, i).trim();
    if (isPlaceKind(head)) return { kind: head, detail: text.slice(i + PLACE_SEP.length).trim() };
  }
  return { kind: null, detail: text };
}

/** 入力から場所欄の1件を作る。大分類と名前の両方 →「大分類＞名前」、どちらか一方 → それだけ。両方空なら空文字 */
export function formatPlace(kind: PlaceKind | null, detail: string): string {
  const d = detail.trim();
  if (kind && d !== "") return `${kind}${PLACE_SEP}${d}`;
  return kind ?? d;
}

/**
 * 場所の大分類。入力で選んだ大分類を使う。大分類のない古い記録は、
 * 「家」「自宅」「職場」「会社」と移動手段（電車・徒歩など）だけ決め、それ以外（店名など）は推測しない（null）。
 */
export function placeKindOf(raw: string): PlaceKind | null {
  const p = parsePlace(raw);
  if (p.kind) return p.kind;
  const n = p.detail;
  if (n === "自宅") return "家";
  if (n === "会社") return "職場";
  if (MOVING_PLACE.test(n)) return "移動";
  return null;
}
