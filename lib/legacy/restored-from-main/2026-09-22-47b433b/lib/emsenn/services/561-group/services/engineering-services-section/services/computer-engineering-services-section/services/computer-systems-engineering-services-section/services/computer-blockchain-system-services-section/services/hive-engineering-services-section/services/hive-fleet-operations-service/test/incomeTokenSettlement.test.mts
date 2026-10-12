import assert from "node:assert/strict";
import test from "node:test";

import {
  incomeTokenDistributionFromHistoryRow,
  readIncomeTokenDistributions,
  recordIncomeTokenDistributions,
  summarizeIncomeTokenPosition,
  type IncomeTokenDistribution,
  type IncomeTokenDistributionScan,
} from "../src/core/incomeTokenSettlement.mts";
import { parseOptions } from "../scripts/income-token-audit.mjs";

function historyRow(index: number, amount: string, holding: string, day: number) {
  return [index, { op: ["transfer", { from: "eds-pay", to: "emsenn0", amount, memo: `Dividends for holding ${holding} EDSI tokens.` }],
    block: 100_000 + index, op_in_trx: 0, trx_id: index.toString(16).padStart(40, "0"), timestamp: `2026-07-${String(day).padStart(2, "0")}T20:00:00` }];
}

function distribution(index: number, amount: string, holding: string, day: number): IncomeTokenDistribution {
  const parsed = incomeTokenDistributionFromHistoryRow(historyRow(index, amount, holding, day), "emsenn0", "eds-pay", "EDSI");
  assert.ok(parsed);
  return parsed;
}

function scan(): IncomeTokenDistributionScan {
  const distributions = Object.freeze([
    distribution(1, "0.221 HIVE", "88.000", 1),
    distribution(2, "0.223 HIVE", "88.500", 8),
    distribution(3, "0.224 HIVE", "89.000", 15),
    distribution(4, "0.225 HIVE", "89.568", 20),
  ]);
  return Object.freeze({ kind: "aagaard.income-token-distribution-scan", account: "emsenn0", payer: "eds-pay", symbol: "EDSI",
    requestedLimit: 1000, oldestHistoryIndex: 1, newestHistoryIndex: 4,
    evidenceProviders: Object.freeze(["https://one.example", "https://two.example"]), distributions });
}

test("strict distribution parsing admits exact native-HIVE income and fails closed for a mislabeled carrier", () => {
  const parsed = distribution(1, "0.224 HIVE", "89.568", 20);
  assert.equal(parsed.amount, "0.224 HIVE");
  assert.equal(parsed.reportedHolding, "89.568");
  assert.equal(incomeTokenDistributionFromHistoryRow([1, { op: ["vote", {}] }], "emsenn0", "eds-pay", "EDSI"), null);
  assert.throws(() => incomeTokenDistributionFromHistoryRow(historyRow(2, "0.224 SWAP.HIVE", "89.568", 20), "emsenn0", "eds-pay", "EDSI"), /malformed/);
});

test("position summary separates realized HIVE from the SWAP.HIVE exit sidecar", () => {
  const summary = summarizeIncomeTokenPosition({ scan: scan(), observedAt: "2026-07-22T00:00:00.000Z",
    exit: { status: "certified", valuation: { completeExit: true, grossDepthProceeds: "89.57450000", counterSymbol: "SWAP.HIVE" } } });
  assert.equal(summary.realized.scanTotal, "0.893 HIVE");
  assert.equal(summary.realized.yearToDate, "0.893 HIVE");
  assert.equal(summary.projection.annualizedNativeHive, "11.609000 HIVE");
  assert.equal(summary.comparison.yieldBps, null);
  assert.equal(summary.decision, "hold-productive-position-and-monitor");
});

test("distribution settlement projects deterministically and idempotently from the chain scan", async () => {
  const first = await recordIncomeTokenDistributions("/tmp/not-used", scan(), "2026-07-22T01:00:00.000Z");
  const second = await recordIncomeTokenDistributions("/tmp/not-used", scan(), "2026-07-22T01:01:00.000Z");
  assert.equal(first.length, 4);
  assert.deepEqual(first.map((event) => event.eventId), second.map((event) => event.eventId));
  assert.equal(first[0]?.realization.asset, "HIVE");
  assert.equal(first[0]?.valuation.swapHive, null);
  await assert.rejects(readIncomeTokenDistributions("/tmp/not-used", "emsenn0", "EDSI"), /local projections are retired/);
});

test("the audit CLI has no credential or arbitrary-token surface", () => {
  assert.deepEqual(parseOptions(["--account", "emsenn0", "--symbol", "edsi"]), { account: "emsenn0", symbol: "EDSI", record: false });
  assert.deepEqual(parseOptions(["--account", "emsenn0", "--symbol", "bro"]), { account: "emsenn0", symbol: "BRO", record: false });
  assert.throws(() => parseOptions(["--account", "emsenn0", "--symbol", "EDS"]), /admitted income token/);
  assert.throws(() => parseOptions(["--account", "emsenn0", "--symbol", "EDSI", "--key-file", "secret"]), /unknown argument/);
});

test("BRO dividends require the exact brodivs payer and BRO memo", () => {
  const row = [219288, { op: ["transfer", { from: "brodivs", to: "emsenn0", amount: "0.003 HIVE",
    memo: "Dividends for holding 2.02059643 BRO tokens." }], block: 100_000_000, op_in_trx: 0,
    trx_id: "b".repeat(40), timestamp: "2025-10-11T19:48:18" }];
  const parsed = incomeTokenDistributionFromHistoryRow(row, "emsenn0", "brodivs", "BRO");
  assert.equal(parsed?.reportedHolding, "2.02059643");
  assert.equal(parsed?.amount, "0.003 HIVE");
  assert.equal(incomeTokenDistributionFromHistoryRow(row, "emsenn0", "wrong-payer", "BRO"), null);
  assert.equal(incomeTokenDistributionFromHistoryRow([219288, { ...(row[1] as object),
    op: ["transfer", { from: "brodivs", to: "emsenn0", amount: "0.003 HIVE",
      memo: "Dividends for holding 2.02059643 SPI tokens." }] }], "emsenn0", "brodivs", "BRO"), null);
});
