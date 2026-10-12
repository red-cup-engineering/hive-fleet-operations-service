import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { EngineClient } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { operateAutomaticArbitrage as operate, automaticArbitrageReceipt } from "../src/core/automaticArbitrageCycle.mjs";
import { arbitrageIntentStore } from "../src/core/arbitrageIntent.mjs";
import { assessSwapLegEffect, assessSellLegEffect } from "../src/integrations/hive-engine/hiveEngineConfirmation.mjs";

const account = "sigmund-vexler";
const swapId = "a".repeat(40);
const sellId = "b".repeat(40);
const opportunity = { symbol: "SHARD", pool: "SWAP.HIVE:SHARD", policyAdmitted: true,
  exact: { admitted: true, quote: { quantity: "400.00", maxInputSwapHive: "0.12748943",
    limitSellPriceSwapHive: "0.00032200", worstCaseProfitSwapHive: "0.00131057" } } };
const costs = { status: "priced", total: "0.00020000", components: [
  { name: "Hive RC", amount: "0.00000000" }, { name: "signer", amount: "0.00010000" },
  { name: "runner/paymaster", amount: "0.00010000" },
] };

function transaction(call, id) {
  const swap = call.contractAction === "swapTokens";
  const transfer = (event, symbol, quantity) => ({ contract: "tokens", event,
    data: { [event === "transferToContract" ? "from" : "to"]: account, symbol, quantity } });
  return { transactionId: id, sender: account, contract: call.contractName, action: call.contractAction,
    payload: JSON.stringify({ ...call.contractPayload, isSignedWithActiveKey: true }),
    logs: JSON.stringify({ events: swap ? [
      transfer("transferToContract", "SWAP.HIVE", "0.12740000"), transfer("transferFromContract", "SHARD", "400.00"),
    ] : [
      transfer("transferToContract", "SHARD", "400.00"), transfer("transferFromContract", "SWAP.HIVE", "0.12880000"),
      { contract: "market", event: "orderClosed", data: { account, type: "sell", txId: id } },
    ] }) };
}

async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "hive-arbitrage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataDir = path.join(directory, "data");
  const signed = [];
  let scans = 0;
  const options = { account, admittedAccounts: [account], executeOne: true, dataDir, economicCostWitness: costs,
    scan: async () => { scans++; return { status: "certified", account, providerKnowledge: { value: "true" }, opportunities: [opportunity] }; },
    sign: async (request) => { signed.push(request.leg); return { status: "broadcast", id: request.leg === "swap" ? swapId : sellId }; },
    confirmLeg: async (who, call, id, assess) => assess(who, call, [transaction(call, id)]),
  };
  return { options, signed, scans: () => scans, store: arbitrageIntentStore(dataDir, account) };
}

test("shadow discovery has no signer access and creates no intent", async (t) => {
  const f = await setup(t);
  const result = await operate({ ...f.options, executeOne: false });
  assert.equal(result.status, "admissible-route-observed");
  assert.deepEqual(f.signed, []);
  await assert.rejects(access(f.options.dataDir), { code: "ENOENT" });
});

test("one complete cycle has two confirmed transfers and exact costed proceeds", async (t) => {
  const f = await setup(t);
  const result = await operate(f.options);
  assert.equal(result.status, "round-trip-confirmed-costed");
  assert.deepEqual(f.signed, ["swap", "sell"]);
  assert.equal(result.economicEffect.grossPnlSwapHive, "0.00140000");
  assert.equal(result.economicEffect.modeledNetPnlSwapHiveExact, "0.00120000");
  assert.equal((await f.store.read()).terminal, true);
  assert.equal(automaticArbitrageReceipt(result).status, "confirmed");
});

test("an unconfirmed swap survives reopening and resumes only its sell", async (t) => {
  const f = await setup(t);
  const first = await operate({ ...f.options, confirmLeg: async () => ({ status: "unverified" }) });
  assert.equal(first.status, "execution-residue");
  assert.deepEqual(f.signed, ["swap"]);
  const second = await operate({ ...f.options, dataDir: path.resolve(f.options.dataDir) });
  assert.equal(second.status, "round-trip-confirmed-costed");
  assert.deepEqual(f.signed, ["swap", "sell"]);
  assert.equal(f.scans(), 1);
  assert.equal(second.economicEffect.pricedResourceCostSwapHive, "0.00040000");
  assert.equal(second.economicEffect.modeledNetPnlSwapHiveExact, "0.00100000");
});

