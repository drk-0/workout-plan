import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReadiness,
  normalizeReadiness,
  readinessIsComplete,
  suggestAdjustments
} from "./readiness.js";
import { READINESS_BLOCK_MESSAGE } from "./safety.js";

test("evaluateReadiness blocks severe pain", () => {
  const result = evaluateReadiness({ painToday: "severe" });
  assert.equal(result.blocked, true);
  assert.ok(result.blockReasons.includes("severe pain today"));
});

test("evaluateReadiness blocks urgent symptoms", () => {
  const cases = [
    { dizziness: true },
    { unusualWeakness: true },
    { unusualShortnessOfBreath: true },
    { chestDiscomfort: true },
    { confusion: true },
    { faintness: true }
  ];
  for (const input of cases) {
    const result = evaluateReadiness({ painToday: "none", ...input });
    assert.equal(result.blocked, true, JSON.stringify(input));
  }
});

test("evaluateReadiness allows mild pain without urgent symptoms", () => {
  const result = evaluateReadiness({
    painToday: "mild",
    energy: 4,
    soreness: 2
  });
  assert.equal(result.blocked, false);
});

test("suggestAdjustments recommends lighter work for low energy", () => {
  const suggestions = suggestAdjustments({ energy: 1, soreness: 2, painToday: "none" });
  assert.ok(suggestions.some((item) => item.includes("Low energy")));
});

test("suggestAdjustments recommends substitution for moderate pain", () => {
  const suggestions = suggestAdjustments({ energy: 4, soreness: 2, painToday: "moderate" });
  assert.ok(suggestions.some((item) => item.includes("substitution")));
});

test("normalizeReadiness attaches evaluation metadata", () => {
  const readiness = normalizeReadiness({
    energy: 3,
    soreness: 4,
    painToday: "none"
  });
  assert.equal(readiness.blocked, false);
  assert.ok(readiness.suggestedAdjustments.length > 0);
});

test("normalizeReadiness blocks severe pain with stop-workout message", () => {
  const readiness = normalizeReadiness({
    energy: 4,
    soreness: 2,
    painToday: "severe"
  });
  assert.equal(readiness.blocked, true);
  assert.ok(readiness.blockReasons.includes("severe pain today"));
  assert.equal(evaluateReadiness(readiness).blockMessage, READINESS_BLOCK_MESSAGE);
});

test("dizziness and unusual weakness block independently", () => {
  const dizzinessOnly = evaluateReadiness({ painToday: "none", dizziness: true, unusualWeakness: false });
  const weaknessOnly = evaluateReadiness({ painToday: "none", dizziness: false, unusualWeakness: true });
  assert.equal(dizzinessOnly.blocked, true);
  assert.equal(weaknessOnly.blocked, true);
  assert.ok(dizzinessOnly.blockReasons.includes("dizziness"));
  assert.ok(weaknessOnly.blockReasons.includes("unusual weakness"));
});

test("readinessIsComplete requires energy, soreness, painToday, and recordedAt", () => {
  assert.equal(readinessIsComplete(null), false);
  assert.equal(
    readinessIsComplete({
      energy: 4,
      soreness: 2,
      painToday: "none",
      recordedAt: "2026-07-20T10:00:00.000Z"
    }),
    true
  );
  assert.equal(
    readinessIsComplete({
      energy: 4,
      soreness: 2,
      painToday: null,
      recordedAt: "2026-07-20T10:00:00.000Z"
    }),
    false
  );
});
