import { spawn } from "node:child_process";
import path from "node:path";

import type {
  HiveWriteBoundary,
  HiveWriteResult,
  IncentiveActionKind,
  IncentiveOffer,
  StakingAction,
  TradingPlan,
  VotePlanItem,
  WalletActor,
  WrapAction,
} from "../../core/core.adapter.ts";
import * as hiveEngine from "../hive-engine/hiveEngineOps.mjs";

export interface HiveBroadcastCommandOptions {
  readonly command: string;
  readonly keyRoot?: string;
  readonly timeoutMs?: number;
}

export interface HiveBroadcastRequest {
  readonly kind: "aagaard.hive-write";
  readonly account: string;
  readonly role: "posting" | "active";
  readonly lane: "voting" | "trading" | "incentive";
  readonly target: string;
  readonly operation: readonly [string, Readonly<Record<string, unknown>>];
  readonly keyFile?: string;
}

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function txId(value: unknown): string {
  const body = record(value);
  const id = body["id"] ?? body["txId"] ?? body["transaction_id"];
  if (typeof id !== "string" || id.trim() === "") throw new Error("broadcast command returned no transaction id");
  return id;
}

function writeResult(value: unknown): HiveWriteResult {
  const body = record(value);
  const id = txId(body);
  const effect = record(body["economicEffect"]);
  const status = effect["status"];
  if (status !== "confirmed" && status !== "partial" && status !== "unverified" && status !== "not-recognized") return Object.freeze({ id });
  return Object.freeze({
    id,
    economicEffect: Object.freeze({
      status,
      source: typeof effect["source"] === "string" ? effect["source"] : "broadcast-command",
      ...(typeof effect["reference"] === "string" ? { reference: effect["reference"] } : {}),
      ...(typeof effect["contract"] === "string" ? { contract: effect["contract"] } : {}),
      ...(typeof effect["action"] === "string" ? { action: effect["action"] } : {}),
      ...(typeof effect["confirmedLegs"] === "number" ? { confirmedLegs: effect["confirmedLegs"] } : {}),
      ...(typeof effect["expectedLegs"] === "number" ? { expectedLegs: effect["expectedLegs"] } : {}),
      ...(typeof effect["realizedInputSwapHive"] === "number" ? { realizedInputSwapHive: effect["realizedInputSwapHive"] } : {}),
      ...(typeof effect["realizedProceedsSwapHive"] === "number" ? { realizedProceedsSwapHive: effect["realizedProceedsSwapHive"] } : {}),
      ...(typeof effect["realizedPnlSwapHive"] === "number" ? { realizedPnlSwapHive: effect["realizedPnlSwapHive"] } : {}),
    }),
  });
}

function amountHbd(value: number): string {
  return `${value.toFixed(3)} HBD`;
}

function request(input: Omit<HiveBroadcastRequest, "kind" | "keyFile">, keyRoot: string | undefined): HiveBroadcastRequest {
  const body = { kind: "aagaard.hive-write" as const, ...input };
  return Object.freeze(keyRoot ? { ...body, keyFile: path.join(keyRoot, input.account, `${input.role}.wif`) } : body);
}

function voteOperation(account: string, vote: VotePlanItem): HiveBroadcastRequest["operation"] {
  return Object.freeze(["vote", Object.freeze({
    voter: account,
    author: vote.author,
    permlink: vote.permlink,
    weight: vote.weightBps,
  })]);
}

// A trade's `pair` is `${from}/${to}`. Hive-Engine's market contract only
// ever trades a token against SWAP.HIVE (verified against
// hivesmartcontracts/contracts/market.js: both marketBuy and marketSell
// assert `symbol !== HIVE_PEGGED_SYMBOL`, i.e. the OTHER side is always
// SWAP.HIVE) -- a hop that involves neither side being SWAP.HIVE (e.g. a
// holonomy cycle leg like "DEC/HBD") cannot be executed as a single real
// market operation, and is refused here rather than guessed at.
//
// `trade.quantity` is computed by core.adapter.ts's sizeTradeQuantity from
// this tick's own live price data (real unit conversion from the trade's
// HBD-equivalent budget allocation into the traded token's own units) --
// replacing the earlier fixed MICRO_QUANTITY placeholder that ignored
// trade.amount entirely. A null quantity (pair unpriceable, or the trade
// wasn't funded by this tick's budget allocator) is refused, never
// substituted with a guessed size.
function tradeOperation(account: string, trade: TradingPlan["trades"][number]): HiveBroadcastRequest["operation"] {
  const [from, to] = trade.pair.split("/");
  if (trade.quantity === null) throw new Error(`trade pair '${trade.pair}' has no real computed quantity -- not funded or not priceable, refusing rather than guessing a size`);
  if (to === "SWAP.HIVE" && from) return hiveEngine.marketSell(account, from, trade.quantity);
  if (from === "SWAP.HIVE" && to) return hiveEngine.marketBuy(account, to, trade.quantity);
  throw new Error(`trade pair '${trade.pair}' involves neither side as SWAP.HIVE -- not executable as a single real market operation`);
}

function tradeBundleOperation(account: string, bundle: TradingPlan["bundles"][number]): HiveBroadcastRequest["operation"] {
  if (!bundle.executable || !bundle.funded) throw new Error(`trade bundle '${bundle.id}' is not both executable and funded`);
  if (bundle.kind === "pool-to-orderbook-round-trip") {
    const poolBuy = hiveEngine.swapTokens(account, bundle.pool, bundle.symbol, bundle.quantity, "exactOutput", bundle.maxInputSwapHive);
    const bookExit = hiveEngine.marketSellLimit(account, bundle.symbol, bundle.quantity, bundle.limitSellPriceSwapHive, 300);
    return hiveEngine.batchOperations(account, [poolBuy, bookExit]);
  }
  throw new Error(`trade bundle '${bundle.id}' uses the retired order-book-to-pool direction whose second leg cannot be conditioned on a complete first-leg fill`);
}

