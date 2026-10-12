import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { startRwilProviderProcess, type RunningRwilProvider } from "@emsenn/rwil-rdf-services/test-provider";

import {
  SCOREBOARD_SCHEMA,
  recordScoreboardTick,
  renderAccountReport,
  valuePortfolioHbd,
  type ScoreboardEntry,
} from "../src/core/scoreboard.mts";
import type {
  LiquidityReading,
  TradingExecution,
  TradingPlan,
  WalletChainState,
} from "../src/core/core.adapter.ts";

const account = "profit-witness";
let rwil: RunningRwilProvider;
const priorRwilAgent = process.env["RWIL_RDF_AGENT"];

test.before(async () => {
  rwil = await startRwilProviderProcess();
  process.env["RWIL_RDF_AGENT"] = rwil.agentCardUrl;
});

test.after(async () => {
  if (priorRwilAgent === undefined) delete process.env["RWIL_RDF_AGENT"];
  else process.env["RWIL_RDF_AGENT"] = priorRwilAgent;
  await rwil.close();
});

function state(hbd: string): WalletChainState {
  return Object.freeze({
    account,
    hive: "2.000 HIVE",
    hbd,
    currentMana: "10000",
    maxMana: "10000",
    tokens: Object.freeze({ DUST: "3.000" }),
  });
}

const liquidity = Object.freeze({
  kind: "aagaard.liquidity",
  venues: Object.freeze([Object.freeze({
    venue: "hive-internal",
    pair: "HIVE/HBD",
    midpoint: 0.5,
    bidDepth: 100,
    askDepth: 100,
    relativeSpreadBps: 20,
    imbalance: 0,
    thin: false,
  })]),
  pools: Object.freeze([]),
  corridors: Object.freeze([]),
  totalDepthProxy: 200,
  rigidity: Object.freeze({}),
  flow: Object.freeze([]),
  screening: Object.freeze([]),
}) as unknown as LiquidityReading;

const plan = Object.freeze({
  account,
  hive: "2.000 HIVE",
  hbd: "1.000 HBD",
  liveEligible: true,
  liquidity,
  trades: Object.freeze([Object.freeze({
    pair: "SWAP.HIVE/CENT",
    side: "buy",
    amount: 5,
    edgeBps: 200,
    reason: "fixture",
    funded: true,
    quantity: "1.00000000",
  })]),
  bundles: Object.freeze([]),
  lp: Object.freeze([]),
  savings: null,
  arbitrageCycles: Object.freeze([]),
  cycleCapacities: Object.freeze([]),
  allocation: Object.freeze({
    funded: Object.freeze(["0"]),
    totalCost: 5,
    totalBenefit: 0.1,
    consideredCount: 1,
    fundedCount: 1,
    choiceBits: 0,
    exact: true,
  }),
  arena: Object.freeze({}),
}) as unknown as TradingPlan;

const noExecution = Object.freeze({
  mode: "propose-only",
  tradesExecuted: 0,
  bundlesExecuted: 0,
  lpExecuted: 0,
  savingsExecuted: false,
  receipts: Object.freeze([]),
}) satisfies TradingExecution;