test("an unconfirmed sell is observed again without resubmitting either leg", async (t) => {
  const f = await setup(t);
  const first = await operate({ ...f.options, confirmLeg: async (...args) => args[1].contractAction === "sell"
    ? { status: "partial" } : f.options.confirmLeg(...args) });
  assert.equal(first.leg, "sell");
  const second = await operate({ ...f.options, executeOne: false });
  assert.equal(second.status, "round-trip-confirmed-costed");
  assert.deepEqual(f.signed, ["swap", "sell"]);
  assert.equal(f.scans(), 1);
});

test("an explicit sell refusal can be re-admitted; a disarmed caller cannot submit it", async (t) => {
  const f = await setup(t);
  await operate({ ...f.options, sign: async (request) => request.leg === "sell"
    ? { status: "refused", datum: "route-stale", reason: "no depth" } : f.options.sign(request) });
  const shadow = await operate({ ...f.options, executeOne: false });
  assert.equal(shadow.nextLeg, "sell");
  assert.deepEqual(f.signed, ["swap"]);
  const completed = await operate(f.options);
  assert.equal(completed.status, "round-trip-confirmed-costed");
  assert.deepEqual(f.signed, ["swap", "sell"]);
  assert.equal(f.scans(), 1);
});

test("timeout leaves a durable unknown outcome and never retries the signer", async (t) => {
  const f = await setup(t);
  const first = await operate({ ...f.options, sign: async () => { throw new Error("lost answer"); } });
  assert.equal(first.status, "submission-outcome-unknown");
  assert.equal((await f.store.read()).swap.status, "submitting");
  const next = await operate(f.options);
  assert.equal(next.status, "submission-outcome-unknown");
  assert.deepEqual(f.signed, []);
  assert.equal(f.scans(), 1);
  const recovered = await operate({ ...f.options, executeOne: false, recover: { swap: swapId } });
  assert.equal(recovered.nextLeg, "sell");
  const completed = await operate(f.options);
  assert.deepEqual(f.signed, ["sell"]);
  assert.equal(completed.status, "round-trip-confirmed-unpriced");
  assert.equal(completed.economicEffect.modeledNetPnlSwapHive, null, "unknown-outcome polling costs are not invented");
});

test("concurrent callers cannot steal the in-flight signer's revision", async (t) => {
  const f = await setup(t);
  let entered, release;
  const signing = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const first = operate({ ...f.options, sign: async (request) => {
    if (request.leg === "swap") { entered(); await gate; }
    return f.options.sign(request);
  } });
  await signing;
  const second = await operate(f.options);
  assert.equal(second.status, "submission-outcome-unknown");
  release();
  assert.equal((await first).status, "round-trip-confirmed-costed");
  assert.deepEqual(f.signed, ["swap", "sell"]);
});

test("unknown submission recovery requires matching providers, identity, and a subsequent block", async (t) => {
  const f = await setup(t);
  await operate({ ...f.options, sign: async () => { throw new Error("lost answer"); } });
  const state = await f.store.read();
  const call = JSON.parse(state.swap.request.operation[1].json);
  const row = { ...transaction(call, swapId), blockNumber: 123 };
  let scenario = "old-block";
  t.mock.method(globalThis, "setTimeout", (callback) => setImmediate(callback));
  t.mock.method(EngineClient.prototype, "getTransactionInfo", async function () {
    if (scenario === "wrong-id") return { ...row, transactionId: sellId };
    if (scenario === "disagreement" && this.nodes[0].includes("dtools")) return { ...row, sender: "someone-else" };
    return row;
  });
  t.mock.method(EngineClient.prototype, "getBlockInfo", async () => ({
    timestamp: scenario === "old-block" ? "2000-01-01T00:00:00" : state.swap.submittedAt,
    transactions: scenario === "missing-transaction" ? [] : [row],
  }));
  const recovery = { ...f.options, executeOne: false, confirmLeg: undefined, recover: { swap: swapId } };
  for (scenario of ["old-block", "missing-transaction", "wrong-id", "disagreement"]) {
    assert.equal((await operate(recovery)).status, "recovery-unverified", scenario);
    assert.equal((await f.store.read()).swap.status, "submitting");
  }
  scenario = "matching";
  assert.equal((await operate(recovery)).nextLeg, "sell");
  assert.equal((await f.store.read()).swap.id, swapId);
  assert.deepEqual(f.signed, []);
});

