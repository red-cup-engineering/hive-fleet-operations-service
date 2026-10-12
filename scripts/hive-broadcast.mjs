#!/usr/bin/env node
// hive-broadcast — the fleet's one signer. It signs what the fleet's planners ask for, inside the
// guards each account's entry in aagaard.config.json sets, with the account's stored key:
//
//   - the account must be in the fleet's strategy config and hold the key role the act needs
//     (its "keys" list); a posting-only account signs only posting acts.
//   - the protected-asset guard: ZINGALPHA #1831 is permanently outside open, transfer,
//     delegation, listing, sale, burn and liquidation.
//   - value caps per operation from the account's capHiveMilli, capHbdMilli and capSwapHiveMilli;
//     votes up to its maxVoteWeightBps and never below its votingPowerFloorBps of mana.
//   - funds leave an account only to another fleet account or the HIVE/SWAP.HIVE peg; savings
//     moves are self-only; pool swaps carry a slippage bound.
//   - game acts must be exactly what their game package builds; arbitrage legs re-prove their
//     round trip against fresh pool and book state.
//
// Reads one JSON request on stdin: { account, role, lane, target, operation, ...lane fields }.
// Answers one JSON line on stdout, exit 0: {"status":"broadcast","id":"<txid>"} or
// {"status":"refused","datum":"<why>","reason":"..."} (nothing was signed). Exit 1 only when a
// broadcast was attempted and its outcome is unknown. Before signing, every write re-proves on
// chain that the account keeps twice the operation's RC cost and that the key it loads from the
// keystore (key-management's hive-keystore, HIVE_KEY_ROOT / HIVE_KEY_PASSPHRASE) satisfies the
// account's authority for that role. The same signer runs wherever the keys are; runSigner in
// src/core/signer.mjs reaches it locally or over ssh.

