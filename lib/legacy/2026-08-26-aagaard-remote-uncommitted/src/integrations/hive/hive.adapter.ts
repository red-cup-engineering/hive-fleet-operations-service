import type { InternalMarketReading, PostCandidate, WalletActor, WalletChainState } from "../../core/core.adapter.ts";
import type { CurationRewardOperation, CurationRewardScan } from "../../core/curationSettlement.mts";
export type { InternalMarketReading } from "../../core/core.adapter.ts";

export interface HiveClientOptions {
  readonly nodes: readonly string[];
  readonly timeoutMs: number;
  readonly perSourceLimit: number;
  readonly fetch?: typeof fetch;
}

export interface HiveClient {
  readCandidateField(wallet: WalletActor): Promise<readonly PostCandidate[]>;
  readWalletState(wallet: WalletActor): Promise<WalletChainState | null>;
  /** Bounded account-history scan for actual curation_reward virtual ops. */
  readCurationRewards(wallet: WalletActor): Promise<CurationRewardScan>;
  /** Hive's own internal HIVE/HBD order book -- the real market this app
   *  used to stand in for with a hardcoded 0.30/0.31 placeholder. */
  readInternalMarket(): Promise<InternalMarketReading | null>;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.split(" ")[0]);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseJsonRecord(value: unknown): JsonRecord {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function tagsOf(raw: JsonRecord): readonly string[] {
  const metadata = parseJsonRecord(raw["json_metadata"]);
  const tags = Array.isArray(metadata["tags"])
    ? metadata["tags"].filter((entry): entry is string => typeof entry === "string")
    : [];
  const category = text(raw["category"]);
  return Object.freeze([...new Set([category, ...tags].filter((tag) => tag !== ""))]);
}

function activeVotesOf(raw: JsonRecord): readonly { readonly voter: string; readonly rshares: number; readonly time?: string; readonly percent?: number }[] {
  const votes = Array.isArray(raw["active_votes"]) ? raw["active_votes"] : [];
  return Object.freeze(votes.filter(isRecord).map((vote) => {
    const time = text(vote["time"]);
    return Object.freeze({
      voter: text(vote["voter"]),
      rshares: num(vote["rshares"]),
      ...(time !== "" ? { time: normalizedIso(time) } : {}),
      ...(typeof vote["percent"] === "number" ? { percent: vote["percent"] } : {}),
    });
  }).filter((vote) => vote.voter !== ""));
}

function beneficiariesOf(raw: JsonRecord): readonly { readonly account: string; readonly weight: number }[] {
  const beneficiaries = Array.isArray(raw["beneficiaries"]) ? raw["beneficiaries"] : [];
  return Object.freeze(beneficiaries.filter(isRecord).map((entry) => Object.freeze({
    account: text(entry["account"]),
    weight: num(entry["weight"]),
  })).filter((entry) => entry.account !== ""));
}

// Hive timestamps arrive without a trailing "Z" (naive UTC) — Date.parse
// treats that as local time unless corrected, which would silently skew every
// age and timing read by the runtime's UTC offset.
function normalizedIso(value: string): string {
  return value.endsWith("Z") ? value : `${value}Z`;
}

/** Decode one condenser_api.get_account_history row. Virtual-operation
 * transaction ids are commonly all zero, so source identity is the account's
 * history index plus the block/op position instead. */
export function curationRewardFromHistoryRow(account: string, row: unknown): CurationRewardOperation | null {
  if (!Array.isArray(row) || row.length < 2 || !isRecord(row[1])) return null;
  const historyIndex = num(row[0], Number.NaN);
  const envelope = row[1];
  const op = envelope["op"];
  if (!Number.isInteger(historyIndex) || !Array.isArray(op) || op[0] !== "curation_reward" || !isRecord(op[1])) return null;
  const value = op[1];
  const curator = text(value["curator"]);
  const author = text(value["author"]);
  const permlink = text(value["permlink"]);
  const rewardText = text(value["reward"]);
  const rewardMatch = /^(\d+(?:\.\d{1,6})?) VESTS$/.exec(rewardText);
  const block = num(envelope["block"], Number.NaN);
  const operationIndex = num(envelope["op_in_trx"], Number.NaN);
  const timestamp = text(envelope["timestamp"]);
  if (curator !== account || author === "" || permlink === "" || !rewardMatch
    || !Number.isInteger(block) || !Number.isInteger(operationIndex) || timestamp === "") return null;
  return Object.freeze({
    sourceId: `hive-account-history:${account}:${historyIndex}:${block}:${operationIndex}`,
    account,
    historyIndex,
    block,
    operationIndex,
    timestamp: normalizedIso(timestamp),
    author,
    permlink,
    reward: Object.freeze({ amount: rewardMatch[1]!, asset: "VESTS" as const }),
    payoutMustBeClaimed: typeof value["payout_must_be_claimed"] === "boolean" ? value["payout_must_be_claimed"] : null,
  });
}

function ageHours(created: string, now = Date.now()): number {
  const ms = Date.parse(normalizedIso(created));
  return Number.isFinite(ms) ? Math.max(0, (now - ms) / 3_600_000) : 0;
}

export function postCandidateFromHive(raw: JsonRecord, now = Date.now()): PostCandidate | null {
  const author = text(raw["author"]);
  const permlink = text(raw["permlink"]);
  if (author === "" || permlink === "") return null;
  const created = text(raw["created"]);
  return Object.freeze({
    author,
    permlink,
    title: text(raw["title"]),
    body: text(raw["body"]).slice(0, 4000),
    tags: tagsOf(raw),
    pendingPayout: num(raw["pending_payout_value"] ?? raw["pending_payout"], 0),
    netRshares: num(raw["net_rshares"], 0),
    comments: num(raw["children"], 0),
    ageHours: ageHours(created, now),
    created: created === "" ? new Date(now).toISOString() : normalizedIso(created),
    beneficiaries: beneficiariesOf(raw),
    votes: activeVotesOf(raw),
  });
}

const VOTING_MANA_REGENERATION_SECONDS = 5 * 24 * 60 * 60;

/** Project Hive's stored manabar to the observation time. The legacy
 * `voting_power` account field is only the value stored at the account's last
 * vote and does not regenerate between account mutations, so treating it as a
 * current value can keep an idle, fully recharged wallet below its strategy
 * floor indefinitely. */
export function accountStateFromHive(account: string, raw: JsonRecord | undefined, nowUnixSeconds = Math.floor(Date.now() / 1000)): WalletChainState | null {
  if (!raw) return null;
  const vestingShares = num(raw["vesting_shares"], 0);
  const delegatedVestingShares = num(raw["delegated_vesting_shares"], 0);
  const receivedVestingShares = num(raw["received_vesting_shares"], 0);
  const maxMana = Math.max(0, Math.round((vestingShares - delegatedVestingShares + receivedVestingShares) * 1_000_000));
  const manabar = isRecord(raw["voting_manabar"]) ? raw["voting_manabar"] : null;
  const storedMana = manabar ? num(manabar["current_mana"], Number.NaN) : Number.NaN;
  const lastUpdate = manabar ? num(manabar["last_update_time"], Number.NaN) : Number.NaN;
  const elapsed = Number.isFinite(lastUpdate) ? Math.max(0, Math.floor(nowUnixSeconds) - Math.floor(lastUpdate)) : 0;
  const currentMana = maxMana > 0 && Number.isFinite(storedMana) && Number.isFinite(lastUpdate)
    ? Math.max(0, Math.min(maxMana, Math.floor(storedMana + (elapsed * maxMana) / VOTING_MANA_REGENERATION_SECONDS)))
    : 0;
  return Object.freeze({
    account,
    hive: text(raw["balance"], "0.000 HIVE"),
    hbd: text(raw["hbd_balance"], "0.000 HBD"),
    currentMana: String(currentMana),
    maxMana: String(maxMana),
    tokens: Object.freeze({}),
  });
}

function feedRequests(wallet: WalletActor, limit: number): readonly JsonRecord[] {
  const feeds = wallet.strategy.feeds.length > 0 ? wallet.strategy.feeds : ["trending"];
  return Object.freeze(feeds.map((feed) => {
    if (feed === "following") {
      return Object.freeze({ sort: "feed", tag: wallet.account, limit });
    }
    if (feed.startsWith("blog:")) {
      return Object.freeze({ sort: "blog", tag: feed.slice("blog:".length), limit });
    }
    if (feed === "trending" || feed === "created" || feed === "hot") {
      return Object.freeze({ sort: feed, tag: "", limit });
    }
    return Object.freeze({ sort: "trending", tag: feed, limit });
  }));
}

export function createHiveClient(options: HiveClientOptions): HiveClient {
  const fetchImpl = options.fetch ?? fetch;
  let nextId = 1;
  let internalMarketCache: { readonly expires: number; readonly value: Promise<InternalMarketReading | null> } | null = null;

  async function call(method: string, params: unknown): Promise<unknown> {
    let lastError: unknown;
    for (const node of options.nodes) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetchImpl(node, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Hive RPC ${node} ${response.status}`);
        const payload = await response.json() as unknown;
        if (!isRecord(payload)) throw new Error(`Hive RPC ${node} returned non-object payload`);
        if (payload["error"] !== undefined) throw new Error(`Hive RPC ${method} error: ${JSON.stringify(payload["error"])}`);
        return payload["result"];
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function rankedPosts(request: JsonRecord): Promise<readonly JsonRecord[]> {
    const result = await call("bridge.get_ranked_posts", request);
    return Object.freeze((Array.isArray(result) ? result : []).filter(isRecord));
  }

  return Object.freeze({
    async readCandidateField(wallet: WalletActor) {
      const batches = await Promise.all(feedRequests(wallet, options.perSourceLimit).map(rankedPosts));
      const byKey = new Map<string, PostCandidate>();
      for (const raw of batches.flat()) {
        const post = postCandidateFromHive(raw);
        if (post) byKey.set(`${post.author}/${post.permlink}`, post);
      }
      return Object.freeze([...byKey.values()]);
    },
    async readWalletState(wallet: WalletActor) {
      const result = await call("condenser_api.get_accounts", [[wallet.account]]);
      const accounts = Array.isArray(result) ? result.filter(isRecord) : [];
      return accountStateFromHive(wallet.account, accounts[0]);
    },
    async readCurationRewards(wallet: WalletActor) {
      const requestedLimit = 1000;
      const result = await call("condenser_api.get_account_history", [wallet.account, -1, requestedLimit]);
      const rows = Array.isArray(result) ? result : [];
      const indices = rows
        .map((row) => Array.isArray(row) ? num(row[0], Number.NaN) : Number.NaN)
        .filter((value) => Number.isInteger(value));
      const rewards = rows
        .map((row) => curationRewardFromHistoryRow(wallet.account, row))
        .filter((entry): entry is CurationRewardOperation => entry !== null);
      return Object.freeze({
        kind: "aagaard.hive-curation-reward-scan" as const,
        account: wallet.account,
        requestedLimit,
        newestHistoryIndex: indices.length > 0 ? Math.max(...indices) : null,
        oldestHistoryIndex: indices.length > 0 ? Math.min(...indices) : null,
        rewards: Object.freeze(rewards),
      });
    },
    async readInternalMarket() {
      if (internalMarketCache && internalMarketCache.expires > Date.now()) return await internalMarketCache.value;
      const value = (async (): Promise<InternalMarketReading | null> => {
      const [ticker, book] = await Promise.all([
        call("condenser_api.get_ticker", []),
        call("condenser_api.get_order_book", [20]),
      ]);
      if (!isRecord(ticker)) return null;
      const latest = num(ticker["latest"], 0);
      const bid = num(ticker["highest_bid"], 0);
      const ask = num(ticker["lowest_ask"], 0);
      const midpoint = latest > 0 ? latest : bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
      if (midpoint <= 0) return null;
      const relativeSpreadBps = bid > 0 && ask > 0 ? Math.round(((ask - bid) / midpoint) * 10000) : 0;
      // hbd/hive amounts on each book row are integer-scaled (thousandths);
      // consistent scale is all this depth proxy needs, since it is compared
      // to zero (one-sided check) and to itself (imbalance), never to an
      // absolute HBD figure.
      const bids = isRecord(book) && Array.isArray(book["bids"]) ? book["bids"].filter(isRecord) : [];
      const asks = isRecord(book) && Array.isArray(book["asks"]) ? book["asks"].filter(isRecord) : [];
      const bookRows = (rows: readonly JsonRecord[]) => Object.freeze(rows.map((row) => Object.freeze({
        priceHbdPerHive: num(row["real_price"], 0),
        hiveQuantity: num(row["hive"], 0) / 1000,
        hbdQuantity: num(row["hbd"], 0) / 1000,
      })).filter((row) => row.priceHbdPerHive > 0 && row.hiveQuantity > 0 && row.hbdQuantity > 0));
      const bidRows = bookRows(bids);
      const askRows = bookRows(asks);
      const bestBid = bidRows[0]?.priceHbdPerHive ?? bid;
      const bestAsk = askRows[0]?.priceHbdPerHive ?? ask;
      const bidDepth = bidRows.reduce((sum, row) => sum + row.hbdQuantity, 0);
      const askDepth = askRows.reduce((sum, row) => sum + row.hbdQuantity, 0);
      return Object.freeze({
        midpoint,
        bestBid,
        bestAsk,
        bestBidQuantityHive: bidRows[0]?.hiveQuantity ?? 0,
        bestAskQuantityHive: askRows[0]?.hiveQuantity ?? 0,
        bids: bidRows,
        asks: askRows,
        bidDepth,
        askDepth,
        relativeSpreadBps,
      });
      })();
      internalMarketCache = { expires: Date.now() + 15_000, value };
      return await value;
    },
  });
}