test("process death after claiming submission cannot become a fresh acquisition", async (t) => {
  const f = await setup(t);
  const moduleUrl = new URL("../src/core/automaticArbitrageCycle.mjs", import.meta.url).href;
  const source = `import { operateAutomaticArbitrage as operate } from ${JSON.stringify(moduleUrl)};
    await operate({ account: ${JSON.stringify(account)}, admittedAccounts: [${JSON.stringify(account)}],
      executeOne: true, dataDir: ${JSON.stringify(f.options.dataDir)}, economicCostWitness: ${JSON.stringify(costs)},
      scan: async () => (${JSON.stringify({ status: "certified", account, providerKnowledge: { value: "true" }, opportunities: [opportunity] })}),
      sign: async () => { process.stdout.write("submission-claimed\\n"); await new Promise(() => {}); }
    });`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  t.after(() => child.kill("SIGKILL"));
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const output = await Promise.race([once(child.stdout, "data").then(([chunk]) => String(chunk)), closed.then(() => { throw new Error(stderr || "child ended before submission"); })]);
  assert.match(output, /submission-claimed/);
  child.kill("SIGKILL");
  await closed;
  const resumed = await operate(f.options);
  assert.equal(resumed.status, "submission-outcome-unknown");
  assert.equal(f.scans(), 0);
  assert.deepEqual(f.signed, []);
});

test("concurrent first calls claim only one acquisition", async (t) => {
  const f = await setup(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => operate(f.options)));
  assert.equal(results.filter((row) => row.status === "round-trip-confirmed-costed").length, 1);
  assert.deepEqual(f.signed, ["swap", "sell"]);
});

test("missing recovery costs preserve confirmed gross but withhold net profit", async (t) => {
  const f = await setup(t);
  await operate({ ...f.options, confirmLeg: async () => ({ status: "unverified" }) });
  const result = await operate({ ...f.options, economicCostWitness: null, priceCosts: async () => ({ status: "unpriced" }) });
  assert.equal(result.status, "round-trip-confirmed-unpriced");
  assert.equal(automaticArbitrageReceipt(result).economicEffect.modeledNetPnlSwapHive, null);
  assert.equal(result.economicEffect.grossPnlSwapHive, "0.00140000");
  assert.equal(result.economicEffect.modeledNetPnlSwapHiveExact, null);
  assert.equal(result.economicEffect.unpricedRecoveryCycles, 1);
});

test("confirmation binds the exact account, payload, transfers, and sell closure", async (t) => {
  const f = await setup(t);
  await operate(f.options);
  const state = await f.store.read();
  for (const [leg, assess] of [["swap", assessSwapLegEffect], ["sell", assessSellLegEffect]]) {
    const call = JSON.parse(state[leg].request.operation[1].json);
    const row = transaction(call, state[leg].id);
    assert.equal(assess(account, call, [row]).status, "confirmed");
    assert.notEqual(assess(account, call, [{ ...row, sender: "another-account" }]).status, "confirmed");
    assert.notEqual(assess(account, call, [{ ...row, payload: "{}" }]).status, "confirmed");
    assert.notEqual(assess(account, call, [{ ...row, logs: JSON.stringify({ events: [], errors: ["rejected"] }) }]).status, "confirmed");
  }
});

test("bad cost arithmetic and unauthorized accounts never acquire", async (t) => {
  const f = await setup(t);
  const result = await operate({ ...f.options, economicCostWitness: { ...costs, total: "0.00000000" } });
  assert.equal(result.status, "unpriced-resource-cost-model");
  await assert.rejects(operate({ ...f.options, account: "another-account" }), /not admitted/);
  assert.deepEqual(f.signed, []);
});
