import assert from "node:assert/strict";
import test from "node:test";

import { operate, roundTripRequest, selectOpportunity, sellLegRequest, swapLegRequest } from "../scripts/automatic-arbitrage-cycle.mjs";

const opportunity = { symbol: "SHARD", pool: "SWAP.HIVE:SHARD", policyAdmitted: true,
  exact: { admitted: true, quote: { quantity: "400.00", maxInputSwapHive: "0.12748943",
    limitSellPriceSwapHive: "0.00032200", worstCaseProfitSwapHive: "0.00131057" } } };
const scan = { status: "certified", account: "sigmund-vexler", providerKnowledge: { value: "true" },
  observedAt: "2026-07-26T00:00:00.000Z", admittedCount: 1, certifyingProviders: ["a", "b"], opportunities: [opportunity] };

test("only Sigmund's certified policy-admitted route is selected", () => {
  assert.equal(selectOpportunity(scan)?.symbol, "SHARD");
  assert.equal(selectOpportunity({ ...scan, account: "michael561" }), null);
  assert.equal(selectOpportunity({ ...scan, providerKnowledge: { value: "both" } }), null);
});

test("the automatic cycle emits the exact bounded round-trip envelope", () => {
  const request = roundTripRequest(opportunity, "/opaque/active.wif");
  assert.equal(request.account, "sigmund-vexler");
  const calls = JSON.parse(request.operation[1].json);
  assert.equal(calls[0].contractPayload.maxAmountIn, "0.12748943");
  assert.equal(calls[1].contractPayload.price, "0.00032200");
  assert.equal(calls[1].contractPayload.expiration, 300);
});

test("Michael's autonomous lane cannot use Sigmund's authority", () => {
  const request = roundTripRequest(opportunity, "cold-red-gate:michael561/active", "michael561");
  assert.equal(request.account, "michael561");
  assert.deepEqual(request.operation[1].required_auths, ["michael561"]);
});

test("the swap leg request carries the round trip's own worst-case profit context, never bundled with the sell", () => {
  const request = swapLegRequest(opportunity, "cold-red-gate:sigmund-vexler/active", "sigmund-vexler", "0.00020000");
  assert.equal(request.leg, "swap");
  assert.equal(request.pricedOverheadSwapHive, "0.00020000");
  assert.equal(request.pairedSellPriceSwapHive, "0.00032200");
  const calls = JSON.parse(request.operation[1].json);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contractAction, "swapTokens");
  assert.equal(calls[0].contractPayload.maxAmountIn, "0.12748943");
});

test("the sell leg request carries leg one's committed cost so the signer can re-gate before realizing proceeds", () => {
  const request = sellLegRequest(opportunity, "cold-red-gate:sigmund-vexler/active", "sigmund-vexler", "0.00020000");
  assert.equal(request.leg, "sell");
  assert.equal(request.pricedOverheadSwapHive, "0.00020000");
  assert.equal(request.pairedSwapMaxAmountInSwapHive, "0.12748943");
  const calls = JSON.parse(request.operation[1].json);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].contractAction, "sell");
  assert.equal(calls[0].contractPayload.price, "0.00032200");
});

test("the cloud signer cannot pretend Hive RC, signer, and runner overhead cost zero", async () => {
  // Hermetic: without a stand-in priceCosts, coldRedGateSigner falls to the
  // real default pricer, which reaches real Hive RC nodes and, once past
  // that gate, the real cold-red-gate signer over SSH -- never exercise
  // that live path from a unit test. The stand-in proves operate() still
  // refuses on an unpriced decision rather than treating a missing one as
  // free.
  const priceCosts = async () => ({ status: "unpriced-resource-cost-model", reason: "rc-capacity-single-witness",
    stillUnpriced: ["Hive RC"], components: null });
  const receipt = await operate({ account: "michael561", executeOne: true, coldRedGateSigner: true, priceCosts,
    scan: async () => ({ ...scan, account: "michael561" }),
    broadcastSwapLeg: async () => { throw new Error("must not broadcast"); },
    broadcastSellLeg: async () => { throw new Error("must not broadcast"); } });
  assert.equal(receipt.status, "unpriced-resource-cost-model");
});

