#!/usr/bin/env node
import { FLEET_DATA_DIR } from "../src/core/journal.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// Convert michael561's exact freshly observed liquid WORKERBEE into productive
// BEE-mining power by self-staking and delegating the same bounded quantity to
// the no-fee ph1102 pool.  No other account, token, recipient, transfer, sale,
// unstake, or delegation shape crosses this capability.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { recordAssetYield } from "../src/core/assetYieldSettlement.mjs";
import { makeFail, engineFind, engineTransaction } from "../src/core/hiveScriptSupport.mjs";
import { planWorkerBeeYield, statesAgree } from "@red-cup-engineering/workerbee-services-section";
import { decimalUnits, formatUnits } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { liveEngineBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
import { accountsWithLane } from "../src/core/accountStrategy.mjs";
const hiveReader = new HiveClient();

const ACCOUNT = accountsWithLane("workerbee-yield")[0] ?? "";
const SYMBOL = "WORKERBEE";
const POOL_ACCOUNT = "ph1102";
const POOL_ID = "BEE:WORKERBEE";
const CONTRACT_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const BLOCKCHAIN_NODES = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];
const DATA_DIR = FLEET_DATA_DIR;

const fail = makeFail("workerbee-yield");

export function parseOptions(argv) {
  const options = { account: "", executeOne: false, settleTx: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => { const value = argv[index + 1]; if (!value || value.startsWith("--")) fail(`${argument} requires a value`); index += 1; return value; };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--execute-one") options.executeOne = true;
    else if (argument === "--settle-tx") options.settleTx = take().toLowerCase();
    else fail(`unknown argument ${argument}`);
  }
  if (options.account !== ACCOUNT) fail(`--account must be the account whose strategy config runs this lane (${ACCOUNT || "none configured"})`);
  if (options.settleTx && options.executeOne) fail("--settle-tx cannot be combined with execution");
  if (options.settleTx && !/^[0-9a-f]{40}$/u.test(options.settleTx)) fail("--settle-tx must be one canonical Hive transaction id");
  return Object.freeze(options);
}

const find = (node, contract, table, query, limit = 1000, indexes = []) => engineFind(node, contract, table, query, { limit, indexes, backoffMs: 350, fail });

async function readState(account, node) {
  const observedAt = new Date().toISOString();
  const [tokens, balances, delegations, pendingUnstakes, pendingUndelegations, pools, powers, beeBids, workerBeeBids] = await Promise.all([
    find(node, "tokens", "tokens", { symbol: SYMBOL }, 2),
    find(node, "tokens", "balances", { account, symbol: SYMBOL }, 2),
    find(node, "tokens", "delegations", { from: account, to: POOL_ACCOUNT, symbol: SYMBOL }, 2),
    find(node, "tokens", "pendingUnstakes", { account, symbol: SYMBOL }, 100),
    find(node, "tokens", "pendingUndelegations", { account, symbol: SYMBOL }, 100),
    find(node, "mining", "pools", { id: POOL_ID }, 2),
    find(node, "mining", "miningPower", { id: POOL_ID, account: POOL_ACCOUNT }, 2),
    find(node, "market", "buyBook", { symbol: "BEE" }, 1000, [{ index: "priceDec", descending: true }]),
    find(node, "market", "buyBook", { symbol: SYMBOL }, 1000, [{ index: "priceDec", descending: true }]),
  ]);
  if (tokens.length !== 1 || balances.length !== 1 || delegations.length > 1 || pools.length !== 1 || powers.length !== 1) fail(`${node} returned non-unique WORKERBEE evidence`);
  const token = tokens[0]; const balance = balances[0]; const delegationRow = delegations[0]; const pool = pools[0];
  const precision = Number(token.precision); if (precision !== 5) fail(`${node} returned unexpected WORKERBEE precision`);
  const canonical = (value) => formatUnits(decimalUnits(String(value ?? "0"), precision), precision);
  const bidsBee = liveEngineBook(beeBids, 8, "bid", Math.floor(Date.parse(observedAt) / 1000));
  const bidsWorkerBee = liveEngineBook(workerBeeBids, precision, "bid", Math.floor(Date.parse(observedAt) / 1000));
  return Object.freeze({ account, symbol: SYMBOL, observedAt, token: Object.freeze({ issuer: String(token.issuer), precision,
    stakingEnabled: token.stakingEnabled === true, delegationEnabled: token.delegationEnabled === true,
    unstakingCooldownDays: Number(token.unstakingCooldown), undelegationCooldownDays: Number(token.undelegationCooldown),
    numberTransactions: Number(token.numberTransactions) }),
  balance: Object.freeze({ liquid: canonical(balance.balance), stake: canonical(balance.stake), delegationsOut: canonical(balance.delegationsOut),
    pendingUnstake: canonical(balance.pendingUnstake), pendingUndelegations: canonical(balance.pendingUndelegations) }),
  delegation: Object.freeze({ to: POOL_ACCOUNT, quantity: canonical(delegationRow?.quantity ?? "0") }),
  pendingRows: Object.freeze({ unstakes: pendingUnstakes.length, undelegations: pendingUndelegations.length }),
  pool: Object.freeze({ id: String(pool.id), minedToken: String(pool.minedToken), lotteryWinners: Number(pool.lotteryWinners),
    lotteryIntervalHours: Number(pool.lotteryIntervalHours), lotteryAmount: formatUnits(decimalUnits(pool.lotteryAmount, 8), 8), active: pool.active === true,
    tokenMiners: Object.freeze((pool.tokenMiners ?? []).map((row) => Object.freeze({ symbol: String(row.symbol), multiplier: Number(row.multiplier) }))),
    totalPower: canonical(pool.totalPower), poolAccountPower: canonical(powers[0]?.power?.$numberDecimal ?? powers[0]?.power ?? "0") }),
  books: Object.freeze({ beeBids: Object.freeze(bidsBee), workerBeeBids: Object.freeze(bidsWorkerBee) }) });
}

