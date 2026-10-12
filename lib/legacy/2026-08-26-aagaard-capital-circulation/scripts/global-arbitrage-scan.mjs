#!/usr/bin/env node
// Complete SWAP.HIVE-pool discovery followed by exact full-book sizing.
// All provider calls are read-only. Even a policy-admitted observation is
// not executable until a separate fresh boundary supplies and settles it.

import { pathToFileURL } from "node:url";

import { certifyGlobalArbitrageScan, discoverPoolToBookRoutes } from "../src/core/globalArbitrageScan.mts";
import { createSerializedHiveEngineRpc } from "../src/integrations/hive-engine/serializedRpc.mts";

const DEFAULT_ACCOUNT = "michael561";
const FLEET = new Set(["emsenn0", "essiebee", "help-fund", "marshian", "michael561", "sigmund-vexler"]);
const PROVIDERS = Object.freeze([
  "https://api.hive-engine.com/rpc/contracts",
  "https://herpc.dtools.dev/contracts",
  "https://herpc.liotes.com/contracts",
]);
const BOOK_LIMIT = 200;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

function decimal(value, label) {
  const candidate = String(value ?? "");
  if (!DECIMAL.test(candidate)) throw new Error(`${label} is not an exact unsigned decimal`);
  return candidate;
}

function feeBps(row) {
  if (row.tradeFeeMultiplier === undefined) return 25;
  const multiplier = Number(row.tradeFeeMultiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1) throw new Error("pool fee multiplier is malformed");
  return Math.round((1 - multiplier) * 10_000);
}

function fraction(value) {
  const [whole, tail = ""] = value.split(".");
  return [BigInt(`${whole}${tail}`), tail.length];
}

function compare(left, right) {
  const [lv, lp] = fraction(left); const [rv, rp] = fraction(right); const p = Math.max(lp, rp);
  const l = lv * 10n ** BigInt(p - lp); const r = rv * 10n ** BigInt(p - rp);
  return l < r ? -1 : l > r ? 1 : 0;
}

async function allRows(rpc, contract, table, query = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await rpc.find(contract, table, query, 1_000, offset, []);
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

async function observeProvider(provider, account) {
  const rpc = createSerializedHiveEngineRpc({ nodes: [provider], timeoutMs: 20_000, attemptsPerNode: 2 });
  try {
    const [rawPools, rawMetrics, balanceRows] = await Promise.all([
      allRows(rpc, "marketpools", "pools"), allRows(rpc, "market", "metrics"),
      rpc.find("tokens", "balances", { account, symbol: "SWAP.HIVE" }, 2, 0, []),
    ]);
    const pools = rawPools.filter((row) => String(row.tokenPair ?? "").split(":").includes("SWAP.HIVE")).map((row) => Object.freeze({
      pair: String(row.tokenPair), baseQuantity: decimal(row.baseQuantity, "pool base quantity"),
      quoteQuantity: decimal(row.quoteQuantity, "pool quote quantity"), feeBps: feeBps(row),
    })).sort((left, right) => left.pair.localeCompare(right.pair));
    const metrics = rawMetrics.map((row) => Object.freeze({ symbol: String(row.symbol ?? "").toUpperCase(),
      highestBid: decimal(row.highestBid ?? "0", "market highest bid") }))
      .filter((row) => row.symbol !== "").sort((left, right) => left.symbol.localeCompare(right.symbol));
    const routes = discoverPoolToBookRoutes({ pools, metrics });
    const symbols = [...new Set(routes.map((row) => row.symbol))].sort();
    const rawTokens = symbols.length === 0 ? [] : await rpc.find("tokens", "tokens", { symbol: { $in: ["SWAP.HIVE", ...symbols] } }, symbols.length + 1, 0, []);
    const precision = Object.fromEntries(rawTokens.map((row) => {
      const value = Number(row.precision);
      if (!Number.isSafeInteger(value) || value < 0 || value > 18) throw new Error(`${row.symbol} precision is malformed`);
      return [String(row.symbol).toUpperCase(), value];
    }));
    if (precision["SWAP.HIVE"] === undefined) throw new Error("SWAP.HIVE precision is unavailable");
    const books = [];
    for (const symbol of symbols) {
      const raw = await rpc.find("market", "buyBook", { symbol }, BOOK_LIMIT, 0, [{ index: "priceDec", descending: true }]);
      const bids = raw.map((row) => Object.freeze({ priceSwapHivePerToken: decimal(row.price, `${symbol} bid price`),
        quantity: decimal(row.quantity, `${symbol} bid quantity`) }));
      books.push(Object.freeze({ symbol, bids: Object.freeze(bids), complete: raw.length < BOOK_LIMIT,
        ordered: bids.every((entry, index) => index === 0 || compare(entry.priceSwapHivePerToken, bids[index - 1].priceSwapHivePerToken) <= 0),
        fleetBidPrices: Object.freeze(raw.filter((row) => FLEET.has(String(row.account ?? "").toLowerCase())).map((row) => decimal(row.price, `${symbol} fleet bid price`)).sort()),
      }));
    }
    const balance = balanceRows.length === 0 ? "0" : decimal(balanceRows[0].balance, `${account} SWAP.HIVE balance`);
    return Object.freeze({ provider, status: "available", state: Object.freeze({ account,
      swapHiveBalance: balance, swapHivePrecision: precision["SWAP.HIVE"], tokenPrecision: Object.freeze(precision),
      pools: Object.freeze(pools), metrics: Object.freeze(metrics), books: Object.freeze(books),
    }) });
  } catch (error) {
    return Object.freeze({ provider, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
  }
}

export async function observe({ account = DEFAULT_ACCOUNT } = {}) {
  if (!FLEET.has(account)) throw new TypeError(`global arbitrage scan account is not in the admitted fleet: ${account}`);
  const observedAt = new Date().toISOString();
  return certifyGlobalArbitrageScan({ observedAt, observations: await Promise.all(PROVIDERS.map((provider) => observeProvider(provider, account))) });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const account = args.length === 0 ? DEFAULT_ACCOUNT
    : args.length === 2 && args[0] === "--account" ? args[1]
      : null;
  try {
    if (account === null) throw new TypeError("usage: global-arbitrage-scan.mjs [--account FLEET_ACCOUNT]");
    process.stdout.write(`${JSON.stringify(await observe({ account }), null, 2)}\n`);
  }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
