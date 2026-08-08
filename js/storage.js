export const STORAGE_PREFIX = "workoutPlan:";

export function storageKey(name) {
  return `${STORAGE_PREFIX}${name}`;
}

export const APP_STORAGE_KEYS = Object.freeze({
  history: storageKey("workoutHistory"),
  bodyMetrics: storageKey("bodyMetrics"),
  storageVersion: storageKey("storageVersion"),
  exerciseTargets: storageKey("exerciseTargets"),
  progressionSuggestions: storageKey("progressionSuggestions"),
  userEquipment: storageKey("userEquipment"),
  sheetsUrl: storageKey("googleSheetsWebAppUrl"),
  sheetsToken: storageKey("googleSheetsSyncToken"),
  iosInstallDismissed: storageKey("iosInstallDismissed"),
  healthConnectLastSync: storageKey("healthConnectLastSync")
});

const LEGACY_KEYS = Object.freeze({
  workoutHistory: APP_STORAGE_KEYS.history,
  bodyMetrics: APP_STORAGE_KEYS.bodyMetrics,
  storageVersion: APP_STORAGE_KEYS.storageVersion,
  exerciseTargets: APP_STORAGE_KEYS.exerciseTargets,
  progressionSuggestions: APP_STORAGE_KEYS.progressionSuggestions,
  userEquipment: APP_STORAGE_KEYS.userEquipment,
  googleSheetsWebAppUrl: APP_STORAGE_KEYS.sheetsUrl,
  iosInstallDismissed: APP_STORAGE_KEYS.iosInstallDismissed,
  healthConnectLastSync: APP_STORAGE_KEYS.healthConnectLastSync
});

const BACKUP_KEYS = Object.freeze([
  APP_STORAGE_KEYS.history,
  APP_STORAGE_KEYS.bodyMetrics,
  APP_STORAGE_KEYS.storageVersion,
  APP_STORAGE_KEYS.exerciseTargets,
  APP_STORAGE_KEYS.progressionSuggestions,
  APP_STORAGE_KEYS.userEquipment
]);

const MAX_BACKUP_BYTES = 2_000_000;

export function migrateLegacyStorage(storage = globalThis.localStorage) {
  if (!storage) return;
  for (const [legacyKey, currentKey] of Object.entries(LEGACY_KEYS)) {
    const legacyValue = storage.getItem(legacyKey);
    if (legacyValue == null) continue;
    if (storage.getItem(currentKey) == null) storage.setItem(currentKey, legacyValue);
    storage.removeItem(legacyKey);
  }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function createDataBackup(storage = globalThis.localStorage) {
  const data = {};
  for (const key of BACKUP_KEYS) {
    const value = storage?.getItem(key);
    if (value != null) data[key] = value;
  }
  return JSON.stringify({
    format: "workout-plan-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data
  }, null, 2);
}

export function restoreDataBackup(text, storage = globalThis.localStorage) {
  if (typeof text !== "string" || new Blob([text]).size > MAX_BACKUP_BYTES) {
    throw new Error("Backup file is too large.");
  }

  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("Backup is not valid JSON.");
  }

  if (backup?.format !== "workout-plan-backup" || backup.version !== 1 || !backup.data || Array.isArray(backup.data)) {
    throw new Error("This is not a supported Workout Plan backup.");
  }

  const allowed = new Set(BACKUP_KEYS);
  for (const [key, value] of Object.entries(backup.data)) {
    if (!allowed.has(key) || typeof value !== "string") {
      throw new Error("Backup contains unsupported data.");
    }
    JSON.parse(value);
  }

  for (const [key, value] of Object.entries(backup.data)) storage.setItem(key, value);
  return Object.keys(backup.data).length;
}
