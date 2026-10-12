import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { normalizeEngineTransactionInfo, parseOptions, planWorkerBeeYield, statesAgree } from "../scripts/workerbee-yield.mjs";

const STATE = Object.freeze({ account: "michael561", symbol: "WORKERBEE", observedAt: "2026-07-22T00:00:00.000Z",
  token: Object.freeze({ issuer: "steem-tokens", precision: 5, stakingEnabled: true, delegationEnabled: true,
    unstakingCooldownDays: 63, undelegationCooldownDays: 7, numberTransactions: 9 }),
  balance: Object.freeze({ liquid: "3.66758", stake: "0.00000", delegationsOut: "0.00000", pendingUnstake: "0.00000", pendingUndelegations: "0.00000" }),
  delegation: Object.freeze({ to: "ph1102", quantity: "0.00000" }), pendingRows: Object.freeze({ unstakes: 0, undelegations: 0 }),
  pool: Object.freeze({ id: "BEE:WORKERBEE", minedToken: "BEE", lotteryWinners: 10, lotteryIntervalHours: 1, lotteryAmount: "10.00000000", active: true,
    tokenMiners: Object.freeze([Object.freeze({ symbol: "WORKERBEE", multiplier: 1 })]), totalPower: "232290.60673", poolAccountPower: "19911.81112" }),
  books: Object.freeze({
    beeBids: Object.freeze([Object.freeze({ account: "buyer", price: "0.51550475", quantity: "1.83277550", txId: "a".repeat(40), expiration: 2_000_000_000 })]),
    workerBeeBids: Object.freeze([
      Object.freeze({ account: "buyer", price: "1.22800000", quantity: "0.10000", txId: "b".repeat(40), expiration: 2_000_000_000 }),
      Object.freeze({ account: "buyer", price: "1.00000000", quantity: "3.56758", txId: "c".repeat(40), expiration: 2_000_000_000 }),
    ]),
  }) });

test("WORKERBEE plan derives exact chain-yield bounds and one productive batch", () => {
  const plan = planWorkerBeeYield(STATE); assert.equal(plan.kind, "stake-delegate"); if (plan.kind !== "stake-delegate") return;
  assert.equal(plan.quantity, "3.66758"); assert.equal(plan.recipient, "ph1102"); assert.equal(plan.expectedYield.weeklyBeeFloor, "0.02652511");
  assert.equal(plan.expectedYield.annualBeeFloor, "1.37930572"); assert.equal(plan.expectedYield.annualSwapHiveAtBidFloor, "0.71103865");
  assert.equal(plan.expectedYield.positionSwapHiveAtBidFloor, "3.69038000"); assert.equal(plan.expectedYield.positionExitLevels, 2);
  assert.equal(plan.expectedYield.annualYieldBps, 1926);
  assert.deepEqual(JSON.parse(plan.operation[1].json), [
    { contractName: "tokens", contractAction: "stake", contractPayload: { symbol: "WORKERBEE", to: "michael561", quantity: "3.66758" } },
    { contractName: "tokens", contractAction: "delegate", contractPayload: { symbol: "WORKERBEE", to: "ph1102", quantity: "3.66758" } },
  ]);
});

test("WORKERBEE planner refuses changed law, pending movement, no inventory, or signer-cap overflow", () => {
  assert.match(planWorkerBeeYield({ ...STATE, token: { ...STATE.token, undelegationCooldownDays: 8 } }).reason, /terms changed/);
  assert.match(planWorkerBeeYield({ ...STATE, pendingRows: { unstakes: 1, undelegations: 0 } }).reason, /pending/);
  assert.match(planWorkerBeeYield({ ...STATE, balance: { ...STATE.balance, liquid: "0.00000" } }).reason, /no liquid/);
  assert.match(planWorkerBeeYield({ ...STATE, balance: { ...STATE.balance, liquid: "10.00001" } }).reason, /signer cap/);
});

test("WORKERBEE arguments and independent economic evidence are exact", () => {
  assert.deepEqual(parseOptions(["--account", "michael561"]), { account: "michael561", keyFile: "", executeOne: false, settleTx: "" });
  assert.throws(() => parseOptions(["--account", "emsenn0"]), /exactly michael561/);
  assert.throws(() => parseOptions(["--account", "michael561", "--execute-one"]), /requires --key-file/);
  assert.equal(statesAgree(STATE, { ...STATE, observedAt: "later" }), true);
  assert.equal(statesAgree(STATE, { ...STATE, books: { ...STATE.books, beeBids: [] } }), false);
});

test("batched Hive Engine rows retain and merge both exact child effects", () => {
  const normalized = normalizeEngineTransactionInfo([
    { transactionId: `${"a".repeat(40)}-0`, blockNumber: 123, logs: JSON.stringify({ events: [{ contract: "tokens", event: "stake", data: { account: "michael561", symbol: "WORKERBEE", quantity: "3.66758" } }] }) },
    { transactionId: `${"a".repeat(40)}-1`, blockNumber: 123, logs: JSON.stringify({ events: [{ contract: "tokens", event: "delegate", data: { to: "ph1102", symbol: "WORKERBEE", quantity: "3.66758" } }] }) },
  ], "test");
  assert.deepEqual(normalized.transactionIds, [`${"a".repeat(40)}-0`, `${"a".repeat(40)}-1`]);
  assert.equal(normalized.logs.events.length, 2);
  assert.throws(() => normalizeEngineTransactionInfo([{ transactionId: `${"a".repeat(40)}-0`, blockNumber: 123, logs: '{"errors":["second call failed"]}' }], "test"), /second call failed/);
});

test("signer admits only the exact bounded WORKERBEE self-stake and ph1102 delegation batch", async () => {
  const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
  const stakeCall = { contractName: "tokens", contractAction: "stake", contractPayload: { symbol: "WORKERBEE", to: "michael561", quantity: "3.66758" } };
  const delegateCall = { contractName: "tokens", contractAction: "delegate", contractPayload: { symbol: "WORKERBEE", to: "ph1102", quantity: "3.66758" } };
  const calls = [stakeCall, delegateCall];
  const run = (overrides: Record<string, unknown> = {}, operation: readonly Record<string, unknown>[] = calls): Promise<string> => new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "ignore", "pipe"] }); let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); }); child.on("close", () => resolve(stderr));
    child.stdin.end(JSON.stringify({ account: "michael561", role: "active", lane: "asset-yield", target: "workerbee:ph1102:3.66758", keyFile: "/missing/active.wif",
      operation: ["custom_json", { id: "ssc-mainnet-hive", required_auths: ["michael561"], required_posting_auths: [], json: JSON.stringify(operation) }], ...overrides }));
  });
  assert.match(await run(), /cannot read key file/);
  assert.match(await run({ target: "workerbee:other:3.66758" }), /WORKERBEE yield/);
  assert.match(await run({ lane: "trading" }), /batched custom_json/);
  assert.match(await run({}, [{ ...stakeCall, contractPayload: { ...stakeCall.contractPayload, symbol: "ZING" } }, delegateCall]), /WORKERBEE yield/);
  assert.match(await run({}, [stakeCall, { ...delegateCall, contractPayload: { ...delegateCall.contractPayload, to: "mallory" } }]), /WORKERBEE yield/);
  const standalone = stakeCall;
  assert.match(await run({ operation: ["custom_json", { id: "ssc-mainnet-hive", required_auths: ["michael561"], required_posting_auths: [], json: JSON.stringify(standalone) }] }), /refusing contract call 'tokens.stake'/);
});
