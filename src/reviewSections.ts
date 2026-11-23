import type { Settings } from "./types.js";

export const REVIEW_SECTIONS = [
  ["diff", "前期間との差"], ["trend", "推移"], ["nagara", "ながら・重なり"],
  ["place", "場所"], ["travel", "移動（マーカーの組）"],
  ["people", "人"], ["unconfirmed", "未確定の予定"],
] as const;

const PLAN_ONLY_VISIBLE = new Set(["trend", "place", "people"]);

export function availableReviewSections(settings: Settings) {
  return settings.planOnly ? REVIEW_SECTIONS.filter(([key]) => key !== "travel" && key !== "unconfirmed") : REVIEW_SECTIONS;
}

export function hiddenReviewSections(settings: Settings): string[] {
  if (settings.hiddenReviewSections !== undefined) return settings.hiddenReviewSections;
  return settings.planOnly ? REVIEW_SECTIONS.map(([key]) => key).filter((key) => !PLAN_ONLY_VISIBLE.has(key)) : [];
}

export function isReviewSectionVisible(settings: Settings, key: string): boolean {
  return availableReviewSections(settings).some(([section]) => section === key) && !hiddenReviewSections(settings).includes(key);
}
