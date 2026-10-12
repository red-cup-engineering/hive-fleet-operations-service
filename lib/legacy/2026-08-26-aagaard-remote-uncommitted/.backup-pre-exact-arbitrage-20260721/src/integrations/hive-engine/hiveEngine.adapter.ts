import type { LiquidityReading, MarketReadBoundary, WalletActor, WalletChainState, WalletMarketState } from "../../core/core.adapter.ts";
import { detailedBalance, type TradeFill } from "../../analysis/flow.mts";

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
}

type JsonRecord = Readonly<Record<string, unknown>>;
type Venue = LiquidityReading["venues"][number];
type Pool = LiquidityReading["pools"][number];

const GAME_SYMBOLS = Object.freeze(["DEC", "SPS", "SPSP", "VOUCHER", "STARBITS", "STAR", "SIM", "BUDS", "SEEDS"]);

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

function venueFromBook(symbol: string, buys: readonly JsonRecord[], sells: readonly JsonRecord[]): Venue | null {
  const bids = buys.map((row) => ({ price: num(row["price"]), quantity: num(row["quantity"], num(row["tokensLocked"])) })).filter((row) => row.price > 0 && row.quantity > 0);
  const asks = sells.map((row) => ({ price: num(row["price"]), quantity: num(row["quantity"], num(row["tokensLocked"])) })).filter((row) => row.price > 0 && row.quantity > 0);
  const bestBid = Math.max(0, ...bids.map((row) => row.price));
  const bestAsk = Math.min(...asks.map((row) => row.price).filter((price) => price > 0));
  const midpoint = bestBid > 0 && Number.isFinite(bestAsk) ? (bestBid + bestAsk) / 2 : bestBid > 0 ? bestBid : Number.isFinite(bestAsk) ? bestAsk : 0;
  if (midpoint <= 0) return null;
  const bidDepth = bids.reduce((sum, row) => sum + row.quantity, 0);
  const askDepth = asks.reduce((sum, row) => sum + row.quantity, 0);
  const total = bidDepth + askDepth;
  const spread = bestBid > 0 && Number.isFinite(bestAsk) ? Math.max(0, Math.round(((bestAsk - bestBid) / midpoint) * 10000)) : 0;
  return Object.freeze({
    venue: "hive-engine",
    pair: `${symbol}/SWAP.HIVE`,
    midpoint,
    bidDepth,
    askDepth,
    relativeSpreadBps: spread,
    imbalance: total > 0 ? Number(((bidDepth - askDepth) / total).toFixed(6)) : 0,
    thin: total < 1,
  });
}

