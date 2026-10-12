// Reads the public Hive-Engine market universe for one wallet.  This is an
// adapter: it establishes observed market state only; the core decides whether
// that state admits an economic action.
import { EngineClient } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { certifyGlobalArbitrageScan, discoverPoolToBookRoutes } from "../../core/globalArbitrageScan.mjs";

export const HIVE_ENGINE_ARBITRAGE_PROVIDERS = Object.freeze([
  "https://api.hive-engine.com/rpc",
  "https://herpc.dtools.dev",
  "https://herpc.liotes.com",
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
  const [lv, lp] = fraction(left); const [rv, rp] = fraction(right); const precision = Math.max(lp, rp);
  const l = lv * 10n ** BigInt(precision - lp); const r = rv * 10n ** BigInt(precision - rp);
  return l < r ? -1 : l > r ? 1 : 0;
}

async function allRows(rpc, contract, table, query = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await rpc.find(contract, table, query, { limit: 1_000, offset });
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

async function observeProvider(provider, account, fleet) {
  const rpc = new EngineClient({ nodes: [provider], timeout: 20_000, serial: true });
  try {
    const [rawPools, rawMetrics, balanceRows] = await Promise.all([
      allRows(rpc, "marketpools", "pools"), allRows(rpc, "market", "metrics"),
      rpc.find("tokens", "balances", { account, symbol: "SWAP.HIVE" }, { limit: 2 }),
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
    const rawTokens = symbols.length === 0 ? [] : await rpc.find("tokens", "tokens", { symbol: { $in: ["SWAP.HIVE", ...symbols] } }, { limit: symbols.length + 1 });
    const precision = Object.fromEntries(rawTokens.map((row) => {
      const value = Number(row.precision);
      if (!Number.isSafeInteger(value) || value < 0 || value > 18) throw new Error(`${row.symbol} precision is malformed`);
      return [String(row.symbol).toUpperCase(), value];
    }));
    if (precision["SWAP.HIVE"] === undefined) throw new Error("SWAP.HIVE precision is unavailable");
    const books = [];
    for (const symbol of symbols) {
      const raw = await rpc.find("market", "buyBook", { symbol }, { limit: BOOK_LIMIT, indexes: [{ index: "priceDec", descending: true }] });
      const bids = raw.map((row) => Object.freeze({ priceSwapHivePerToken: decimal(row.price, `${symbol} bid price`), quantity: decimal(row.quantity, `${symbol} bid quantity`) }));
      books.push(Object.freeze({ symbol, bids: Object.freeze(bids), complete: raw.length < BOOK_LIMIT,
        ordered: bids.every((entry, index) => index === 0 || compare(entry.priceSwapHivePerToken, bids[index - 1].priceSwapHivePerToken) <= 0),
        fleetBidPrices: Object.freeze(raw.filter((row) => fleet.has(String(row.account ?? "").toLowerCase())).map((row) => decimal(row.price, `${symbol} fleet bid price`)).sort()),
      }));
    }
    const balance = balanceRows.length === 0 ? "0" : decimal(balanceRows[0].balance, `${account} SWAP.HIVE balance`);
    return Object.freeze({ provider, status: "available", state: Object.freeze({ account, swapHiveBalance: balance,
      swapHivePrecision: precision["SWAP.HIVE"], tokenPrecision: Object.freeze(precision), pools: Object.freeze(pools),
      metrics: Object.freeze(metrics), books: Object.freeze(books),
    }) });
  } catch (error) {
    return Object.freeze({ provider, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
  }
}

/** Obtain independently observed, exact pool-to-book opportunities for one fleet wallet. */
export async function observeGlobalArbitrage({ account, fleetAccounts, providers = HIVE_ENGINE_ARBITRAGE_PROVIDERS } = {}) {
  const fleet = new Set((fleetAccounts ?? []).map((value) => String(value).toLowerCase()));
  if (!fleet.has(account)) throw new TypeError(`global arbitrage scan account is not in the admitted fleet: ${account}`);
  const observedAt = new Date().toISOString();
  return certifyGlobalArbitrageScan({ observedAt, observations: await Promise.all(providers.map((provider) => observeProvider(provider, account, fleet))) });
}
