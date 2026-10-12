import assert from "node:assert/strict";
import test from "node:test";

import { certifyExactTriangleAssay, type TriangleMarketState, type TriangleProviderObservation } from "../src/core/triangleAssay.mts";

const state: TriangleMarketState = Object.freeze({
  account: "michael561", initialBalance: "1.00000000", initialPrecision: 8, capInitialMilli: 1000,
  firstPool: { pair: "SWAP.HIVE:A", inputSymbol: "SWAP.HIVE", outputSymbol: "A", reserveIn: "1000", reserveOut: "1100", inputPrecision: 8, outputPrecision: 3, feeBps: 25 },
  secondPool: { pair: "B:A", inputSymbol: "A", outputSymbol: "B", reserveIn: "1000", reserveOut: "1100", inputPrecision: 3, outputPrecision: 3, feeBps: 25 },
  finalTokenPrecision: 3, bids: [{ priceSwapHivePerToken: "1.00000000", quantity: "1000.000" }],
  bidBookComplete: true, bidBookOrdered: true, perPoolSlippageBps: 50,
});

function seen(provider: string, value = state): TriangleProviderObservation {
  return Object.freeze({ provider, status: "available", state: value });
}

test("two exact witnesses certify a non-executable exact triangle assay", () => {
  const report = certifyExactTriangleAssay({ observedAt: "2026-07-22T09:40:00Z", observations: [seen("one"), seen("two")] });
  assert.equal(report.status, "certified");
  if (report.status !== "certified") return;
  assert.equal(report.result.admitted, true);
  assert.equal(report.executionAdmissible, false);
  assert.deepEqual(report.route, ["SWAP.HIVE", "A", "B", "SWAP.HIVE"]);
});

test("triangle assay exposes provider contradiction and insufficient support", () => {
  const contested = certifyExactTriangleAssay({ observedAt: "2026-07-22T09:40:00Z", observations: [seen("one"), seen("two", { ...state, initialBalance: "0.90000000" })] });
  assert.equal(contested.status, "uncertified");
  assert.equal(contested.providerKnowledge.value, "both");
  const neither = certifyExactTriangleAssay({ observedAt: "2026-07-22T09:40:00Z", observations: [seen("one"), { provider: "two", status: "unavailable", problem: "503" }] });
  assert.equal(neither.status, "uncertified");
  assert.equal(neither.providerKnowledge.value, "neither");
});
