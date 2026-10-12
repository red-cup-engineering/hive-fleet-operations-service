import assert from "node:assert/strict";
import test from "node:test";

import { sizeExactTriangle, type ExactTriangleInput } from "../src/analysis/exactTriangle.mts";

const profitable: ExactTriangleInput = Object.freeze({
  initialBalance: "1.00000000",
  initialPrecision: 8,
  capInitialMilli: 1000,
  firstPool: Object.freeze({ pair: "SWAP.HIVE:A", inputSymbol: "SWAP.HIVE", outputSymbol: "A", reserveIn: "1000.00000000", reserveOut: "1100.000", inputPrecision: 8, outputPrecision: 3, feeBps: 25 }),
  secondPool: Object.freeze({ pair: "B:A", inputSymbol: "A", outputSymbol: "B", reserveIn: "1000.000", reserveOut: "1100.000", inputPrecision: 3, outputPrecision: 3, feeBps: 25 }),
  finalTokenPrecision: 3,
  bids: Object.freeze([{ priceSwapHivePerToken: "1.00000000", quantity: "1000.000" }]),
  bidBookComplete: true,
  bidBookOrdered: true,
  perPoolSlippageBps: 50,
});

test("exact triangle sizes a positive snapshot full-fill surplus without admitting execution", () => {
  const result = sizeExactTriangle(profitable);
  assert.equal(result.admitted, true);
  if (!result.admitted) return;
  assert.ok(BigInt(result.quote.snapshotFullFillSurplus.replace(".", "")) > 0n);
  assert.equal(result.quote.executionAdmissible, false);
  assert.equal(result.quote.finalLimitPrice, "1.00000000");
  assert.ok(result.quote.evidenceGaps.includes("three-contract-call-carrier-is-sequential-not-atomic"));
});

test("exact triangle refuses incomplete depth, losing routes, and route precision drift", () => {
  const incomplete = sizeExactTriangle({ ...profitable, bidBookComplete: false });
  assert.equal(incomplete.admitted, false);
  if (!incomplete.admitted) assert.match(incomplete.reason, /truncated/u);
  const losing = sizeExactTriangle({ ...profitable, secondPool: { ...profitable.secondPool, reserveOut: "100.000" } });
  assert.equal(losing.admitted, false);
  const drift = sizeExactTriangle({ ...profitable, secondPool: { ...profitable.secondPool, inputPrecision: 4 } });
  assert.equal(drift.admitted, false);
});

test("exact triangle conservatively refuses final depth shortfall", () => {
  const result = sizeExactTriangle({ ...profitable, bids: [{ priceSwapHivePerToken: "1.00000000", quantity: "0.001" }] });
  assert.equal(result.admitted, false);
});
