// The fleet's bounded pool-to-book capital transformation.  This composes
// public market observation, exact planning, the signer, independent chain
// confirmation, and a priced-resource result into one operational effect.
import { EngineClient, ENGINE_NODES, engineCustomJson, market, pools } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { runSigner } from "./signer.mjs";
import { priceResourceCosts, RESOURCE_COMPONENT_NAMES } from "./resourceCostModel.mjs";
import { assessSellLegEffect, assessSwapLegEffect } from "../integrations/hive-engine/hiveEngineConfirmation.mjs";
import { observeGlobalArbitrage } from "../integrations/hive-engine/globalArbitrage.adapter.mjs";
import { arbitrageIntentStore } from "./arbitrageIntent.mjs";
import { fileURLToPath } from "node:url";

const DECIMAL_8DP = /^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u;

function fail(message) { throw new Error(`automatic-arbitrage-cycle: ${message}`); }

function admitted(account, accounts) {
  return Array.isArray(accounts) && accounts.includes(account);
}

function isFullyPricedResourceCost(costs) {
  return Boolean(costs) && costs.status === "priced" && DECIMAL_8DP.test(costs.total ?? "")
    && Array.isArray(costs.components)
    && costs.components.length === RESOURCE_COMPONENT_NAMES.length
    && RESOURCE_COMPONENT_NAMES.every((name) => costs.components.filter((component) => component?.name === name && DECIMAL_8DP.test(component.amount ?? "")).length === 1)
    && costs.components.reduce((sum, component) => sum + decimalUnits(component.amount, 8), 0n) === decimalUnits(costs.total, 8);
}

/** Select the best policy-admitted exact route for the stated admissible account. */
export function selectAutomaticArbitrageOpportunity(scan, account, admittedAccounts) {
  if (!admitted(account, admittedAccounts) || scan?.status !== "certified" || scan.account !== account || scan.providerKnowledge?.value !== "true") return null;
  return (scan.opportunities ?? []).find((row) => row.policyAdmitted === true && row.exact?.admitted === true) ?? null;
}

function requireOpportunity(opportunity, account, admittedAccounts) {
  if (!opportunity?.exact?.quote) fail("an exact opportunity is required");
  if (!admitted(account, admittedAccounts)) fail("account is not admitted to autonomous arbitrage");
  return opportunity.exact.quote;
}

/** The first standalone, bounded exact-output pool leg. */
export function automaticArbitrageSwapLegRequest(opportunity, account, pricedOverheadSwapHive, admittedAccounts) {
  const quote = requireOpportunity(opportunity, account, admittedAccounts);
  const call = pools.swapTokens({ tokenPair: opportunity.pool, tokenSymbol: opportunity.symbol, tokenAmount: quote.quantity,
    tradeType: "exactOutput", maxAmountIn: quote.maxInputSwapHive });
  return Object.freeze({ kind: "aagaard.hive-write", account, role: "active", lane: "trading",
    target: `${opportunity.symbol}:pool-to-book-round-trip`, leg: "swap", pricedOverheadSwapHive,
    pairedSellPriceSwapHive: quote.limitSellPriceSwapHive, operation: engineCustomJson(account, call) });
}

/** The second standalone, price-floored order-book leg. */
export function automaticArbitrageSellLegRequest(opportunity, account, pricedOverheadSwapHive, admittedAccounts) {
  const quote = requireOpportunity(opportunity, account, admittedAccounts);
  const call = market.sell({ symbol: opportunity.symbol, quantity: quote.quantity, price: quote.limitSellPriceSwapHive, expiration: 300 });
  return Object.freeze({ kind: "aagaard.hive-write", account, role: "active", lane: "trading",
    target: `${opportunity.symbol}:pool-to-book-round-trip`, leg: "sell", pricedOverheadSwapHive,
    pairedSwapMaxAmountInSwapHive: quote.maxInputSwapHive, operation: engineCustomJson(account, call) });
}