import { readFileSync } from "node:fs";
import { keySatisfiesAuthority, loadHiveKey } from "@red-cup-engineering/key-management-services-section/hive-keystore";
import { ENGINE_NODES, EngineClient, exactOutputSwapInput, poolFeeBps, reserveFraction } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { parseEngineOrderBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { marketSellWalk } from "@red-cup-engineering/gaming/market";
import { gradedFromParts, gradedSign, gradedValue } from "@red-cup-engineering/exact-number-data-service/graded";
import { currentVotingMana } from "@red-cup-engineering/hive-blockchain-client-service/rewards.mjs";
import { decimalUnits, rationalUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { NET_FLOOR_MARGIN_SWAP_HIVE } from "../src/core/resourceCostModel.mjs";
import { observeRcReserve } from "../src/integrations/hive/rcReserve.adapter.mjs";
import { assertRulesPermit } from "../src/core/rules.mjs";
import { accountPolicy, assertAccountMutationRole } from "../src/core/accountStrategy.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
import { HONEY_SWAP_ACCOUNT, WRAP_MEMO } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import {
  SPLINTERLANDS_ROSTER_PURCHASE_POLICY,
  assertExactSplinterlandsRosterPurchaseOperation,
  planSplinterlandsRosterPurchase,
} from "@red-cup-engineering/splinterlands-services-section/market";
import { SPLINTERLANDS_OPERATOR_POLICY } from "../src/integrations/splinterlands/splinterlandsOperator.mjs";
import { sameOperation } from "@red-cup-engineering/hive-blockchain-client-service/ops.mjs";
import { terraCoreBattleIntent, terraCoreClaimIntent, terraCoreEngineeringUpgradeIntent } from "@red-cup-engineering/terracore-services-section";
import { validateDCropsActionJson } from "@red-cup-engineering/dcrops-services-section";
import { dcityRecoveryIntent } from "@red-cup-engineering/dcity-services-section";
import { workerBeeYieldIntent } from "@red-cup-engineering/workerbee-services-section";

// The signing account's policy from the fleet's strategy config (set once per request in main).
let POLICY;

const MILLI_TO_SWAP_HIVE = 100_000n; // thousandths to 8-place SWAP.HIVE units

function keyOfCall(call) {
  return call && typeof call === "object" && !Array.isArray(call)
    ? `${call.contractName}.${call.contractAction}`
    : "invalid.invalid";
}

// WORKERBEE yield is one bounded batch: the account self-stakes at most ten liquid WORKERBEE and
// delegates the same quantity to the ph1102 no-fee BEE pool; if the second call fails, the first
// leaves the asset self-staked and mining. The WorkerBee package builds the batch.
function validateWorkerBeeYieldBatch(account, role, lane, target, fields, calls) {
  if (role !== "active" || lane !== "asset-yield") fail("hive-broadcast: WORKERBEE yield requires the asset-yield lane and active authority");
  const quantity = calls?.[0]?.contractPayload?.quantity;
  if (target !== `workerbee:ph1102:${quantity}`) fail("hive-broadcast: WORKERBEE yield target must name the pool and quantity");
  sameAsIntent(fields, () => workerBeeYieldIntent(account, quantity), "hive-broadcast: WORKERBEE yield requires the exact bounded self-stake then ph1102 delegation batch");
}

// A Hive-Engine contract call the fleet may sign for this account: moving tokens only inside the
// fleet, spending SWAP.HIVE only within the account's cap, and pool swaps only with a slippage bound.
function validateEngineCall(account, call) {
  const key = keyOfCall(call);
  const payload = call?.contractPayload ?? {};
  const spend = (value, label) => { const units = swapHiveUnits(value, label); if (units > POLICY.capSwapHiveMilli * MILLI_TO_SWAP_HIVE) fail(`hive-broadcast: ${key} spends more SWAP.HIVE than @${account}'s cap`, "exceeds-account-cap"); };
  switch (key) {
    case "tokens.transfer":
      if (!POLICY.fleet.has(payload.to) || payload.to === account) fail(`hive-broadcast: tokens move only between fleet accounts, not to '${payload.to}'`);
      return;
    case "tokens.stake":
      if (payload.to !== undefined && payload.to !== account && !POLICY.fleet.has(payload.to)) fail("hive-broadcast: stake goes to the account itself or a fleet account");
      return;
    case "tokens.unstake": case "tokens.cancelUnstake": case "tokens.delegate": case "tokens.undelegate":
    case "market.sell": case "market.cancel": case "marketpools.removeLiquidity": case "hivepegged.withdraw":
      return;
    case "market.buy": {
      const places = /\.([0-9]+)$/.exec(String(payload.quantity))?.[1]?.length ?? 0;
      let quantity;
      try { quantity = decimalUnits(String(payload.quantity), places); } catch { fail("hive-broadcast: buy quantity is not canonical"); }
      const price = swapHiveUnits(payload.price, "price");
      const escrow = (quantity * price + 10n ** BigInt(places) - 1n) / 10n ** BigInt(places);
      if (escrow > POLICY.capSwapHiveMilli * MILLI_TO_SWAP_HIVE) fail(`hive-broadcast: the buy escrows more SWAP.HIVE than @${account}'s cap`, "exceeds-account-cap");
      return;
    }
    case "marketpools.swapTokens":
      if (payload.tradeType === "exactInput" && payload.minAmountOut === undefined) fail("hive-broadcast: an exact-input pool swap needs a minAmountOut");
      if (payload.tradeType === "exactOutput" && payload.maxAmountIn === undefined) fail("hive-broadcast: an exact-output pool swap needs a maxAmountIn");
      if (payload.tradeType === "exactInput" && payload.tokenSymbol === "SWAP.HIVE") spend(payload.tokenAmount, "tokenAmount");
      if (payload.tradeType === "exactOutput" && String(payload.tokenPair).split(":").includes("SWAP.HIVE") && payload.tokenSymbol !== "SWAP.HIVE") spend(payload.maxAmountIn, "maxAmountIn");
      return;
    case "marketpools.addLiquidity": {
      const [base] = String(payload.tokenPair ?? "").split(":");
      spend(base === "SWAP.HIVE" ? payload.baseQuantity : payload.quoteQuantity, "SWAP.HIVE side");
      return;
    }
    default:
      fail(`hive-broadcast: refusing contract call '${key}' -- not a Hive-Engine action the fleet signs`);
  }
}

// A refusal is the signer's answer, not a crash: one JSON line on stdout, exit 0, nothing signed.
function fail(reason, datum = "unsafe-envelope") {
  process.stdout.write(`${JSON.stringify({ status: "refused", datum, reason })}\n`);
  process.exit(0);
}

// A game act is admitted only as exactly the operation its game package builds for the same
// parameters; the signer adds the lane, target and size bounds.
function sameAsIntent(fields, build, message) {
  let expected;
  try { expected = build(); } catch (error) { fail(`${message}: ${error instanceof Error ? error.message : String(error)}`); }
  if (!sameOperation(["custom_json", fields], expected.operation ?? expected)) fail(message);
}

function validateTerraCoreClaim(account, role, fields, decoded) {
  if (role !== "posting") fail("hive-broadcast: TerraCore claim requires only the actor's posting authority");
  sameAsIntent(fields, () => terraCoreClaimIntent(account, decoded?.amount), "hive-broadcast: TerraCore claim must be exactly one positive 8-decimal claim by the actor");
}

function canonicalHiveAccount(value) {
  return typeof value === "string"
    && /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/.test(value);
}

function validateCurationVote(account, role, lane, target, fields) {
  const exactEnvelope = role === "posting"
    && lane === "voting"
    && exactObjectKeys(fields, ["voter", "author", "permlink", "weight"])
    && fields.voter === account
    && canonicalHiveAccount(account)
    && canonicalHiveAccount(fields.author)
    && typeof fields.permlink === "string"
    && /^(?=.{1,256}$)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.permlink)
    && target === `${fields.author}/${fields.permlink}`
    && Number.isInteger(fields.weight)
    && fields.weight >= 1
    && fields.weight <= POLICY.maxVoteWeightBps;
  if (!exactEnvelope) {
    fail(`hive-broadcast: a curation vote is one positive vote by the actor on a canonical post, weight 1 through @${account}'s ${POLICY.maxVoteWeightBps}`);
  }
}

function validateHbdSavingsTouch(account, role, lane, target, fields) {
  const admitted = role === "active"
    && canonicalHiveAccount(account)
    && fields.from === account
    && fields.to === account
    && typeof fields.amount === "string" && /^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/.test(fields.amount)
    && BigInt(fields.amount.slice(0, -4).replace(".", "")) > 0n;
  if (!admitted) fail("hive-broadcast: an HBD savings deposit is a positive HBD self-deposit with active authority");
}

function validateHbdSavingsExit(account, role, lane, target, fields) {
  const admitted = role === "active" && lane === "savings-exit" && target === account
    && canonicalHiveAccount(account)
    && exactObjectKeys(fields, ["from", "request_id", "to", "amount", "memo"])
    && fields.from === account && fields.to === account
    && Number.isSafeInteger(fields.request_id) && fields.request_id >= 0 && fields.request_id <= 0xffffffff
    && typeof fields.amount === "string" && /^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/.test(fields.amount)
    && BigInt(fields.amount.slice(0, -4).replace(".", "")) > 0n
    && fields.memo === "aagaard:hbd-savings-exit:v1";
  if (!admitted) fail("hive-broadcast: HBD savings exit must be one exact active-authorized positive HBD self-withdrawal");
}

function validateNativeMarketOrder(account, role, lane, target, fields) {
  const amount = /^(0|[1-9][0-9]*)\.([0-9]{3}) (HIVE|HBD)$/;
  const sell = amount.exec(fields?.amount_to_sell ?? "");
  const receive = amount.exec(fields?.min_to_receive ?? "");
  const expiration = Date.parse(fields?.expiration ?? "");
  const now = Date.now();
  const exact = role === "active"
    && exactObjectKeys(fields, ["owner", "orderid", "amount_to_sell", "min_to_receive", "fill_or_kill", "expiration"])
    && fields.owner === account && target === `order:${fields.orderid}`
    && Number.isSafeInteger(fields.orderid) && fields.orderid >= 0 && fields.orderid <= 0xffffffff
    && typeof fields.fill_or_kill === "boolean"
    && sell && receive && sell[3] !== receive[3]
    && BigInt(`${sell[1]}${sell[2]}`) > 0n && BigInt(`${receive[1]}${receive[2]}`) > 0n
    && Number.isFinite(expiration) && expiration > now && expiration <= now + 28 * 86_400_000;
  if (!exact) fail("hive-broadcast: a native market order is one active-authorized HIVE/HBD limit order owned by the actor, expiring within 28 days");
  const hive = sell?.[3] === "HIVE" ? BigInt(`${sell[1]}${sell[2]}`) : receive?.[3] === "HIVE" ? BigInt(`${receive[1]}${receive[2]}`) : 0n;
  const hbd = sell?.[3] === "HBD" ? BigInt(`${sell[1]}${sell[2]}`) : receive?.[3] === "HBD" ? BigInt(`${receive[1]}${receive[2]}`) : 0n;
  if (hive > POLICY.capHiveMilli) fail(`hive-broadcast: the order moves more HIVE than @${account}'s cap`, "exceeds-account-cap");
  if (hbd > POLICY.capHbdMilli) fail(`hive-broadcast: the order moves more HBD than @${account}'s cap`, "exceeds-account-cap");
}

// A peg-ladder rung: one resting HIVE/HBD maker order (never fill-or-kill) living at most 25 hours,
// inside the ladder's armed mandate: the mandate names the account, admits both limit-order
// operations, and caps the HIVE an ask and the HBD a bid may lock.
function validatePegLadderOrder(account, role, target, fields, mandate) {
  const amount = /^(0|[1-9][0-9]*)\.([0-9]{3}) (HIVE|HBD)$/;
  const sell = amount.exec(fields?.amount_to_sell ?? "");
  const receive = amount.exec(fields?.min_to_receive ?? "");
  const expiration = Date.parse(`${fields?.expiration ?? ""}Z`);
  const now = Date.now();
  const exact = role === "active"
    && exactObjectKeys(fields, ["owner", "orderid", "amount_to_sell", "min_to_receive", "fill_or_kill", "expiration"])
    && fields.owner === account && target === `order:${fields.orderid}`
    && Number.isSafeInteger(fields.orderid) && fields.orderid >= 0 && fields.orderid <= 0xffffffff
    && fields.fill_or_kill === false && sell && receive && sell[3] !== receive[3]
    && BigInt(`${sell[1]}${sell[2]}`) > 0n && BigInt(`${receive[1]}${receive[2]}`) > 0n
    && Number.isFinite(expiration) && expiration > now && expiration <= now + 25 * 3_600_000;
  if (!exact) fail("hive-broadcast: a peg-ladder rung is one resting HIVE/HBD limit order owned by the actor, expiring within 25 hours");
  const armed = mandate && mandate.account === account
    && Array.isArray(mandate.admittedOperations) && ["limit_order_create", "limit_order_cancel"].every((op) => mandate.admittedOperations.includes(op))
    && typeof mandate.maxExposure?.hive === "string" && typeof mandate.maxExposure?.hbd === "string";
  if (!armed) fail("hive-broadcast: the peg-ladder mandate is not armed for this account", "mandate-not-armed");
  const locked = decimalUnits(`${sell[1]}.${sell[2]}`, 3);
  let ceiling;
  try { ceiling = decimalUnits(sell[3] === "HIVE" ? mandate.maxExposure.hive : mandate.maxExposure.hbd, 3); }
  catch { fail("hive-broadcast: the peg-ladder mandate's exposure cap is not a 3-place amount", "mandate-not-armed"); }
  if (locked > ceiling) fail(`hive-broadcast: the rung locks more ${sell[3]} than the mandate's exposure cap`, "exceeds-max-exposure");
}

function validateNativeMarketCancel(account, role, lane, target, fields) {
  const exact = role === "active"
    && exactObjectKeys(fields, ["owner", "orderid"])
    && fields.owner === account && target === `order:${fields.orderid}`
    && Number.isSafeInteger(fields.orderid) && fields.orderid >= 0 && fields.orderid <= 0xffffffff;
  if (!exact) fail("hive-broadcast: native market cancellation must target one exact order owned by the active-authorized actor");
}

function validateTerraCoreBattle(account, role, lane, target, fields, decoded) {
  if (role !== "posting" || lane !== "gaming" || target !== "terracore-one-action") {
    fail("hive-broadcast: TerraCore battle requires the exact one-action gaming lane and actor's posting authority");
  }
  sameAsIntent(fields, () => terraCoreBattleIntent(account, decoded?.target), "hive-broadcast: TerraCore battle must contain exactly one canonical non-self target");
}

function validateDCityRecovery(account, role, lane, target, fields, decoded) {
  if (role !== "active" || lane !== "gaming" || target !== "dcity-liquid-sim-recovery") {
    fail("hive-broadcast: dCity recovery requires the exact gaming lane and actor's active authority");
  }
  const payload = decoded?.contractPayload;
  sameAsIntent(fields, () => dcityRecoveryIntent(account, { tokenPair: payload?.tokenPair, quantitySim: payload?.tokenAmount, minimumSwapHive: payload?.minAmountOut }),
    "hive-broadcast: dCity recovery must be one bounded exact-input SIM/SWAP.HIVE swap");
}

function validateTokenLiquidation(account, role, lane, target, fields, decoded) {
  const exactActiveAuth = role === "active"
    && lane === "liquidity-exit"
    && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  const payload = decoded?.contractPayload;
  const symbol = payload?.symbol;
  const quantity = payload?.quantity;
  const price = payload?.price;
  const exactTarget = `liquidate:${symbol}:${quantity}:${price}`;
  if (!exactActiveAuth
    || !exactObjectKeys(decoded, ["contractName", "contractAction", "contractPayload"])
    || decoded.contractName !== "market" || decoded.contractAction !== "sell"
    || !exactObjectKeys(payload, ["symbol", "quantity", "price", "expiration"])
    || typeof symbol !== "string" || !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) || symbol === "SWAP.HIVE"
    || typeof quantity !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(quantity)
    || BigInt(quantity.replace(".", "")) === 0n
    || typeof price !== "string" || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(price)
    || BigInt(price.replace(".", "")) === 0n
    || payload.expiration !== 300 || target !== exactTarget) {
    fail("hive-broadcast: token liquidation must be one exact active-authorized, price-floored, 300-second market sell in the liquidity-exit lane");
  }
}