const pricedCosts = { status: "priced", total: "0.00020000", components: [
  { name: "Hive RC", amount: "0.00000000", unit: "SWAP.HIVE", witness: {} },
  { name: "signer", amount: "0.00010000", unit: "SWAP.HIVE", witness: {} },
  { name: "runner/paymaster", amount: "0.00010000", unit: "SWAP.HIVE", witness: {} },
] };
const SWAP_TXID = "a".repeat(40);
const SELL_TXID = "b".repeat(40);
const confirmedEffect = (call) => Object.freeze({ status: "confirmed", source: "hive-engine.getTransactionInfo",
  contract: call.contractName, action: call.contractAction, expectedLegs: 1, confirmedLegs: 1 });

test("a cold-red-gate round trip broadcasts and confirms each leg separately, in order, and reports both transaction ids", () => {
  return (async () => {
    const seen = [];
    const broadcastSwapLeg = async (request) => { seen.push("swap-broadcast"); assert.equal(request.leg, "swap"); return { status: "broadcast", id: SWAP_TXID }; };
    const broadcastSellLeg = async (request) => { seen.push("sell-broadcast"); assert.equal(request.leg, "sell"); return { status: "broadcast", id: SELL_TXID }; };
    const confirmLeg = async (account, call, transactionId) => { seen.push(`confirm-${transactionId === SWAP_TXID ? "swap" : "sell"}`); return confirmedEffect(call); };
    const receipt = await operate({ account: "michael561", executeOne: true, coldRedGateSigner: true, economicCostWitness: pricedCosts,
      scan: async () => ({ ...scan, account: "michael561" }), broadcastSwapLeg, broadcastSellLeg, confirmLeg });
    assert.equal(receipt.status, "round-trip-confirmed-unpriced-resource-costs");
    assert.equal(receipt.swapTransactionId, SWAP_TXID);
    assert.equal(receipt.sellTransactionId, SELL_TXID);
    assert.equal(receipt.swapEconomicEffect.status, "confirmed");
    assert.equal(receipt.sellEconomicEffect.status, "confirmed");
    assert.deepEqual(seen, ["swap-broadcast", "confirm-swap", "sell-broadcast", "confirm-sell"]);
  })();
});

test("a swap-leg refusal never reaches the sell leg and reports no chain mutation at all", async () => {
  const receipt = await operate({ account: "michael561", executeOne: true, coldRedGateSigner: true, economicCostWitness: pricedCosts,
    scan: async () => ({ ...scan, account: "michael561" }),
    broadcastSwapLeg: async () => ({ status: "refused", datum: "route-stale", reason: "current pool reserves would exceed the committed maxAmountIn" }),
    broadcastSellLeg: async () => { throw new Error("must not broadcast the sell leg after a swap-leg refusal"); } });
  assert.equal(receipt.status, "swap-leg-refused");
  assert.equal(receipt.refusal.datum, "route-stale");
  assert.equal(receipt.chainMutation, false);
});

test("a sell-leg refusal after a confirmed swap leg is residue, not a crash -- the swap already happened", async () => {
  const broadcastSwapLeg = async () => ({ status: "broadcast", id: SWAP_TXID });
  const broadcastSellLeg = async () => ({ status: "refused", datum: "route-stale", reason: "current order book no longer has enough depth" });
  const confirmLeg = async (account, call) => confirmedEffect(call);
  const receipt = await operate({ account: "michael561", executeOne: true, coldRedGateSigner: true, economicCostWitness: pricedCosts,
    scan: async () => ({ ...scan, account: "michael561" }), broadcastSwapLeg, broadcastSellLeg, confirmLeg });
  assert.equal(receipt.status, "execution-residue");
  assert.equal(receipt.swapTransactionId, SWAP_TXID);
  assert.equal(receipt.swapEconomicEffect.status, "confirmed");
  assert.equal(receipt.sellTransactionId, null);
  assert.equal(receipt.sellRefusal.datum, "route-stale");
  assert.equal(receipt.chainMutation, true);
});

