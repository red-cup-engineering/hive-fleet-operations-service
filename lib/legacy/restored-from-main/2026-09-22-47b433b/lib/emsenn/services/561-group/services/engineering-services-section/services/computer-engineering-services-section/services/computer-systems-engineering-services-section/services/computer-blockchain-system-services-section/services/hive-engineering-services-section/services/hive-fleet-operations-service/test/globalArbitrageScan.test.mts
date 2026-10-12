import assert from "node:assert/strict";
import test from "node:test";

import { certifyGlobalArbitrageScan, discoverPoolToBookRoutes, type GlobalArbitrageState } from "../src/core/globalArbitrageScan.mts";

const state: GlobalArbitrageState = Object.freeze({
  account: "michael561", swapHiveBalance: "2.00000000", swapHivePrecision: 8, tokenPrecision: { GOLD: 3, FLAT: 3 },
  pools: [
    { pair: "SWAP.HIVE:GOLD", baseQuantity: "1000", quoteQuantity: "1000", feeBps: 25 },
    { pair: "FLAT:SWAP.HIVE", baseQuantity: "1000", quoteQuantity: "1000", feeBps: 25 },
  ],
  metrics: [{ symbol: "GOLD", highestBid: "1.02000000" }, { symbol: "FLAT", highestBid: "1.00100000" }],
  books: [{ symbol: "GOLD", bids: [{ priceSwapHivePerToken: "1.02000000", quantity: "10.000" }], complete: true, ordered: true, fleetBidPrices: [] }],
});

test("full-universe discovery exactly shortlists only gross edges above its proof threshold", () => {
  assert.deepEqual(discoverPoolToBookRoutes(state).map((row) => row.symbol), ["GOLD"]);
});

test("two providers certify and economically assay the same global route", () => {
  const report = certifyGlobalArbitrageScan({ observedAt: "2026-07-22T09:45:00Z", observations: [
    { provider: "one", status: "available", state }, { provider: "two", status: "available", state },
  ], minimumProfitSwapHive: "0.00000001" });
  assert.equal(report.status, "certified");
  if (report.status !== "certified") return;
  assert.equal(report.universe.swapHivePoolCount, 2);
  assert.equal(report.opportunities.length, 1);
  assert.equal(report.opportunities[0]?.exact.admitted, true);
  assert.equal(report.opportunities[0]?.policyAdmitted, true);
  assert.equal(report.executionAdmissible, false);
});

test("global scan refuses provider contradiction and fleet self-cross", () => {
  const contested = certifyGlobalArbitrageScan({ observedAt: "2026-07-22T09:45:00Z", observations: [
    { provider: "one", status: "available", state }, { provider: "two", status: "available", state: { ...state, swapHiveBalance: "1.00000000" } },
  ] });
  assert.equal(contested.status, "uncertified");
  const crossing = { ...state, books: [{ ...state.books[0]!, fleetBidPrices: ["1.02000000"] }] };
  const report = certifyGlobalArbitrageScan({ observedAt: "2026-07-22T09:45:00Z", observations: [
    { provider: "one", status: "available", state: crossing }, { provider: "two", status: "available", state: crossing },
  ], minimumProfitSwapHive: "0.00000001" });
  assert.equal(report.status, "certified");
  if (report.status === "certified") assert.equal(report.opportunities[0]?.policyAdmitted, false);
});
