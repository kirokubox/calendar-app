import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import { periodOf } from "../src/reviewLogic.js";
import { buildReviewMarkdown, mdCell } from "../src/reviewMarkdown.js";
import type { CalendarEvent, Nagara } from "../src/types.js";

const STAMP = "2026-10-01T00:00:00.000Z";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: STAMP, updatedAt: STAMP, ...eventDefaults(), ...extra };
}

test("セルのエスケープ：| と改行", () => {
  assert.equal(mdCell("a|b"), "a\\|b");
  assert.equal(mdCell("1行目\n2行目\r\n3行目"), "1行目<br>2行目<br>3行目");
});

test("週のMarkdown：5ブロックの構成・エスケープ・主行動なしの重なり・日ごとの明細", () => {
  const period = periodOf("week", "2026-10-08", 1);
  const events = [
    ev("a", "散歩|外食", "2026-10-06T10:00", "2026-10-06T12:00", { colorId: "2", people: ["めぐ"], places: ["公園"], memo: "1行目\n2行目" }),
    ev("p", "会議", "2026-10-06T14:00", "2026-10-06T15:00", { kind: "plan" }),
    ev("c", "中止", "2026-10-07T10:00", "2026-10-07T11:00", { kind: "plan", status: "cancelled", cancelReason: "雨" }),
    ev("d", "終日の予定", "2026-10-08T00:00", "2026-10-09T00:00", { allDay: true, kind: "plan" }),
  ];
  const nagara: Nagara[] = [
    { id: "n1", label: "音楽", type: "nagara", eventId: "a", start: null, end: null, createdAt: STAMP, updatedAt: STAMP },
    { id: "n2", label: "動画", type: "nagara", eventId: null, start: "2026-10-06T12:00", end: "2026-10-06T13:00", createdAt: STAMP, updatedAt: STAMP },
    { id: "n3", label: "カフェ", type: "place", eventId: null, start: "2026-10-06T09:00", end: "2026-10-06T10:00", createdAt: STAMP, updatedAt: STAMP },
  ];
  const md = buildReviewMarkdown({ events, nagara, revisions: [], settings: defaultSettings(), period, nowLocal: "2026-10-20T09:00" });
  const headings = md.split("\n").filter((l) => l.startsWith("## ") || l.startsWith("# "));
  assert.deepEqual(headings.map((h) => h.slice(0, 7)), ["# カレンダー", "## 1. 時間", "## 2. なが", "## 3. 未確", "## 4. キャ", "## 5. 日ご"].map((x) => x.slice(0, 7)));
  assert.ok(md.includes("散歩\\|外食"), "タイトルの | をエスケープ");
  assert.ok(md.includes("1行目<br>2行目"), "メモの改行をエスケープ");
  assert.ok(md.includes("主行動なし"), "主行動のない時間のながら");
  assert.ok(md.includes("| カフェ | 1時間 |"), "場所の表");
  assert.ok(md.includes("予定（キャンセル）"));
  assert.ok(md.includes("未確定の予定（2件）"), "会議と終日の予定が未確定");
  assert.ok(md.includes("### 2026-10-05"));
  assert.ok(md.includes("### 2026-10-11"));
  assert.ok(!md.includes("今日以降の分も未記録"), "期間が過去なら注記しない");
  const detail = md.split("\n").filter((l) => l.startsWith("| 10:00–12:00"));
  assert.equal(detail.length, 1);
  assert.equal(detail[0].replace(/\\\|/g, "").split("|").length, 10, "8列＋両端");
});

test("月のMarkdown：日数ぶんの見出しと、未来を含む期間の注記", () => {
  const period = periodOf("month", "2026-10-08", 1);
  const md = buildReviewMarkdown({ events: [], nagara: [], revisions: [], settings: defaultSettings(), period, nowLocal: "2026-10-08T09:00" });
  assert.equal(md.split("\n").filter((l) => l.startsWith("### 2026-10-")).length, 31);
  assert.ok(md.includes("今日以降の分も未記録"));
  assert.ok(md.includes("# カレンダー 月次レポート"));
});
