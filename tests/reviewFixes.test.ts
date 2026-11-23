import assert from "node:assert/strict";
import test from "node:test";
import { nextPlanInfo } from "../src/bedtimeLogic.js";
import { eventDefaults } from "../src/migrate.js";
import { canonicalMarkerLabel, markerCandidates, pairTravelMarkers, travelPairSummaries } from "../src/markerLogic.js";
import type { CalendarEvent, Marker } from "../src/types.js";

// 2026-11-23 レビュー反映（依頼書40）：寄り道を分ける・「家を出た」→「外出」・予定だけで使うときの次の予定
const stamp = "2026-01-01T00:00:00.000Z";
const mk = (id: string, label: string, at: string): Marker => ({ id, label, at, createdAt: stamp, updatedAt: stamp });

/** 帰りの通勤（会社発→帰宅）を、指定の日・分で並べる */
function homeTrips(trips: Array<[string, number]>): Marker[] {
  return trips.flatMap(([day, minutes], i) => {
    const end = new Date(`${day}T18:00:00`);
    end.setMinutes(end.getMinutes() + minutes);
    const at = `${day}T${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
    return [mk(`s${i}`, "会社発", `${day}T18:00`), mk(`e${i}`, "帰宅", at)];
  });
}

test("古い「家を出た」は「外出」と同じものとして組になる", () => {
  assert.equal(canonicalMarkerLabel("家を出た"), "外出");
  assert.equal(canonicalMarkerLabel(" 帰宅 "), "帰宅");
  const pairs = pairTravelMarkers([mk("a", "家を出た", "2026-11-02T07:20"), mk("b", "会社着", "2026-11-02T08:40"), mk("c", "外出", "2026-11-03T07:20"), mk("d", "会社着", "2026-11-03T08:35")]);
  assert.deepEqual(pairs.map((p) => [p.key, p.minutes]), [["toWork", 80], ["toWork", 75]]);
});

test("候補に古い「家を出た」を「外出」と二重に出さない", () => {
  const markers = [mk("a", "家を出た", "2026-11-02T07:20"), mk("b", "開場", "2026-11-02T17:00")];
  assert.deepEqual(markerCandidates(["外出", "帰宅"], markers), ["外出", "帰宅", "開場"]);
});

test("ふだんの1.5倍を超えた回を寄り道ありとして分ける", () => {
  const markers = homeTrips([["2026-11-02", 70], ["2026-11-03", 80], ["2026-11-04", 75], ["2026-11-05", 160], ["2026-11-06", 85], ["2026-11-09", 120]]);
  const home = travelPairSummaries(markers, "2026-11-01", "2026-12-01").find((r) => r.key === "fromWork")!;
  // ふだん＝中央値 (80+85)/2=82.5 → 1.5倍は123.75。160分だけが寄り道あり、120分はふだん
  assert.equal(home.usual, 82.5);
  assert.deepEqual([home.count, home.detourCount, home.detourAverage, home.longest], [5, 1, 160, 120]);
  assert.deepEqual(home.rows.filter((r) => r.detour).map((r) => r.minutes), [160]);
});

test("ちょうど1.5倍はふだん、直近90日が5回未満なら分けない", () => {
  const exact = homeTrips([["2026-11-02", 80], ["2026-11-03", 80], ["2026-11-04", 80], ["2026-11-05", 80], ["2026-11-06", 120]]);
  const a = travelPairSummaries(exact, "2026-11-01", "2026-12-01").find((r) => r.key === "fromWork")!;
  assert.deepEqual([a.count, a.detourCount], [5, 0]);
  const few = homeTrips([["2026-11-02", 60], ["2026-11-03", 60], ["2026-11-04", 300]]);
  const b = travelPairSummaries(few, "2026-11-01", "2026-12-01").find((r) => r.key === "fromWork")!;
  assert.equal(b.usual, null);
  assert.deepEqual([b.count, b.detourCount, b.longest], [3, 0, 300]);
});

const plan = (id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  ...eventDefaults(), id, title, start, end, allDay: false, colorId: null, kind: "plan", createdAt: stamp, updatedAt: stamp, ...extra,
});

test("次の予定：最中・次・無い（キャンセル・終日・今日より後は除く）", () => {
  const until = "2026-11-24T00:00";
  const events = [
    plan("a", "歯医者", "2026-11-23T15:00", "2026-11-23T16:00"),
    plan("b", "会議", "2026-11-23T13:00", "2026-11-23T14:00", { status: "cancelled" }),
    plan("c", "旅行", "2026-11-23T00:00", "2026-11-24T00:00", { allDay: true }),
    plan("d", "明日の予定", "2026-11-24T09:00", "2026-11-24T10:00"),
  ];
  assert.deepEqual(nextPlanInfo(events, "2026-11-23T12:20", until), { title: "歯医者", remainingMinutes: 160, ongoing: false });
  assert.deepEqual(nextPlanInfo(events, "2026-11-23T15:40", until), { title: "歯医者", remainingMinutes: 20, ongoing: true });
  assert.equal(nextPlanInfo(events, "2026-11-23T17:00", until), null);
});
