export function neutralizeSpreadsheetFormula(value) {
  const text = String(value ?? "");
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function csvCell(value) {
  return `"${neutralizeSpreadsheetFormula(value).replaceAll('"', '""')}"`;
}
