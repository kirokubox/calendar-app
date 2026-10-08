import assert from "node:assert/strict";
import test from "node:test";
import { defaultCategoryParents, defaultSettings } from "../src/constants.js";
import { eventDefaults, migrateEvent, migrateSettings } from "../src/migrate.js";

const v1Event = {
  id: "a", title: "散歩", start: "2026-10-08T10:00", end: "2026-10-08T11:00", allDay: false, colorId: null, kind: "actual",
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
};

test("v1のイベントに既定値が付き、元の項目はそのまま", () => {
  const e = migrateEvent(v1Event);
  assert.deepEqual(e, { ...v1Event, ...eventDefaults() });
  assert.deepEqual(e.people, []);
  assert.deepEqual(e.places, []);
  assert.equal(e.memo, "");
  assert.equal(e.planId, null);
  assert.equal(e.status, "active");
  assert.equal(e.source, "app");
  assert.equal(e.original, null);
});

test("v2の項目がすでにあれば保持し、不正な型は既定値に戻す", () => {
  const e = migrateEvent({ ...v1Event, people: ["めぐちゃん"], places: ["カフェ", "駅"], memo: "m", planId: "p", status: "cancelled", source: "google", original: { x: 1 } });
  assert.deepEqual(e.people, ["めぐちゃん"]);
  assert.deepEqual(e.places, ["カフェ", "駅"]);
  assert.equal(e.planId, "p");
  assert.equal(e.status, "cancelled");
  assert.equal(e.source, "google");
  assert.deepEqual(e.original, { x: 1 });
  const bad = migrateEvent({ ...v1Event, people: "x", status: "zzz", memo: 5 });
  assert.deepEqual(bad.people, []);
  assert.equal(bad.status, "active");
  assert.equal(bad.memo, "");
});

test("eventDefaults は呼ぶたびに別の配列を返す（共有されない）", () => {
  const a = eventDefaults();
  a.people.push("x");
  assert.deepEqual(eventDefaults().people, []);
});

test("v1の設定に、週の始まり（月曜）と親カテゴリの既定値が付く", () => {
  const s = migrateSettings({ schemaVersion: 1, colorLabels: { default: "遊び", "1": "寝る" } });
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.weekStartDay, 1);
  assert.equal(s.colorLabels.default, "遊び");
  assert.equal(s.colorLabels["1"], "寝る");
  assert.equal(s.colorLabels["11"], "仕事");
  assert.deepEqual(s.categoryParents, defaultCategoryParents());
});

test("親カテゴリの既定の割り当て", () => {
  const p = defaultCategoryParents();
  assert.equal(p["1"], "睡眠");
  assert.equal(p["3"], "生活");
  assert.equal(p["11"], "仕事");
  for (const k of ["default", "2", "5", "9"]) assert.equal(p[k], "自由時間");
  for (const k of ["4", "6", "7", "8", "10"]) assert.equal(p[k], "その他");
});

test("設定：保存済みの週の始まり・親カテゴリは保持、不正な値は既定に戻す", () => {
  const ok = migrateSettings({ ...defaultSettings(), weekStartDay: 0, categoryParents: { "4": "仕事" } });
  assert.equal(ok.weekStartDay, 0);
  assert.equal(ok.categoryParents["4"], "仕事");
  assert.equal(ok.categoryParents["1"], "睡眠");
  const bad = migrateSettings({ weekStartDay: 9, categoryParents: { "4": "謎" }, colorLabels: {} });
  assert.equal(bad.weekStartDay, 1);
  assert.equal(bad.categoryParents["4"], "その他");
  assert.deepEqual(migrateSettings(undefined), defaultSettings());
});
