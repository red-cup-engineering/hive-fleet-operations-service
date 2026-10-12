#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// One-step dCrops operator. Every invocation observes fresh season, land, and
// seed state and can authorize at most one plot action. Clearing and replanting
// therefore require separate invocations with an independent observation in
// between, matching the way the live action was first proven.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDCropsClient } from "@red-cup-engineering/dcrops-services-section";
import { planDCropsPlot } from "@red-cup-engineering/dcrops-services-section";
import { parseDCropsSeed } from "@red-cup-engineering/dcrops-services-section";
import { parseDCropsLand } from "@red-cup-engineering/dcrops-services-section";
import { observeRcReserve } from "../src/integrations/hive/rcReserve.adapter.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
const hiveReader = new HiveClient();

const HIVE_NODES = ["https://api.hive.blog", "https://api.deathwing.me"];
const ENGINE_NODES = ["https://api.hive-engine.com/rpc", "https://herpc.dtools.dev"];

function fail(message) {
  throw new Error(`dcrops-cycle: ${message}`);
}

export function parseOptions(argv) {
  const options = { account: "", landID: 0, seedID: 0, plotNo: 0, executeOne: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      return value;
    };
    if (argument === "--account") options.account = take().toLowerCase();
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
  return Object.freeze(options);
}

async function hiveAccount(account) {
  const rows = await new RpcClient({ nodes: [HIVE_NODES[0]], timeout: 6000 }).call("condenser_api.get_accounts", [[account]]);
  const row = rows?.[0];
  if (!row) fail(`Hive account ${account} was not found`);
  return row;
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
  // Nothing to do this tick (the crop is growing, the season is closed) is a receipt, not a failure.
  if (!plan.intent || !["remove-expired", "plant", "harvest"].includes(plan.kind)) return Object.freeze({ ...base, status: "waiting", credentialAccess: false, chainMutation: false });
  if (resourceCredits.status !== "certified") return Object.freeze({ ...base, status: "resource-credit-uncertain", credentialAccess: false, chainMutation: false });
  if (resourceCredits.plan.decision !== "ready") return Object.freeze({ ...base, status: "resource-credit-wait", credentialAccess: false, chainMutation: false });
  const result = await submitToSigner({
    account: options.account,
    role: "active",
    lane: "gaming",
    target: `dcrops:land:${options.landID}:plot:${options.plotNo}:${plan.kind}`,
    operation: plan.intent.operation,
  });
  if (typeof result?.id !== "string" || !/^[0-9a-f]{40}$/.test(result.id)) fail("broadcaster returned no canonical transaction id");
  const hive = await hiveReader.confirmTransaction(result.id, plan.intent.operation);
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
  main().catch(reportFailure);
}
