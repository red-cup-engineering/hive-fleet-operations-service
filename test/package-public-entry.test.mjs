import assert from "node:assert/strict";
import test from "node:test";

test("published root entry resolves to direct JavaScript source", async () => {
  const entry = await import("@red-cup-engineering/hive-fleet-operations-service");
  assert.equal(typeof entry.createAagaardRuntime, "function");
});