async function defaultConfirmLeg(account, call, transactionId, assess, { notBefore } = {}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const observations = await Promise.all(ENGINE_NODES.slice(0, 2).map(async (node) => {
      const client = new EngineClient({ nodes: [node], timeout: 10_000 });
      const row = await client.getTransactionInfo(transactionId).catch(() => null);
      if (row && notBefore) {
        // A manually recovered id must belong to a block after this intent,
        // not an older, identically shaped trade from the same account.
        const block = await client.getBlockInfo(row.blockNumber).catch(() => null);
        const timestamp = typeof block?.timestamp === "string" ? block.timestamp : "";
        const at = Date.parse(timestamp.endsWith("Z") ? timestamp : `${timestamp}Z`);
        if (!Number.isFinite(at) || at < Math.floor(Date.parse(notBefore) / 1000) * 1000 ||
            !block?.transactions?.some((tx) => tx.transactionId === transactionId)) return null;
      }
      return row?.transactionId === transactionId ? [row] : null;
    }));
    if (observations[0] && JSON.stringify(observations[0]) === JSON.stringify(observations[1])) return assess(account, call, observations[0]);
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return Object.freeze({ status: "unverified", source: "hive-engine.getTransactionInfo", expectedLegs: 1, confirmedLegs: 0 });
}

function confirmedEconomicEffect(swapEffect, sellEffect, state) {
  const input = decimalUnits(swapEffect.realizedInputSwapHive, 8);
  const proceeds = decimalUnits(sellEffect.realizedProceedsSwapHive, 8);
  const resourceCost = decimalUnits(state.pricedResourceCostTotalSwapHive, 8);
  const gross = proceeds - input;
  const modeledNet = gross - resourceCost;
  return Object.freeze({
    status: "confirmed",
    source: Object.freeze([swapEffect.source, sellEffect.source]),
    realizedInputSwapHive: formatUnits(input, 8),
    realizedProceedsSwapHive: formatUnits(proceeds, 8),
    grossPnlSwapHive: formatUnits(gross, 8),
    pricedResourceCostSwapHive: formatUnits(resourceCost, 8),
    resourceCostCycles: state.resourceCostCycles,
    unpricedRecoveryCycles: state.unpricedRecoveryCycles,
    modeledNetPnlSwapHive: state.unpricedRecoveryCycles ? null : Number(formatUnits(modeledNet, 8)),
    modeledNetPnlSwapHiveExact: state.unpricedRecoveryCycles ? null : formatUnits(modeledNet, 8),
    // The P&L is a modelled net: the capital legs are chain-confirmed while
    // runner and signer costs are independently priced operational resources.
    netPnlStatus: state.unpricedRecoveryCycles ? "chain-confirmed-gross-recovery-costs-unpriced" : "chain-confirmed-gross-with-priced-resource-costs",
  });
}

/**
 * Execute at most one independently certified, bounded round trip for one
 * admitted wallet.  Calling it with `executeOne:false` performs the same
 * observation and reconciliation without key access or chain mutation. The
 * account's durable intent is shared by the CLI and fleet. Run all callers
 * against the same data directory; it must survive release replacement.
 */