const AGREEMENT_FIELDS = ["account", "symbol", "token", "balance", "delegation", "pendingRows", "pool", "books"];
function depthProceeds(quantityUnits, quantityPrecision, bids) {
  let left = quantityUnits; let proceeds = 0n; let levels = 0; let floorPrice = null;
  for (const bid of bids) {
    if (left === 0n) break;
    const available = decimalUnits(bid.quantity, quantityPrecision); const take = available < left ? available : left;
    if (take === 0n) continue;
    const price = decimalUnits(bid.price, 8); proceeds += take * price / (10n ** BigInt(quantityPrecision)); left -= take; levels += 1; floorPrice = bid.price;
  }
  return left === 0n ? Object.freeze({ proceeds, levels, floorPrice }) : null;
}

async function independentlyObservedState(account) {
  const states = await Promise.all(CONTRACT_NODES.map((node) => readState(account, node)));
  if (!statesAgree(states[0], states[1])) fail("independent Hive-Engine providers disagree on WORKERBEE yield evidence");
  return Object.freeze({ state: states[0], evidenceProviders: Object.freeze(CONTRACT_NODES.map((node) => Object.freeze({ node }))) });
}

const engineTx = (node, txid) => engineTransaction(node, txid, { backoffMs: 350, fail });

// Hive Engine returns a row for a single call and an array of child rows for a
// batched custom_json.  Normalize both without discarding the child identity;
// otherwise a successful first call could be mistaken for the whole batch.
function exactYieldEvents(logs, quantity) {
  const events = Array.isArray(logs?.events) ? logs.events : [];
  const stakeEvent = events.filter((event) => event.contract === "tokens" && event.event === "stake"
    && JSON.stringify(event.data) === JSON.stringify({ account: ACCOUNT, symbol: SYMBOL, quantity }));
  const delegateEvent = events.filter((event) => event.contract === "tokens" && event.event === "delegate"
    && JSON.stringify(event.data) === JSON.stringify({ to: POOL_ACCOUNT, symbol: SYMBOL, quantity }));
  return stakeEvent.length === 1 && delegateEvent.length === 1;
}

async function waitForEffect(account, txid, before, plan) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [transactions, states] = await Promise.all([Promise.all(BLOCKCHAIN_NODES.map((node) => engineTx(node, txid))), Promise.all(CONTRACT_NODES.map((node) => readState(account, node)))]);
    const quantity = decimalUnits(plan.quantity, 5); const expectedLiquid = decimalUnits(before.balance.liquid, 5) - quantity;
    const expectedOut = decimalUnits(before.balance.delegationsOut, 5) + quantity; const expectedDelegation = decimalUnits(before.delegation.quantity, 5) + quantity;
    const confirmed = transactions.every((row) => row && exactYieldEvents(row.logs, plan.quantity)) && states.every((state) =>
      decimalUnits(state.balance.liquid, 5) === expectedLiquid && decimalUnits(state.balance.stake, 5) === decimalUnits(before.balance.stake, 5)
      && decimalUnits(state.balance.delegationsOut, 5) === expectedOut && decimalUnits(state.delegation.quantity, 5) === expectedDelegation);
    if (confirmed) return Object.freeze({ transactions, states });
    if (attempt < 19) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
  }
  return null;
}

export async function operate(options) {
  const observed = await independentlyObservedState(options.account); const plan = planWorkerBeeYield(observed.state);
  const base = Object.freeze({ kind: "aagaard.asset-yield-receipt", account: options.account, symbol: SYMBOL, observedAt: new Date().toISOString(), before: observed.state,
    evidenceProviders: observed.evidenceProviders, plan });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (plan.kind !== "stake-delegate") fail(`fresh plan is not executable: ${plan.reason}`);
  const target = `workerbee:${POOL_ACCOUNT}:${plan.quantity}`; let submission;
  try { submission = await submitToSigner({ account: options.account, role: "active", lane: "asset-yield", target, operation: plan.operation }); }
  catch (error) { throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  if (!/^[0-9a-f]{40}$/.test(String(submission?.id ?? ""))) fail("submission returned no canonical transaction id; do not retry automatically");
  const transactionId = String(submission.id); let hive = null; let effect = null; let settlementError = null;
  try { hive = await hiveReader.confirmTransaction(transactionId, plan.operation); effect = await waitForEffect(options.account, transactionId, observed.state, plan); if (!effect) settlementError = "WORKERBEE yield effect did not independently reconcile before timeout"; }
  catch (error) { settlementError = error instanceof Error ? error.message : String(error); }
  const completedAt = new Date().toISOString(); const receipt = Object.freeze({ ...base, transactionId, ...(hive ? { hive } : {}),
    status: effect ? "yield-delegation-confirmed" : "settlement-pending", retryAllowed: false, ...(settlementError ? { settlementError } : {}),
    ...(effect ? { engine: effect.transactions, after: effect.states } : {}), completedAt });
  const event = await recordAssetYield(DATA_DIR, receipt, completedAt);
  return Object.freeze({ ...receipt, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }) });
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(reportFailure);
