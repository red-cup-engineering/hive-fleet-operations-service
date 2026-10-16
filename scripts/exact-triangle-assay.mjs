#!/usr/bin/env node
import { certifyExactTriangleAssay } from "../src/core/triangleAssay.mjs";
import { EngineClient } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-operation-service";
import { oneRow } from "../src/core/hiveScriptSupport.mjs";
import { accountsWithLane } from "../src/core/accountStrategy.mjs";

const ACCOUNT = accountsWithLane("arbitrage")[0] ?? "";
const PROVIDERS = Object.freeze([
  "https://api.hive-engine.com/rpc",
  "https://herpc.dtools.dev",
  "https://herpc.liotes.com",
]);
const BOOK_LIMIT = 200;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

const one = (rows, label) => oneRow(rows, label, (message) => { throw new Error(message); });

function decimal(value, label) {
  const candidate = String(value ?? "");
  if (!DECIMAL.test(candidate)) throw new Error(`${label} is not an exact unsigned decimal`);
  return candidate;
}

function precision(rows, symbol) {
  const row = one(rows.filter((entry) => entry.symbol === symbol), `${symbol} token`);
  const value = Number(row.precision);
  if (!Number.isSafeInteger(value) || value < 0 || value > 18) throw new Error(`${symbol} precision is malformed`);
  return value;
}

function feeBps(row) {
  if (row.tradeFeeMultiplier === undefined) return 25;
  const multiplier = Number(row.tradeFeeMultiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1) throw new Error("pool fee multiplier is malformed");
  return Math.round((1 - multiplier) * 10_000);
}

function orientPool(rows, inputSymbol, outputSymbol, precisions) {
  const row = one(rows.filter((entry) => {
    const pair = String(entry.tokenPair ?? "").split(":");
    return pair.length === 2 && pair.includes(inputSymbol) && pair.includes(outputSymbol);
  }), `${inputSymbol}->${outputSymbol} pool`);
  const [base, quote] = String(row.tokenPair).split(":");
  return Object.freeze({
    pair: String(row.tokenPair), inputSymbol, outputSymbol,
    reserveIn: decimal(base === inputSymbol ? row.baseQuantity : row.quoteQuantity, `${inputSymbol} reserve`),
    reserveOut: decimal(base === outputSymbol ? row.baseQuantity : row.quoteQuantity, `${outputSymbol} reserve`),
    inputPrecision: precisions[inputSymbol], outputPrecision: precisions[outputSymbol], feeBps: feeBps(row),
  });
}

function fraction(value) {
  const [whole, tail = ""] = value.split(".");
  return [BigInt(`${whole}${tail}`), tail.length];
}

function compare(left, right) {
  const [lv, lp] = fraction(left); const [rv, rp] = fraction(right);
  const p = Math.max(lp, rp);
  const l = lv * 10n ** BigInt(p - lp); const r = rv * 10n ** BigInt(p - rp);
  return l < r ? -1 : l > r ? 1 : 0;
}

async function observeProvider(provider) {
  const rpc = new EngineClient({ nodes: [provider], timeout: 15_000, serial: true });
  try {
    const [tokenRows, balanceRows, poolRows, rawBids] = await Promise.all([
      rpc.find("tokens", "tokens", { symbol: { $in: ["SWAP.HIVE", "VOUCHER", "DEC"] } }, { limit: 3 }),
      rpc.find("tokens", "balances", { account: ACCOUNT, symbol: "SWAP.HIVE" }, { limit: 2 }),
      rpc.find("marketpools", "pools", { tokenPair: { $in: ["SWAP.HIVE:VOUCHER", "VOUCHER:SWAP.HIVE", "DEC:VOUCHER", "VOUCHER:DEC"] } }, { limit: 4 }),
      rpc.find("market", "buyBook", { symbol: "DEC" }, { limit: BOOK_LIMIT, indexes: [{ index: "priceDec", descending: true }] }),
    ]);
    const precisions = Object.freeze({ "SWAP.HIVE": precision(tokenRows, "SWAP.HIVE"), VOUCHER: precision(tokenRows, "VOUCHER"), DEC: precision(tokenRows, "DEC") });
    const bids = rawBids.map((row) => Object.freeze({
      priceSwapHivePerToken: decimal(row.price, "DEC bid price"), quantity: decimal(row.quantity, "DEC bid quantity"),
    }));
    const bidBookOrdered = bids.every((entry, index) => index === 0 || compare(entry.priceSwapHivePerToken, bids[index - 1].priceSwapHivePerToken) <= 0);
    const balance = balanceRows.length === 0 ? "0" : decimal(one(balanceRows, "michael561 SWAP.HIVE balance").balance, "SWAP.HIVE balance");
    return Object.freeze({ provider, status: "available", state: Object.freeze({
      account: ACCOUNT, initialBalance: balance, initialPrecision: precisions["SWAP.HIVE"], capInitialMilli: 1000,
      firstPool: orientPool(poolRows, "SWAP.HIVE", "VOUCHER", precisions),
      secondPool: orientPool(poolRows, "VOUCHER", "DEC", precisions),
      finalTokenPrecision: precisions.DEC, bids: Object.freeze(bids),
      bidBookComplete: rawBids.length < BOOK_LIMIT, bidBookOrdered, perPoolSlippageBps: 50,
    }) });
  } catch (error) {
    return Object.freeze({ provider, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
  }
}

export async function observe() {
  const observedAt = new Date().toISOString();
  return certifyExactTriangleAssay({ observedAt, observations: await Promise.all(PROVIDERS.map(observeProvider)) });
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "exact-triangle-assay", description: "observe — the exact-triangle-assay operation.", operation: observe }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
