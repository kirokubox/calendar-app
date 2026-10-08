import assert from "node:assert/strict";
import test from "node:test";
import { buildBackup, mergeById, settingsForRestore, validateBackup } from "../src/backup.js";
import { defaultCategoryParents, defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent, Nagara, PlanRevision, RecurrenceRule } from "../src/types.js";

const stamp = "2026-10-01T00:00:00.000Z";

function ev(id: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, start: "2026-10-08T10:00", end: "2026-10-08T11:00", allDay: false, colorId: "1", kind: "actual", createdAt: stamp, updatedAt: stamp, ...eventDefaults(), ...extra };
}

const nagara: Nagara = { id: "n1", label: "YouTube", type: "nagara", eventId: "a", start: null, end: null, createdAt: stamp, updatedAt: stamp };
const session: Nagara = { id: "n2", label: "カフェ", type: "place", eventId: null, start: "2026-10-08T15:30", end: "2026-10-08T18:45", createdAt: stamp, updatedAt: stamp };
const revision: PlanRevision = {
  id: "r1", planId: "a", changedAt: stamp,
  snapshot: { title: "旧", start: "2026-10-08T09:00", end: "2026-10-08T10:00", allDay: false, colorId: null, people: [], places: [], memo: "", subcategory: null, status: "active", cancelReason: "" },
};
const rule: RecurrenceRule = {
  id: "c1", title: "朝礼", colorId: "11", startTime: "09:00", endTime: "09:15", weekdays: [1, 2, 3, 4, 5], startDate: "2026-10-01", endDate: null, active: true,
  generatedDates: ["2026-10-08"],
};

function json(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v));
}

test("v2：全ストア（イベント・ながら・履歴・繰り返し・設定）が書き出し→検証で戻る", () => {
  const b = buildBackup([ev("a", { people: ["めぐ"], places: ["駅", "カフェ"], memo: "m" })], { ...defaultSettings(), weekStartDay: 0 }, "x", {
    nagara: [nagara, session], revisions: [revision], recurrences: [rule],
  });
  assert.equal(b.schemaVersion, 2);
  const r = validateBackup(json(b));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.sourceVersion, 2);
    assert.deepEqual(r.backup, b);
  }
});

test("v1のバックアップも復元できる：イベントに既定値、ながら等は空、設定は既定値で補う", () => {
  const v1 = {
    app: "calendar-app", schemaVersion: 1, exportedAt: "2026-10-08T12:00:00.000Z",
    events: [{ id: "a", title: "睡眠", start: "2026-10-07T23:30", end: "2026-10-08T06:00", allDay: false, colorId: "1", kind: "actual", createdAt: stamp, updatedAt: stamp }],
    settings: { schemaVersion: 1, colorLabels: { default: "遊び", "1": "睡眠" } },
  };
  const r = validateBackup(v1);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.sourceVersion, 1);
  assert.equal(r.backup.schemaVersion, 2);
  assert.deepEqual(r.backup.events[0], { ...v1.events[0], ...eventDefaults() });
  assert.deepEqual(r.backup.nagara, []);
  assert.deepEqual(r.backup.revisions, []);
  assert.deepEqual(r.backup.recurrences, []);
  assert.equal(r.backup.settings.colorLabels.default, "遊び");
  assert.equal(r.backup.settings.colorLabels["11"], "");
  assert.equal(r.backup.settings.weekStartDay, 1);
  assert.deepEqual(r.backup.settings.categoryParents, defaultCategoryParents());
});

test("v1の復元では、今の週の始まり・親カテゴリを残す。v2ではバックアップの設定を使う", () => {
  const current = { ...defaultSettings(), weekStartDay: 0, categoryParents: { ...defaultCategoryParents(), "4": "仕事" as const } };
  const b = buildBackup([], defaultSettings(), "x");
  const fromV1 = settingsForRestore(b, 1, current);
  assert.equal(fromV1.weekStartDay, 0);
  assert.equal(fromV1.categoryParents["4"], "仕事");
  assert.equal(fromV1.colorLabels.default, b.settings.colorLabels.default);
  assert.deepEqual(settingsForRestore(b, 2, current), b.settings);
});

test("v2の検証：ながら・履歴・繰り返しの不正値は理由つきで拒否", () => {
  const good = buildBackup([ev("a")], defaultSettings(), "x", { nagara: [nagara, session], revisions: [revision], recurrences: [rule] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clone = (): any => JSON.parse(JSON.stringify(good));
  const reason = (v: unknown) => { const r = validateBackup(v); return r.ok ? "" : r.reason; };

  let b = clone(); delete b.nagara;
  assert.match(reason(b), /nagara/);
  b = clone(); b.nagara[0].type = "x";
  assert.match(reason(b), /nagara\[0\]\.type/);
  b = clone(); b.nagara[1].end = "2026-10-08T15:00";
  assert.match(reason(b), /終了が開始以前/);
  b = clone(); b.nagara[1].end = null;
  assert.match(reason(b), /両方/);
  b = clone(); b.nagara[0].eventId = null;
  assert.match(reason(b), /指定がありません/);
  b = clone(); b.nagara.push(clone().nagara[0]);
  assert.match(reason(b), /重複/);
  b = clone(); b.revisions[0].snapshot = 5;
  assert.match(reason(b), /snapshot/);
  b = clone(); b.recurrences[0].weekdays = [7];
  assert.match(reason(b), /weekdays/);
  b = clone(); b.events[0].people = "x";
  assert.match(reason(b), /people/);
  b = clone(); b.events[0].status = "zzz";
  assert.match(reason(b), /status/);
});

test("マージ（全ストア共通）：同じidは上書き、それ以外は追加", () => {
  const merged = mergeById([nagara, session], [{ ...nagara, label: "ラジオ" }, { ...session, id: "n3" }]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((n) => n.id === "n1")?.label, "ラジオ");
});
