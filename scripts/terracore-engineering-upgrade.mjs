#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// One-time, one-level TerraCore Engineering upgrade. This boundary is fixed
// to the proven level-14 -> level-15 opportunity, exact SCRAP cost and reserve
// policy. It cannot upgrade another stat, repeat a level, stake, transfer to a
// player, buy an asset, contribute Favor, or invoke another game operation.

import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planTerraCoreEngineeringUpgrade } from "@red-cup-engineering/terracore-services-section";
import { terraCoreEngineeringUpgradeIntent } from "@red-cup-engineering/terracore-services-section";
import { parseTerraCorePlayer } from "@red-cup-engineering/terracore-services-section";
import { reconcileTerraCoreEngineeringUpgrade } from "@red-cup-engineering/terracore-services-section";
import { makeFail, parseAccountExecuteOneOptions, rpc as sharedRpc, engineFind, findEngineTransaction } from "../src/core/hiveScriptSupport.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
const hiveReader = new HiveClient();

const API = "https://api.terracoregame.com";
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const CONTRACT_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const BLOCKCHAIN_NODES = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];

const fail = makeFail("terracore-engineering-upgrade");
const rpc = (node, method, params, timeoutMs) => sharedRpc(node, method, params, { timeoutMs, backoffMs: 500, fail });

export function parseOptions(argv) { return parseAccountExecuteOneOptions(argv, fail); }

const find = (node, contract, table, query, limit = 2, indexes = []) => engineFind(node, contract, table, query, { limit, indexes, backoffMs: 500, fail });

function exact8(value) {
  if (!/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(value)) fail(`noncanonical eight-decimal SCRAP amount '${value}'`);
  return BigInt(value.replace(".", ""));
}

