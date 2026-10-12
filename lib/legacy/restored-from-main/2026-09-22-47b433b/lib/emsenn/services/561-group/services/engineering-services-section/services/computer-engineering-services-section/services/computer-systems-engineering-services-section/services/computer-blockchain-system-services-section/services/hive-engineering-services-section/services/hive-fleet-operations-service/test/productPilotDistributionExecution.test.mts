import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { productPilotReblogOperation } from "../src/core/productDistribution.mts";
import {
  productPilotDistributionEvent,
  readProductPilotEvents,
  recordProductPilotDistribution,
} from "../src/core/productPilotSettlement.mts";
import { EXIT_TIGHTNESS_PILOT_TARGET } from "../src/core/exitTightnessPilotPost.mjs";
import { exactProductReblogOperation, parseOptions } from "../scripts/product-pilot-distribute.mjs";

const BROADCASTER = new URL("../scripts/hive-broadcast.mjs", import.meta.url).pathname;
const TX = "b".repeat(40);

function request(operation: unknown = productPilotReblogOperation()) {
  return { account: "michael561", role: "posting", lane: "product-distribution",
    target: EXIT_TIGHTNESS_PILOT_TARGET, keyFile: "/missing/posting.wif", operation };
}

test("signer admits only the exact product reblog before reading a posting key", () => {
  const admitted = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(request()), encoding: "utf8" });
  assert.notEqual(admitted.status, 0);
  assert.match(admitted.stderr, /cannot read key file/u);
  const exact = productPilotReblogOperation();
  const wrongAccount = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify({ ...request(), account: "emsenn0" }), encoding: "utf8" });
  assert.notEqual(wrongAccount.status, 0);
  assert.match(wrongAccount.stderr, /emsenn0 is vote-only/u);
  assert.doesNotMatch(wrongAccount.stderr, /cannot read key file/u);
  for (const changed of [
    { ...request(), role: "active" },
    { ...request(), target: "emsenn0/other" },
    request([exact[0], { ...exact[1], json: JSON.stringify(["reblog", { account: "michael561", author: "other", permlink: "post" }]) }]),
  ]) {
    const refused = spawnSync(process.execPath, [BROADCASTER], { input: JSON.stringify(changed), encoding: "utf8" });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /one exact michael561 reblog/u);
    assert.doesNotMatch(refused.stderr, /cannot read key file/u);
  }
});

test("transaction matching accepts no operation drift", () => {
  const exact = productPilotReblogOperation();
  assert.equal(exactProductReblogOperation(exact), true);
  assert.equal(exactProductReblogOperation({ type: "custom_json_operation", value: exact[1] }), false);
  assert.equal(exactProductReblogOperation(["custom_json_operation", exact[1]]), true);
  assert.equal(exactProductReblogOperation([exact[0], { ...exact[1], required_posting_auths: ["other"] }]), false);
});

test("distribution event carries zero revenue and requires ready RC plus two confirmations", () => {
  const base = { transactionId: TX, followers: 21, observedAt: "2026-07-22T16:00:00.000Z",
    currentRc: "340000000", requiredRc: "339139544" };
  const pending = productPilotDistributionEvent({ ...base, status: "settlement-pending" });
  assert.equal(pending.revenueRecognized, "0.000 HBD");
  assert.equal(pending.block, null);
  const confirmed = productPilotDistributionEvent({ ...base, status: "distributed-confirmed", block: 108_400_000,
    hiveProviders: ["https://two.example", "https://one.example"] });
  assert.deepEqual(confirmed.hiveProviders, ["https://one.example", "https://two.example"]);
  assert.throws(() => productPilotDistributionEvent({ ...base, currentRc: "1", status: "settlement-pending" }), /reserve was not satisfied/u);
  assert.throws(() => productPilotDistributionEvent({ ...base, status: "distributed-confirmed", block: 1, hiveProviders: ["https://one.example"] }), /two Hive providers/u);
});


test("distribution operator has only one account, one action, and keyless recovery", () => {
  assert.deepEqual(parseOptions(["--account", "michael561"]), { account: "michael561", keyFile: "", executeOne: false, settleTx: "" });
  assert.deepEqual(parseOptions(["--account", "michael561", "--key-file", "/tmp/key", "--execute-one"]),
    { account: "michael561", keyFile: "/tmp/key", executeOne: true, settleTx: "" });
  assert.deepEqual(parseOptions(["--account", "michael561", "--settle-tx", TX]),
    { account: "michael561", keyFile: "", executeOne: false, settleTx: TX });
  assert.throws(() => parseOptions(["--account", "emsenn0"]), /exactly michael561/u);
  assert.throws(() => parseOptions(["--account", "michael561", "--execute-one"]), /requires --key-file/u);
  assert.throws(() => parseOptions(["--account", "michael561", "--key-file", "/tmp/key", "--settle-tx", TX]), /cannot be combined/u);
});