// LP position sizing (baseQuantity/quoteQuantity matched to the pool's
// current ratio) needs price data this function is not given either, and
// an incorrectly-ratioed addLiquidity call is a real, two-sided fund
// exposure -- worse than a single-sided trade Hive-Engine can simply
// refuse for insufficient balance. Refused rather than guessed at, same
// discipline as the trading-intent placeholder this replaced.
function liquidityOperation(_account: string, entry: TradingPlan["lp"][number]): HiveBroadcastRequest["operation"] {
  throw new Error(`LP position sizing for '${entry.pool}' is not yet unit-verified -- addLiquidity needs live pool-ratio data this operation builder does not have`);
}

function savingsOperation(account: string, entry: NonNullable<TradingPlan["savings"]>): HiveBroadcastRequest["operation"] {
  return Object.freeze(["transfer_to_savings", Object.freeze({
    from: account,
    to: account,
    amount: amountHbd(entry.amountHbd),
    memo: "Aagaard HBD savings move",
  })]);
}

function incentiveOperation(account: string, offer: IncentiveOffer, action: Exclude<IncentiveActionKind, "comment" | "post" | "delegate">): HiveBroadcastRequest["operation"] {
  if (action === "vote") return voteOperation(account, { author: offer.source.author, permlink: offer.source.permlink, weightBps: 10000, strategyAlpha: 0, sinkDeficit: 0, reason: "incentive vote" });
  if (action === "reblog") {
    return Object.freeze(["custom_json", Object.freeze({
      id: "follow",
      required_auths: [],
      required_posting_auths: [account],
      json: JSON.stringify(["reblog", { account, author: offer.source.author, permlink: offer.source.permlink }]),
    })]);
  }
  return Object.freeze(["custom_json", Object.freeze({
    id: "follow",
    required_auths: [],
    required_posting_auths: [account],
    json: JSON.stringify(["follow", { follower: account, following: offer.source.author, what: ["blog"] }]),
  })]);
}

function stakeOperation(account: string, action: StakingAction): HiveBroadcastRequest["operation"] {
  if (action.kind === "stake") return hiveEngine.stake(account, action.symbol, action.quantity, action.to);
  return hiveEngine.delegate(account, action.symbol, action.quantity, action.to);
}

function wrapOperation(account: string, action: WrapAction): HiveBroadcastRequest["operation"] {
  if (action.kind === "wrap") return hiveEngine.wrapHive(account, action.quantityHive);
  return hiveEngine.unwrapHive(account, action.quantityHive);
}

export function createHiveBroadcastCommand(options: HiveBroadcastCommandOptions): HiveWriteBoundary {
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 30_000);
  const keyRoot = options.keyRoot?.trim() ?? "";

  async function broadcast(payload: HiveBroadcastRequest): Promise<HiveWriteResult> {
    const command = options.command.trim();
    if (command === "") throw new Error("broadcast command is not configured");
    return await new Promise((resolve, reject) => {
      const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`broadcast command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(stderr.trim() || `broadcast command exited ${code ?? "without status"}`));
          return;
        }
        try {
          resolve(writeResult(JSON.parse(stdout) as unknown));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(`${JSON.stringify(payload)}\n`);
    });
  }

  const boundary: HiveWriteBoundary = Object.freeze({
    vote(wallet: WalletActor, vote: VotePlanItem) {
      return broadcast(request({ account: wallet.account, role: "posting", lane: "voting", target: `${vote.author}/${vote.permlink}`, operation: voteOperation(wallet.account, vote) }, keyRoot));
    },
    trade(wallet: WalletActor, trade: TradingPlan["trades"][number]) {
      return broadcast(request({ account: wallet.account, role: "active", lane: "trading", target: trade.pair, operation: tradeOperation(wallet.account, trade) }, keyRoot));
    },
    tradeBundle(wallet: WalletActor, bundle: TradingPlan["bundles"][number]) {
      return broadcast(request({ account: wallet.account, role: "active", lane: "trading", target: bundle.id, operation: tradeBundleOperation(wallet.account, bundle) }, keyRoot));
    },
    liquidity(wallet: WalletActor, entry: TradingPlan["lp"][number]) {
      return broadcast(request({ account: wallet.account, role: "active", lane: "trading", target: entry.pool, operation: liquidityOperation(wallet.account, entry) }, keyRoot));
    },
    savings(wallet: WalletActor, entry: NonNullable<TradingPlan["savings"]>) {
      return broadcast(request({ account: wallet.account, role: "active", lane: "trading", target: "HBD savings", operation: savingsOperation(wallet.account, entry) }, keyRoot));
    },
    incentive(wallet: WalletActor, offer: IncentiveOffer, action: Exclude<IncentiveActionKind, "comment" | "post" | "delegate">) {
      return broadcast(request({ account: wallet.account, role: "posting", lane: "incentive", target: offer.id, operation: incentiveOperation(wallet.account, offer, action) }, keyRoot));
    },
    stake(wallet: WalletActor, action: StakingAction) {
      return broadcast(request({ account: wallet.account, role: "active", lane: "trading", target: `${action.symbol}->${action.to}`, operation: stakeOperation(wallet.account, action) }, keyRoot));
    },
    wrap(wallet: WalletActor, action: WrapAction) {
      return broadcast(request({ account: wallet.account, role: "active", lane: "trading", target: `${action.kind}:${action.quantityHive}`, operation: wrapOperation(wallet.account, action) }, keyRoot));
    },
  });
  return boundary;
}
