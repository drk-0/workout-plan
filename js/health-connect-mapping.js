import { localDateKey } from "./workout-data.js";

export const HEALTH_CONNECT_SYNC_KEY = "healthConnectLastSync";
export const KG_TO_LB = 2.2046226218;

export function kilogramsToPounds(kg) {
  const value = Number(kg);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * KG_TO_LB * 10) / 10;
}

export function parseBodyFatPercentage(record) {
  if (!record || typeof record !== "object") return null;
  const raw = record.percentage ?? record.value;
  const value = typeof raw === "object" ? raw?.value : raw;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 100) return null;
  return Math.round(num * 10) / 10;
}

export function mapWeightRecordToMetric(record) {
  if (!record?.time) return null;
  const weightLb = kilogramsToPounds(record.value);
  if (weightLb == null) return null;
  const time = new Date(record.time);
  const metadataId = record.metadata?.id;
  return {
    id: metadataId ? `hc-weight-${metadataId}` : `hc-weight-${time.getTime()}`,
    date: localDateKey(time),
    timestamp: time.toISOString(),
    weight: weightLb,
    waist: null,
    bodyFat: null,
    notes: "GE scale (Health Connect)",
    source: "health_connect"
  };
}

export function mapBodyFatRecordToMetric(record) {
  if (!record?.time) return null;
  const bodyFat = parseBodyFatPercentage(record);
  if (bodyFat == null) return null;
  const time = new Date(record.time);
  const metadataId = record.metadata?.id;
  return {
    id: metadataId ? `hc-bodyfat-${metadataId}` : `hc-bodyfat-${time.getTime()}`,
    date: localDateKey(time),
    timestamp: time.toISOString(),
    weight: null,
    waist: null,
    bodyFat,
    notes: "GE scale body fat (Health Connect)",
    source: "health_connect"
  };
}

/**
 * Merge weight and body-fat readings by calendar day, then upsert into stored metrics.
 * Manual entries win on the same day unless Health Connect has a newer timestamp.
 */
export function mergeHealthConnectMetrics(existing, weightRecords, bodyFatRecords = []) {
  const byDate = new Map();

  for (const entry of existing) {
    byDate.set(entry.date, { ...entry });
  }

  const weightByDate = new Map();
  for (const record of weightRecords) {
    const mapped = mapWeightRecordToMetric(record);
    if (!mapped) continue;
    const current = weightByDate.get(mapped.date);
    if (!current || new Date(mapped.timestamp) > new Date(current.timestamp)) {
      weightByDate.set(mapped.date, mapped);
    }
  }

  const fatByDate = new Map();
  for (const record of bodyFatRecords) {
    const mapped = mapBodyFatRecordToMetric(record);
    if (!mapped) continue;
    const current = fatByDate.get(mapped.date);
    if (!current || new Date(mapped.timestamp) > new Date(current.timestamp)) {
      fatByDate.set(mapped.date, mapped);
    }
  }

  let imported = 0;

  for (const [date, weightEntry] of weightByDate) {
    const fatEntry = fatByDate.get(date);
    const existingEntry = byDate.get(date);
    const merged = {
      ...(existingEntry || {}),
      id: weightEntry.id,
      date,
      timestamp: weightEntry.timestamp,
      weight: weightEntry.weight,
      bodyFat: fatEntry?.bodyFat ?? existingEntry?.bodyFat ?? null,
      waist: existingEntry?.waist ?? null,
      notes: existingEntry?.source === "manual" ? existingEntry.notes : weightEntry.notes,
      source: existingEntry?.source === "manual" ? existingEntry.source : "health_connect"
    };

    if (
      !existingEntry ||
      existingEntry.source !== "manual" ||
      new Date(merged.timestamp) > new Date(existingEntry.timestamp)
    ) {
      if (!existingEntry || JSON.stringify(existingEntry) !== JSON.stringify(merged)) {
        imported += 1;
      }
      byDate.set(date, merged);
    }
  }

  for (const [date, fatEntry] of fatByDate) {
    if (weightByDate.has(date)) continue;
    const existingEntry = byDate.get(date);
    const merged = {
      ...(existingEntry || {}),
      id: fatEntry.id,
      date,
      timestamp: fatEntry.timestamp,
      bodyFat: fatEntry.bodyFat,
      weight: existingEntry?.weight ?? null,
      waist: existingEntry?.waist ?? null,
      notes: existingEntry?.source === "manual" ? existingEntry.notes : fatEntry.notes,
      source: existingEntry?.source === "manual" ? existingEntry.source : "health_connect"
    };

    if (
      !existingEntry ||
      existingEntry.source !== "manual" ||
      new Date(merged.timestamp) > new Date(existingEntry.timestamp)
    ) {
      if (!existingEntry || existingEntry.bodyFat !== merged.bodyFat) {
        imported += 1;
      }
      byDate.set(date, merged);
    }
  }

  const mergedList = [...byDate.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  return { entries: mergedList, imported };
}

export function formatHealthConnectStatus(availability) {
  switch (availability) {
    case "Available":
      return { label: "Ready", tone: "ok" };
    case "NotInstalled":
      return { label: "Install Health Connect", tone: "warn" };
    case "NotSupported":
      return { label: "Not supported on this device", tone: "warn" };
    default:
      return { label: "Browser mode (no Health Connect)", tone: "muted" };
  }
}
