#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// One-action recovery operator for liquid SIM left by the closed dCity game.
// It can only exchange the account's entire freshly observed liquid SIM
// balance for SWAP.HIVE through the exact surviving pool with a hard minimum.
// CITY NFTs are observed but this script has no burn, transfer, or market path.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planDCityLiquidSimRecovery } from "@red-cup-engineering/dcity-services-section";
import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { EngineClient } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { makeFail, parseAccountExecuteOneOptions, rpc as supportRpc, engineTransaction, oneRow } from "../src/core/hiveScriptSupport.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
const hiveReader = new HiveClient();

const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const ENGINE_CONTRACT_NODES = ["https://api.hive-engine.com/rpc", "https://herpc.dtools.dev"];
const ENGINE_BLOCKCHAIN_NODES = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];
const CONTRACT_READERS = new Map(ENGINE_CONTRACT_NODES.map((node) => [node,
  new EngineClient({ nodes: [node], timeout: 7_000, serial: true })]));

const fail = makeFail("dcity-recovery");

export function parseOptions(argv) { return parseAccountExecuteOneOptions(argv, fail); }

// One node, retried with backoff, refusing through this script's fail.
const rpc = (node, method, params, timeoutMs = 7000) => supportRpc(node, method, params, { timeoutMs, fail });

async function find(node, contract, table, query, limit = 1000) {
  const reader = CONTRACT_READERS.get(node);
  if (!reader) fail(`${node} is not an admitted Hive Engine contract provider`);
  return await reader.find(contract, table, query, { limit: limit });
}

const one = (rows, field) => oneRow(rows, field, fail);

async function readState(account, node) {
  const [simTokens, swapTokens, simBalances, swapBalances, directPools, reversePools, nfts] = await Promise.all([
    find(node, "tokens", "tokens", { symbol: "SIM" }, 2),
    find(node, "tokens", "tokens", { symbol: "SWAP.HIVE" }, 2),
    find(node, "tokens", "balances", { account, symbol: "SIM" }, 2),
    find(node, "tokens", "balances", { account, symbol: "SWAP.HIVE" }, 2),
    find(node, "marketpools", "pools", { tokenPair: "SWAP.HIVE:SIM" }, 2),
    find(node, "marketpools", "pools", { tokenPair: "SIM:SWAP.HIVE" }, 2),
    find(node, "nft", "CITYinstances", { account, ownedBy: "u" }, 1000),
  ]);
  const poolRows = [...directPools, ...reversePools];
  const pool = one(poolRows, "SIM/SWAP.HIVE pool");
  const simBalance = simBalances.length === 0 ? "0.000" : String(one(simBalances, "SIM balance").balance);
  const swapHiveBalance = swapBalances.length === 0 ? "0.00000000" : String(one(swapBalances, "SWAP.HIVE balance").balance);
  const lockedUnits = nfts.reduce((sum, nft) => sum + decimalUnits(String(nft?.lockedTokens?.SIM ?? "0"), 3), 0n);
  return Object.freeze({
    account,
    observedAt: new Date().toISOString(),
    simBalance,
    swapHiveBalance,
    simPrecision: Number(one(simTokens, "SIM token").precision),
    swapHivePrecision: Number(one(swapTokens, "SWAP.HIVE token").precision),
    tokenPair: String(pool.tokenPair),
    baseQuantity: String(pool.baseQuantity),
    quoteQuantity: String(pool.quoteQuantity),
    nftCount: nfts.length,
    nftLockedSim: formatUnits(lockedUnits, 3),
  });
}

const ECONOMIC_FIELDS = ["account", "simBalance", "swapHiveBalance", "simPrecision", "swapHivePrecision", "tokenPair", "baseQuantity", "quoteQuantity", "nftCount", "nftLockedSim"];

export function statesAgree(left, right) {
  return ECONOMIC_FIELDS.every((field) => left[field] === right[field]);
}

export function planState(state) { return planDCityLiquidSimRecovery(state, 100); }

async function independentlyObservedState(account) {
  const states = await Promise.all(ENGINE_CONTRACT_NODES.map((node) => readState(account, node)));
  if (!statesAgree(states[0], states[1])) fail("independent Hive-Engine providers disagree on the live dCity recovery evidence");
  return Object.freeze({ state: states[0], providers: Object.freeze(states.map((state, index) => Object.freeze({ node: ENGINE_CONTRACT_NODES[index], observedAt: state.observedAt }))) });
}

