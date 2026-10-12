#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// Convert one account's entire freshly observed liquid Hive-Engine token
// balance into SWAP.HIVE through existing bids. The order has a hard price
// floor and a 300-second expiry; no buy, transfer, NFT, or staking action is
// available through this boundary.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { TOKEN_LIQUIDATION_CATEGORY, tokenLiquidationEvent } from "../src/core/tokenLiquidationSettlement.mjs";
import { FLEET_DATA_DIR, witnessChainAct } from "../src/core/journal.mjs";
import { assertLiquidationSymbolAllowed } from "../src/core/protectedAssets.mjs";
import { makeFail, engineFind, engineTransaction } from "../src/core/hiveScriptSupport.mjs";
import { engineCustomJson, market } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { decimalUnits, formatUnits, rationalUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
import { FLEET_ACCOUNTS } from "../src/core/core.adapter.mjs";
import { liveEngineBook, parseEngineOrderBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { bestBid, marketSellWalk } from "@red-cup-engineering/gaming/market";
import { gradedFromParts, gradedSign, gradedValue } from "@red-cup-engineering/exact-number-data-service/graded";
const hiveReader = new HiveClient();

const CONTRACT_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const BLOCKCHAIN_NODES = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];
const FLEET = new Set(FLEET_ACCOUNTS);

const fail = makeFail("liquidate-token");

export function parseOptions(argv) {
  const options = { account: "", symbol: "", executeOne: false, maxSlippageBps: 500 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      return value;
    };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--symbol") options.symbol = take().toUpperCase();
    else if (argument === "--max-slippage-bps") options.maxSlippageBps = Number(take());
    else if (argument === "--execute-one") options.executeOne = true;
    else fail(`unknown argument ${argument}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(options.symbol) || options.symbol === "SWAP.HIVE") fail("a non-SWAP.HIVE Hive-Engine --symbol is required");
  assertLiquidationSymbolAllowed(options.account, options.symbol);
  if (!Number.isInteger(options.maxSlippageBps) || options.maxSlippageBps < 0 || options.maxSlippageBps > 2500) fail("--max-slippage-bps must be an integer from 0 through 2500");
  return Object.freeze(options);
}

const find = (node, contract, table, query, limit = 1000, indexes = []) => engineFind(node, contract, table, query, { limit, indexes, backoffMs: 350, fail });



function normalizedBook(rows, precision, observedUnix) {
  return Object.freeze(liveEngineBook(rows, precision, "bid", observedUnix).filter((row) => !FLEET.has(row.account)));
}

async function readState(account, symbol, node) {
  const observedAt = new Date().toISOString();
  const [tokenRows, balanceRows, swapRows, bids] = await Promise.all([
    find(node, "tokens", "tokens", { symbol }, 2),
    find(node, "tokens", "balances", { account, symbol }, 2),
    find(node, "tokens", "balances", { account, symbol: "SWAP.HIVE" }, 2),
    find(node, "market", "buyBook", { symbol }, 1000, [{ index: "priceDec", descending: true }]),
  ]);
  if (tokenRows.length !== 1 || balanceRows.length > 1 || swapRows.length > 1) fail(`${node} returned non-unique token or balance evidence`);
  const precision = Number(tokenRows[0].precision);
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) fail(`${node} returned invalid token precision`);
  const balance = balanceRows[0]?.balance ?? formatUnits(0n, precision);
  const swapHiveBalance = swapRows[0]?.balance ?? "0.00000000";
  decimalUnits(balance, precision); decimalUnits(swapHiveBalance, 8);
  return Object.freeze({ account, symbol, precision, balance: formatUnits(decimalUnits(balance, precision), precision),
    swapHiveBalance: formatUnits(decimalUnits(swapHiveBalance, 8), 8), observedAt,
    bids: normalizedBook(bids, precision, Math.floor(Date.parse(observedAt) / 1000)) });
}

const ECONOMIC_FIELDS = ["account", "symbol", "precision", "balance", "swapHiveBalance", "bids"];
export function statesAgree(left, right) {
  return ECONOMIC_FIELDS.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

export function planLiquidation(state, maxSlippageBps = 500) {
  const quantity = decimalUnits(state.balance, state.precision);
  if (quantity === 0n) return Object.freeze({ kind: "refuse", reason: "no liquid token balance remains" });
  if (!Array.isArray(state.bids) || state.bids.length === 0) return Object.freeze({ kind: "refuse", reason: "no non-fleet live bid exists" });
  // Sell the whole balance into the non-fleet bids, best first.
  const book = parseEngineOrderBook(state.bids, [], state.symbol);
  const walked = marketSellWalk(book, gradedFromParts(quantity, 10n ** BigInt(state.precision), state.symbol));
  const units8 = (value) => rationalUnits(gradedValue(value), 8, { rounding: "toward-zero" });
  const left = gradedSign(walked.shortfall) > 0 ? 1n : 0n;
  const best = units8(bestBid(book).price);
  const floor = units8(walked.worst);
  const proceeds = units8(walked.cost);
  const levels = walked.levels;
  if (left !== 0n) return Object.freeze({ kind: "refuse", reason: "displayed non-fleet bids cannot fill the full liquid balance" });
  const slippageBps = Number((best - floor) * 10_000n / best);
  if (slippageBps > maxSlippageBps) return Object.freeze({ kind: "refuse", reason: `full exit floor is ${slippageBps} bps below the best bid`, slippageBps });
  if (proceeds < 100_000n) return Object.freeze({ kind: "refuse", reason: "full displayed exit is worth less than 0.001 SWAP.HIVE" });
  const quantityText = formatUnits(quantity, state.precision);
  const floorText = formatUnits(floor, 8);
  return Object.freeze({ kind: "sell", quantity: quantityText, bestBid: formatUnits(best, 8), floorPrice: floorText,
    minimumSwapHive: formatUnits(quantity * floor / (10n ** BigInt(state.precision)), 8),
    displayedGrossSwapHive: formatUnits(proceeds, 8), levels, slippageBps,
    operation: engineCustomJson(state.account, market.sell({ symbol: state.symbol, quantity: quantityText, price: floorText, expiration: 300 })) });
}

async function independentlyObservedState(account, symbol) {
  const states = await Promise.all(CONTRACT_NODES.map((node) => readState(account, symbol, node)));
  if (!statesAgree(states[0], states[1])) fail("independent Hive-Engine providers disagree on liquidation evidence");
  return Object.freeze({ state: states[0], providers: Object.freeze(CONTRACT_NODES.map((node, index) => Object.freeze({ node, observedAt: states[index].observedAt }))) });
}

async function transactionEvidence(txid) {
  const rows = await Promise.all(BLOCKCHAIN_NODES.map((node) => engineTransaction(node, txid, { backoffMs: 350, fail })));
  return rows.some((row) => row === null) ? null : Object.freeze(rows);
}

async function effectState(account, symbol, txid, node) {
  const [tokenRows, swapRows, orders] = await Promise.all([
    find(node, "tokens", "balances", { account, symbol }, 2),
    find(node, "tokens", "balances", { account, symbol: "SWAP.HIVE" }, 2),
    find(node, "market", "sellBook", { account, symbol }, 1000),
  ]);
  return Object.freeze({ node, tokenBalance: String(tokenRows[0]?.balance ?? "0"),
    swapHiveBalance: String(swapRows[0]?.balance ?? "0.00000000"),
    matchingOpenOrders: orders.filter((row) => row.txId === txid).map((row) => Object.freeze({ txId: row.txId, quantity: row.quantity, price: row.price })) });
}

async function waitForEffect(account, symbol, txid, before, plan) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [engine, states] = await Promise.all([
      transactionEvidence(txid),
      Promise.all(CONTRACT_NODES.map((node) => effectState(account, symbol, txid, node))),
    ]);
    const expectedToken = decimalUnits(before.balance, before.precision) - decimalUnits(plan.quantity, before.precision);
    const minimum = decimalUnits(plan.minimumSwapHive, 8);
    const confirmed = states.every((state) => decimalUnits(state.tokenBalance, before.precision) === expectedToken
      && decimalUnits(state.swapHiveBalance, 8) - decimalUnits(before.swapHiveBalance, 8) >= minimum
      && state.matchingOpenOrders.length === 0);
    if (engine && confirmed) return Object.freeze({ engine, states });
    if (attempt < 19) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200));
  }
  return null;
}

export async function operate(options) {
  const observed = await independentlyObservedState(options.account, options.symbol);
  const plan = planLiquidation(observed.state, options.maxSlippageBps);
  const base = Object.freeze({ kind: "aagaard.token-liquidation-receipt", account: options.account, symbol: options.symbol,
    observedAt: new Date().toISOString(), before: Object.freeze({ balance: observed.state.balance, swapHiveBalance: observed.state.swapHiveBalance }),
    evidenceProviders: observed.providers, plan });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (plan.kind !== "sell") fail(`fresh plan is not executable: ${plan.reason}`);
  const target = `liquidate:${options.symbol}:${plan.quantity}:${plan.floorPrice}`;
  let submission;
  try { submission = await submitToSigner({ account: options.account, role: "active", lane: "liquidity-exit", target,
    operation: plan.operation }); }
  catch (error) { throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  if (!/^[0-9a-f]{40}$/.test(String(submission?.id ?? ""))) fail("submission returned no canonical transaction id; do not retry automatically");
  const transactionId = String(submission.id);
  let hive = null;
  let effect = null;
  let settlementError = null;
  try {
    hive = await hiveReader.confirmTransaction(transactionId, plan.operation);
    effect = await waitForEffect(options.account, options.symbol, transactionId, observed.state, plan);
    if (!effect) settlementError = "liquidation effect did not independently reconcile before timeout";
  } catch (error) {
    settlementError = error instanceof Error ? error.message : String(error);
  }
  const completedAt = new Date().toISOString();
  const receipt = Object.freeze({ ...base, transactionId, ...(hive ? { hive } : {}), status: effect ? "liquidated-confirmed" : "settlement-pending",
    retryAllowed: false, ...(settlementError ? { settlementError } : {}),
    ...(effect ? { engine: effect.engine, after: effect.states } : {}), completedAt });
  const event = witnessChainAct(FLEET_DATA_DIR, TOKEN_LIQUIDATION_CATEGORY, completedAt, tokenLiquidationEvent(receipt, completedAt));
  return Object.freeze({ ...receipt, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }) });
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}
