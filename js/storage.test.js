import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_STORAGE_KEYS,
  clearSheetDeleteQueue,
  createDataBackup,
  loadSheetDeleteQueue,
  migrateLegacyStorage,
  queueSheetDeletes,
  restoreDataBackup
} from "./storage.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values
  };
}

test("legacy health and workout data migrates into app namespace", () => {
  const storage = memoryStorage({
    workoutHistory: "[{\"id\":\"session-1\"}]",
    bodyMetrics: "[{\"weight\":180}]"
  });

  migrateLegacyStorage(storage);

  assert.equal(storage.getItem(APP_STORAGE_KEYS.history), "[{\"id\":\"session-1\"}]");
  assert.equal(storage.getItem(APP_STORAGE_KEYS.bodyMetrics), "[{\"weight\":180}]");
  assert.equal(storage.getItem("workoutHistory"), null);
  assert.equal(storage.getItem("bodyMetrics"), null);
});

test("backup round-trip restores health data without credentials", () => {
  const source = memoryStorage({
    [APP_STORAGE_KEYS.history]: "[]",
    [APP_STORAGE_KEYS.bodyMetrics]: "[{\"weight\":180}]",
    [APP_STORAGE_KEYS.sheetsToken]: "do-not-export"
  });
  const backup = createDataBackup(source);
  const target = memoryStorage();

  const restored = restoreDataBackup(backup, target);

  assert.equal(restored, 2);
  assert.equal(target.getItem(APP_STORAGE_KEYS.bodyMetrics), "[{\"weight\":180}]");
  assert.equal(target.getItem(APP_STORAGE_KEYS.sheetsToken), null);
  assert.doesNotMatch(backup, /do-not-export/);
});

test("restore rejects unknown keys", () => {
  const backup = JSON.stringify({
    format: "workout-plan-backup",
    version: 1,
    data: { "other-app:key": "[]" }
  });
  assert.throws(() => restoreDataBackup(backup, memoryStorage()), /unsupported data/);
});

test("Google Sheets deletion queue deduplicates and clears set ids", () => {
  const storage = memoryStorage();
  queueSheetDeletes(["set-1", "set-1", "set-2"], storage);
  assert.deepEqual(loadSheetDeleteQueue(storage), ["set-1", "set-2"]);
  clearSheetDeleteQueue(storage);
  assert.deepEqual(loadSheetDeleteQueue(storage), []);
});