test("the scoreboard persists only typed RWIL observations and never invents P/L", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-scoreboard-v2-"));
  try {
    const entry = await recordScoreboardTick(root, account, state("1.000 HBD"), liquidity, null, plan, noExecution, 0, "2026-07-19T00:00:00.000Z");

    assert.equal(entry.scoreboardSchema, SCOREBOARD_SCHEMA);
    assert.equal(entry.realizedTradePnlHbd, null);
    assert.equal(entry.profitClaimStatus, "unproven");
    assert.equal(entry.tradesConfirmed, 0);
    assert.equal(entry.allocatorObjectiveSwapHive, 0.1);
    assert.equal(entry.allocatorObjectiveHbd, null);
    assert.equal(entry.observedUnreconciledDeltaHbd, 0);
    assert.equal("cumulativeTradeYieldHbd" in entry, false);
    assert.equal("alphaHbd" in entry, false);
    assert.ok(entry.profitClaimGaps.includes("no-confirmed-trade-in-this-tick"));
    assert.ok(entry.profitClaimGaps.includes("unpriced-held-symbols:DUST"));

    const report = renderAccountReport(root, account);
    assert.match(report, /1 typed RWIL/);
    assert.match(report, /P\/L:\s+unproven/);
    assert.doesNotMatch(report, /beat the market/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SWAP.HIVE holdings are not silently marked at native HIVE's midpoint", () => {
  const marked = valuePortfolioHbd({ hive: "2.000 HIVE", hbd: "1.000 HBD", tokens: { "SWAP.HIVE": "10.000" } }, liquidity);
  assert.equal(marked, 2);
});

test("an unavailable portfolio observation is null and cannot establish genesis", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-scoreboard-unavailable-"));
  try {
    const entry = await recordScoreboardTick(root, account, state("0.000 HBD"), liquidity, null, plan, noExecution, 0, "2026-07-19T00:00:00.000Z", false);
    assert.equal(entry.benchmarkValueHbd, null);
    assert.equal(entry.portfolioObservedBeforeExecutionHbd, null);
    assert.equal(entry.observedUnreconciledDeltaHbd, null);
    assert.ok(entry.profitClaimGaps.includes("portfolio-substrate-unavailable"));
    assert.match(renderAccountReport(root, account), /no scoreboard history/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an observed portfolio increase remains unreconciled rather than becoming profit", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-scoreboard-cashflow-"));
  try {
    await recordScoreboardTick(root, account, state("1.000 HBD"), liquidity, null, plan, noExecution, 0, "2026-07-19T00:00:00.000Z");
    const entry: ScoreboardEntry = await recordScoreboardTick(root, account, state("4.000 HBD"), liquidity, null, plan, noExecution, 0, "2026-07-19T00:01:00.000Z");

    assert.equal(entry.observedUnreconciledDeltaHbd, 3);
    assert.equal(entry.realizedTradePnlHbd, null);
    assert.equal(entry.cashFlowReconciliation, "missing");
    assert.equal(entry.profitClaimStatus, "unproven");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a complete economically confirmed bundle records realized trade P/L", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "aagaard-scoreboard-confirmed-"));
  try {
    const bundlePlan = Object.freeze({
      ...plan,
      trades: Object.freeze([]),
      bundles: Object.freeze([Object.freeze({ funded: true })]),
    }) as unknown as TradingPlan;
    const confirmedExecution = Object.freeze({
      mode: "live",
      tradesExecuted: 2,
      bundlesExecuted: 1,
      lpExecuted: 0,
      savingsExecuted: false,
      receipts: Object.freeze([Object.freeze({
        lane: "trading",
        action: "trade-bundle",
        target: "LEN:pool-to-book",
        status: "broadcast",
        role: "active",
        txId: "outer",
        economicEffect: Object.freeze({
          status: "confirmed",
          source: "hive-engine.getTransactionInfo",
          confirmedLegs: 2,
          expectedLegs: 2,
          realizedInputSwapHive: 1,
          realizedProceedsSwapHive: 1.1,
          realizedPnlSwapHive: 0.1,
        }),
      })]),
    }) satisfies TradingExecution;

    const entry = await recordScoreboardTick(root, account, state("1.000 HBD"), liquidity, null, bundlePlan, confirmedExecution, 0, "2026-07-19T00:00:00.000Z");

    assert.equal(entry.realizedTradePnlSwapHive, 0.1);
    assert.equal(entry.realizedTradePnlHbd, null);
    assert.equal(entry.profitClaimStatus, "realized-trade-pnl-swap-hive-proven");
    assert.equal(entry.bundlesConfirmed, 1);
    assert.ok(!entry.profitClaimGaps.includes("confirmed-fill-costs-fees-and-proceeds-not-joined"));
    assert.ok(entry.profitClaimGaps.includes("swap-hive-to-hbd-valuation-policy-missing"));
    assert.match(renderAccountReport(root, account), /trade P\/L:\s+\+0\.10000000 SWAP\.HIVE/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