export async function operateAutomaticArbitrage({
  account,
  admittedAccounts,
  fleetAccounts = admittedAccounts,
  executeOne = false,
  economicCostWitness = null,
  priceCosts = priceResourceCosts,
  scan = ({ account: scanAccount }) => observeGlobalArbitrage({ account: scanAccount, fleetAccounts }),
  sign = runSigner,
  confirmLeg = defaultConfirmLeg,
  dataDir = process.env.AAGAARD_DATA_DIR || fileURLToPath(new URL("../../data", import.meta.url)),
  recover = {},
} = {}) {
  if (!admitted(account, admittedAccounts)) fail("account is not admitted to autonomous arbitrage");
  const observedAt = new Date().toISOString();
  const intents = arbitrageIntentStore(dataDir, account);
  let state = await intents.read();
  let base = { kind: "aagaard.automatic-arbitrage-cycle", account, observedAt };
  const pending = state && !state.terminal;
  if (Object.keys(recover).some((leg) => !["swap", "sell"].includes(leg)) ||
      Object.values(recover).some((id) => !/^[0-9a-f]{40}$/u.test(id))) fail("recovery requires a canonical swap or sell transaction id");
  if (Object.keys(recover).length && !pending) fail("there is no unfinished cycle to reconcile");
  for (const leg of Object.keys(recover)) {
    if (state[leg]?.status !== "submitting") fail(`the ${leg} leg has no submission with an unknown outcome`);
  }

  async function advance(update) {
    const next = await intents.advance(state, { ...state, ...update, updatedAt: observedAt });
    if (!next) return false;
    state = next;
    return true;
  }
  function result(status, extra = {}) {
    return Object.freeze({ ...base, status, opportunity: state?.opportunity,
      intentRevision: state?.revision, swapTransactionId: state?.swap?.id ?? null,
      sellTransactionId: state?.sell?.id ?? null, retryAllowed: false,
      chainMutation: Boolean(state?.swap && state.swap.status !== "refused"), ...extra });
  }
  if (!pending) {
    const universe = await scan({ account });
    const opportunity = selectAutomaticArbitrageOpportunity(universe, account, admittedAccounts);
    base.scan = { status: universe.status, observedAt: universe.observedAt, admittedCount: universe.admittedCount ?? null,
      providers: universe.certifyingProviders ?? [] };
    if (!opportunity) return Object.freeze({ ...base, status: "no-admissible-route", credentialAccess: false, chainMutation: false });
    if (!executeOne) return Object.freeze({ ...base, status: "admissible-route-observed", opportunity, credentialAccess: false, chainMutation: false });
    const costs = economicCostWitness ?? await priceCosts({ account, worstCaseProfitSwapHive: opportunity.exact.quote.worstCaseProfitSwapHive });
    if (!isFullyPricedResourceCost(costs)) return Object.freeze({ ...base, status: "unpriced-resource-cost-model", opportunity,
      reason: costs?.reason ?? null, stillUnpriced: costs?.stillUnpriced ?? null, components: costs?.components ?? null,
      credentialAccess: false, chainMutation: false });
    if (!await advance({ opportunity, costs, scan: base.scan, terminal: false, swap: null, sell: null, economicEffect: null,
      pricedResourceCostTotalSwapHive: costs.total, resourceCostCycles: 1, unpricedRecoveryCycles: 0, recoveryCostWitness: null,
      startedAt: observedAt })) return result("cycle-busy", { chainMutation: false });
  } else {
    base.scan = state.scan;
    const unknownLeg = ["swap", "sell"].find((leg) => state[leg]?.status === "submitting");
    // Never race an in-flight signer by advancing its revision. It owns the
    // next answer; no observer may steal that slot or lease it again.
    if (unknownLeg && !recover[unknownLeg]) return result("submission-outcome-unknown", { leg: unknownLeg });
    // Every resumed invocation consumes runner resources too. Preserve the
    // declared model and withhold a net claim if any recovery cost is unknown.
    const costs = economicCostWitness ?? await priceCosts({ account,
      worstCaseProfitSwapHive: state.opportunity.exact.quote.worstCaseProfitSwapHive }).catch(() => null);
    const priced = isFullyPricedResourceCost(costs);
    if (!await advance({ recoveryCostWitness: costs, resourceCostCycles: state.resourceCostCycles + 1,
      unpricedRecoveryCycles: state.unpricedRecoveryCycles + Number(!priced || Boolean(unknownLeg)),
      pricedResourceCostTotalSwapHive: formatUnits(decimalUnits(state.pricedResourceCostTotalSwapHive, 8) + (priced ? decimalUnits(costs.total, 8) : 0n), 8),
    })) return result("cycle-busy");
  }

  // The previous transaction is read before another leg can be submitted.
  // A submission claim without an answer survives process death and timeout.
  // Recovery supplies an identity, never permission to repeat the operation.
  const effects = {};
  for (const leg of ["swap", "sell"]) {
    const assess = leg === "swap" ? assessSwapLegEffect : assessSellLegEffect;
    const build = leg === "swap" ? automaticArbitrageSwapLegRequest : automaticArbitrageSellLegRequest;
    let submitted = state[leg];
    let request = submitted?.request ?? build(state.opportunity, account, state.costs.total, admittedAccounts);
    if (recover[leg]) {
      if (submitted?.status !== "submitting") fail(`the ${leg} leg has no submission with an unknown outcome`);
      if (await intents.hasTransaction(recover[leg])) fail("recovered transaction already belongs to a recorded leg");
      const effect = await confirmLeg(account, JSON.parse(request.operation[1].json), recover[leg], assess, { notBefore: submitted.submittedAt });
      if (effect.status !== "confirmed") return result("recovery-unverified", { leg, effect });
      if (!await advance({ [leg]: { ...submitted, status: "broadcast", id: recover[leg] } })) return result("cycle-busy");
      submitted = state[leg];
    }
    if (submitted?.status === "submitting") return result("submission-outcome-unknown", { leg });
    if (!submitted || submitted.status === "refused") {
      if (!executeOne) return result("execution-residue", { nextLeg: leg, credentialAccess: false });
      // Only the winner of this durable revision may call the signer. There
      // is no expiring lease which could permit a second, delayed broadcast.
      if (!await advance({ [leg]: { status: "submitting", request, submittedAt: new Date().toISOString() } })) return result("cycle-busy");
      let answer;
      try { answer = await sign(request); }
      catch { return result("submission-outcome-unknown", { leg }); }
      if (answer?.status !== "refused" && !(answer?.status === "broadcast" && /^[0-9a-f]{40}$/u.test(answer.id))) {
        return result("submission-outcome-unknown", { leg });
      }
      if (!await advance({ [leg]: { ...state[leg], ...answer }, terminal: leg === "swap" && answer.status === "refused" })) return result("cycle-busy");
      submitted = state[leg];
      if (answer.status === "refused") return result(leg === "swap" ? "swap-leg-refused" : "execution-residue",
        { refusal: { datum: answer.datum, reason: answer.reason }, leg, chainMutation: leg === "sell" });
    }
    effects[leg] = await confirmLeg(account, JSON.parse(request.operation[1].json), submitted.id, assess);
    if (effects[leg].status !== "confirmed") return result("execution-residue", { leg, [`${leg}EconomicEffect`]: effects[leg] });
  }
  const economicEffect = confirmedEconomicEffect(effects.swap, effects.sell, state);
  if (!await advance({ terminal: true, economicEffect })) return result("cycle-busy");
  return result(state.unpricedRecoveryCycles ? "round-trip-confirmed-unpriced" : "round-trip-confirmed-costed",
    { swapEconomicEffect: effects.swap, sellEconomicEffect: effects.sell, economicEffect });
}

/** Make a fleet lane receipt from the one round-trip operational result. */
export function automaticArbitrageReceipt(result) {
  if (!result) return null;
  const base = { lane: "trading", action: "trade-bundle", target: result.opportunity?.pool ?? "global-pool-to-book", account: result.account, cycle: result };
  if (["round-trip-confirmed-costed", "round-trip-confirmed-unpriced"].includes(result.status)) return Object.freeze({ ...base, status: "confirmed", txId: result.sellTransactionId, economicEffect: result.economicEffect });
  if (result.status === "admissible-route-observed") return Object.freeze({ ...base, status: "dry-run", error: "fleet trading lane is not armed" });
  if (result.status === "no-admissible-route") return Object.freeze({ ...base, status: "skipped", error: "no independently certified profitable route" });
  return Object.freeze({ ...base, status: result.chainMutation ? "residue" : "refused", error: result.status });
}