function validateTokenUnstake(account, role, lane, target, fields, decoded) {
  const exactActiveAuth = role === "active" && lane === "liquidity-unlock"
    && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  const payload = decoded?.contractPayload;
  if (!exactActiveAuth
    || !exactObjectKeys(decoded, ["contractName", "contractAction", "contractPayload"])
    || decoded.contractName !== "tokens" || decoded.contractAction !== "unstake"
    || !exactObjectKeys(payload, ["symbol", "quantity"])
    || typeof payload.symbol !== "string" || !/^[A-Z][A-Z0-9.]{0,9}$/.test(payload.symbol) || payload.symbol === "SWAP.HIVE"
    || typeof payload.quantity !== "string" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(payload.quantity)
    || BigInt(payload.quantity.replace(".", "")) === 0n
    || target !== `unstake:${payload.symbol}:${payload.quantity}`) {
    fail("hive-broadcast: token unlock must be one exact active-authorized unstake in the liquidity-unlock lane");
  }
}

function validateTerraCoreEngineeringUpgrade(account, role, lane, target, fields, decoded) {
  if (role !== "active" || lane !== "gaming" || target !== "terracore-engineering-upgrade") {
    fail("hive-broadcast: TerraCore engineering upgrade requires the exact gaming lane and actor's active authority");
  }
  const payload = decoded?.contractPayload;
  const nonce = /^terracore_engineering-([0-9a-f]{16})$/.exec(payload?.memo ?? "")?.[1];
  sameAsIntent(fields, () => terraCoreEngineeringUpgradeIntent(account, payload?.quantity, nonce ?? ""),
    "hive-broadcast: TerraCore engineering upgrade must be one exact SCRAP-to-null transfer");
  if (decimalUnits(payload.quantity, 8) > 1_000_000n * 100_000_000n) fail("hive-broadcast: TerraCore engineering upgrade burns at most 1,000,000 SCRAP");
}

function exactObjectKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function validateDCropsAction(account, role, fields, decoded) {
  const exactActiveAuth = role === "active"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  if (!exactActiveAuth) fail("hive-broadcast: dCrops plot action requires exactly the actor's active authority");
  try { validateDCropsActionJson(decoded); }
  catch (error) { fail(`hive-broadcast: dCrops admits exactly one remove, harvest, or plant plot action: ${error instanceof Error ? error.message : String(error)}`); }
}

async function readSplinterlandsJson(path) {
  const response = await fetch(`https://api.splinterlands.com${path}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) fail(`hive-broadcast: Splinterlands ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function validateSplinterlandsRosterPurchase(account, role, lane, target, fields, decoded) {
  const exactActiveAuth = account === SPLINTERLANDS_OPERATOR_POLICY.account
    && role === "active"
    && lane === SPLINTERLANDS_ROSTER_PURCHASE_POLICY.lane
    && target === SPLINTERLANDS_ROSTER_PURCHASE_POLICY.target
    && fields.id === "sm_market_purchase"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  if (!exactActiveAuth || !exactObjectKeys(decoded, ["currency", "items", "price", "app", "n"])) {
    fail("hive-broadcast: Splinterlands roster acquisition requires the exact active-authorized gaming lane and purchase envelope");
  }
  if (decoded.currency !== "CREDITS" || typeof decoded.app !== "string" || !decoded.app.startsWith("splinterlands/")) {
    fail("hive-broadcast: Splinterlands roster acquisition requires CREDITS and an exact client version");
  }
  const [settings, balances, ...listingGroups] = await Promise.all([
    readSplinterlandsJson("/settings"),
    readSplinterlandsJson(`/players/balances?username=${encodeURIComponent(account)}`),
    ...SPLINTERLANDS_ROSTER_PURCHASE_POLICY.cards.map((card) => readSplinterlandsJson(`/market/for_sale_by_card?card_detail_id=${card.cardDetailId}&gold=false&edition=${card.edition}`)),
  ]);
  if (!Array.isArray(balances)) fail("hive-broadcast: Splinterlands returned malformed balance evidence");
  const credits = balances.find((entry) => entry?.player === account && entry?.token === "CREDITS")?.balance;
  const clientVersion = String(settings?.version ?? "");
  if (decoded.app !== `splinterlands/${clientVersion}`) fail("hive-broadcast: Splinterlands client version changed after the purchase was planned");
  const listingsByCard = new Map(SPLINTERLANDS_ROSTER_PURCHASE_POLICY.cards.map((card, index) => {
    const rows = listingGroups[index];
    if (!Array.isArray(rows)) fail(`hive-broadcast: Splinterlands returned malformed listings for card ${card.cardDetailId}`);
    return [card.cardDetailId, rows];
  }));
  const expected = planSplinterlandsRosterPurchase({
    account,
    creditBalance: Number(credits),
    clientVersion,
    nonce: decoded.n,
    listingsByCard,
    fleet: [...POLICY.fleet],
    now: new Date(),
  });
  assertExactSplinterlandsRosterPurchaseOperation(["custom_json", fields], expected);
}

// One limit buy of an income-paying token, escrowing at most the account's SWAP.HIVE cap and
// expiring within 300 seconds; the target names the exact symbol, quantity and price.

function validateIncomeTokenBuy(account, role, target, fields, call) {
  const order = call?.contractPayload;
  const envelope = role === "active" && fields.id === "ssc-mainnet-hive"
    && JSON.stringify(fields.required_auths) === JSON.stringify([account]) && JSON.stringify(fields.required_posting_auths) === "[]"
    && exactObjectKeys(call, ["contractName", "contractAction", "contractPayload"])
    && exactObjectKeys(order, ["symbol", "quantity", "price", "expiration"])
    && /^[A-Z][A-Z0-9.]{0,19}$/.test(order.symbol ?? "") && order.symbol !== "SWAP.HIVE"
    && Number.isInteger(order.expiration) && order.expiration >= 1 && order.expiration <= 300
    && target === `acquire:${order.symbol}:${order.quantity}:${order.price}`;
  if (!envelope) fail("hive-broadcast: an income-token acquisition is one bounded limit buy matching its target");
  const places = /\.([0-9]+)$/.exec(String(order.quantity))?.[1]?.length ?? 0;
  let quantity;
  try { quantity = decimalUnits(String(order.quantity), places); } catch { fail("hive-broadcast: buy quantity is not canonical"); }
  const price = swapHiveUnits(order.price, "price");
  const escrow = (quantity * price + 10n ** BigInt(places) - 1n) / 10n ** BigInt(places);
  if (quantity <= 0n || price <= 0n || escrow > POLICY.capSwapHiveMilli * MILLI_TO_SWAP_HIVE) fail("hive-broadcast: the buy escrows more than the income-token spend bound");
}

// --- the arbitrage legs ---
//
// A pool-to-book round trip signs as two single-action transactions, never one bundle: two
// actions in one custom_json cross the resourcemanager's free-transaction count and burn its
// multi-transaction fee (michael561's a6308f23ba5026f1e670e61cea257eaf62524322, 2026-09-05: the
// swap leg filled, the sell leg failed holding 0.0002 BEED against a 0.001 floor). Each leg
// carries the other leg's committed bound, so either one re-proves the whole trip's worst-case
// profit over its priced overhead against fresh chain state before it signs.

const ARBITRAGE_MIN_PROFIT = 100_000n; // 0.00100000 SWAP.HIVE
const SWAP_HIVE_SCALE = 100_000_000n;

function swapHiveUnits(value, label) {
  try { return decimalUnits(String(value ?? ""), 8); }
  catch { return fail(`hive-broadcast: ${label} is not an 8-place SWAP.HIVE amount`); }
}

function arbitrageEnvelope(payload, fields, leg, extraKeys) {
  const { account, role } = payload;
  if (!POLICY.tradingLive || role !== "active" || payload.leg !== leg
    || !exactObjectKeys(payload, ["kind", "account", "role", "lane", "target", "leg", "operation", ...extraKeys])
    || fields.id !== "ssc-mainnet-hive"
    || JSON.stringify(fields.required_auths) !== JSON.stringify([account]) || JSON.stringify(fields.required_posting_auths) !== "[]") {
    fail(`hive-broadcast: the arbitrage ${leg} leg requires a trading-live account's exact active-authority envelope`);
  }
}

// Both providers must return the same rows, or the read is not evidence.
async function engineConsensusFind(contract, table, query, options) {
  const answers = await Promise.all(ENGINE_NODES.slice(0, 2).map((node) => new EngineClient({ nodes: [node] }).find(contract, table, query, options).catch(() => null)));
  if (!Array.isArray(answers[0]) || JSON.stringify(answers[0]) !== JSON.stringify(answers[1])) {
    fail(`hive-broadcast: providers disagree on or withhold ${contract}.${table}`, "route-stale");
  }
  return answers[0];
}

async function validateArbitrageSwapLeg(payload, call) {
  const fields = payload.operation[1];
  arbitrageEnvelope(payload, fields, "swap", ["pricedOverheadSwapHive", "pairedSellPriceSwapHive"]);
  const swap = call.contractPayload;
  if (!exactObjectKeys(call, ["contractName", "contractAction", "contractPayload"])
    || !exactObjectKeys(swap, ["tokenPair", "tokenSymbol", "tokenAmount", "tradeType", "maxAmountIn"]) || swap.tradeType !== "exactOutput"
    || typeof swap.tokenPair !== "string" || !swap.tokenPair.split(":").includes("SWAP.HIVE") || !swap.tokenPair.split(":").includes(swap.tokenSymbol)
    || payload.target !== `${swap.tokenSymbol}:pool-to-book-round-trip`) {
    fail("hive-broadcast: the arbitrage swap leg must be one exactOutput SWAP.HIVE pool swap for the target token");
  }
  const places = /\.([0-9]+)$/.exec(String(swap.tokenAmount))?.[1]?.length ?? 0;
  let quantity;
  try { quantity = decimalUnits(String(swap.tokenAmount), places); } catch { fail("hive-broadcast: swap tokenAmount is not canonical"); }
  const input = swapHiveUnits(swap.maxAmountIn, "maxAmountIn");
  const pairedPrice = swapHiveUnits(payload.pairedSellPriceSwapHive, "pairedSellPriceSwapHive");
  const overhead = swapHiveUnits(payload.pricedOverheadSwapHive, "pricedOverheadSwapHive");
  const margin = decimalUnits(NET_FLOOR_MARGIN_SWAP_HIVE, 8);
  const tokenScale = 10n ** BigInt(places);
  const proceeds = quantity * pairedPrice / tokenScale;
  if (quantity <= 0n || input <= 0n || pairedPrice <= 0n || input > POLICY.capSwapHiveMilli * MILLI_TO_SWAP_HIVE
    || proceeds < input + ARBITRAGE_MIN_PROFIT || proceeds < input + overhead + margin) {
    fail("hive-broadcast: the round trip's committed bounds do not prove profit over overhead and margin");
  }
  const pools = await engineConsensusFind("marketpools", "pools", { tokenPair: swap.tokenPair }, { limit: 2 });
  if (pools.length !== 1) fail("hive-broadcast: pool reserve evidence is unavailable", "route-stale");
  const [base, quote] = String(pools[0].tokenPair).split(":");
  const tokenIsBase = base === swap.tokenSymbol;
  if (!tokenIsBase && quote !== swap.tokenSymbol) fail("hive-broadcast: pool evidence names a different pair", "route-stale");
  let expectedInput;
  try {
    expectedInput = exactOutputSwapInput({
      reserveIn: reserveFraction(tokenIsBase ? pools[0].quoteQuantity : pools[0].baseQuantity),
      reserveOut: reserveFraction(tokenIsBase ? pools[0].baseQuantity : pools[0].quoteQuantity),
      quantity, tokenScale, inputScale: SWAP_HIVE_SCALE, feeBps: poolFeeBps(pools[0]),
    });
  } catch (error) { fail(`hive-broadcast: pool evidence is malformed: ${error.message}`, "route-stale"); }
  if (expectedInput === null) fail("hive-broadcast: pool reserves can no longer pay out the committed quantity", "route-stale");
  if (expectedInput > input) fail("hive-broadcast: current reserves would exceed the committed maxAmountIn", "route-stale");
}

async function validateArbitrageSellLeg(payload, call) {
  const fields = payload.operation[1];
  const order = call.contractPayload;
  const roundTrip = payload.target === `${order?.symbol}:pool-to-book-round-trip`;
  if (!roundTrip && payload.target !== `${order?.symbol}:reconciliation-sell`) fail("hive-broadcast: a sell leg's target is its round trip or a reconciliation sell");
  arbitrageEnvelope(payload, fields, "sell", roundTrip ? ["pricedOverheadSwapHive", "pairedSwapMaxAmountInSwapHive"] : []);
  if (!exactObjectKeys(call, ["contractName", "contractAction", "contractPayload"])
    || !exactObjectKeys(order, ["symbol", "quantity", "price", "expiration"])
    || !Number.isInteger(order.expiration) || order.expiration < 1 || order.expiration > 300) {
    fail("hive-broadcast: the arbitrage sell leg must be one limit sell expiring within 300 seconds");
  }
  const places = /\.([0-9]+)$/.exec(String(order.quantity))?.[1]?.length ?? 0;
  let quantity;
  try { quantity = decimalUnits(String(order.quantity), places); } catch { fail("hive-broadcast: sell quantity is not canonical"); }
  const price = swapHiveUnits(order.price, "price");
  if (quantity <= 0n || price <= 0n) fail("hive-broadcast: the sell leg's quantity and price must be positive");
  if (roundTrip) {
    const pairedInput = swapHiveUnits(payload.pairedSwapMaxAmountInSwapHive, "pairedSwapMaxAmountInSwapHive");
    const overhead = swapHiveUnits(payload.pricedOverheadSwapHive, "pricedOverheadSwapHive");
    const proceeds = quantity * price / 10n ** BigInt(places);
    if (pairedInput <= 0n || proceeds < pairedInput + ARBITRAGE_MIN_PROFIT || proceeds < pairedInput + overhead + decimalUnits(NET_FLOOR_MARGIN_SWAP_HIVE, 8)) {
      fail("hive-broadcast: the round trip's committed bounds do not prove profit over overhead and margin");
    }
  }
  // The price bounds selling for less; the book must also still hold enough depth at or above it
  // to fill the whole quantity, or part of it rests unfilled.
  const book = await engineConsensusFind("market", "buyBook", { symbol: order.symbol }, { limit: 200, indexes: [{ index: "priceDec", descending: true }] });
  let depthBook;
  try { depthBook = parseEngineOrderBook(book, [], order.symbol).bids.filter((level) => rationalUnits(gradedValue(level.price), 8, { rounding: "toward-zero" }) >= price); }
  catch { fail("hive-broadcast: order book evidence is malformed", "route-stale"); }
  const walked = marketSellWalk({ bids: depthBook, asks: [] }, gradedFromParts(quantity, 10n ** BigInt(places), order.symbol));
  if (gradedSign(walked.shortfall) > 0) fail("hive-broadcast: the book no longer holds enough depth at or above the committed price", "route-stale");
}

// --- signing-time chain checks, every lane ---

// The operation's resource credits: at least twice its average cost must be available now.
async function assertRcReserve(account, opName) {
  const observation = await observeRcReserve({ account, operation: `${opName}_operation` });
  if (observation.status !== "certified") fail(`hive-broadcast: RC evidence is ${observation.refusal}`, "rc-evidence-unavailable");
  if (observation.plan.decision !== "ready") fail(`hive-broadcast: RC reserve is below twice the ${opName} cost (${observation.plan.decision})`, "insufficient-rc-reserve");
}

// A vote lands only on a live, paying post the voter has not voted, at least ten minutes before
// payout, and leaves the voter at 80% mana or more.
async function assertVoteViable(reader, chainAccount, fields) {
  const post = await reader.getPost(fields.author, fields.permlink, fields.voter);
  const payoutAt = Date.parse(String(post?.payout_at ?? "").replace(/Z?$/, "Z"));
  const pending = /^([0-9]+(?:\.[0-9]{1,3})?) HBD$/.exec(String(post?.pending_payout_value ?? ""));
  const ceiling = /^([0-9]+(?:\.[0-9]{1,3})?) HBD$/.exec(String(post?.max_accepted_payout ?? ""));
  if (post?.author !== fields.author || post?.permlink !== fields.permlink || post?.is_paidout === true
    || !Number.isFinite(payoutAt) || payoutAt - Date.now() < 600_000
    || !pending || Number(pending[1]) <= 0 || !ceiling || Number(ceiling[1]) <= 0
    || !Array.isArray(post?.active_votes) || post.active_votes.some((vote) => vote?.voter === fields.voter)) {
    fail("hive-broadcast: the post is not a live, paying, unvoted target", "post-not-viable");
  }
  const { currentMana, maxMana } = currentVotingMana(chainAccount, Date.now() / 1000);
  if (maxMana <= 0n) fail("hive-broadcast: the voter has no voting mana", "voting-mana-reserve");
  const manaBps = currentMana * 10_000n / maxMana;
  const afterBps = manaBps * (500_000n - BigInt(fields.weight)) / 500_000n;
  const floor = BigInt(POLICY.votingPowerFloorBps);
  if (manaBps < floor || afterBps < floor) fail(`hive-broadcast: the vote would take voting mana below @${chainAccount.name}'s ${POLICY.votingPowerFloorBps / 100}% floor`, "voting-mana-reserve");
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    fail(`hive-broadcast: stdin is not JSON: ${error.message}`);
    return;
  }

  const { account, role, lane, target, operation } = payload;
  if (typeof account !== "string" || !account) fail("hive-broadcast: no account");
  if (!Array.isArray(operation) || operation.length !== 2) fail("hive-broadcast: no operation");
  const [opName, opFields] = operation;
  POLICY = accountPolicy(account);
  if (!POLICY.inFleet) fail(`hive-broadcast: @${account} is not an account in the fleet's strategy config`);

  try { assertAccountMutationRole({ account, role, lane, operation: opName }); }
  catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`); }

  if (opName !== "vote" && opName !== "custom_json" && opName !== "transfer" && opName !== "transfer_to_savings" && opName !== "transfer_from_savings" && opName !== "limit_order_create" && opName !== "limit_order_cancel") {
    fail(`hive-broadcast: refusing operation '${opName}' -- the fleet signs votes, transfers, savings moves, HIVE/HBD orders and custom_json`);
    return;
  }

  // Every operation is judged against the house's rules before any lane validates it.
  let ruleDecoded;
  if (opName === "custom_json") { try { ruleDecoded = JSON.parse(opFields.json); } catch { ruleDecoded = undefined; } }
  try { assertRulesPermit({ account, opName, opFields, decoded: ruleDecoded }); }
  catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`, "rules"); return; }

  if (opName === "vote") validateCurationVote(account, role, lane, target, opFields);
  if (opName === "transfer_to_savings") validateHbdSavingsTouch(account, role, lane, target, opFields);
  if (opName === "transfer_from_savings") validateHbdSavingsExit(account, role, lane, target, opFields);
  if (opName === "limit_order_create") {
    if (lane === "peg-ladder") validatePegLadderOrder(account, role, target, opFields, payload.mandate);
    else validateNativeMarketOrder(account, role, lane, target, opFields);
  }
  if (opName === "limit_order_cancel") validateNativeMarketCancel(account, role, lane === "peg-ladder" ? "native-market" : lane, target, opFields);

  let contractKey = null;
  let customJsonRole = "active";
  if (opName === "custom_json") {
    let decoded;
    try {
      decoded = JSON.parse(opFields.json);
    } catch (error) {
      fail(`hive-broadcast: custom_json's own json field is not JSON: ${error.message}`);
      return;
    }
    if (opFields.id === "terracore_claim") {
      validateTerraCoreClaim(account, role, opFields, decoded);
      contractKey = "terracore.claim";
      customJsonRole = "posting";
    } else if (opFields.id === "terracore_battle") {
      validateTerraCoreBattle(account, role, lane, target, opFields, decoded);
      contractKey = "terracore.battle";
      customJsonRole = "posting";
    } else if (opFields.id === "dcrops") {
      validateDCropsAction(account, role, opFields, decoded);
      contractKey = `dcrops.${decoded.operation}`;
    } else if (opFields.id === "sm_market_purchase") {
      try { await validateSplinterlandsRosterPurchase(account, role, lane, target, opFields, decoded); }
      catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`); }
      contractKey = "splinterlands.acquireModernRosterV1";
    } else if (Array.isArray(decoded)) {
      const exactActiveAuth = role === "active"
        && Array.isArray(opFields.required_auths) && opFields.required_auths.length === 1 && opFields.required_auths[0] === account
        && Array.isArray(opFields.required_posting_auths) && opFields.required_posting_auths.length === 0
        && opFields.id === "ssc-mainnet-hive";
      if (!exactActiveAuth) fail("hive-broadcast: a Hive-Engine batch requires exactly the actor's active authority and canonical contract id");
      if (lane === "asset-yield") validateWorkerBeeYieldBatch(account, role, lane, target, opFields, decoded);
      else for (const call of decoded) validateEngineCall(account, call);
      contractKey = decoded.map(keyOfCall).join("+");
    } else {
      contractKey = keyOfCall(decoded);
      const exactActiveAuth = role === "active" && opFields.id === "ssc-mainnet-hive"
        && JSON.stringify(opFields.required_auths) === JSON.stringify([account]) && JSON.stringify(opFields.required_posting_auths) === "[]";
      if (!exactActiveAuth) fail("hive-broadcast: a Hive-Engine call requires exactly the actor's active authority and canonical contract id");
      if (contractKey === "marketpools.swapTokens" && payload.leg === "swap") {
        await validateArbitrageSwapLeg(payload, decoded);
        contractKey = "arbitrage.swapLeg";
      } else if (contractKey === "market.sell" && payload.leg === "sell") {
        await validateArbitrageSellLeg(payload, decoded);
        contractKey = "arbitrage.sellLeg";
      } else if (contractKey === "marketpools.swapTokens" && target === "dcity-liquid-sim-recovery") {
        validateDCityRecovery(account, role, lane, target, opFields, decoded);
        contractKey = "dcity.recoverLiquidSim";
      } else if (contractKey === "market.buy" && lane === "income-token-acquisition") {
        validateIncomeTokenBuy(account, role, target, opFields, decoded);
        contractKey = "market.acquireIncomeToken";
      } else if (contractKey === "market.sell" && lane === "liquidity-exit") {
        validateTokenLiquidation(account, role, lane, target, opFields, decoded);
        contractKey = "market.liquidateOwnedToken";
      } else if (contractKey === "tokens.unstake" && lane === "liquidity-unlock") {
        validateTokenUnstake(account, role, lane, target, opFields, decoded);
        contractKey = "tokens.unlockOwnedStake";
      } else if (contractKey === "tokens.transfer" && lane === "gaming" && target === "terracore-engineering-upgrade") {
        validateTerraCoreEngineeringUpgrade(account, role, lane, target, opFields, decoded);
        contractKey = "terracore.engineeringUpgrade";
      } else {
        validateEngineCall(account, decoded);
      }
    }
  }

  // Native HIVE/HBD leaves an account only to the peg (the exact wrap deposit) or another fleet account.
  if (opName === "transfer") {
    const toPeg = opFields.to === HONEY_SWAP_ACCOUNT && opFields.memo === WRAP_MEMO;
    if (opFields.from !== account || (!toPeg && (!POLICY.fleet.has(opFields.to) || opFields.to === account))) {
      fail(`hive-broadcast: a transfer goes only to another fleet account or the HIVE/SWAP.HIVE peg, not to '${opFields.to}'`);
    }
    if (typeof opFields.amount !== "string" || !/^\d+\.\d{3} (?:HIVE|HBD)$/.test(opFields.amount) || (toPeg && !opFields.amount.endsWith(" HIVE"))) {
      fail(`hive-broadcast: transfer amount '${opFields.amount}' is not a well-formed HIVE or HBD quantity`);
    }
  }

  const signingRole = opName === "vote" ? "posting" : opName === "custom_json" ? customJsonRole : "active";
  if (role !== signingRole) fail(`hive-broadcast: ${opName} signs with the ${signingRole} key, not ${role}`);
  // The stored key first, so a request no key can sign never reaches the network.
  let wif;
  try { wif = loadHiveKey(account, role, { root: process.env.HIVE_KEY_ROOT || undefined, passphrase: process.env.HIVE_KEY_PASSPHRASE }); }
  catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`, "key-unavailable"); }
  if (!wif) fail(`hive-broadcast: no ${role} key is stored for @${account}`, "key-unavailable");
  const reader = new HiveClient({ account });
  const [chainAccount] = await Promise.all([reader.getAccount(account), assertRcReserve(account, opName)]);
  if (!keySatisfiesAuthority(chainAccount, role, wif)) fail(`hive-broadcast: the stored ${role} key does not satisfy @${account}'s ${role} authority`, "key-authority-insufficient");
  if (opName === "vote") await assertVoteViable(reader, chainAccount, opFields);
  const hive = new HiveClient({ account, keys: { [role]: wif } });

  try {
    let result;
    if (opName === "vote") {
      result = await hive.vote({ voter: opFields.voter ?? account, author: opFields.author, permlink: opFields.permlink, weight: opFields.weight });
    } else if (opName === "transfer" || opName === "transfer_to_savings" || opName === "transfer_from_savings" || opName === "limit_order_create" || opName === "limit_order_cancel") {
      // A native transfer requires active authority on Hive itself, same
      // as every custom_json contract call below requires it via
      // isSignedWithActiveKey.
      result = await hive.broadcast([[opName, opFields]], "active");
    } else {
      // Hive-Engine calls use active authority; TerraCore's two exact game
      // actions are the admitted posting-authorized custom_json shapes.
      result = await hive.broadcast([["custom_json", opFields]], customJsonRole);
    }
    process.stdout.write(`${JSON.stringify({ status: "broadcast", id: result.id })}\n`);
  } catch (error) {
    // The broadcast was attempted: its outcome is unknown, which is not a refusal.
    process.stderr.write(`hive-broadcast: broadcast outcome unknown: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

await main();
