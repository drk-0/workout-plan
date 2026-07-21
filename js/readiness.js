import { READINESS_BLOCK_MESSAGE } from "./safety.js";

export const PAIN_TODAY_LEVELS = ["none", "mild", "moderate", "severe"];

export function normalizeReadiness(raw) {
  if (!raw || typeof raw !== "object") return null;

  const energy = raw.energy === "" || raw.energy == null ? null : Number(raw.energy);
  const soreness = raw.soreness === "" || raw.soreness == null ? null : Number(raw.soreness);
  const painToday = PAIN_TODAY_LEVELS.includes(String(raw.painToday || "").toLowerCase())
    ? String(raw.painToday).toLowerCase()
    : null;
  const glucose = raw.glucose === "" || raw.glucose == null ? null : Number(raw.glucose);

  const out = {
    energy: Number.isFinite(energy) ? energy : null,
    soreness: Number.isFinite(soreness) ? soreness : null,
    painToday,
    dizziness: Boolean(raw.dizziness),
    unusualWeakness: Boolean(raw.unusualWeakness),
    unusualShortnessOfBreath: Boolean(raw.unusualShortnessOfBreath),
    chestDiscomfort: Boolean(raw.chestDiscomfort),
    confusion: Boolean(raw.confusion),
    faintness: Boolean(raw.faintness),
    glucose: Number.isFinite(glucose) ? glucose : null,
    note: String(raw.note || "").trim(),
    recordedAt: raw.recordedAt || new Date().toISOString()
  };

  const evaluation = evaluateReadiness(out);
  out.blocked = evaluation.blocked;
  out.blockReasons = evaluation.blockReasons;
  out.suggestedAdjustments = evaluation.suggestedAdjustments;

  return out;
}

export function evaluateReadiness(readiness) {
  const blockReasons = [];

  if (readiness.painToday === "severe") {
    blockReasons.push("severe pain today");
  }
  if (readiness.dizziness) blockReasons.push("dizziness");
  if (readiness.unusualWeakness) blockReasons.push("unusual weakness");
  if (readiness.unusualShortnessOfBreath) blockReasons.push("unusual shortness of breath");
  if (readiness.chestDiscomfort) blockReasons.push("chest discomfort");
  if (readiness.confusion) blockReasons.push("confusion");
  if (readiness.faintness) blockReasons.push("faintness");

  const blocked = blockReasons.length > 0;
  const suggestedAdjustments = blocked ? [] : suggestAdjustments(readiness);

  return {
    blocked,
    blockReasons,
    blockMessage: blocked ? READINESS_BLOCK_MESSAGE : null,
    suggestedAdjustments
  };
}

export function suggestAdjustments(readiness) {
  const suggestions = [];

  if (readiness.energy != null && readiness.energy <= 2) {
    suggestions.push("Low energy today — consider dropping one set or using a lighter weight.");
  }
  if (readiness.soreness != null && readiness.soreness >= 4) {
    suggestions.push("Moderate soreness — consider reducing volume or using lighter weights.");
  }
  if (readiness.painToday === "moderate") {
    suggestions.push("Moderate pain today — consider substitutions or a shorter range of motion.");
  }
  if (readiness.painToday === "mild") {
    suggestions.push("Mild pain today — move slowly, use lighter loads, and stop if pain increases.");
  }

  return suggestions;
}

export function readinessIsComplete(readiness) {
  return Boolean(readiness?.recordedAt && readiness.energy != null && readiness.soreness != null && readiness.painToday);
}
