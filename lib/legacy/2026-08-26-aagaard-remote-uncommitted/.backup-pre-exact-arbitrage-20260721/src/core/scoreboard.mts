// core/scoreboard — did the strategy beat just holding?
//
// Real broadcast isn't configured (no posting/active keys under keyRoot), so
// every vote and trade runs dry-run: nothing on-chain actually changes. That
// makes "beat the market" ambiguous unless the comparison is stated
// precisely, so this module states it precisely:
//
//   benchmark(t)  = the account's REAL holdings at genesis, marked to CURRENT
//                   real prices at tick t — pure buy-and-hold, no strategy.
//   strategy(t)   = benchmark(t) + the running sum of every tick's
//                   hypothetical trade yield (edgeBps x amount on every trade
//                   this tick actually proposed) — what the strategy WOULD
//                   have made if every proposed trade had executed.
//   alpha(t)      = strategy(t) - benchmark(t), i.e. exactly the cumulative
//                   hypothetical trade yield.
//
// Voting is tracked separately as a raw alpha-score signal (the sum of each
// cast vote's strategyAlpha), never folded into the HBD figures: curation
// reward genuinely earned depends on the total reward pool and every other
// voter's stake, which this app does not model, and a fabricated HBD
// conversion would be false precision dressed as an answer.
//
// Genesis is captured once per account, the first tick this module ever
// records one for, and never moved — the whole point is a fixed starting
// line, not a rolling one that quietly resets the benchmark each day.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

import type { LiquidityReading, VotingPlan, TradingPlan, WalletChainState } from "./core.adapter.ts";

function numOf(value: string, fallback = 0): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function tokenValueHbd(symbol: string, liquidity: LiquidityReading): number {
  if (symbol === "HBD") return 1;
  if (symbol === "HIVE" || symbol === "SWAP.HIVE") return liquidity.venues[0]?.midpoint ?? 0;
  const pool = liquidity.pools.find((entry) => entry.pair.startsWith(`${symbol}:`));
  return pool ? pool.impliedPrice * (liquidity.venues[0]?.midpoint ?? 0) : 0;
}

/** Mark a chain state's full holdings (HIVE, HBD, every held token) to
 *  current prices, in HBD. */
export function valuePortfolioHbd(state: Pick<WalletChainState, "hive" | "hbd" | "tokens">, liquidity: LiquidityReading): number {
  const hivePrice = tokenValueHbd("HIVE", liquidity);
  let total = numOf(state.hive) * hivePrice + numOf(state.hbd);
  for (const [symbol, amount] of Object.entries(state.tokens)) {
    total += numOf(amount) * tokenValueHbd(symbol, liquidity);
  }
  return total;
}

export interface GenesisSnapshot {
  readonly account: string;
  readonly at: string;
  readonly hive: string;
  readonly hbd: string;
  readonly tokens: Readonly<Record<string, string>>;
}

export interface ScoreboardEntry {
  readonly ts: string;
  readonly account: string;
  /** Genesis holdings marked to today's prices: buy-and-hold, no strategy. */
  readonly benchmarkValueHbd: number;
  /** This tick's hypothetical trade yield: sum over every proposed trade of
   *  edgeBps/10000 x amount — what this tick's proposed trades would have
   *  captured had they actually broadcast. */
  readonly tickTradeYieldHbd: number;
  /** Running sum of every tick's hypothetical trade yield since genesis. */
  readonly cumulativeTradeYieldHbd: number;
  /** strategy(t) = benchmarkValueHbd + cumulativeTradeYieldHbd. */
  readonly strategyValueHbd: number;
  /** Exactly cumulativeTradeYieldHbd, named for what it answers. */
  readonly alphaHbd: number;
  readonly alphaBps: number;
  readonly votesPlanned: number;
  readonly votesCast: number;
  /** Sum of strategyAlpha across every cast vote this tick — a raw proxy
   *  score, never converted to HBD (see module header). */
  readonly votingSignalScore: number;
  readonly tradesPlanned: number;
  readonly arbitrageCyclesFound: number;
  readonly topArbitrageCycle: string | null;
}

function genesisPath(scoreboardDir: string, account: string): string {
  return path.join(scoreboardDir, `${account}-genesis.json`);
}

function ledgerPath(scoreboardDir: string, account: string): string {
  return path.join(scoreboardDir, `${account}-scoreboard.jsonl`);
}

function readGenesis(scoreboardDir: string, account: string): GenesisSnapshot | null {
  const file = genesisPath(scoreboardDir, account);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as GenesisSnapshot) : null;
}

function writeGenesisIfAbsent(scoreboardDir: string, account: string, state: WalletChainState, at: string): GenesisSnapshot {
  const existing = readGenesis(scoreboardDir, account);
  if (existing) return existing;
  const genesis: GenesisSnapshot = Object.freeze({ account, at, hive: state.hive, hbd: state.hbd, tokens: state.tokens });
  mkdirSync(scoreboardDir, { recursive: true });
  writeFileSync(genesisPath(scoreboardDir, account), `${JSON.stringify(genesis, null, 2)}\n`);
  return genesis;
}

function readCumulativeYield(scoreboardDir: string, account: string): number {
  const file = ledgerPath(scoreboardDir, account);
  if (!existsSync(file)) return 0;
  const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return 0;
  const last = JSON.parse(lines[lines.length - 1]!) as ScoreboardEntry;
  return last.cumulativeTradeYieldHbd;
}

