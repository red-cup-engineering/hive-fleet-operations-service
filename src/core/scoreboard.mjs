import { claimsOf, recordClaim } from "./journal.mjs";
import { readCurationTelemetry } from "./curationSettlement.mjs";
export const SCOREBOARD_SCHEMA = "aagaard.scoreboard.v3";
function numOf(value, fallback = 0) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}
function tokenValueHbd(symbol, liquidity) {
    if (symbol === "HBD") return 1;
    if (symbol === "HIVE") return liquidity.venues.find((venue)=>venue.pair === "HIVE/HBD")?.midpoint ?? 0;
    if (symbol === "SWAP.HIVE") return 0;
    const pool = liquidity.pools.find((entry)=>entry.pair.startsWith(`${symbol}:`));
    return pool ? pool.impliedPrice * (liquidity.venues.find((venue)=>venue.pair === "HIVE/HBD")?.midpoint ?? 0) : 0;
}
export function valuePortfolioHbd(state, liquidity) {
    const hivePrice = tokenValueHbd("HIVE", liquidity);
    let total = numOf(state.hive) * hivePrice + numOf(state.hbd);
    for (const [symbol, amount] of Object.entries(state.tokens)){
        total += numOf(amount) * tokenValueHbd(symbol, liquidity);
    }
    return total;
}
const GENESIS_CATEGORY = "aagaard.scoreboard-genesis";
const TICK_CATEGORY = "aagaard.scoreboard-tick";
function readGenesis(dataDir, account) {
    return claimsOf(dataDir, GENESIS_CATEGORY).find((genesis)=>genesis.account === account) ?? null;
}
async function writeGenesisIfAbsent(dataDir, account, state, at) {
    const existing = readGenesis(dataDir, account);
    if (existing) return existing;
    const genesis = Object.freeze({
        account,
        at,
        hive: state.hive,
        hbd: state.hbd,
        tokens: state.tokens
    });
    recordClaim(dataDir, GENESIS_CATEGORY, at, genesis);
    return genesis;
}
export async function recordScoreboardTick(dataDir, account, state, liquidity, votingPlan, tradingPlan, tradingExecution, votesCast, at, observationComplete = true) {
    const genesis = readGenesis(dataDir, account) ?? (observationComplete ? await writeGenesisIfAbsent(dataDir, account, state, at) : null);
    const benchmarkValueHbd = observationComplete && genesis ? valuePortfolioHbd(genesis, liquidity) : null;
    const portfolioObservedBeforeExecutionHbd = observationComplete ? valuePortfolioHbd(state, liquidity) : null;
    const observedUnreconciledDeltaHbd = benchmarkValueHbd !== null && portfolioObservedBeforeExecutionHbd !== null ? portfolioObservedBeforeExecutionHbd - benchmarkValueHbd : null;
    const votingSignalScore = (votingPlan?.votes ?? []).reduce((sum, vote)=>sum + Number(vote.expectedCurationHbd ?? 0), 0);
    const topCycle = tradingPlan.arbitrageCycles[0];
    const unpricedSymbols = Object.entries(state.tokens).filter(([symbol, amount])=>numOf(amount) !== 0 && tokenValueHbd(symbol, liquidity) === 0).map(([symbol])=>symbol).sort();
    const expectedConfirmedBundles = tradingExecution?.bundlesExecuted ?? 0;
    // Capital is recognized only after both legs' chain effects agree.  The
    // net includes the explicitly priced signer/runner resource model; the
    // gross chain delta remains on the receipt for later ledger reconciliation.
    const provenBundleEffects = (tradingExecution?.receipts ?? []).filter((entry)=>entry.lane === "trading" && entry.action === "trade-bundle" && entry.economicEffect?.status === "confirmed" && typeof entry.economicEffect.modeledNetPnlSwapHive === "number" && Number.isFinite(entry.economicEffect.modeledNetPnlSwapHive));
    const tradePnlProven = expectedConfirmedBundles > 0 && provenBundleEffects.length === expectedConfirmedBundles;
    const realizedTradePnlSwapHive = tradePnlProven ? provenBundleEffects.reduce((sum, entry)=>sum + entry.economicEffect.modeledNetPnlSwapHive, 0) : null;
    const profitClaimGaps = Object.freeze([
        "external-cashflows-and-rewards-not-reconciled",
        ...!observationComplete ? [
            "portfolio-substrate-unavailable"
        ] : [],
        ...!tradePnlProven ? [
            "confirmed-fill-costs-fees-and-proceeds-not-joined"
        ] : [],
        ...tradePnlProven ? [
            "swap-hive-to-hbd-valuation-policy-missing"
        ] : [],
        "portfolio-observation-precedes-this-tick-execution",
        ...tradingExecution?.tradesExecuted === 0 || tradingExecution === null ? [
            "no-confirmed-trade-in-this-tick"
        ] : [],
        ...unpricedSymbols.length > 0 ? [
            `unpriced-held-symbols:${unpricedSymbols.join(",")}`
        ] : []
    ]);
    const entry = Object.freeze({
        scoreboardSchema: SCOREBOARD_SCHEMA,
        ts: at,
        account,
        benchmarkValueHbd: benchmarkValueHbd === null ? null : Number(benchmarkValueHbd.toFixed(6)),
        portfolioObservedBeforeExecutionHbd: portfolioObservedBeforeExecutionHbd === null ? null : Number(portfolioObservedBeforeExecutionHbd.toFixed(6)),
        observedUnreconciledDeltaHbd: observedUnreconciledDeltaHbd === null ? null : Number(observedUnreconciledDeltaHbd.toFixed(6)),
        observedUnreconciledDeltaBps: benchmarkValueHbd !== null && observedUnreconciledDeltaHbd !== null && benchmarkValueHbd > 0 ? Number((observedUnreconciledDeltaHbd / benchmarkValueHbd * 10_000).toFixed(3)) : null,
        cashFlowReconciliation: "missing",
        realizedTradePnlSwapHive: realizedTradePnlSwapHive === null ? null : Number(realizedTradePnlSwapHive.toFixed(8)),
        realizedTradePnlHbd: null,
        profitClaimStatus: tradePnlProven ? "chain-confirmed-trade-gross-with-priced-resource-net" : "unproven",
        profitClaimGaps,
        allocatorObjectiveSwapHive: Number(tradingPlan.allocation.totalBenefit.toFixed(8)),
        allocatorCostSwapHive: Number(tradingPlan.allocation.totalCost.toFixed(8)),
        allocatorObjectiveHbd: null,
        allocatorCostHbd: null,
        tradesPlanned: tradingPlan.trades.length + tradingPlan.bundles.filter((bundle)=>bundle.executable).length * 2,
        tradesFunded: tradingPlan.trades.filter((trade)=>trade.funded).length + tradingPlan.bundles.filter((bundle)=>bundle.funded).length * 2,
        tradesConfirmed: tradingExecution?.tradesExecuted ?? 0,
        bundlesPlanned: tradingPlan.bundles.filter((bundle)=>bundle.executable).length,
        bundlesFunded: tradingPlan.bundles.filter((bundle)=>bundle.funded).length,
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
            "alphaBps"
        ])
    });
    recordClaim(dataDir, TICK_CATEGORY, at, entry);
    return entry;
}
export function readScoreboardHistory(dataDir, account) {
    return Object.freeze(claimsOf(dataDir, TICK_CATEGORY).filter((entry)=>entry.account === account).sort((left, right)=>left.ts.localeCompare(right.ts)));
}
export function renderAccountReport(dataDir, account) {
    const genesis = readGenesis(dataDir, account);
    const history = readScoreboardHistory(dataDir, account);
    if (!genesis || history.length === 0) return `${account}: no scoreboard history yet -- run a tick first.`;
    const latest = history[history.length - 1];
    const curation = readCurationTelemetry(dataDir, account);
    const realizedTradePnlSwapHive = latest.realizedTradePnlSwapHive ?? null;
    const lines = [
        `${account}`,
        `  genesis:    ${genesis.at}  (${genesis.hive}, ${genesis.hbd}${Object.keys(genesis.tokens).length ? ", " + Object.entries(genesis.tokens).map(([s, a])=>`${a} ${s}`).join(", ") : ""})`,
        `  observations:${history.length} transient live readings`,
        latest.benchmarkValueHbd === null ? "  benchmark:  unavailable (portfolio substrate incomplete)" : `  benchmark:  ${latest.benchmarkValueHbd.toFixed(4)} HBD  (genesis holdings at observed prices)`,
        latest.portfolioObservedBeforeExecutionHbd === null ? "  portfolio:  unavailable (portfolio substrate incomplete)" : `  portfolio:  ${latest.portfolioObservedBeforeExecutionHbd.toFixed(4)} HBD  (current holdings before this tick's execution)`,
        latest.observedUnreconciledDeltaHbd === null ? "  raw delta:  unavailable (not zero)" : `  raw delta:  ${latest.observedUnreconciledDeltaHbd >= 0 ? "+" : ""}${latest.observedUnreconciledDeltaHbd.toFixed(4)} HBD  (not P/L; cash flows and rewards are unreconciled)`,
        realizedTradePnlSwapHive === null ? `  trade P/L:  unproven (${latest.profitClaimGaps.join("; ")})` : `  trade P/L:  ${realizedTradePnlSwapHive >= 0 ? "+" : ""}${realizedTradePnlSwapHive.toFixed(8)} SWAP.HIVE (complete confirmed round trips; HBD/USD valuation unproven)`,
        `  execution:  ${latest.tradesConfirmed}/${latest.tradesFunded}/${latest.tradesPlanned} confirmed/funded/planned; mode ${latest.executionMode}`,
        `  bundles:    ${latest.bundlesConfirmed ?? 0}/${latest.bundlesFunded ?? 0}/${latest.bundlesPlanned ?? 0} complete round trips confirmed/funded/planned`,
        `  allocator:  ${latest.allocatorObjectiveSwapHive.toFixed(8)} SWAP.HIVE objective on ${latest.allocatorCostSwapHive.toFixed(8)} SWAP.HIVE planned cost (research telemetry only)`,
        `  voting:     ${latest.votesCast}/${latest.votesPlanned} cast this tick; signal ${latest.votingSignalScore.toFixed(2)} proxy units`,
        `  curation:   ${curation?.realizedReward?.amount ?? "0.000000"} VESTS settled across ${curation?.settlementsObserved ?? 0} reward(s); ${curation?.settlementsMatchedToPredictions ?? 0} joined to predictions (VESTS prediction error and HBD value unavailable)`,
        `  arbitrage:  ${latest.arbitrageCyclesFound} cycle(s) observed${latest.topArbitrageCycle ? `; best: ${latest.topArbitrageCycle}` : ""}`
    ];
    return lines.join("\n");
}
export function renderFleetReport(dataDir, accounts) {
    return accounts.map((account)=>renderAccountReport(dataDir, account)).join("\n\n");
}
