import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/constants.js";
import { migrateSettings } from "../src/migrate.js";
import { availableReviewSections, hiddenReviewSections, isReviewSectionVisible } from "../src/reviewSections.js";
import { buildBackup, validateBackup } from "../src/backup.js";

test("古い設定は全節を表示し、予定専用の未選択は推移・場所・人だけを表示", () => {
  const old = migrateSettings(defaultSettings());
  assert.deepEqual(hiddenReviewSections(old), []);
  const planOnly = migrateSettings({ ...old, planOnly: true });
  assert.deepEqual(availableReviewSections(planOnly).map(([key]) => key), ["diff", "trend", "nagara", "place", "people"]);
  assert.deepEqual(availableReviewSections(planOnly).filter(([key]) => isReviewSectionVisible(planOnly, key)).map(([key]) => key), ["trend", "place", "people"]);
});

test("明示して隠した節は表示せず、古いバックアップと任意項目を読める", () => {
  const settings = { ...defaultSettings(), hiddenReviewSections: ["people"] };
  assert.equal(isReviewSectionVisible(settings, "people"), false);
  const backup = buildBackup([], settings, "2026-11-23T00:00:00.000Z");
  const restored = validateBackup(backup);
  assert.equal(restored.ok, true);
  if (restored.ok) assert.deepEqual(restored.backup.settings.hiddenReviewSections, ["people"]);
  const invalid = validateBackup({ ...backup, settings: { ...settings, hiddenReviewSections: [1] } });
  assert.equal(invalid.ok, false);
  const old = validateBackup({ ...backup, settings: defaultSettings() });
  assert.equal(old.ok, true);
  if (old.ok) assert.equal(old.backup.settings.hiddenReviewSections, undefined);
});
