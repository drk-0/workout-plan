export const STOP_SYMPTOMS = [
  "chest pain or pressure",
  "faintness or feeling like you might pass out",
  "confusion or trouble thinking clearly",
  "severe shortness of breath",
  "sudden unusual weakness",
  "sharp or severe pain during exercise"
];

export const URGENT_SYMPTOM_WARNING = `Stop exercising. These symptoms can be serious. If they are severe, sudden, or not improving, seek medical help right away. This app cannot diagnose the cause.`;

export const SHARP_PAIN_WARNING = `Sharp pain during a set is a signal to stop this exercise. Do not push through it. Consider skipping this exercise or choosing an easier substitute.`;

export const READINESS_BLOCK_MESSAGE = `Based on what you reported, it is not safe to start this workout right now. Rest, monitor how you feel, and seek medical help if symptoms are urgent or worsening. This app does not diagnose the cause.`;

export const MEDICAL_DISCLAIMER = `This app is for personal workout tracking only. It is not medical advice. Do not change medications, insulin, or carbohydrate intake based on this app.`;

export function renderStopSymptomsList() {
  return STOP_SYMPTOMS.map((item) => `<li>${item}</li>`).join("");
}
