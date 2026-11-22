import assert from "node:assert/strict";
import test from "node:test";
import { validateBackup } from "../src/backup.js";
import { defaultSettings } from "../src/constants.js";
import { eventDefaults } from "../src/migrate.js";
import { buildPhotoZip, readPhotoZip } from "../src/photoBackup.js";
import type { CalendarEvent, StoredPhoto } from "../src/types.js";

const event: CalendarEvent = { ...eventDefaults(), id: "event", title: "食事", start: "2026-11-23T12:00", end: "2026-11-23T13:00",
  allDay: false, colorId: null, kind: "actual", createdAt: "2026-11-23T00:00:00Z", updatedAt: "2026-11-23T00:00:00Z", photoIds: ["photo"] };
const photo: StoredPhoto = { id: "photo", eventId: "event", blob: new Blob(["image"], { type: "image/webp" }), mimeType: "image/webp",
  width: 10, height: 10, byteSize: 5, createdAt: "2026-11-23T00:00:00Z" };

test("写真つきZIPは記録・写真を復元でき、写真欠けを拒否する", async () => {
  const zip = await buildPhotoZip([event], defaultSettings(), {}, [photo], new Date("2026-11-23T00:00:00Z"));
  const restored = await readPhotoZip(zip);
  const result = validateBackup(restored.backup);
  assert.equal(result.ok, true);
  assert.equal(restored.photos.length, 1);
  assert.equal(restored.photos[0].eventId, "event");
  assert.equal(await restored.photos[0].blob.text(), "image");
  await assert.rejects(() => buildPhotoZip([event], defaultSettings(), {}, [], new Date()), /見つかりません/);
});
