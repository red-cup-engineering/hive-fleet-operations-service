import assert from "node:assert/strict";
import test from "node:test";
import { nextTransition, operationDigest } from "../scripts/help-liquidity-cell.mjs";

const state = { michaelSwapHive: "69.00000000", helpSwapHive: "0.00231231", helpSwapBtc: "0.00000000" };
test("the chain-derived state machine advances one liquidity reaction at a time", () => {
  assert.equal(nextTransition({ funded: false, swapped: false, pooled: false, state }), "fund");
  assert.equal(nextTransition({ funded: true, swapped: false, pooled: false, state: { ...state, helpSwapHive: "1.00231231" } }), "swap");
  assert.equal(nextTransition({ funded: true, swapped: true, pooled: false, state: { ...state, helpSwapHive: "0.50231231", helpSwapBtc: "0.00000037" } }), "pool");
  assert.equal(nextTransition({ funded: true, swapped: true, pooled: true, state }), "monitor");
});
test("operation identity is canonical and drift-sensitive", () => {
  assert.equal(operationDigest(["x", { b: 2, a: 1 }]), operationDigest(["x", { a: 1, b: 2 }]));
  assert.notEqual(operationDigest(["x", { a: 1 }]), operationDigest(["x", { a: 2 }]));
});
