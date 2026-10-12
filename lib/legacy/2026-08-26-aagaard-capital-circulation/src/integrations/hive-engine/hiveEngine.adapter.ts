import type { LiquidityReading, MarketReadBoundary, WalletActor, WalletChainState, WalletMarketState } from "../../core/core.adapter.ts";
import { detailedBalance, type FlowReading, type TradeFill } from "../../analysis/flow.mts";
import { normalizeMakerOpenOrder, type MakerOpenOrder, type MakerOrderScan } from "../../core/makerOrders.mts";
import { createSerializedHiveEngineRpc, type HiveEngineFindIndex } from "./serializedRpc.mts";

export interface HiveEngineClientOptions {
  readonly nodes: readonly string[];
  readonly timeoutMs: number;
  readonly balanceLimit: number;
  readonly marketLimit: number;
  readonly poolLimit: number;
  readonly symbols: readonly string[];
  readonly fetch?: typeof fetch;
}

export interface HiveEngineClient extends MarketReadBoundary {
  readWalletTokens(wallet: WalletActor): Promise<Readonly<Record<string, string>>>;
  readFleetOpenOrders(accounts: readonly string[], observedAt?: string): Promise<MakerOrderScan>;
}

type JsonRecord = Readonly<Record<string, unknown>>;
type Venue = LiquidityReading["venues"][number];
type Pool = LiquidityReading["pools"][number];
type ExactLevel = NonNullable<Venue["exactBook"]>["bids"][number];
type FindIndex = HiveEngineFindIndex;

