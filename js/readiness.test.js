import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReadiness,
  normalizeReadiness,
  suggestAdjustments
} from "./readiness.js";

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
