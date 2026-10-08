import assert from "node:assert/strict";
import test from "node:test";
import { isEditedInApp, parseGoogleImport, planGoogleImport } from "../src/googleImport.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent } from "../src/types.js";

const T0 = "2026-10-08T00:00:00.000Z";
const T1 = "2026-10-09T00:00:00.000Z";
const T2 = "2026-10-10T00:00:00.000Z";

function idMaker(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

function file(events: unknown[]) {
  return { app: "calendar-app", format: "google-import", version: 1, createdAt: T0, events };
}

function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    googleEventId: id, title: `予定${id}`, start: "2026-10-08T10:00", end: "2026-10-08T11:00", allDay: false, colorId: "7",
    location: "渋谷", description: "メモ", original: { id, summary: `予定${id}` }, ...extra,
  };
}

test("形式の検証：app / format / version が違えばエラー", () => {
  assert.equal(parseGoogleImport(null).ok, false);
  assert.equal(parseGoogleImport({ ...file([]), format: "x" }).ok, false);
  assert.equal(parseGoogleImport({ ...file([]), version: 2 }).ok, false);
  assert.equal(parseGoogleImport({ ...file([]), events: {} }).ok, false);
  const r = parseGoogleImport(file([]));
  assert.ok(r.ok && r.items.length === 0);
});

test("不正な1件は読み飛ばして理由を返す・googleEventIdの重複は後勝ち", () => {
  const r = parseGoogleImport(file([
    item("a"),
    item("b", { start: "2026-10-08" }),
    item("c", { end: "2026-10-08T09:00" }),
    item("d", { colorId: "99" }),
    item("a", { title: "更新後" }),
    item("e", { title: "", colorId: null, location: null, description: null, allDay: true }),
  ]));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.items.map((i) => i.googleEventId), ["a", "e"]);
  assert.equal(r.items[0].title, "更新後");
  assert.equal(r.skippedCount, 3);
  assert.equal(r.duplicates, 1);
  assert.equal(r.items[1].title, "（無題）");
  assert.equal(r.items[1].colorId, null);
});

test("照合：新規は種別不明・google・places=[location]・memo=description・original保存・importedAt設定", () => {
  const parsed = parseGoogleImport(file([item("a", { title: "A/B" })]));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const plan = planGoogleImport(parsed.items, [], T1, idMaker());
  assert.equal(plan.create.length, 1);
  const e = plan.create[0];
  assert.deepEqual([e.kind, e.source, e.title, e.googleEventId, e.importedAt, e.updatedAt], ["unknown", "google", "A/B", "a", T1, T1]);
  assert.deepEqual(e.places, ["渋谷"]);
  assert.equal(e.memo, "メモ");
  assert.deepEqual(e.original, { id: "a", summary: "予定a" });
  assert.equal(isEditedInApp(e), false);
});

test("照合：変更なし・更新・保持（アプリで編集済み）", () => {
  const parsed = parseGoogleImport(file([item("same"), item("changed", { title: "新タイトル" }), item("edited", { title: "Google側で変更" })]));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const base = (id: string, extra: Partial<CalendarEvent>): CalendarEvent => ({
    id: `x-${id}`, title: `予定${id}`, start: "2026-10-08T10:00", end: "2026-10-08T11:00", allDay: false, colorId: "7", kind: "unknown",
    createdAt: T0, updatedAt: T0, ...eventDefaults(), places: ["渋谷"], memo: "メモ", source: "google", googleEventId: id,
    original: { id, summary: `予定${id}` }, importedAt: T0, ...extra,
  });
  const existing = [
    base("same", {}),
    base("changed", { kind: "actual", people: ["めぐ"] }),
    base("edited", { updatedAt: T1, title: "アプリで変更" }),
    base("other", {}),
  ];
  const plan = planGoogleImport(parsed.items, existing, T2, idMaker());
  assert.deepEqual([plan.create.length, plan.update.length, plan.unchanged, plan.kept], [0, 1, 1, 1]);
  const u = plan.update[0];
  assert.equal(u.id, "x-changed", "idは変えない");
  assert.equal(u.title, "新タイトル");
  assert.equal(u.kind, "actual", "取り込みが決めない項目は保つ");
  assert.deepEqual(u.people, ["めぐ"]);
  assert.deepEqual([u.importedAt, u.updatedAt], [T2, T2]);
  assert.equal(isEditedInApp(u), false, "更新後は編集済みと見なされない");
  const again = planGoogleImport(parsed.items, [u], "2026-10-11T00:00:00.000Z", idMaker());
  assert.deepEqual([again.update.length, again.unchanged], [0, 1]);
});

test("取り込み後にアプリで編集すると保持される", () => {
  const parsed = parseGoogleImport(file([item("a")]));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const first = planGoogleImport(parsed.items, [], T0, idMaker()).create[0];
  const edited = { ...first, memo: "自分で追記", updatedAt: T1 };
  assert.equal(planGoogleImport(parsed.items, [edited], T2, idMaker()).kept, 1);
});
