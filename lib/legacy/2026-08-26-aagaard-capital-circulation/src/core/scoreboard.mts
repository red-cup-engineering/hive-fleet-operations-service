// core/scoreboard — what has Aagaard actually observed, and what remains a plan?
//
// The original scoreboard accumulated `edgeBps * planned amount` on every
// proposed trade and exposed that sum as `cumulativeTradeYieldHbd`,
// `strategyValueHbd`, and `alphaHbd`. No trade needed to execute for those
// numbers to rise. The preserved v1 ledger is therefore a shadow-opportunity
// trace, not P/L evidence.
//
// v3 refuses that category error and the later v2 error of silently
// valuing SWAP.HIVE as native HIVE:
//
//   benchmark = genesis holdings marked at this tick's observed prices
//   observed  = current on-chain holdings marked at those same prices
//   delta     = observed - benchmark, explicitly unreconciled for deposits,
//               withdrawals, rewards, fees, and other non-trade flows
//   realized trade P/L = the net SWAP.HIVE effect of a complete confirmed
//                        round trip. HBD P/L remains null until a separately
//                        evidenced SWAP.HIVE valuation relation is admitted.
//
// The allocator's objective remains visible as research telemetry, but never
// compounds and is never named yield, alpha, profit, or strategy value.

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

import type { LiquidityReading, VotingPlan, TradingPlan, TradingExecution, WalletChainState } from "./core.adapter.ts";
import { readCurationTelemetry } from "./curationSettlement.mts";

export const SCOREBOARD_SCHEMA = "aagaard.scoreboard.v3" as const;

function numOf(value: string, fallback = 0): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function tokenValueHbd(symbol: string, liquidity: LiquidityReading): number {
  if (symbol === "HBD") return 1;
  if (symbol === "HIVE") return liquidity.venues.find((venue) => venue.pair === "HIVE/HBD")?.midpoint ?? 0;
  if (symbol === "SWAP.HIVE") return 0;
  const pool = liquidity.pools.find((entry) => entry.pair.startsWith(`${symbol}:`));
  return pool ? pool.impliedPrice * (liquidity.venues.find((venue) => venue.pair === "HIVE/HBD")?.midpoint ?? 0) : 0;
}

/** Mark a chain state's full holdings (HIVE, HBD, every held token) to
 * current observed prices, in HBD. Missing token prices contribute zero to
 * this mark and remain an explicit reconciliation gap in every v2 entry. */
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
  readonly scoreboardSchema: typeof SCOREBOARD_SCHEMA;
  readonly ts: string;
  readonly account: string;
  /** Genesis holdings marked to this tick's prices: buy-and-hold comparator. */
  readonly benchmarkValueHbd: number | null;
  /** Current holdings read before this tick's execution, marked to the same prices. */
  readonly portfolioObservedBeforeExecutionHbd: number | null;
  /** Observed minus benchmark. This is not attributed P/L. */
  readonly observedUnreconciledDeltaHbd: number | null;
  readonly observedUnreconciledDeltaBps: number | null;
  readonly cashFlowReconciliation: "missing";
  /** Absent on preserved early-v2 rows written before sidechain confirmation. */
  readonly realizedTradePnlSwapHive?: number | null;
  readonly realizedTradePnlHbd: null;
  readonly profitClaimStatus: "realized-trade-pnl-swap-hive-proven" | "unproven";
  readonly profitClaimGaps: readonly string[];
  /** The allocator's within-tick mathematical objective for funded plans.
   * It is opportunity telemetry, not a prediction or realized return. */
  readonly allocatorObjectiveSwapHive: number;
  readonly allocatorCostSwapHive: number;
  readonly allocatorObjectiveHbd: null;
  readonly allocatorCostHbd: null;
  readonly tradesPlanned: number;
  readonly tradesFunded: number;
  readonly tradesConfirmed: number;
  readonly bundlesPlanned?: number;
  readonly bundlesFunded?: number;
  readonly bundlesConfirmed?: number;
  readonly executionMode: TradingExecution["mode"] | "not-run";
  readonly votesPlanned: number;
  readonly votesCast: number;
  /** Raw voting signal proxy; never converted to money. */
  readonly votingSignalScore: number;
  readonly arbitrageCyclesFound: number;
  readonly topArbitrageCycle: string | null;
  readonly supersedesMetricSemantics: readonly [
    "tickTradeYieldHbd",
    "cumulativeTradeYieldHbd",
    "strategyValueHbd",
    "alphaHbd",
    "alphaBps",
  ];
}

