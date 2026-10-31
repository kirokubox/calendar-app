import assert from "node:assert/strict";
import test from "node:test";
import { buildBackup, settingsForRestore, validateBackup } from "../src/backup.js";
import { defaultSettings } from "../src/constants.js";
import { buildLastRows, isOverTarget, lastDateLabel, sortLastRows, type LastRow } from "../src/lastLogic.js";
import { eventDefaults, migrateLastItems, migrateSettings } from "../src/migrate.js";
import type { CalendarEvent, LastItem, Marker } from "../src/types.js";

const STAMP = "2026-10-01T00:00:00.000Z";
const NOW = "2026-10-31T12:00";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: STAMP, updatedAt: STAMP, ...eventDefaults(), ...extra };
}
function mk(id: string, label: string, at: string): Marker {
  return { id, label, at, createdAt: STAMP, updatedAt: STAMP };
}
function item(id: string, name: string, targetDays: number | null = null): LastItem {
  return { id, name, targetDays };
}
function row(id: string, daysAgo: number | null): LastRow {
  return { item: item(id, id), last: daysAgo === null ? null : { start: "2026-10-01T00:00", daysAgo }, over: false };
}

test("前回：目安の日数を超えたら目立たせる（ちょうどの日はまだ）", () => {
  assert.equal(isOverTarget(8, 7), true);
  assert.equal(isOverTarget(7, 7), false);
  assert.equal(isOverTarget(100, null), false);
});

test("前回：久しぶりな順。同じ日数は登録順、記録が無い項目は一番下に登録順でまとめる", () => {
  const sorted = sortLastRows([row("a", null), row("b", 3), row("c", 10), row("d", null), row("e", 3), row("f", 0)]);
  assert.deepEqual(sorted.map((r) => r.item.id), ["c", "b", "e", "f", "a", "d"]);
});

test("前回：イベントもマーカーも数え、予定と未来の記録は数えない", () => {
  const settings = { ...defaultSettings(), lastItems: [] };
  const events = [
    ev("e1", "サウナ", "2026-10-26T19:00", "2026-10-26T21:00"),
    ev("e2", "サウナ", "2026-10-15T19:00", "2026-10-15T21:00"),
    ev("p1", "サウナ", "2026-10-30T19:00", "2026-10-30T21:00", { kind: "plan" }),
    ev("e3", "美容院", "2026-11-02T10:00", "2026-11-02T11:00"),
  ];
  const markers = [mk("m1", "シーツ替え", "2026-10-20T09:00")];
  const items = [item("i1", "サウナ", 3), item("i2", "シーツ替え", 14), item("i3", "美容院"), item("i4", "散歩")];
  const rows = buildLastRows(items, events, [], markers, settings, NOW);
  assert.deepEqual(rows.map((r) => [r.item.name, r.last?.daysAgo ?? null, r.over]), [
    ["シーツ替え", 11, false],
    ["サウナ", 5, true],
    ["美容院", null, false],
    ["散歩", null, false],
  ]);
  assert.equal(rows[1].last?.start, "2026-10-26T19:00");
});

test("前回：日付の見せ方は月/日、今年以外は年を付ける", () => {
  assert.equal(lastDateLabel("2026-10-26", NOW), "10/26");
  assert.equal(lastDateLabel("2025-12-03", NOW), "2025/12/3");
});

test("設定：「前回」の項目が無い設定は空。名前が空・id重複は除き、目安は1以上の整数だけ残す", () => {
  assert.deepEqual(migrateSettings({ weekStartDay: 1 }).lastItems, []);
  assert.deepEqual(defaultSettings().lastItems, []);
  assert.deepEqual(
    migrateLastItems([
      { id: "a", name: " サウナ ", targetDays: 7 },
      { id: "b", name: "", targetDays: 3 },
      { id: "a", name: "重複", targetDays: 3 },
      { id: "c", name: "散歩", targetDays: 0 },
      { id: "d", name: "美容院", targetDays: 2.5 },
      { id: "e", name: "掃除機" },
      "壊れた値",
    ]),
    [item("a", "サウナ", 7), item("c", "散歩"), item("d", "美容院"), item("e", "掃除機")],
  );
});

test("バックアップ：「前回」の項目を書き出して読み戻せる。古いバックアップは空、形が違えば読み込まない", () => {
  const settings = { ...defaultSettings(), lastItems: [item("a", "サウナ", 7), item("b", "散歩")] };
  const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Record<string, unknown> & { settings: Record<string, unknown> };
  const b = buildBackup([], settings, STAMP);
  const r = validateBackup(json(b));
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.backup.settings.lastItems, settings.lastItems);

  const old = json(b);
  delete old.settings.lastItems;
  const r2 = validateBackup(old);
  assert.deepEqual(r2.ok && r2.backup.settings.lastItems, []);

  const broken = json(b);
  broken.settings.lastItems = "サウナ";
  assert.equal(validateBackup(broken).ok, false);
  const broken2 = json(b);
  broken2.settings.lastItems = [{ id: "a", name: "サウナ", targetDays: "7" }];
  assert.equal(validateBackup(broken2).ok, false);
});

test("復元：v1のバックアップは「前回」の項目を持たないので、今の設定を残す", () => {
  const current = { ...defaultSettings(), lastItems: [item("a", "サウナ")] };
  const b = buildBackup([], defaultSettings(), STAMP);
  assert.deepEqual(settingsForRestore(b, 1, current).lastItems, current.lastItems);
  assert.deepEqual(settingsForRestore(b, 2, current).lastItems, []);
});
