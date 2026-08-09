import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./Code.gs", import.meta.url), "utf8");
const context = {};
vm.createContext(context);
vm.runInContext(`${source}
globalThis.testApi = { API_VERSION, constantTimeEqual, normalizeLog, safeText };`, context);

test("workout edit sync uses the current API version", () => {
  assert.equal(context.testApi.API_VERSION, 2);
});

test("sync token comparison rejects missing and mismatched values", () => {
  assert.equal(context.testApi.constantTimeEqual("correct", "correct"), true);
  assert.equal(context.testApi.constantTimeEqual("wrong", "correct"), false);
  assert.equal(context.testApi.constantTimeEqual("", "correct"), false);
});

test("sheet text neutralizes formula injection", () => {
  assert.equal(context.testApi.safeText("=IMPORTXML(\"https://example.com\")", 2000).startsWith("'="), true);
  assert.equal(context.testApi.safeText("  +1", 2000).startsWith("'"), true);
  assert.equal(context.testApi.safeText("normal note", 2000), "normal note");
});

test("log validation rejects unsafe identifiers and numeric ranges", () => {
  const valid = context.testApi.normalizeLog({
    id: "set-123",
    sessionId: "session-123",
    notes: "@SUM(A1:A2)",
    reps: 12,
    weight: 25
  });
  assert.equal(valid.notes, "'@SUM(A1:A2)");
  assert.throws(() => context.testApi.normalizeLog({
    id: "<script>",
    sessionId: "session-123"
  }), /Invalid id/);
  assert.throws(() => context.testApi.normalizeLog({
    id: "set-123",
    sessionId: "session-123",
    weight: 100000
  }), /out of range/);
});