export type ScoreboardHistoryEntry = ScoreboardEntry;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
const GENESIS_CATEGORY = "aagaard.scoreboard-genesis";
const SCOREBOARD_CATEGORY = "aagaard.scoreboard-observation";

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

function readGenesis(dataDir: string, account: string): GenesisSnapshot | null {
  return (querySettlementRecords(GENESIS_CATEGORY) as readonly GenesisSnapshot[]).find((entry) => entry.account === account) ?? null;
}

async function writeGenesisIfAbsent(dataDir: string, account: string, state: WalletChainState, at: string): Promise<GenesisSnapshot> {
  const existing = readGenesis(dataDir, account);
  if (existing) return existing;
  const genesis: GenesisSnapshot = Object.freeze({ account, at, hive: state.hive, hbd: state.hbd, tokens: state.tokens });
  await recordSettlementRecord({ agentUrl: rwilAgent(), settlement: AAGAARD_SETTLEMENT, actor: AAGAARD_ACTOR, category: GENESIS_CATEGORY, recordedAt: at, record: genesis });
  return genesis;
}

/** Record one truthful observation. The old hypothetical accumulator is not
 * read or carried forward: v1 rows remain the bad-incumbent witness, while
 * v3 begins a new metric semantics at the first unit-safe tick. */
