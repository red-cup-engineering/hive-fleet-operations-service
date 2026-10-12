import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { addLiquidity, swapTokens, transferToken } from "../src/integrations/hive-engine/hiveEngineOps.mjs";
import { operationDigest } from "../scripts/help-liquidity-cell.mjs";

const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url).pathname;

function request(quantity = "10.00000000") {
  return {
    kind: "aagaard.hive-write",
    account: "michael561",
    role: "active",
    lane: "treasury-rebalance",
    target: "sigmund-vexler:arbitrage-capital",
    keyFile: "/missing/active.wif",
    operation: transferToken("michael561", "sigmund-vexler", "SWAP.HIVE", quantity,
      "AGRODAO shared allocator: Sigmund arbitrage float"),
  };
}

function feeRequest(quantity = "0.0100") {
  return {
    kind: "aagaard.hive-write",
    account: "michael561",
    role: "active",
    lane: "treasury-rebalance",
    target: "sigmund-vexler:arbitrage-fees",
    keyFile: "/missing/active.wif",
    operation: transferToken("michael561", "sigmund-vexler", "BEED", quantity,
      "AGRODAO shared allocator: Sigmund arbitrage BEED fees"),
  };
}

test("the signer admits only the exact bounded michael561 to Sigmund arbitrage float", () => {
  const admitted = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(request()), encoding: "utf8" });
  assert.notEqual(admitted.status, 0);
  assert.match(admitted.stderr, /cannot read key file/u);

  for (const changed of [
    request("10.00000001"),
    { ...request(), target: "someone-else" },
    { ...request(), account: "help-fund" },
  ]) {
    const refused = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(changed), encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.doesNotMatch(refused.stderr, /cannot read key file/u);
  }
});

test("the signer refuses an obsolete BEED arbitrage-fee transfer", () => {
  const admitted = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(feeRequest()), encoding: "utf8" });
  assert.notEqual(admitted.status, 0);
  assert.match(admitted.stderr, /treasury rebalance/u);

  for (const changed of [feeRequest("0.0101"), { ...feeRequest(), target: "sigmund-vexler:arbitrage-capital" }]) {
    const refused = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(changed), encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.doesNotMatch(refused.stderr, /cannot read key file/u);
  }
});

test("the signer admits only the exact HELP liquidity funding pilot", () => {
  const admittedRequest = { ...request("1.00000000"), target: "help-fund:liquidity-capital",
    operation: transferToken("michael561", "help-fund", "SWAP.HIVE", "1.00000000", "AGRODAO shared allocator: HELP BTC-pool liquidity pilot") };
  const admitted = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(admittedRequest), encoding: "utf8" });
  assert.match(admitted.stderr, /cannot read key file/u);
  for (const changed of [{ ...admittedRequest, operation: transferToken("michael561", "help-fund", "SWAP.HIVE", "1.00000001", "AGRODAO shared allocator: HELP BTC-pool liquidity pilot") },
    { ...admittedRequest, target: "help-fund:anything" }]) {
    const refused = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(changed), encoding: "utf8" });
    assert.doesNotMatch(refused.stderr, /cannot read key file/u);
  }
});

test("HELP's preparatory swap is one exact bounded BTC-pool operation", () => {
  const swap = { kind: "aagaard.hive-write", account: "help-fund", role: "active", lane: "liquidity-bootstrap",
    target: "help-fund:liquidity-bootstrap:SWAP.HIVE:SWAP.BTC", keyFile: "/missing/active.wif",
    operation: swapTokens("help-fund", "SWAP.HIVE:SWAP.BTC", "SWAP.HIVE", "0.50000000", "exactInput", "0.00000037") };
  const admitted = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(swap), encoding: "utf8" });
  assert.match(admitted.stderr, /cannot read key file/u);
  const changed = { ...swap, operation: swapTokens("help-fund", "SWAP.HIVE:SWAP.BTC", "SWAP.HIVE", "0.50000001", "exactInput", "0.00000037") };
  const refused = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(changed), encoding: "utf8" });
  assert.doesNotMatch(refused.stderr, /cannot read key file/u);
});

test("HELP LP addition requires a fresh operation-bound AGRODAO envelope", () => {
  const operation = addLiquidity("help-fund", "SWAP.HIVE:SWAP.BTC", "0.49000000", "0.00000037");
  const digest = operationDigest(operation);
  const now = Date.now();
  const authorization = { kind: "agrodao.hive-enterprise-execution-authorization.v1", issuer: "urn:ame:help-hive-liquidity-enterprise",
    consumer: "urn:ame:aagaard", account: "help-fund", lane: "liquidity", actions: ["lp"],
    decisionId: `sha256:${"a".repeat(64)}`, observationId: "urn:test:observation", planDigest: digest,
    validFrom: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), releaseId: `sha256:${"b".repeat(64)}` };
  const request = { kind: "aagaard.hive-write", account: "help-fund", role: "active", lane: "liquidity",
    target: `help-fund:lp:${digest}`, keyFile: "/missing/active.wif", operation, authorization };
  const admitted = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(request), encoding: "utf8" });
  assert.match(admitted.stderr, /cannot read key file/u);
  const refused = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify({ ...request, authorization: { ...authorization, planDigest: `sha256:${"c".repeat(64)}` } }), encoding: "utf8" });
  assert.doesNotMatch(refused.stderr, /cannot read key file/u);
});
