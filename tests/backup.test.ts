import assert from "node:assert/strict";
import test from "node:test";
import { backupFileName, buildBackup, mergeEvents, summarizeBackup, validateBackup } from "../src/backup.js";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent } from "../src/types.js";

function ev(id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, start, end, allDay: false, colorId: "1", kind: "actual", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...eventDefaults(), ...extra };
}

test("初期のカテゴリ名", () => {
  const l = defaultSettings().colorLabels;
  assert.equal(l.default, "趣味・遊び");
  assert.equal(l["1"], "睡眠");
  assert.equal(l["11"], "仕事");
  assert.equal(l["4"], "");
});

test("書き出し→検証のラウンドトリップ", () => {
  const b = buildBackup([ev("a", "2026-10-08T10:00", "2026-10-08T11:00")], defaultSettings(), "2026-10-08T12:00:00.000Z");
  const r = validateBackup(JSON.parse(JSON.stringify(b)));
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.backup.events, b.events);
  assert.equal(backupFileName("2026-10-08"), "calendar-backup-2026-10-08.json");
});

test("検証：別アプリ・形式違い・不正値は理由つきで拒否", () => {
  const good = buildBackup([ev("a", "2026-10-08T10:00", "2026-10-08T11:00")], defaultSettings(), "x");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clone = (): any => JSON.parse(JSON.stringify(good));
  const reason = (v: unknown) => { const r = validateBackup(v); return r.ok ? "" : r.reason; };

  assert.match(reason(null), /オブジェクト/);
  assert.match(reason({ ...clone(), app: "other" }), /バックアップではありません/);
  assert.match(reason({ ...clone(), schemaVersion: 3 }), /schemaVersion/);
  assert.match(reason({ ...clone(), events: {} }), /events/);
  let b = clone(); b.events[0].start = "2026/10/08 10:00";
  assert.match(reason(b), /events\[0\]\.start/);
  b = clone(); b.events[0].end = "2026-10-08T09:00";
  assert.match(reason(b), /終了が開始以前/);
  b = clone(); b.events[0].colorId = "12";
  assert.match(reason(b), /colorId/);
  b = clone(); b.events[0].kind = "foo";
  assert.match(reason(b), /kind/);
  b = clone(); b.events.push(clone().events[0]);
  assert.match(reason(b), /重複/);
  b = clone(); delete b.settings;
  assert.match(reason(b), /settings/);
  b = clone(); b.settings.colorLabels["1"] = 5;
  assert.match(reason(b), /colorLabels/);
});

test("検証：colorIdがnullは許可、colorLabelsの欠けたキーは空文字で補う", () => {
  const b = buildBackup([ev("a", "2026-10-08T10:00", "2026-10-08T11:00", { colorId: null })], { ...defaultSettings(), colorLabels: { default: "x" } }, "x");
  const r = validateBackup(JSON.parse(JSON.stringify(b)));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.backup.settings.colorLabels.default, "x");
    assert.equal(r.backup.settings.colorLabels["1"], "");
  }
});

test("プレビュー用の件数と期間", () => {
  const b = buildBackup([ev("a", "2026-10-08T10:00", "2026-10-08T11:00"), ev("b", "2026-09-30T23:00", "2026-10-01T06:00"), ev("c", "2026-10-10T00:00", "2026-10-12T00:00", { allDay: true })], defaultSettings(), "x");
  assert.deepEqual(summarizeBackup(b), { count: 3, from: "2026-09-30", to: "2026-10-12" });
  assert.deepEqual(summarizeBackup(buildBackup([], defaultSettings(), "x")), { count: 0, from: null, to: null });
});

test("マージ：同じidは上書き、それ以外は追加", () => {
  const existing = [ev("a", "2026-10-08T10:00", "2026-10-08T11:00", { title: "旧" }), ev("b", "2026-10-09T10:00", "2026-10-09T11:00")];
  const incoming = [ev("a", "2026-10-08T10:00", "2026-10-08T11:00", { title: "新" }), ev("c", "2026-10-10T10:00", "2026-10-10T11:00")];
  const merged = mergeEvents(existing, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((e) => e.id === "a")?.title, "新");
  assert.ok(merged.find((e) => e.id === "b"));
  assert.ok(merged.find((e) => e.id === "c"));
});
