import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, neutralizeSpreadsheetFormula } from "./spreadsheet-security.js";

test("spreadsheet exports neutralize formula prefixes", () => {
  assert.equal(neutralizeSpreadsheetFormula("=HYPERLINK(\"https://example.com\")").startsWith("'="), true);
  assert.equal(neutralizeSpreadsheetFormula("  @SUM(A1:A2)").startsWith("'"), true);
  assert.equal(neutralizeSpreadsheetFormula("ordinary note"), "ordinary note");
  assert.equal(csvCell('a "quoted" note'), '"a ""quoted"" note"');
});
