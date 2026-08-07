import {
  formatHealthConnectStatus,
  HEALTH_CONNECT_SYNC_KEY
} from "./health-connect-mapping.js";

export { formatHealthConnectStatus };

export function isHealthConnectRuntime() {
  return Boolean(window.Capacitor?.isNativePlatform?.() && window.Capacitor?.getPlatform?.() === "android");
}

export function getLastHealthConnectSync() {
  try {
    return localStorage.getItem(HEALTH_CONNECT_SYNC_KEY);
  } catch {
    return null;
  }
}

async function loadHealthConnect() {
  if (!isHealthConnectRuntime()) return null;
  return import("./health-connect.js");
}

export async function getHealthConnectAvailability() {
  const integration = await loadHealthConnect();
  return integration ? integration.getHealthConnectAvailability() : "WebOnly";
}

export async function syncBodyMetricsFromHealthConnect() {
  const integration = await loadHealthConnect();
  if (!integration) {
    return {
      ok: false,
      availability: "WebOnly",
      message: "Install the Android app to sync from your GE scale."
    };
  }
  return integration.syncBodyMetricsFromHealthConnect();
}