const GAME_SYMBOLS = Object.freeze(["DEC", "SPS", "SPSP", "VOUCHER", "STARBITS", "STARPRO", "SIM", "BUDS", "SEEDS"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function positiveTokenBalance(raw: JsonRecord): readonly [string, string] | null {
  const symbol = text(raw["symbol"]).toUpperCase();
  const balance = text(raw["balance"], text(raw["stake"], "0"));
  if (symbol === "" || num(balance) <= 0) return null;
  return Object.freeze([symbol, balance]);
}

function exactLevel(row: JsonRecord): ExactLevel | null {
  const price = text(row["price"]);
  const quantity = text(row["quantity"]);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(price) || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(quantity)
    || num(price) <= 0 || num(quantity) <= 0) return null;
  return Object.freeze({ priceSwapHivePerToken: price, quantity });
}

function ordered(levels: readonly ExactLevel[], descending: boolean): boolean {
  return levels.every((level, index) => index === 0 || (descending
    ? num(level.priceSwapHivePerToken) <= num(levels[index - 1]!.priceSwapHivePerToken)
    : num(level.priceSwapHivePerToken) >= num(levels[index - 1]!.priceSwapHivePerToken)));
}

function venueFromBook(symbol: string, buys: readonly JsonRecord[], sells: readonly JsonRecord[], observedAt: string, rowLimit: number): Venue | null {
  const bids = buys.map((row) => ({ price: num(row["price"]), quantity: num(row["quantity"], num(row["tokensLocked"])) })).filter((row) => row.price > 0 && row.quantity > 0);
  const asks = sells.map((row) => ({ price: num(row["price"]), quantity: num(row["quantity"], num(row["tokensLocked"])) })).filter((row) => row.price > 0 && row.quantity > 0);
  const bestBid = Math.max(0, ...bids.map((row) => row.price));
  const bestAsk = Math.min(...asks.map((row) => row.price).filter((price) => price > 0));
  const bestBidQuantity = bids.filter((row) => row.price === bestBid).reduce((sum, row) => sum + row.quantity, 0);
  const bestAskQuantity = asks.filter((row) => row.price === bestAsk).reduce((sum, row) => sum + row.quantity, 0);
  const midpoint = bestBid > 0 && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : bestBid > 0 ? bestBid : Number.isFinite(bestAsk) ? bestAsk : 0;
  if (midpoint <= 0) return null;
  const exactBids = buys.map(exactLevel).filter((level): level is ExactLevel => level !== null);
  const exactAsks = sells.map(exactLevel).filter((level): level is ExactLevel => level !== null);
  const bidDepth = bids.reduce((sum, row) => sum + row.quantity, 0);
  const askDepth = asks.reduce((sum, row) => sum + row.quantity, 0);
  const total = bidDepth + askDepth;
  const spread = bestBid > 0 && Number.isFinite(bestAsk) ? Math.max(0, Math.round(((bestAsk - bestBid) / midpoint) * 10000)) : 0;
  return Object.freeze({
    venue: "hive-engine",
    pair: `${symbol}/SWAP.HIVE`,
    midpoint,
    bestBid,
    bestAsk: Number.isFinite(bestAsk) ? bestAsk : 0,
    bestBidQuantity,
    bestAskQuantity,
    bidDepth,
    askDepth,
    relativeSpreadBps: spread,
    imbalance: total > 0 ? Number(((bidDepth - askDepth) / total).toFixed(6)) : 0,
    thin: total < 1,
    exactBook: Object.freeze({
      observedAt,
      bids: Object.freeze(exactBids),
      asks: Object.freeze(exactAsks),
      bidComplete: buys.length < rowLimit && exactBids.length === buys.length,
      askComplete: sells.length < rowLimit && exactAsks.length === sells.length,
      bidOrdered: exactBids.length === buys.length && ordered(exactBids, true),
      askOrdered: exactAsks.length === sells.length && ordered(exactAsks, false),
    }),
  });
}

function poolFrom(raw: JsonRecord): Pool | null {
  const pair = text(raw["tokenPair"], text(raw["pair"]));
  if (pair === "" || !pair.includes(":")) return null;
  const base = num(raw["baseQuantity"]);
  const quote = num(raw["quoteQuantity"]);
  const impliedPrice = num(raw["basePrice"], base > 0 ? quote / base : 0);
  if (impliedPrice <= 0) return null;
  // The live mainnet contract charged 25 bps on transaction
  // 57c4578b697b5ab83a56ef8c4fa84f3ef938f72b even though its pool row omitted
  // tradeFeeMultiplier. Honor an explicit multiplier when supplied; otherwise
  // use the deployed mainnet default rather than pricing swaps as fee-free.
  const feeMultiplier = num(raw["tradeFeeMultiplier"], 0.9975);
  return Object.freeze({
    pair,
    impliedPrice,
    baseQuantity: base,
    quoteQuantity: quote,
    baseQuantityExact: text(raw["baseQuantity"]),
    quoteQuantityExact: text(raw["quoteQuantity"]),
    tvlQuote: quote > 0 ? quote * 2 : num(raw["totalShares"], 0),
    feeBps: feeMultiplier > 0 && feeMultiplier <= 1 ? Math.round((1 - feeMultiplier) * 10000) : 0,
  });
}

function uniqueSymbols(wallet: WalletActor, state: WalletChainState | null | undefined, options: HiveEngineClientOptions): readonly string[] {
  return Object.freeze([...new Set([
    ...options.symbols,
    ...GAME_SYMBOLS,
    ...Object.keys(wallet.tokens),
    ...Object.keys(state?.tokens ?? {}),
  ].map((symbol) => symbol.toUpperCase()).filter((symbol) => symbol !== "" && symbol !== "HIVE" && symbol !== "HBD" && symbol !== "SWAP.HIVE"))]);
}

function marketSymbols(tokens: Readonly<Record<string, string>>, wallet: WalletActor, state: WalletChainState | null | undefined, options: HiveEngineClientOptions): readonly string[] {
  return Object.freeze([...new Set([...uniqueSymbols(wallet, state, options), ...Object.keys(tokens).map((symbol) => symbol.toUpperCase())])]
    .filter((symbol) => symbol !== "" && symbol !== "HIVE" && symbol !== "HBD" && symbol !== "SWAP.HIVE" && symbol !== "SWAP.HBD"));
}

function relevantPool(pool: Pool, symbols: ReadonlySet<string>): boolean {
  const [base, quote] = pool.pair.split(":").map((entry) => entry.toUpperCase()).filter((entry) => entry !== "SWAP.HIVE" && entry !== "SWAP.HBD");
  return symbols.has(base ?? "") || symbols.has(quote ?? "");
}

export function createHiveEngineClient(options: HiveEngineClientOptions): HiveEngineClient {
  const MARKET_CACHE_MS = 30_000;
  const rpc = createSerializedHiveEngineRpc({ nodes: options.nodes, timeoutMs: options.timeoutMs,
    ...(options.fetch ? { fetch: options.fetch } : {}) });
  type CacheEntry<T> = { readonly expires: number; readonly value: Promise<T> };
  const bookCache = new Map<string, CacheEntry<Venue | null>>();
  const flowCache = new Map<string, CacheEntry<FlowReading>>();
  let allPoolsCache: CacheEntry<Readonly<{ readonly rows: readonly Pool[]; readonly observedAt: string }>> | null = null;

  function cached<T>(entry: CacheEntry<T> | undefined | null, load: () => Promise<T>): CacheEntry<T> {
    if (entry && entry.expires > Date.now()) return entry;
    return { expires: Date.now() + MARKET_CACHE_MS, value: load() };
  }

  async function find(contract: string, table: string, query: JsonRecord, limit: number, indexes?: readonly FindIndex[]): Promise<readonly JsonRecord[]> {
    return await rpc.find(contract, table, query, limit, 0, indexes);
  }

  async function balances(wallet: WalletActor): Promise<Readonly<Record<string, string>>> {
    const rows = await find("tokens", "balances", { account: wallet.account }, options.balanceLimit);
    return Object.freeze(Object.fromEntries(rows.map(positiveTokenBalance).filter((entry): entry is readonly [string, string] => entry !== null)));
  }

  async function books(symbol: string): Promise<Venue | null> {
    const observedAt = new Date().toISOString();
    const entry = cached(bookCache.get(symbol), async () => {
      const [buys, sells] = await Promise.all([
        find("market", "buyBook", { symbol }, options.marketLimit, [{ index: "priceDec", descending: true }]),
        find("market", "sellBook", { symbol }, options.marketLimit, [{ index: "priceDec", descending: false }]),
      ]);
      return venueFromBook(symbol, buys, sells, observedAt, options.marketLimit);
    });
    bookCache.set(symbol, entry);
    return await entry.value;
  }

  async function pools(symbols: ReadonlySet<string>): Promise<Readonly<{ readonly rows: readonly Pool[]; readonly observedAt: string }>> {
    // Pool state is account-independent. The old implementation issued two
    // RPC calls per held/configured symbol for every wallet concurrently,
    // which turned a six-wallet tick into hundreds of redundant requests
    // and made providers return partial/empty markets. One cached table read
    // supplies the whole fleet; each account filters it locally.
    allPoolsCache = cached(allPoolsCache, async () => {
      const rows = await find("marketpools", "pools", {}, options.poolLimit);
      return Object.freeze({
        rows: Object.freeze(rows.map(poolFrom).filter((entry): entry is Pool => entry !== null)),
        observedAt: new Date().toISOString(),
      });
    });
    const snapshot = await allPoolsCache.value;
    return Object.freeze({ rows: Object.freeze(snapshot.rows.filter((pool) => relevantPool(pool, symbols))), observedAt: snapshot.observedAt });
  }

  return Object.freeze({
    readWalletTokens: balances,
    async readFleetOpenOrders(accounts: readonly string[], observedAt = new Date().toISOString()) {
      const requested = Object.freeze([...new Set(accounts.map((account) => account.trim().toLowerCase()).filter((account) => account !== ""))].sort());
      const limitations: string[] = [];
      const observedAccounts: string[] = [];
      const orders: MakerOpenOrder[] = [];
      await Promise.all(requested.map(async (account) => {
        const results = await Promise.all((["buy", "sell"] as const).map(async (side) => {
          const table = side === "buy" ? "buyBook" : "sellBook";
          try {
            const rows = await find("market", table, { account }, options.marketLimit);
            const normalized = rows.map((row) => normalizeMakerOpenOrder(row, side));
            const malformed = normalized.filter((row) => row === null).length;
            if (rows.length >= options.marketLimit) limitations.push(`${account} ${table} reached row limit ${options.marketLimit}`);
            if (malformed > 0) limitations.push(`${account} ${table} contained ${malformed} malformed row(s)`);
            const wrongAccount = normalized.filter((row): row is MakerOpenOrder => row !== null && row.account !== account);
            if (wrongAccount.length > 0) limitations.push(`${account} ${table} returned ${wrongAccount.length} row(s) owned by another account`);
            return {
              complete: rows.length < options.marketLimit && malformed === 0 && wrongAccount.length === 0,
              orders: normalized.filter((row): row is MakerOpenOrder => row !== null && row.account === account),
            };
          } catch (error) {
            limitations.push(`${account} ${table} unavailable: ${error instanceof Error ? error.message : String(error)}`);
            return { complete: false, orders: Object.freeze([]) as readonly MakerOpenOrder[] };
          }
        }));
        orders.push(...results.flatMap((result) => result.orders));
        if (results.every((result) => result.complete)) observedAccounts.push(account);
      }));
      orders.sort((left, right) => left.orderKey.localeCompare(right.orderKey));
      observedAccounts.sort();
      limitations.sort();
      return Object.freeze({
        kind: "aagaard.maker-order-scan" as const,
        observedAt: new Date(observedAt).toISOString(),
        source: "hive-engine.market.buyBook+sellBook" as const,
        accountsRequested: requested,
        accountsObserved: Object.freeze(observedAccounts),
        complete: observedAccounts.length === requested.length && limitations.length === 0,
        orders: Object.freeze(orders),
        limitations: Object.freeze(limitations),
      });
    },
    async readWalletMarket(wallet: WalletActor, state?: WalletChainState | null) {
      // A transient account-balance failure must not erase the shared book
      // and pool market for that wallet. Fall back to already-observed
      // holdings; the bundle sizer still refuses capital whose SWAP.HIVE
      // balance is absent, so this improves observation without inventing
      // spendable funds.
      let balancesObserved = true;
      const tokens = await balances(wallet).catch(() => {
        balancesObserved = false;
        return Object.freeze({ ...(state?.tokens ?? {}) });
      });
      const symbols = marketSymbols(tokens, wallet, state, options);
      const symbolSet = new Set(symbols);
      let poolsObserved = true;
      const poolSnapshot = await pools(symbolSet).catch(() => {
        poolsObserved = false;
        return Object.freeze({ rows: Object.freeze([]) as readonly Pool[], observedAt: new Date().toISOString() });
      });
      const poolRows = poolSnapshot.rows;
      const pooledSymbols = symbols.filter((symbol) => poolRows.some((pool) => {
        const pair = pool.pair.split(":");
        return pair.includes(symbol) && pair.includes("SWAP.HIVE");
      }));
      // SWAP.HIVE's own precision is needed too: a marketBuy's quantity
      // parameter is SWAP.HIVE spent, not units of the target token, so
      // rounding a buy's size needs SWAP.HIVE's precision, not the target
      // token's.
      const precisionSymbols = [...new Set([...pooledSymbols, "SWAP.HIVE"])];
      const bookResults = await Promise.all(pooledSymbols.map(async (symbol) => {
        try {
          return { observed: true as const, venue: await books(symbol) };
        } catch {
          return { observed: false as const, venue: null };
        }
      }));
      let precisionObserved = true;
      const precisionRows = precisionSymbols.length > 0
        ? await find("tokens", "tokens", { symbol: { $in: precisionSymbols } }, precisionSymbols.length).catch(() => {
            precisionObserved = false;
            return Object.freeze([]) as readonly JsonRecord[];
          })
        : Object.freeze([]) as readonly JsonRecord[];
      const precision = Object.freeze(Object.fromEntries(precisionRows
        .map((row) => [text(row["symbol"]).toUpperCase(), num(row["precision"], NaN)] as const)
        .filter(([, value]) => Number.isFinite(value))));
      return Object.freeze({
        observedAt: [poolSnapshot.observedAt, ...bookResults.map((entry) => entry.venue?.exactBook?.observedAt).filter((value): value is string => typeof value === "string")].sort()[0] ?? poolSnapshot.observedAt,
        tokens,
        venues: Object.freeze(bookResults.map((entry) => entry.venue).filter((entry): entry is Venue => entry !== null)),
        pools: poolRows,
        precision,
        availability: Object.freeze({
          balances: balancesObserved,
          pools: poolsObserved,
          precision: precisionObserved,
          booksRequested: pooledSymbols.length,
          booksObserved: bookResults.filter((entry) => entry.observed).length,
        }),
      }) satisfies WalletMarketState;
    },
    // A token's own contract record is the only real source for whether
    // staking/delegation exist at all (e.g. POSH: stakingEnabled=false,
    // verified directly against api.hive-engine.com/rpc/contracts) --
    // staking a token the contract has permanently disabled would otherwise
    // broadcast a doomed transaction every tick, forever.
    async readStakeParams(symbols: readonly string[]) {
      if (symbols.length === 0) return Object.freeze({});
      const rows = await find("tokens", "tokens", { symbol: { $in: [...symbols] } }, symbols.length);
      return Object.freeze(Object.fromEntries(rows.map((row) => [
        text(row["symbol"]).toUpperCase(),
        Object.freeze({
          stakingEnabled: row["stakingEnabled"] === true,
          delegationEnabled: row["delegationEnabled"] === true,
        }),
      ])));
    },
    // Real realized fills from the market contract's own tradesHistory
    // table (verified shape: {type: "buy"|"sell", volume, ...}, where
    // `type` names which side's order crossed the book) -- see
    // analysis/flow.mts for what detailedBalance does with them.
    async readTradeFlow(symbols: readonly string[]) {
      const TRADE_FLOW_LIMIT = 50;
      const entries = await Promise.all(symbols.map(async (symbol) => {
        const entry = cached(flowCache.get(symbol), async () => {
          const rows = await find("market", "tradesHistory", { symbol }, TRADE_FLOW_LIMIT, [{ index: "timestamp", descending: true }]).catch(() => Object.freeze([]) as readonly JsonRecord[]);
          const fills: TradeFill[] = rows
            .map((row) => ({ type: row["type"], volume: num(row["volume"]) }))
            .filter((row): row is { type: "buy" | "sell"; volume: number } => (row.type === "buy" || row.type === "sell") && row.volume > 0)
            .map((row) => ({ type: row.type, volumeSwapHive: row.volume }));
          return detailedBalance(symbol, fills);
        });
        flowCache.set(symbol, entry);
        return [symbol, await entry.value] as const;
      }));
      return Object.freeze(Object.fromEntries(entries));
    },
  });
}