function poolFrom(raw: JsonRecord): Pool | null {
  const pair = text(raw["tokenPair"], text(raw["pair"]));
  if (pair === "" || !pair.includes(":")) return null;
  const base = num(raw["baseQuantity"]);
  const quote = num(raw["quoteQuantity"]);
  const impliedPrice = num(raw["basePrice"], base > 0 ? quote / base : 0);
  if (impliedPrice <= 0) return null;
  const feeMultiplier = num(raw["tradeFeeMultiplier"], 0.9975);
  return Object.freeze({
    pair,
    impliedPrice,
    tvlQuote: quote > 0 ? quote * 2 : num(raw["totalShares"], 0),
    feeBps: feeMultiplier > 0 && feeMultiplier <= 1 ? Math.round((1 - feeMultiplier) * 10000) : 25,
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
  const fetchImpl = options.fetch ?? fetch;
  let nextId = 1;

  async function find(contract: string, table: string, query: JsonRecord, limit: number, sort?: JsonRecord): Promise<readonly JsonRecord[]> {
    let lastError: unknown;
    for (const node of options.nodes) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetchImpl(node, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: nextId++,
            method: "find",
            params: { contract, table, query, limit, ...(sort ? { sort } : {}) },
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Hive-Engine RPC ${node} ${response.status}`);
        const payload = await response.json() as unknown;
        if (!isRecord(payload)) throw new Error(`Hive-Engine RPC ${node} returned non-object payload`);
        if (payload["error"] !== undefined) throw new Error(`Hive-Engine ${contract}.${table} error: ${JSON.stringify(payload["error"])}`);
        if (!Array.isArray(payload["result"])) throw new Error(`Hive-Engine ${contract}.${table} returned missing result`);
        return Object.freeze(payload["result"].filter(isRecord));
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function balances(wallet: WalletActor): Promise<Readonly<Record<string, string>>> {
    const rows = await find("tokens", "balances", { account: wallet.account }, options.balanceLimit);
    return Object.freeze(Object.fromEntries(rows.map(positiveTokenBalance).filter((entry): entry is readonly [string, string] => entry !== null)));
  }

  async function books(symbol: string): Promise<Venue | null> {
    const [buys, sells] = await Promise.all([
      find("market", "buyBook", { symbol }, options.marketLimit).catch(() => Object.freeze([]) as readonly JsonRecord[]),
      find("market", "sellBook", { symbol }, options.marketLimit).catch(() => Object.freeze([]) as readonly JsonRecord[]),
    ]);
    return venueFromBook(symbol, buys, sells);
  }

  async function pools(symbols: ReadonlySet<string>): Promise<readonly Pool[]> {
    const pairs = [...symbols].flatMap((symbol) => [`${symbol}:SWAP.HIVE`, `SWAP.HIVE:${symbol}`]);
    const targeted = await Promise.all(pairs.map((tokenPair) => find("marketpools", "pools", { tokenPair }, 1).catch(() => Object.freeze([]) as readonly JsonRecord[])));
    const rows = targeted.flat();
    if (rows.length === 0) {
      const fallbackRows = await find("marketpools", "pools", {}, Math.min(options.poolLimit, 200)).catch(() => Object.freeze([]) as readonly JsonRecord[]);
      return Object.freeze(fallbackRows.map(poolFrom).filter((entry): entry is Pool => entry !== null).filter((pool) => relevantPool(pool, symbols)));
    }
    return Object.freeze(rows.map(poolFrom).filter((entry): entry is Pool => entry !== null).filter((pool) => relevantPool(pool, symbols)));
  }

  return Object.freeze({
    readWalletTokens: balances,
    async readWalletMarket(wallet: WalletActor, state?: WalletChainState | null) {
      const tokens = await balances(wallet);
      const symbols = marketSymbols(tokens, wallet, state, options);
      const symbolSet = new Set(symbols);
      // SWAP.HIVE's own precision is needed too: a marketBuy's quantity
      // parameter is SWAP.HIVE spent, not units of the target token, so
      // rounding a buy's size needs SWAP.HIVE's precision, not the target
      // token's.
      const precisionSymbols = [...symbolSet, "SWAP.HIVE"];
      const [venues, poolRows, precisionRows] = await Promise.all([
        Promise.all(symbols.map(books)),
        pools(symbolSet),
        precisionSymbols.length > 0 ? find("tokens", "tokens", { symbol: { $in: precisionSymbols } }, precisionSymbols.length) : Promise.resolve(Object.freeze([]) as readonly JsonRecord[]),
      ]);
      const precision = Object.freeze(Object.fromEntries(precisionRows
        .map((row) => [text(row["symbol"]).toUpperCase(), num(row["precision"], NaN)] as const)
        .filter(([, value]) => Number.isFinite(value))));
      return Object.freeze({
        tokens,
        venues: Object.freeze(venues.filter((entry): entry is Venue => entry !== null)),
        pools: poolRows,
        precision,
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
        const rows = await find("market", "tradesHistory", { symbol }, TRADE_FLOW_LIMIT, { timestamp: -1 }).catch(() => Object.freeze([]) as readonly JsonRecord[]);
        const fills: TradeFill[] = rows
          .map((row) => ({ type: row["type"], volume: num(row["volume"]) }))
          .filter((row): row is { type: "buy" | "sell"; volume: number } => (row.type === "buy" || row.type === "sell") && row.volume > 0)
          .map((row) => ({ type: row.type, volumeSwapHive: row.volume }));
        return [symbol, detailedBalance(symbol, fills)] as const;
      }));
      return Object.freeze(Object.fromEntries(entries));
    },
  });
}
