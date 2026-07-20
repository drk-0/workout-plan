export const PAIN_AFTER_LEVELS = ["none", "mild", "moderate", "severe"];
export const COMPLETION_STATUSES = ["completed", "shortened", "stopped"];

export function normalizeRecovery(raw) {
  if (!raw || typeof raw !== "object") return undefined;

  const overallEffort =
    raw.overallEffort === "" || raw.overallEffort == null ? null : Number(raw.overallEffort);
  const glucose = raw.glucose === "" || raw.glucose == null ? null : Number(raw.glucose);
  const painAfter = PAIN_AFTER_LEVELS.includes(String(raw.painAfter || "").toLowerCase())
    ? String(raw.painAfter).toLowerCase()
    : "none";
  const completionStatus = COMPLETION_STATUSES.includes(String(raw.completionStatus || "").toLowerCase())
    ? String(raw.completionStatus).toLowerCase()
    : "completed";

  return {
    overallEffort: Number.isFinite(overallEffort) ? overallEffort : null,
    unusualFatigue: Boolean(raw.unusualFatigue),
    painAfter,
    glucose: Number.isFinite(glucose) ? glucose : null,
    notes: String(raw.notes || "").trim(),
    completionStatus,
    recordedAt: raw.recordedAt || new Date().toISOString()
  };
}
