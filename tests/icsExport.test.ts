import assert from "node:assert/strict";
import test from "node:test";
import { buildIcs, icsDescription, icsTargets } from "../src/icsExport.js";
import { eventDefaults } from "../src/migrate.js";
import type { CalendarEvent } from "../src/types.js";

function ev(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start, end, allDay: false, colorId: null, kind: "actual", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z", ...eventDefaults(), ...extra };
}

test(".ics：キャンセルを除き、期間にかかるものだけを時刻順に", () => {
  const events = [
    ev("b", "夕食", "2026-11-18T19:00", "2026-11-18T20:00"),
    ev("a", "仕事", "2026-11-18T09:00", "2026-11-18T18:00", { kind: "plan" }),
    ev("c", "ジム", "2026-11-18T21:00", "2026-11-18T22:00", { kind: "plan", status: "cancelled" }),
    ev("d", "前日", "2026-11-17T23:00", "2026-11-18T01:00"),
    ev("e", "翌週", "2026-11-25T10:00", "2026-11-25T11:00"),
  ];
  assert.deepEqual(icsTargets(events, "2026-11-18", "2026-11-18").map((e) => e.id), ["d", "a", "b"]);
  assert.equal(icsTargets(events, null, null).length, 4);
});

test(".ics：時刻・終日・エスケープ・説明欄", () => {
  const text = buildIcs(
    [
      ev("x1", "会議, 定例; 第2回", "2026-11-18T13:00", "2026-11-18T15:00", { kind: "plan", places: ["職場＞会議室"], people: ["Aさん"], memo: "資料を\n持っていく" }),
      ev("x2", "旅行", "2026-11-20T00:00", "2026-11-21T00:00", { allDay: true }),
    ],
    { from: null, to: null, exportedAt: "2026-11-21T01:02:03.456Z" },
  );
  assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(text.endsWith("END:VCALENDAR\r\n"));
  assert.match(text, /DTSTART:20261118T130000\r\nDTEND:20261118T150000/);
  assert.ok(text.includes(String.raw`SUMMARY:会議\, 定例\; 第2回`));
  assert.match(text, /LOCATION:職場＞会議室/);
  assert.match(text, /DTSTAMP:20261121T010203Z/);
  assert.match(text, /DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261122/);
  assert.equal(icsDescription(ev("y", "t", "2026-11-18T13:00", "2026-11-18T14:00", { kind: "plan", people: ["A", "B"], memo: "メモ" })), "キロクカレンダー：予定\n人：A、B\nメモ");
});

test(".ics：長い行は75バイトで折り返す", () => {
  const text = buildIcs([ev("z", "あ".repeat(60), "2026-11-18T13:00", "2026-11-18T14:00")], { from: null, to: null, exportedAt: "2026-11-21T00:00:00.000Z" });
  for (const line of text.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(text.includes("\r\n "));
});
