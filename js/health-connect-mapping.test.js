import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  kilogramsToPounds,
  mapWeightRecordToMetric,
  mergeHealthConnectMetrics
} from "./health-connect-mapping.js";

describe("health-connect-mapping", () => {
  it("converts kilograms to pounds", () => {
    assert.equal(kilogramsToPounds(80), 176.4);
  });

  it("maps weight records from Health Connect", () => {
    const metric = mapWeightRecordToMetric({
      time: "2026-01-15T12:00:00.000Z",
      value: 80,
      metadata: { id: "abc123" }
    });
    assert.equal(metric.weight, 176.4);
    assert.equal(metric.id, "hc-weight-abc123");
    assert.equal(metric.source, "health_connect");
  });

  it("merges scale readings without overwriting manual waist", () => {
    const existing = [
      {
        id: "manual-1",
        date: "2026-01-15",
        timestamp: "2026-01-15T08:00:00.000Z",
        weight: 180,
        waist: 36,
        bodyFat: null,
        notes: "Morning",
        source: "manual"
      }
    ];
    const weightRecords = [
      {
        time: "2026-01-15T12:00:00.000Z",
        value: 81.6,
        metadata: { id: "scale-1" }
      }
    ];
    const { entries, imported } = mergeHealthConnectMetrics(existing, weightRecords);
    assert.equal(imported, 1);
    assert.equal(entries[0].waist, 36);
    assert.equal(entries[0].weight, 179.9);
    assert.equal(entries[0].source, "manual");
  });
});