async function readPlayer(account) {
  const response = await fetch(`${API}/player/${encodeURIComponent(account)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) fail(`player read returned HTTP ${response.status}`);
  return parseTerraCorePlayer(await response.text(), new Date().toISOString());
}

async function readEngineState(account, node) {
  const [tokens, balances] = await Promise.all([
    find(node, "tokens", "tokens", { symbol: "SCRAP" }),
    find(node, "tokens", "balances", { account, symbol: "SCRAP" }),
  ]);
  if (tokens.length !== 1 || Number(tokens[0]?.precision) !== 8) fail(`${node} did not confirm SCRAP precision 8`);
  if (balances.length > 1) fail(`${node} returned duplicate SCRAP balances`);
  const liquidScrap = String(balances[0]?.balance ?? "0.00000000");
  exact8(liquidScrap);
  return Object.freeze({ node, liquidScrap, scrapPrecision: 8, observedAt: new Date().toISOString() });
}

export function engineStatesAgree(left, right) {
  return left.liquidScrap === right.liquidScrap && left.scrapPrecision === right.scrapPrecision;
}

async function independentlyReadState(account) {
  const states = await Promise.all(CONTRACT_NODES.map((node) => readEngineState(account, node)));
  if (!engineStatesAgree(states[0], states[1])) fail("independent Hive-Engine providers disagree on the upgrade capital");
  const player = await readPlayer(account);
  return Object.freeze({
    economic: Object.freeze({ player, liquidScrap: states[0].liquidScrap, scrapPrecision: states[0].scrapPrecision }),
    providers: Object.freeze(states),
  });
}

async function hiveAccount(account) {
  for (const node of HIVE_NODES) {
    const rows = await rpc(node, "condenser_api.get_accounts", [[account]]).catch(() => null);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  fail(`Hive account ${account} was not found on any admitted provider`);
}

export function parseUpgradeTransaction(row, account, quantity, memo) {
  let payload;
  let logs;
  try { payload = typeof row?.payload === "string" ? JSON.parse(row.payload) : row?.payload; } catch { fail("upgrade transaction payload is not JSON"); }
  try { logs = typeof row?.logs === "string" ? JSON.parse(row.logs) : row?.logs; } catch { fail("upgrade transaction logs are not JSON"); }
  if (row?.sender !== account || row?.contract !== "tokens" || row?.action !== "transfer"
    || payload?.symbol !== "SCRAP" || payload?.to !== "null" || payload?.quantity !== quantity || payload?.memo !== memo
    || payload?.isSignedWithActiveKey !== true) {
    fail("upgrade transaction is not the exact active-authorized SCRAP burn");
  }
  if (Array.isArray(logs?.errors) && logs.errors.length > 0) fail("upgrade transaction reports a Hive-Engine error");
  const events = Array.isArray(logs?.events) ? logs.events : [];
  const event = events.find((candidate) => candidate?.contract === "tokens" && candidate?.event === "transfer"
    && candidate?.data?.from === account && candidate?.data?.to === "null"
    && candidate?.data?.symbol === "SCRAP" && candidate?.data?.quantity === quantity);
  if (!event) fail("upgrade transaction lacks the exact SCRAP transfer event");
  return Object.freeze({ transactionId: String(row.transactionId ?? ""), blockNumber: Number(row.blockNumber), quantity, memo });
}

async function waitForEngineTransaction(txid, account, quantity, memo) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const results = await Promise.all(BLOCKCHAIN_NODES.map(async (node) => {
      const found = await findEngineTransaction(node, txid, { backoffMs: 500 });
      return found ? Object.freeze({ node, parsed: parseUpgradeTransaction(found.row, account, quantity, memo) }) : null;
    }));
    if (results.every(Boolean)) {
      const [left, right] = results;
      if (JSON.stringify(left.parsed) !== JSON.stringify(right.parsed)) fail("Hive-Engine providers disagree on the upgrade transaction");
      return Object.freeze(results);
    }
    if (attempt < 14) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("both Hive-Engine providers did not confirm the engineering upgrade");
}

async function waitForEconomicEffect(account, before, quote) {
  let lastReason = "effect unavailable";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const after = await independentlyReadState(account);
      const reconciliation = reconcileTerraCoreEngineeringUpgrade(before.economic, after.economic, quote);
      if (reconciliation.confirmed) return Object.freeze({ after, reconciliation });
      lastReason = reconciliation.reason;
    } catch (error) { lastReason = error instanceof Error ? error.message : String(error); }
    if (attempt < 14) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail(`engineering upgrade did not reconcile: ${lastReason}`);
}

function safeState(state) {
  return Object.freeze({
    observedAt: state.player.observedAt,
    engineering: state.player.engineering,
    mineRate: state.player.mineRate,
    scrapPerDay: null,
    maxAttacks: state.player.maxAttacks,
    lastUpgradeMs: state.player.lastUpgradeMs ?? null,
    liquidScrap: state.liquidScrap,
  });
}

export async function operate(options) {
  const before = await independentlyReadState(options.account);
  const plan = planTerraCoreEngineeringUpgrade(before.economic);
  const base = Object.freeze({
    kind: "aagaard.terracore-engineering-upgrade-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    before: safeState(before.economic),
    plan,
    providers: before.providers.map(({ node, observedAt }) => Object.freeze({ node, observedAt })),
  });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (plan.kind !== "ready") fail(`fresh plan is not executable: ${plan.reason}`);
  const nonce = randomBytes(8).toString("hex");
  const intent = terraCoreEngineeringUpgradeIntent(options.account, plan.quote.costScrap, nonce);
  const memo = JSON.parse(intent.operation[1].json).contractPayload.memo;
  let result;
  try {
    result = await submitToSigner({
      account: options.account,
      role: "active",
      lane: "gaming",
      target: "terracore-engineering-upgrade",
      operation: intent.operation,
    });
  } catch (error) {
    throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof result?.id !== "string" || !/^[0-9a-f]{40}$/.test(result.id)) fail("submission returned no canonical transaction id; do not retry automatically");
  const [hive, engine, effect] = await Promise.all([
    hiveReader.confirmTransaction(result.id, intent.operation),
    waitForEngineTransaction(result.id, options.account, plan.quote.costScrap, memo),
    waitForEconomicEffect(options.account, before, plan.quote),
  ]);
  return Object.freeze({
    ...base,
    status: "upgrade-confirmed",
    transactionId: result.id,
    hive,
    engine,
    after: safeState(effect.after.economic),
    reconciliation: effect.reconciliation,
    completedAt: new Date().toISOString(),
  });
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}
