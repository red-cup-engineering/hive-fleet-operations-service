import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { decide, normalizeSavingsFields } from "../scripts/michael-productive-savings-cell.mjs";
const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url).pathname;
const state = { hbdBalance: "16.304 HBD", savingsHbdBalance: "0.000 HBD", interestRateBps: 1000, pendingWithdrawalCount: 0 };
test("productive savings admits only current law, available capital, and no replay", () => {
  assert.equal(decide(state, false), "deposit"); assert.equal(decide(state, true), "monitor");
  assert.equal(decide({ ...state, interestRateBps: 999 }, false), "refuse-rate-below-10-percent");
  assert.equal(decide({ ...state, hbdBalance: "9.999 HBD" }, false), "refuse-insufficient-liquid-hbd");
  assert.equal(decide({ ...state, pendingWithdrawalCount: 1 }, false), "refuse-pending-withdrawal");
});
test("Hive's appbase asset carrier normalizes to the admitted HBD string", () => {
  assert.deepEqual(normalizeSavingsFields({ from: "michael561", to: "michael561", memo: "aagaard:michael561:productive-savings:v1",
    amount: { nai: "@@000000013", amount: "10000", precision: 3 } }),
  { from: "michael561", to: "michael561", amount: "10.000 HBD", memo: "aagaard:michael561:productive-savings:v1" });
});
test("the signer membrane admits only Michael's exact productive tranche", () => {
  const request = { kind: "aagaard.hive-write", account: "michael561", role: "active", lane: "productive-savings", target: "michael561",
    keyFile: "/missing/active.wif", operation: ["transfer_to_savings", { from: "michael561", to: "michael561", amount: "10.000 HBD", memo: "aagaard:michael561:productive-savings:v1" }] };
  const admitted = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(request), encoding: "utf8" }); assert.match(admitted.stderr, /cannot read key file/u);
  const changed = { ...request, operation: ["transfer_to_savings", { ...request.operation[1], amount: "10.001 HBD" }] };
  const refused = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(changed), encoding: "utf8" }); assert.doesNotMatch(refused.stderr, /cannot read key file/u);
});