async function hiveAccount(account) {
  for (const node of HIVE_NODES) {
    const rows = await rpc(node, "condenser_api.get_accounts", [[account]]).catch(() => null);
    if (Array.isArray(rows) && rows[0]) return rows[0];
  }
  fail(`Hive account ${account} was not found on any admitted provider`);
}

async function waitForEngineTransactions(txid) {
  const found = new Map();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await Promise.all(ENGINE_BLOCKCHAIN_NODES.map(async (node) => {
      if (found.has(node)) return;
      const receipt = await engineTransaction(node, txid, { fail });
      if (receipt) found.set(node, Object.freeze({ node, transactionId: receipt.transactionId, blockNumber: receipt.blockNumber }));
    }));
    if (found.size === ENGINE_BLOCKCHAIN_NODES.length) return Object.freeze([...found.values()]);
    if (attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("both Hive-Engine providers did not confirm the recovery transaction");
}

function effectConfirmed(before, after, quote) {
  const beforeSim = decimalUnits(before.simBalance, 3);
  const afterSim = decimalUnits(after.simBalance, 3);
  const quantity = decimalUnits(quote.quantitySim, 3);
  const beforeSwap = decimalUnits(before.swapHiveBalance, 8);
  const afterSwap = decimalUnits(after.swapHiveBalance, 8);
  const minimum = decimalUnits(quote.minimumSwapHive, 8);
  return beforeSim - afterSim === quantity && afterSwap - beforeSwap >= minimum;
}

async function waitForBalanceEffect(account, before, quote) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const states = await Promise.all(ENGINE_CONTRACT_NODES.map((node) => readState(account, node)));
    if (states.every((state) => effectConfirmed(before, state, quote))) return Object.freeze(states);
    if (attempt < 11) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("both Hive-Engine providers did not confirm the bounded SIM exit effect");
}

function safeState(state) {
  return Object.freeze({
    observedAt: state.observedAt,
    simBalance: state.simBalance,
    swapHiveBalance: state.swapHiveBalance,
    pool: Object.freeze({ tokenPair: state.tokenPair, baseQuantity: state.baseQuantity, quoteQuantity: state.quoteQuantity }),
    cityNfts: Object.freeze({ count: state.nftCount, lockedSim: state.nftLockedSim, disposition: "preserved" }),
  });
}

export async function operate(options) {
  // In the armed lane verify authority before touching the economic
  // providers, then make exactly one two-provider observation. This avoids a
  // duplicate burst that can trigger public-node gateway throttling while
  // still placing the only executable quote immediately before broadcast.
  const observed = await independentlyObservedState(options.account);
  const plan = planState(observed.state);
  const base = Object.freeze({
    kind: "aagaard.dcity-liquid-recovery-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    before: safeState(observed.state),
    providers: observed.providers,
    plan,
  });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (plan.kind !== "ready") fail(`fresh plan is not executable: ${plan.reason}`);
  const broadcastResult = await submitToSigner({
    account: options.account,
    role: "active",
    lane: "gaming",
    target: "dcity-liquid-sim-recovery",
    operation: plan.quote.operation,
  });
  const [hiveConfirmations, engineConfirmations, afterStates] = await Promise.all([
    hiveReader.confirmTransaction(broadcastResult.id, plan.quote.operation),
    waitForEngineTransactions(broadcastResult.id),
    waitForBalanceEffect(options.account, observed.state, plan.quote),
  ]);
  const beforeSwap = decimalUnits(observed.state.swapHiveBalance, 8);
  const afterSwap = decimalUnits(afterStates[0].swapHiveBalance, 8);
  return Object.freeze({
    ...base,
    status: "recovered-confirmed",
    transactionId: broadcastResult.id,
    executedQuote: plan.quote,
    actualSwapHiveReceived: formatUnits(afterSwap - beforeSwap, 8),
    hiveConfirmations,
    engineConfirmations,
    after: safeState(afterStates[0]),
    completedAt: new Date().toISOString(),
  });
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}
