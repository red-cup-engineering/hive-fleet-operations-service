#!/usr/bin/env node
// One-step dCrops operator. Every invocation observes fresh season, land, and
// seed state and can authorize at most one plot action. Clearing and replanting
// therefore require separate invocations with an independent observation in
// between, matching the way the live action was first proven.

import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createDCropsClient,
  parseDCropsLand,
  parseDCropsSeed,
  planDCropsPlot,
} from "../src/integrations/dcrops/dcrops.adapter.ts";
import { observeRcReserve } from "../src/integrations/hive/rcReserve.adapter.mts";
import { PrivateKey } from "../src/integrations/hive/waggle/keys.mjs";

const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me"];
const ENGINE_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const BROADCASTER = new URL("./hive-broadcast.mjs", import.meta.url);

function fail(message) {
  throw new Error(`dcrops-cycle: ${message}`);
}

export function parseOptions(argv) {
  const options = { account: "", keyFile: "", landID: 0, seedID: 0, plotNo: 0, executeOne: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      return value;
    };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--key-file") options.keyFile = take();
    else if (argument === "--land-id") options.landID = Number(take());
    else if (argument === "--seed-id") options.seedID = Number(take());
    else if (argument === "--plot") options.plotNo = Number(take());
    else if (argument === "--execute-one") options.executeOne = true;
    else fail(`unknown argument ${argument}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  if (!Number.isSafeInteger(options.landID) || options.landID < 1) fail("--land-id must be a positive integer");
  if (!Number.isSafeInteger(options.seedID) || options.seedID < 1) fail("--seed-id must be a positive integer");
  if (!Number.isSafeInteger(options.plotNo) || options.plotNo < 0) fail("--plot must be a nonnegative integer");
  if (options.executeOne && !options.keyFile) fail("--execute-one requires --key-file");
  return Object.freeze(options);
}

async function hiveAccount(account) {
  const response = await fetch(HIVE_NODES[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_accounts", params: [[account]] }),
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) fail(`Hive account verification returned HTTP ${response.status}`);
  const row = (await response.json())?.result?.[0];
  if (!row) fail(`Hive account ${account} was not found`);
  return row;
}

async function verifyActiveKey(account, keyFile) {
  const mode = statSync(keyFile).mode & 0o777;
  if ((mode & 0o077) !== 0) fail("active-key file must not be group/world accessible");
  const publicKey = PrivateKey.from(readFileSync(keyFile, "utf8").trim()).createPublic("STM").toString();
  const row = await hiveAccount(account);
  const threshold = Number(row.active?.weight_threshold ?? 1);
  const weight = Number((row.active?.key_auths ?? []).find(([candidate]) => candidate === publicKey)?.[1] ?? 0);
  if (weight < threshold) fail("the supplied key does not independently satisfy the account's active authority");
}

async function readPosition(account, landID, seedID, nodes = ENGINE_NODES) {
  const client = createDCropsClient({ nodes });
  const [season, landRow, seedRow] = await Promise.all([client.readSeason(), client.readInstance(landID), client.readInstance(seedID)]);
  return Object.freeze({
    season,
    land: parseDCropsLand(landRow, account),
    seed: parseDCropsSeed(seedRow, account),
  });
}

function broadcast(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BROADCASTER.pathname], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => {
      if (code !== 0) rejectPromise(new Error(stderr.trim() || `broadcaster exited ${code}`));
      else {
        try { resolvePromise(JSON.parse(stdout)); } catch { rejectPromise(new Error("broadcaster returned invalid JSON")); }
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function safePosition(position, plotNo) {
  return Object.freeze({
    season: position.season,
    land: Object.freeze({ id: position.land.id, account: position.land.account, plot: position.land.plots[plotNo], plantedAtUnix: position.land.plantedAtUnix[plotNo] }),
    seed: Object.freeze({ id: position.seed.id, account: position.seed.account, name: position.seed.name, cooldownAtUnix: position.seed.cooldownAtUnix }),
  });
}

function effectConfirmed(kind, before, after, plotNo) {
  if (kind === "plant") {
    return before.land.plots[plotNo] === ""
      && after.land.plots[plotNo] === before.seed.name
      && typeof after.land.plantedAtUnix[plotNo] === "number"
      && after.seed.cooldownAtUnix > before.seed.cooldownAtUnix;
  }
  return before.land.plots[plotNo] !== ""
    && after.land.plots[plotNo] === ""
    && after.land.plantedAtUnix[plotNo] === null;
}

async function waitForEffect(options, kind, before) {
  let latest = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    latest = await Promise.all(ENGINE_NODES.map((node) => readPosition(options.account, options.landID, options.seedID, [node])));
    if (latest.every((position) => effectConfirmed(kind, before, position, options.plotNo))) return latest;
    if (attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  fail("both independent Hive-Engine providers did not confirm the expected plot effect");
}

async function confirmHiveTransaction(txid, expectedJson) {
  const confirmations = await Promise.all(HIVE_NODES.map(async (node) => {
    const response = await fetch(node, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "account_history_api.get_transaction", params: { id: txid, include_reversible: true } }),
      signal: AbortSignal.timeout(6000),
    });
    const transaction = (await response.json())?.result;
    const operation = transaction?.operations?.[0]?.value ?? transaction?.operations?.[0]?.[1];
    if (!transaction || operation?.id !== "dcrops" || operation?.json !== expectedJson) fail(`${node} did not confirm the exact dCrops transaction`);
    return Object.freeze({ node, block: transaction.block_num });
  }));
  if (new Set(confirmations.map((entry) => entry.block)).size !== 1) fail("Hive providers disagree on the transaction block");
  return Object.freeze(confirmations);
}

export async function operate(options) {
  const [before, resourceCredits] = await Promise.all([
    readPosition(options.account, options.landID, options.seedID),
    observeRcReserve({ account: options.account, operation: "custom_json_operation" }),
  ]);
  const plan = planDCropsPlot(options.account, before.season, before.land, before.seed, options.plotNo);
  const base = {
    kind: "aagaard.dcrops-plot-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    plan: Object.freeze({ kind: plan.kind, reason: plan.reason, ...(plan.nextEligibleAtUnix ? { nextEligibleAtUnix: plan.nextEligibleAtUnix } : {}) }),
    before: safePosition(before, options.plotNo),
    resourceCredits,
  };
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (!plan.intent || !["remove-expired", "plant", "harvest"].includes(plan.kind)) fail(`fresh plan is not executable: ${plan.kind}: ${plan.reason}`);
  if (resourceCredits.status !== "certified") return Object.freeze({ ...base, status: "resource-credit-uncertain", credentialAccess: false, chainMutation: false });
  if (resourceCredits.plan.decision !== "ready") return Object.freeze({ ...base, status: "resource-credit-wait", credentialAccess: false, chainMutation: false });
  await verifyActiveKey(options.account, options.keyFile);
  const result = await broadcast({
    account: options.account,
    role: "active",
    lane: "gaming",
    target: `dcrops:land:${options.landID}:plot:${options.plotNo}:${plan.kind}`,
    keyFile: options.keyFile,
    operation: plan.intent.operation,
  });
  if (typeof result?.id !== "string" || !/^[0-9a-f]{40}$/.test(result.id)) fail("broadcaster returned no canonical transaction id");
  const hive = await confirmHiveTransaction(result.id, plan.intent.operation[1].json);
  const after = await waitForEffect(options, plan.kind, before);
  return Object.freeze({
    ...base,
    status: "confirmed",
    txid: result.id,
    hive,
    after: Object.freeze(after.map((position) => safePosition(position, options.plotNo))),
    completedAt: new Date().toISOString(),
  });
}

async function main() {
  const receipt = await operate(parseOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
