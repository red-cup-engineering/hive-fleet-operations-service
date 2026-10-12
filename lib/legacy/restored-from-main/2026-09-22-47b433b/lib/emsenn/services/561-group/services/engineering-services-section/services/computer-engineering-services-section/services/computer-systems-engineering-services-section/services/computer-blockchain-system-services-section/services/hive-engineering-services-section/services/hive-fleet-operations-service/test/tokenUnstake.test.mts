import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseOptions, planUnstake, statesAgree } from "../scripts/unstake-token.mjs";

const STATE = Object.freeze({ account: "michael561", symbol: "ZING", precision: 3, stakingEnabled: true,
  unstakingCooldownDays: 28, numberTransactions: 4, liquid: "11097.306", stake: "35409.432",
  pendingUnstake: "0.000", delegationsOut: "0.000", pendingUndelegations: "0.000", pendingRows: Object.freeze([]) });

test("full token stake enters the token's exact release schedule", () => {
  const plan = planUnstake(STATE); assert.equal(plan.kind, "unstake"); if (plan.kind !== "unstake") return;
  assert.equal(plan.quantity, "35409.432"); assert.equal(plan.cooldownDays, 28); assert.equal(plan.numberTransactions, 4);
  assert.equal(plan.firstReleaseUnits, "8852.358");
  assert.deepEqual(plan.operation, ["custom_json", { id: "ssc-mainnet-hive", required_auths: ["michael561"], required_posting_auths: [],
    json: '{"contractName":"tokens","contractAction":"unstake","contractPayload":{"symbol":"ZING","quantity":"35409.432"}}' }]);
});

test("unstake refuses pending or delegated positions", () => {
  assert.match(planUnstake({ ...STATE, pendingUnstake: "1.000" }).reason, /already pending/);
  assert.match(planUnstake({ ...STATE, delegationsOut: "1.000" }).reason, /must return/);
  assert.match(planUnstake({ ...STATE, stake: "0.000" }).reason, /no staked/);
});

test("unstake arguments and economic evidence are exact", () => {
  assert.deepEqual(parseOptions(["--account", "michael561", "--symbol", "zing"]), { account: "michael561", symbol: "ZING", keyFile: "", executeOne: false });
  assert.throws(() => parseOptions(["--account", "michael561", "--symbol", "ZING", "--execute-one"]), /requires --key-file/);
  assert.equal(statesAgree(STATE, { ...STATE }), true); assert.equal(statesAgree(STATE, { ...STATE, stake: "1.000" }), false);
});

test("broadcaster admits only the exact liquidity-unlock unstake", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const run = (overrides: Record<string, unknown> = {}): Promise<string> => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] }); let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("close", () => resolve(stderr));
    child.stdin.end(JSON.stringify({ account: "michael561", role: "active", lane: "liquidity-unlock", target: "unstake:ZING:35409.432",
      keyFile: "/missing/active.wif", operation: ["custom_json", { id: "ssc-mainnet-hive", required_auths: ["michael561"], required_posting_auths: [],
        json: '{"contractName":"tokens","contractAction":"unstake","contractPayload":{"symbol":"ZING","quantity":"35409.432"}}' }], ...overrides }));
  });
  assert.match(await run(), /cannot read key file/); assert.match(await run({ target: "unstake:ZING:1.000" }), /token unlock/);
  assert.match(await run({ lane: "trading" }), /refusing contract call/);
});