export async function recordScoreboardTick(
  dataDir: string,
  account: string,
  state: WalletChainState,
  liquidity: LiquidityReading,
  votingPlan: VotingPlan | null,
  tradingPlan: TradingPlan,
  tradingExecution: TradingExecution | null,
  votesCast: number,
  at: string,
  observationComplete = true,
): Promise<ScoreboardEntry> {
  const genesis = readGenesis(dataDir, account) ?? (observationComplete ? await writeGenesisIfAbsent(dataDir, account, state, at) : null);
  const benchmarkValueHbd = observationComplete && genesis ? valuePortfolioHbd(genesis, liquidity) : null;
  const portfolioObservedBeforeExecutionHbd = observationComplete ? valuePortfolioHbd(state, liquidity) : null;
  const observedUnreconciledDeltaHbd = benchmarkValueHbd !== null && portfolioObservedBeforeExecutionHbd !== null
    ? portfolioObservedBeforeExecutionHbd - benchmarkValueHbd
    : null;
  const votingSignalScore = (votingPlan?.votes ?? []).reduce((sum, vote) => sum + vote.strategyAlpha, 0);
  const topCycle = tradingPlan.arbitrageCycles[0];
  const unpricedSymbols = Object.entries(state.tokens)
    .filter(([symbol, amount]) => numOf(amount) !== 0 && tokenValueHbd(symbol, liquidity) === 0)
    .map(([symbol]) => symbol)
    .sort();
  const expectedConfirmedBundles = tradingExecution?.bundlesExecuted ?? 0;
  const provenBundleEffects = (tradingExecution?.receipts ?? []).filter((entry) => entry.lane === "trading"
    && entry.action === "trade-bundle"
    && entry.economicEffect?.status === "confirmed"
    && typeof entry.economicEffect.realizedPnlSwapHive === "number"
    && Number.isFinite(entry.economicEffect.realizedPnlSwapHive));
  const tradePnlProven = expectedConfirmedBundles > 0 && provenBundleEffects.length === expectedConfirmedBundles;
  const realizedTradePnlSwapHive = tradePnlProven
    ? provenBundleEffects.reduce((sum, entry) => sum + entry.economicEffect!.realizedPnlSwapHive!, 0)
    : null;
  const profitClaimGaps = Object.freeze([
    "external-cashflows-and-rewards-not-reconciled",
    ...(!observationComplete ? ["portfolio-substrate-unavailable"] : []),
    ...(!tradePnlProven ? ["confirmed-fill-costs-fees-and-proceeds-not-joined"] : []),
    ...(tradePnlProven ? ["swap-hive-to-hbd-valuation-policy-missing"] : []),
    "portfolio-observation-precedes-this-tick-execution",
    ...(tradingExecution?.tradesExecuted === 0 || tradingExecution === null ? ["no-confirmed-trade-in-this-tick"] : []),
    ...(unpricedSymbols.length > 0 ? [`unpriced-held-symbols:${unpricedSymbols.join(",")}`] : []),
  ]);

  const entry: ScoreboardEntry = Object.freeze({
    scoreboardSchema: SCOREBOARD_SCHEMA,
    ts: at,
    account,
    benchmarkValueHbd: benchmarkValueHbd === null ? null : Number(benchmarkValueHbd.toFixed(6)),
    portfolioObservedBeforeExecutionHbd: portfolioObservedBeforeExecutionHbd === null ? null : Number(portfolioObservedBeforeExecutionHbd.toFixed(6)),
    observedUnreconciledDeltaHbd: observedUnreconciledDeltaHbd === null ? null : Number(observedUnreconciledDeltaHbd.toFixed(6)),
    observedUnreconciledDeltaBps: benchmarkValueHbd !== null && observedUnreconciledDeltaHbd !== null && benchmarkValueHbd > 0
      ? Number(((observedUnreconciledDeltaHbd / benchmarkValueHbd) * 10_000).toFixed(3))
      : null,
    cashFlowReconciliation: "missing",
    realizedTradePnlSwapHive: realizedTradePnlSwapHive === null ? null : Number(realizedTradePnlSwapHive.toFixed(8)),
    realizedTradePnlHbd: null,
    profitClaimStatus: tradePnlProven ? "realized-trade-pnl-swap-hive-proven" : "unproven",
    profitClaimGaps,
    allocatorObjectiveSwapHive: Number(tradingPlan.allocation.totalBenefit.toFixed(8)),
    allocatorCostSwapHive: Number(tradingPlan.allocation.totalCost.toFixed(8)),
    allocatorObjectiveHbd: null,
    allocatorCostHbd: null,
    tradesPlanned: tradingPlan.trades.length + tradingPlan.bundles.filter((bundle) => bundle.executable).length * 2,
    tradesFunded: tradingPlan.trades.filter((trade) => trade.funded).length + tradingPlan.bundles.filter((bundle) => bundle.funded).length * 2,
    tradesConfirmed: tradingExecution?.tradesExecuted ?? 0,
    bundlesPlanned: tradingPlan.bundles.filter((bundle) => bundle.executable).length,
    bundlesFunded: tradingPlan.bundles.filter((bundle) => bundle.funded).length,
    bundlesConfirmed: tradingExecution?.bundlesExecuted ?? 0,
    executionMode: tradingExecution?.mode ?? "not-run",
    votesPlanned: votingPlan?.votes.length ?? 0,
    votesCast,
    votingSignalScore: Number(votingSignalScore.toFixed(3)),
    arbitrageCyclesFound: tradingPlan.arbitrageCycles.length,
    topArbitrageCycle: topCycle ? `${topCycle.path.join("->")} (${topCycle.netHolonomyBps.toFixed(1)}bps net)` : null,
    supersedesMetricSemantics: Object.freeze([
      "tickTradeYieldHbd",
      "cumulativeTradeYieldHbd",
      "strategyValueHbd",
      "alphaHbd",
      "alphaBps",
    ]) as ScoreboardEntry["supersedesMetricSemantics"],
  });

  await recordSettlementRecord({ agentUrl: rwilAgent(), settlement: AAGAARD_SETTLEMENT, actor: AAGAARD_ACTOR, category: SCOREBOARD_CATEGORY, recordedAt: at, record: entry });
  return entry;
}