/** Record one tick's scoreboard entry for one account: establishes genesis
 *  on first call, then measures benchmark vs strategy at every subsequent
 *  tick against real current prices. */
export function recordScoreboardTick(
  scoreboardDir: string,
  account: string,
  state: WalletChainState,
  liquidity: LiquidityReading,
  votingPlan: VotingPlan | null,
  tradingPlan: TradingPlan,
  votesCast: number,
  at: string,
): ScoreboardEntry {
  const genesis = writeGenesisIfAbsent(scoreboardDir, account, state, at);
  const benchmarkValueHbd = valuePortfolioHbd(genesis, liquidity);
  const tickTradeYieldHbd = tradingPlan.trades.reduce((sum, trade) => sum + trade.amount * (trade.edgeBps / 10_000), 0);
  const cumulativeTradeYieldHbd = readCumulativeYield(scoreboardDir, account) + tickTradeYieldHbd;
  const strategyValueHbd = benchmarkValueHbd + cumulativeTradeYieldHbd;
  const alphaHbd = cumulativeTradeYieldHbd;
  const votingSignalScore = (votingPlan?.votes ?? []).reduce((sum, vote) => sum + vote.strategyAlpha, 0);
  const topCycle = tradingPlan.arbitrageCycles[0];

  const entry: ScoreboardEntry = Object.freeze({
    ts: at,
    account,
    benchmarkValueHbd: Number(benchmarkValueHbd.toFixed(6)),
    tickTradeYieldHbd: Number(tickTradeYieldHbd.toFixed(6)),
    cumulativeTradeYieldHbd: Number(cumulativeTradeYieldHbd.toFixed(6)),
    strategyValueHbd: Number(strategyValueHbd.toFixed(6)),
    alphaHbd: Number(alphaHbd.toFixed(6)),
    alphaBps: benchmarkValueHbd > 0 ? Number(((alphaHbd / benchmarkValueHbd) * 10_000).toFixed(3)) : 0,
    votesPlanned: votingPlan?.votes.length ?? 0,
    votesCast,
    votingSignalScore: Number(votingSignalScore.toFixed(3)),
    tradesPlanned: tradingPlan.trades.length,
    arbitrageCyclesFound: tradingPlan.arbitrageCycles.length,
    topArbitrageCycle: topCycle ? `${topCycle.path.join("->")} (${topCycle.netHolonomyBps.toFixed(1)}bps net)` : null,
  });

  mkdirSync(scoreboardDir, { recursive: true });
  appendFileSync(ledgerPath(scoreboardDir, account), `${JSON.stringify(entry)}\n`);
  return entry;
}

export function readScoreboardHistory(scoreboardDir: string, account: string): readonly ScoreboardEntry[] {
  const file = ledgerPath(scoreboardDir, account);
  if (!existsSync(file)) return Object.freeze([]);
  return Object.freeze(
    readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as ScoreboardEntry),
  );
}

/** A human-readable report for one account: genesis, latest standing, and
 *  the trajectory of alpha over every recorded tick. */
export function renderAccountReport(scoreboardDir: string, account: string): string {
  const genesis = readGenesis(scoreboardDir, account);
  const history = readScoreboardHistory(scoreboardDir, account);
  if (!genesis || history.length === 0) {
    return `${account}: no scoreboard history yet -- run a tick first.`;
  }
  const latest = history[history.length - 1]!;
  const first = history[0]!;
  const lines = [
    `${account}`,
    `  genesis:    ${genesis.at}  (${genesis.hive}, ${genesis.hbd}${Object.keys(genesis.tokens).length ? ", " + Object.entries(genesis.tokens).map(([s, a]) => `${a} ${s}`).join(", ") : ""})`,
    `  ticks:      ${history.length}  (first ${first.ts}, latest ${latest.ts})`,
    `  benchmark:  ${latest.benchmarkValueHbd.toFixed(4)} HBD  (genesis holdings at today's prices -- buy and hold)`,
    `  strategy:   ${latest.strategyValueHbd.toFixed(4)} HBD  (benchmark + hypothetical trade yield)`,
    `  alpha:      ${latest.alphaHbd >= 0 ? "+" : ""}${latest.alphaHbd.toFixed(4)} HBD  (${latest.alphaBps >= 0 ? "+" : ""}${latest.alphaBps.toFixed(1)} bps vs benchmark)`,
    `  verdict:    ${latest.alphaHbd > 0 ? "beat the market (hypothetically -- no real broadcast is configured)" : latest.alphaHbd < 0 ? "trailed the market" : "flat -- no trades proposed yet"}`,
    `  voting:     ${latest.votesCast}/${latest.votesPlanned} cast this tick, cumulative signal score ${history.reduce((s, e) => s + e.votingSignalScore, 0).toFixed(2)} (proxy units, not HBD)`,
    `  arbitrage:  ${latest.arbitrageCyclesFound} cycle(s) found this tick${latest.topArbitrageCycle ? `; best: ${latest.topArbitrageCycle}` : ""}`,
  ];
  return lines.join("\n");
}

export function renderFleetReport(scoreboardDir: string, accounts: readonly string[]): string {
  return accounts.map((account) => renderAccountReport(scoreboardDir, account)).join("\n\n");
}
