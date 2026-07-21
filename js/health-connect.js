import {
  HEALTH_CONNECT_SYNC_KEY,
  mergeHealthConnectMetrics
} from "./health-connect-mapping.js";
import { loadBodyMetrics, saveBodyMetrics } from "./progress.js";

const SYNC_DAYS = 90;
const READ_TYPES = ["Weight", "BodyFat"];
const BODY_FAT_TYPE = "BodyFat";

let pluginPromise = null;

function isNativeCapacitor() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

async function getPlugin() {
  if (!isNativeCapacitor()) return null;
  if (!pluginPromise) {
    pluginPromise = (async () => {
      const { registerPlugin } = await import("../vendor/capacitor/core.js");
      return registerPlugin("HealthConnect");
    })();
  }
  return pluginPromise;
}

export function isHealthConnectRuntime() {
  return isNativeCapacitor();
}

export async function getHealthConnectAvailability() {
  if (!isNativeCapacitor()) return "WebOnly";
  try {
    const plugin = await getPlugin();
    const result = await plugin.checkAvailability();
    return result?.availability ?? "NotSupported";
  } catch {
    return "NotSupported";
  }
}

export function getLastHealthConnectSync() {
  try {
    return localStorage.getItem(HEALTH_CONNECT_SYNC_KEY);
  } catch {
    return null;
  }
}

function setLastHealthConnectSync(iso) {
  localStorage.setItem(HEALTH_CONNECT_SYNC_KEY, iso);
}

export async function requestHealthConnectPermissions() {
  const plugin = await getPlugin();
  if (!plugin) {
    throw new Error("Health Connect is only available in the Android app.");
  }
  return plugin.requestPermissions({
    read: READ_TYPES,
    write: []
  });
}

async function readRecords(type, start, end) {
  const plugin = await getPlugin();
  if (!plugin) return [];
  const result = await plugin.readRecords({ type, start, end });
  return Array.isArray(result?.records) ? result.records : [];
}

export async function syncBodyMetricsFromHealthConnect({ days = SYNC_DAYS } = {}) {
  const availability = await getHealthConnectAvailability();
  if (availability === "WebOnly") {
    return {
      ok: false,
      availability,
      message: "Install the Android app to sync from your GE scale."
    };
  }
  if (availability !== "Available") {
    return {
      ok: false,
      availability,
      message:
        availability === "NotInstalled"
          ? "Install Health Connect from the Play Store, then try again."
          : "Health Connect is not available on this device."
    };
  }

  await requestHealthConnectPermissions();

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);

  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const weightRecords = await readRecords("Weight", startIso, endIso);
  let bodyFatRecords = [];
  try {
    bodyFatRecords = await readRecords(BODY_FAT_TYPE, startIso, endIso);
  } catch {
    bodyFatRecords = [];
  }

  const existing = loadBodyMetrics();
  const { entries, imported } = mergeHealthConnectMetrics(existing, weightRecords, bodyFatRecords);
  saveBodyMetrics(entries);
  setLastHealthConnectSync(end.toISOString());

  return {
    ok: true,
    availability,
    imported,
    weightCount: weightRecords.length,
    bodyFatCount: bodyFatRecords.length,
    message:
      imported > 0
        ? `Synced ${imported} day${imported === 1 ? "" : "s"} from your GE scale.`
        : "Scale data is up to date."
  };
}