test("a broadcast swap leg that never confirms on-chain is residue before the sell leg is ever attempted", async () => {
  const receipt = await operate({ account: "michael561", executeOne: true, coldRedGateSigner: true, economicCostWitness: pricedCosts,
    scan: async () => ({ ...scan, account: "michael561" }),
    broadcastSwapLeg: async () => ({ status: "broadcast", id: SWAP_TXID }),
    broadcastSellLeg: async () => { throw new Error("must not broadcast the sell leg before the swap leg confirms"); },
    confirmLeg: async () => Object.freeze({ status: "unverified", source: "hive-engine.getTransactionInfo", expectedLegs: 1, confirmedLegs: 0 }) });
  assert.equal(receipt.status, "execution-residue");
  assert.equal(receipt.swapTransactionId, SWAP_TXID);
  assert.equal(receipt.swapEconomicEffect.status, "unverified");
  assert.equal(receipt.sellTransactionId, null);
  assert.equal(receipt.chainMutation, true);
});

test("execution needs a full resource-cost witness and refuses to call a gross SWAP delta profit", async () => {
  const unpriced = await operate({ executeOne: true, keyFile: "/opaque/key", scan: async () => scan,
    submit: async () => { throw new Error("must not submit"); } });
  assert.equal(unpriced.status, "unpriced-resource-cost-model");

  const completed = await operate({ executeOne: true, keyFile: "/opaque/key", scan: async () => scan,
    economicCostWitness: { status: "priced", total: "0.00010000",
      components: [
        { name: "Hive RC", amount: "0.00000000", unit: "SWAP.HIVE", witness: {} },
        { name: "signer", amount: "0.00000000", unit: "SWAP.HIVE", witness: {} },
        { name: "runner/paymaster", amount: "0.00000000", unit: "SWAP.HIVE", witness: {} },
      ] },
    submit: async () => ({ id: "a".repeat(40), economicEffect: { status: "confirmed", realizedPnlSwapHive: 0.00194485 } }) });
  assert.equal(completed.status, "round-trip-confirmed-unpriced-resource-costs");
  assert.equal(completed.economicEffect.realizedPnlSwapHive, 0.00194485);
});

test("an incompletely priced resource-cost decision (a missing component) still refuses", async () => {
  const priceCosts = async () => ({ status: "priced", total: "0.00010000", components: [
    { name: "Hive RC", amount: "0.00010000", unit: "SWAP.HIVE", witness: {} },
  ] });
  const receipt = await operate({ account: "michael561", executeOne: true, coldRedGateSigner: true, priceCosts,
    scan: async () => ({ ...scan, account: "michael561" }),
    submit: async () => { throw new Error("must not submit"); } });
  assert.equal(receipt.status, "unpriced-resource-cost-model");
});

test("the kill switch: operate() refuses any account outside the admitted autonomous set before it ever scans", async () => {
  await assert.rejects(
    () => operate({ account: "some-other-account", executeOne: true,
      scan: async () => { throw new Error("must not scan for an unadmitted account"); },
      submit: async () => { throw new Error("must not submit for an unadmitted account"); } }),
    /account is not admitted to autonomous arbitrage/);
});

test("the kill switch holds even with a fully priced cost witness and a certified opportunity in hand", async () => {
  await assert.rejects(
    () => operate({ account: "some-other-account", executeOne: true, economicCostWitness: pricedCosts,
      scan: async () => ({ ...scan, account: "some-other-account" }),
      submit: async () => { throw new Error("must not submit for an unadmitted account"); } }),
    /account is not admitted to autonomous arbitrage/);
});

test("the kill switch: each per-leg request constructor also refuses an unadmitted account on its own", () => {
  assert.throws(() => swapLegRequest(opportunity, "/opaque/active.wif", "some-other-account", "0.00020000"),
    /account is not admitted to autonomous arbitrage/);
  assert.throws(() => sellLegRequest(opportunity, "/opaque/active.wif", "some-other-account", "0.00020000"),
    /account is not admitted to autonomous arbitrage/);
  assert.throws(() => roundTripRequest(opportunity, "/opaque/active.wif", "some-other-account"),
    /account is not admitted to autonomous arbitrage/);
});