export function readScoreboardHistory(dataDir: string, account: string): readonly ScoreboardHistoryEntry[] {
  return Object.freeze((querySettlementRecords(SCOREBOARD_CATEGORY) as readonly ScoreboardEntry[])
    .filter((entry) => entry.account === account)
    .sort((left, right) => left.ts.localeCompare(right.ts)));
}

export function renderAccountReport(dataDir: string, account: string): string {
  const genesis = readGenesis(dataDir, account);
  const history = readScoreboardHistory(dataDir, account);
  if (!genesis || history.length === 0) return `${account}: no scoreboard history yet -- run a tick first.`;
  const latest = history[history.length - 1]!;
  const curation = readCurationTelemetry(dataDir, account);
  const realizedTradePnlSwapHive = latest.realizedTradePnlSwapHive ?? null;
  const lines = [
    `${account}`,
    `  genesis:    ${genesis.at}  (${genesis.hive}, ${genesis.hbd}${Object.keys(genesis.tokens).length ? ", " + Object.entries(genesis.tokens).map(([s, a]) => `${a} ${s}`).join(", ") : ""})`,
    `  observations:${history.length} typed RWIL`,
    latest.benchmarkValueHbd === null
      ? "  benchmark:  unavailable (portfolio substrate incomplete)"
      : `  benchmark:  ${latest.benchmarkValueHbd.toFixed(4)} HBD  (genesis holdings at observed prices)`,
    latest.portfolioObservedBeforeExecutionHbd === null
      ? "  portfolio:  unavailable (portfolio substrate incomplete)"
      : `  portfolio:  ${latest.portfolioObservedBeforeExecutionHbd.toFixed(4)} HBD  (current holdings before this tick's execution)`,
    latest.observedUnreconciledDeltaHbd === null
      ? "  raw delta:  unavailable (not zero)"
      : `  raw delta:  ${latest.observedUnreconciledDeltaHbd >= 0 ? "+" : ""}${latest.observedUnreconciledDeltaHbd.toFixed(4)} HBD  (not P/L; cash flows and rewards are unreconciled)`,
    realizedTradePnlSwapHive === null
      ? `  trade P/L:  unproven (${latest.profitClaimGaps.join("; ")})`
      : `  trade P/L:  ${realizedTradePnlSwapHive >= 0 ? "+" : ""}${realizedTradePnlSwapHive.toFixed(8)} SWAP.HIVE (complete confirmed round trips; HBD/USD valuation unproven)`,
    `  execution:  ${latest.tradesConfirmed}/${latest.tradesFunded}/${latest.tradesPlanned} confirmed/funded/planned; mode ${latest.executionMode}`,
    `  bundles:    ${latest.bundlesConfirmed ?? 0}/${latest.bundlesFunded ?? 0}/${latest.bundlesPlanned ?? 0} complete round trips confirmed/funded/planned`,
    `  allocator:  ${latest.allocatorObjectiveSwapHive.toFixed(8)} SWAP.HIVE objective on ${latest.allocatorCostSwapHive.toFixed(8)} SWAP.HIVE planned cost (research telemetry only)`,
    `  voting:     ${latest.votesCast}/${latest.votesPlanned} cast this tick; signal ${latest.votingSignalScore.toFixed(2)} proxy units`,
    `  curation:   ${curation.realizedReward.amount} VESTS settled across ${curation.settlementsObserved} reward(s); ${curation.settlementsMatchedToPredictions} joined to predictions (VESTS prediction error and HBD value unavailable)`,
    `  arbitrage:  ${latest.arbitrageCyclesFound} cycle(s) observed${latest.topArbitrageCycle ? `; best: ${latest.topArbitrageCycle}` : ""}`,
  ];
  return lines.join("\n");
}

export function renderFleetReport(dataDir: string, accounts: readonly string[]): string {
  return accounts.map((account) => renderAccountReport(dataDir, account)).join("\n\n");
}
