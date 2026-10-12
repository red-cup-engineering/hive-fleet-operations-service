#!/usr/bin/env node
// The real AAGAARD_BROADCAST_COMMAND: bridges Aagaard's generic broadcast
// request (see hiveWrite.adapter.ts) to an actual signed, broadcast Hive
// transaction via the waggle library (src/integrations/hive/waggle/),
// copied in from the firm's own prior art -- built and unit-tested against
// a mocked transport, but per its own README never yet broadcast with real
// keys. This is that next step.
//
// Narrow operation shapes are signed and broadcast, and nothing else:
//
//   Before the allowlist is considered, every decoded mutation crosses the
//   protected-asset guard. ZINGALPHA #1831 owned by michael561 is permanently
//   outside open, transfer, delegation, listing, sale, burn, and liquidation
//   authority, including future actions that might otherwise be allowlisted.
//
//   "vote" -- the native Hive vote operation, signed with the posting key.
//
//   "comment" -- ONLY the reviewed one-shot exit-tightness pilot article,
//   bound to emsenn0, its exact body digest, metadata, permlink, and
//   product-pilot lane. This does not unlock runtime drafts, replies, edits,
//   incentives, or any general posting capability.
//
//   "custom_json" whose decoded json is {contractName, contractAction,
//   contractPayload} for exactly one of the three contract/action pairs in
//   ALLOWED_CONTRACT_ACTIONS below -- each verified against the real,
//   open-source contract sources (github.com/hive-engine/hivesmartcontracts)
//   and, where available, against this fleet's own real prior broadcasts.
//   Unbundled market buys are deliberately not in this set. A standalone
//   price-floored market sell is admitted only by the exact liquidity-exit
//   lane below; it can dispose of an owned token but cannot spend SWAP.HIVE.
//   Signed with the active key, exactly as those contracts themselves
//   assert (isSignedWithActiveKey === true) and refuse without.
//
//   "transfer" -- ONLY to WRAP_TARGET, and ONLY with a memo that exactly
//   matches WRAP_MEMO (imported from hiveEngineOps.mjs, the single place
//   that string is constructed, so this check can never drift from what
//   wrapHive itself builds). This is real HIVE leaving the account for an
//   external account, verified against the live deployed hivepegged
//   contract (getContract "hivepegged" -> owner: "honey-swap") and cross-
//   checked against a real recent on-chain deposit (suara8's 0.398 HIVE
//   transfer, same memo shape, credited 0.395 SWAP.HIVE). The strict
//   target+memo check exists so this capability can never become a
//   general-purpose "send HIVE anywhere" primitive, even by a bug
//   elsewhere in the codebase that constructs a transfer op some other way.
//
//   "transfer_to_savings" -- ONLY a 0.001 HBD self-deposit in the exact
//   savings-interest-touch lane. It cannot transfer to another account,
//   deposit HIVE, or move more capital.
//
//   "custom_json" id "terracore_claim" or "terracore_battle" -- exactly one
//   positive 8-decimal SCRAP claim or one canonical non-self target, with the
//   actor as the sole posting authority. TerraCore's developer contract
//   explicitly assigns both actions to the posting key. Battle additionally
//   requires the exact one-action gaming lane.
//
//   "custom_json" id "dcrops" -- exactly one remove, harvest, or plant plot
//   action, with the actor as sole active authority. Pack opening, boosters,
//   markets, crafting, and multi-asset actions remain outside this bridge.
//
//   one standalone Hive-Engine marketpools.swapTokens call only when the
//   request is the dCity liquid-SIM recovery lane: exact-input SIM through
//   the SIM/SWAP.HIVE pair with a positive eight-decimal hard minimum. It
//   cannot burn CITY NFTs, purchase anything, or exchange another token.
//
//   one standalone Hive-Engine SCRAP transfer to null only when the exact
//   TerraCore engineering-upgrade lane supplies a canonical 8-decimal amount
//   and a bounded engineering action nonce. No other burn memo or stat is
//   admitted.
//
// Everything else is refused, including plain-Hive-valid operations this
// codebase has at points used as placeholders: "aagaard_trade_intent" is
// not a real Hive operation at all; a blanket "custom_json is real"
// allowance let six no-op transactions (a made-up "aagaard.lp" id nothing
// interprets) through on this bridge's first live run, which is exactly
// why the allowlist here is keyed on the actual contractName+contractAction
// pair, not just the outer custom_json shape.
//
// Reads one JSON request on stdin (HiveBroadcastRequest's shape), writes
// {"id": "<real transaction id>"} on stdout, exit 0. On refusal or error:
// stderr message, exit 1 -- matching hiveWrite.adapter.ts's own contract.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assertNoProtectedAssetMutation } from "../src/core/protectedAssets.mjs";
import { assertAccountMutationRole } from "../src/core/accountMutationRoles.mts";
import { assertExactExitValueServicePost } from "../src/core/exitValueServicePosts.mjs";
import { assertExactProductPilotReblog } from "../src/core/productDistribution.mts";
import { assertExactProductRcDelegation } from "../src/core/directRcDelegation.mts";
import { Waggle } from "../src/integrations/hive/waggle/client.mjs";
import { HONEY_SWAP_ACCOUNT, WRAP_MEMO } from "../src/integrations/hive-engine/hiveEngineOps.mjs";
import {
  SPLINTERLANDS_ROSTER_PURCHASE_POLICY,
  assertExactSplinterlandsRosterPurchaseOperation,
  planSplinterlandsRosterPurchase,
} from "../src/integrations/splinterlands/splinterlandsMarket.mts";

const ALLOWED_CONTRACT_ACTIONS = new Set([
  "hivepegged.withdraw",
]);

function keyOfCall(call) {
  return call && typeof call === "object" && !Array.isArray(call)
    ? `${call.contractName}.${call.contractAction}`
    : "invalid.invalid";
}

function validateRoundTripBatch(calls) {
  const poolToBook = calls.length === 2 && keyOfCall(calls[0]) === "marketpools.swapTokens" && keyOfCall(calls[1]) === "market.sell";
  if (!poolToBook) {
    fail("hive-broadcast: a batched custom_json must be exactly pool exact-output swap -> limit sell");
    return;
  }
  const swap = calls[0].contractPayload;
  const order = calls[1].contractPayload;
  const bound = swap?.maxAmountIn;
  const tradeType = "exactOutput";
  if (!swap || !order || swap.tradeType !== tradeType
    || typeof bound !== "string" || !bound
    || typeof swap.tokenPair !== "string" || !swap.tokenPair.includes(":")) {
    fail(`hive-broadcast: round-trip swap must be ${tradeType} with tokenPair and its slippage bound`);
    return;
  }
  if (swap.tokenSymbol !== order.symbol || swap.tokenAmount !== order.quantity
    || typeof order.price !== "string" || !order.price
    || !Number.isInteger(order.expiration) || order.expiration < 1 || order.expiration > 300) {
    fail("hive-broadcast: round-trip order and swap must use the exact same symbol and quantity at a bounded price within 300 seconds");
  }
  const exactKeys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
  if (!exactKeys(swap, ["maxAmountIn", "tokenAmount", "tokenPair", "tokenSymbol", "tradeType"])
    || !exactKeys(order, ["expiration", "price", "quantity", "symbol"])) {
    fail("hive-broadcast: round-trip payload contains missing or extra fields");
  }
  const quantityMatch = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(swap.tokenAmount ?? "");
  if (!quantityMatch || BigInt(String(swap.tokenAmount).replace(".", "")) === 0n
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(bound)
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(order.price)
    || BigInt(bound.replace(".", "")) === 0n || BigInt(order.price.replace(".", "")) === 0n) {
    fail("hive-broadcast: round-trip amounts must be positive canonical decimals with 8-decimal SWAP.HIVE bounds");
  }
  const pair = swap.tokenPair.split(":");
  if (pair.length !== 2 || !pair.includes("SWAP.HIVE") || !pair.includes(swap.tokenSymbol)) {
    fail("hive-broadcast: round-trip pool must pair the exact order token with SWAP.HIVE");
  }
  const quantityDecimals = quantityMatch[1]?.length ?? 0;
  const quantityUnits = BigInt(swap.tokenAmount.replace(".", ""));
  const priceUnits = BigInt(order.price.replace(".", ""));
  const maximumInputUnits = BigInt(bound.replace(".", ""));
  const conservativeProceedsUnits = quantityUnits * priceUnits / (10n ** BigInt(quantityDecimals));
  if (conservativeProceedsUnits <= maximumInputUnits) {
    fail("hive-broadcast: round-trip hard limit does not prove positive proceeds over maximum input");
  }
}

function validateArbitrageCapitalRebalance(account, role, lane, target, fields, decoded) {
  const payload = decoded?.contractPayload;
  const exactEnvelope = account === "michael561"
    && role === "active"
    && lane === "treasury-rebalance"
    && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0
    && decoded.contractName === "tokens" && decoded.contractAction === "transfer"
    && exactObjectKeys(decoded, ["contractName", "contractAction", "contractPayload"])
    && exactObjectKeys(payload, ["to", "symbol", "quantity", "memo"])
    && ["sigmund-vexler", "help-fund"].includes(payload?.to);
  const swapHiveFloat = target === "sigmund-vexler:arbitrage-capital"
    && payload?.to === "sigmund-vexler"
    && payload.symbol === "SWAP.HIVE"
    && payload.memo === "AGRODAO shared allocator: Sigmund arbitrage float"
    && /^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(payload.quantity ?? "")
    && BigInt(payload.quantity.replace(".", "")) > 0n
    && BigInt(payload.quantity.replace(".", "")) <= 1_000_000_000n;
  const helpLiquidity = payload?.to === "help-fund"
    && target === "help-fund:liquidity-capital"
    && payload.symbol === "SWAP.HIVE"
    && payload.quantity === "1.00000000"
    && payload.memo === "AGRODAO shared allocator: HELP BTC-pool liquidity pilot";
  if (!exactEnvelope || (!swapHiveFloat && !helpLiquidity)) fail("hive-broadcast: treasury rebalance is only the bounded Sigmund SWAP.HIVE float or the exact 1 SWAP.HIVE HELP liquidity pilot");
}

function validateHelpLiquidityBootstrapSwap(account, role, lane, target, fields, decoded) {
  const payload = decoded?.contractPayload;
  const admitted = account === "help-fund" && role === "active" && lane === "liquidity-bootstrap"
    && target === "help-fund:liquidity-bootstrap:SWAP.HIVE:SWAP.BTC"
    && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0
    && exactObjectKeys(decoded, ["contractName", "contractAction", "contractPayload"])
    && decoded.contractName === "marketpools" && decoded.contractAction === "swapTokens"
    && exactObjectKeys(payload, ["tokenPair", "tokenSymbol", "tokenAmount", "tradeType", "minAmountOut"])
    && payload.tokenPair === "SWAP.HIVE:SWAP.BTC" && payload.tokenSymbol === "SWAP.HIVE"
    && payload.tokenAmount === "0.50000000" && payload.tradeType === "exactInput"
    && payload.minAmountOut === "0.00000037";
  if (!admitted) fail("hive-broadcast: HELP liquidity bootstrap is only the exact bounded 0.5 SWAP.HIVE BTC-pool conversion");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validateHelpLiquidityAdd(account, role, lane, target, fields, decoded, operation, authorization) {
  const payload = decoded?.contractPayload;
  const now = Date.now();
  const validFrom = Date.parse(authorization?.validFrom ?? "");
  const expiresAt = Date.parse(authorization?.expiresAt ?? "");
  const planDigest = `sha256:${createHash("sha256").update(canonical(operation)).digest("hex")}`;
  const exactAuthorization = authorization?.kind === "agrodao.hive-enterprise-execution-authorization.v1"
    && authorization.issuer === "urn:ame:help-hive-liquidity-enterprise"
    && authorization.consumer === "urn:ame:aagaard" && authorization.account === account
    && authorization.lane === "liquidity" && Array.isArray(authorization.actions)
    && authorization.actions.length === 1 && authorization.actions[0] === "lp"
    && authorization.planDigest === planDigest && Number.isFinite(validFrom) && Number.isFinite(expiresAt)
    && validFrom <= now && now < expiresAt && expiresAt - validFrom <= 300_000
    && /^sha256:[0-9a-f]{64}$/u.test(authorization.decisionId ?? "")
    && /^(?:urn:|ni:\/\/\/sha-256;)/u.test(authorization.observationId ?? "")
    && /^sha256:[0-9a-f]{64}$/u.test(authorization.releaseId ?? "");
  const admitted = account === "help-fund" && role === "active" && lane === "liquidity"
    && target === `help-fund:lp:${planDigest}` && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0
    && exactObjectKeys(decoded, ["contractName", "contractAction", "contractPayload"])
    && decoded.contractName === "marketpools" && decoded.contractAction === "addLiquidity"
    && exactObjectKeys(payload, ["tokenPair", "baseQuantity", "quoteQuantity"])
    && payload.tokenPair === "SWAP.HIVE:SWAP.BTC"
    && /^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(payload.baseQuantity ?? "")
    && /^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(payload.quoteQuantity ?? "")
    && BigInt(payload.baseQuantity.replace(".", "")) > 0n && BigInt(payload.baseQuantity.replace(".", "")) <= 100_000_000n
    && BigInt(payload.quoteQuantity.replace(".", "")) > 0n && BigInt(payload.quoteQuantity.replace(".", "")) <= 100n;
  if (!admitted || !exactAuthorization) fail("hive-broadcast: HELP LP add requires the exact BTC pool, bounded quantities, and a fresh operation-digest-bound AGRODAO authorization");
}

// The signer used to admit any standalone tokens.stake or tokens.delegate
// call.  That made "remember which token and recipient are productive" an
// operator obligation.  Keep the productive act at this lowest boundary as
// one exact, bounded batch: michael561 self-stakes no more than ten liquid
// WORKERBEE and immediately delegates that same quantity to the observed
// no-fee BEE mining pool.  If the second call fails, the first leaves the
// asset self-staked and mining rather than transferred or liquidated.
function validateWorkerBeeYieldBatch(account, role, lane, target, fields, calls) {
  const exactActiveAuth = account === "michael561"
    && role === "active"
    && lane === "asset-yield"
    && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  const stakeCall = calls?.[0];
  const delegateCall = calls?.[1];
  const stakePayload = stakeCall?.contractPayload;
  const delegatePayload = delegateCall?.contractPayload;
  const quantity = stakePayload?.quantity;
  const quantityIsBounded = typeof quantity === "string"
    && /^(?:0|[1-9][0-9]*)\.[0-9]{5}$/.test(quantity)
    && BigInt(quantity.replace(".", "")) > 0n
    && BigInt(quantity.replace(".", "")) <= 1_000_000n;
  const exactCalls = Array.isArray(calls) && calls.length === 2
    && exactObjectKeys(stakeCall, ["contractName", "contractAction", "contractPayload"])
    && stakeCall.contractName === "tokens" && stakeCall.contractAction === "stake"
    && exactObjectKeys(stakePayload, ["symbol", "to", "quantity"])
    && stakePayload.symbol === "WORKERBEE" && stakePayload.to === account
    && exactObjectKeys(delegateCall, ["contractName", "contractAction", "contractPayload"])
    && delegateCall.contractName === "tokens" && delegateCall.contractAction === "delegate"
    && exactObjectKeys(delegatePayload, ["symbol", "to", "quantity"])
    && delegatePayload.symbol === "WORKERBEE" && delegatePayload.to === "ph1102"
    && delegatePayload.quantity === quantity;
  if (!exactActiveAuth || !quantityIsBounded || !exactCalls
    || target !== `workerbee:ph1102:${quantity}`) {
    fail("hive-broadcast: WORKERBEE yield requires the exact bounded michael561 self-stake then ph1102 delegation batch");
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function validateTerraCoreClaim(account, role, fields, decoded) {
  const exactPostingAuth = Array.isArray(fields.required_posting_auths)
    && fields.required_posting_auths.length === 1
    && fields.required_posting_auths[0] === account;
  if (role !== "posting" || !Array.isArray(fields.required_auths) || fields.required_auths.length !== 0 || !exactPostingAuth) {
    fail("hive-broadcast: TerraCore claim requires only the actor's posting authority");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)
    || Object.keys(decoded).length !== 1 || typeof decoded.amount !== "string"
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(decoded.amount)
    || BigInt(decoded.amount.replace(".", "")) === 0n) {
    fail("hive-broadcast: TerraCore claim must contain exactly one positive 8-decimal amount");
  }
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
    && fields.weight >= 100
    && fields.weight <= 5000;
  if (!exactEnvelope) {
    fail("hive-broadcast: curation vote requires the exact positive one-vote lane, actor, target, canonical post, and integer weight from 100 through 5000");
  }
}

function validateHbdSavingsTouch(account, role, lane, target, fields) {
  const admitted = role === "active"
    && lane === "savings"
    && target === account
    && canonicalHiveAccount(account)
    && exactObjectKeys(fields, ["from", "to", "amount", "memo"])
    && fields.from === account
    && fields.to === account
    && fields.amount === "0.001 HBD"
    && fields.memo === "aagaard:hbd-interest-touch:v1";
  if (!admitted) fail("hive-broadcast: HBD savings touch must be the exact active-authorized 0.001 HBD self-deposit lane");
}

function validateMichaelProductiveSavings(account, role, lane, target, fields) {
  const admitted = account === "michael561" && role === "active" && lane === "productive-savings" && target === account
    && exactObjectKeys(fields, ["from", "to", "amount", "memo"])
    && fields.from === account && fields.to === account && fields.amount === "10.000 HBD"
    && fields.memo === "aagaard:michael561:productive-savings:v1";
  if (!admitted) fail("hive-broadcast: Michael productive savings is only the exact 10.000 HBD self-deposit");
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

function validateTerraCoreBattle(account, role, lane, target, fields, decoded) {
  const exactPostingAuth = role === "posting"
    && lane === "gaming" && target === "terracore-one-action"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 0
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 1
    && fields.required_posting_auths[0] === account;
  if (!exactPostingAuth) fail("hive-broadcast: TerraCore battle requires the exact one-action gaming lane and actor's posting authority");
  if (!exactObjectKeys(decoded, ["target"])
    || typeof decoded.target !== "string"
    || !/^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/.test(decoded.target)
    || decoded.target === account) {
    fail("hive-broadcast: TerraCore battle must contain exactly one canonical non-self target");
  }
}

function validateDCityRecovery(account, role, lane, target, fields, decoded) {
  const exactActiveAuth = role === "active"
    && lane === "gaming" && target === "dcity-liquid-sim-recovery"
    && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  if (!exactActiveAuth) fail("hive-broadcast: dCity recovery requires the exact gaming lane and actor's active authority");
  const payload = decoded?.contractPayload;
  if (!exactObjectKeys(decoded, ["contractName", "contractAction", "contractPayload"])
    || decoded.contractName !== "marketpools" || decoded.contractAction !== "swapTokens"
    || !exactObjectKeys(payload, ["tokenPair", "tokenSymbol", "tokenAmount", "tradeType", "minAmountOut"])
    || !["SWAP.HIVE:SIM", "SIM:SWAP.HIVE"].includes(payload.tokenPair)
    || payload.tokenSymbol !== "SIM" || payload.tradeType !== "exactInput"
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{3}$/.test(payload.tokenAmount ?? "")
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(payload.minAmountOut ?? "")
    || BigInt(payload.tokenAmount.replace(".", "")) === 0n
    || BigInt(payload.minAmountOut.replace(".", "")) === 0n) {
    fail("hive-broadcast: dCity recovery must be one bounded exact-input SIM/SWAP.HIVE swap");
  }
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
  const exactActiveAuth = role === "active"
    && lane === "gaming" && target === "terracore-engineering-upgrade"
    && fields.id === "ssc-mainnet-hive"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  const payload = decoded?.contractPayload;
  if (!exactActiveAuth
    || !exactObjectKeys(decoded, ["contractName", "contractAction", "contractPayload"])
    || decoded.contractName !== "tokens" || decoded.contractAction !== "transfer"
    || !exactObjectKeys(payload, ["symbol", "to", "quantity", "memo"])
    || payload.symbol !== "SCRAP" || payload.to !== "null"
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(payload.quantity ?? "")
    || BigInt(payload.quantity.replace(".", "")) === 0n
    || BigInt(payload.quantity.replace(".", "")) > 1_000_000n * 100_000_000n
    || !/^terracore_engineering-[0-9a-f]{16}$/.test(payload.memo ?? "")) {
    fail("hive-broadcast: TerraCore engineering upgrade must be one bounded exact SCRAP-to-null transfer in the exact gaming lane");
  }
}

function exactObjectKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateDCropsAction(account, role, fields, decoded) {
  const exactActiveAuth = role === "active"
    && Array.isArray(fields.required_auths) && fields.required_auths.length === 1 && fields.required_auths[0] === account
    && Array.isArray(fields.required_posting_auths) && fields.required_posting_auths.length === 0;
  if (!exactActiveAuth) fail("hive-broadcast: dCrops plot action requires exactly the actor's active authority");
  if (!exactObjectKeys(decoded, ["operation", "payload"])
    || !["removeMultiple", "harvestMultiple", "plantMultiple"].includes(decoded.operation)
    || !Array.isArray(decoded.payload) || decoded.payload.length !== 1) {
    fail("hive-broadcast: dCrops admits exactly one remove, harvest, or plant plot action");
  }
  const target = decoded.payload[0];
  if (!positiveInteger(target?.landID)) fail("hive-broadcast: dCrops land id must be a positive integer");
  if (decoded.operation === "plantMultiple") {
    if (!exactObjectKeys(target, ["landID", "plant"])
      || !Array.isArray(target.plant) || target.plant.length !== 1
      || !exactObjectKeys(target.plant[0], ["seedID", "plotNo"])
      || !positiveInteger(target.plant[0].seedID) || !nonnegativeInteger(target.plant[0].plotNo)) {
      fail("hive-broadcast: dCrops plant must contain exactly one positive seed id and one plot number");
    }
  } else if (!exactObjectKeys(target, ["landID", "plots"])
    || !Array.isArray(target.plots) || target.plots.length !== 1
    || !nonnegativeInteger(target.plots[0])) {
    fail("hive-broadcast: dCrops remove or harvest must contain exactly one plot number");
  }
}

async function readSplinterlandsJson(path) {
  const response = await fetch(`https://api.splinterlands.com${path}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) fail(`hive-broadcast: Splinterlands ${path} returned HTTP ${response.status}`);
  return response.json();
}

async function validateSplinterlandsRosterPurchase(account, role, lane, target, fields, decoded) {
  const exactActiveAuth = account === SPLINTERLANDS_ROSTER_PURCHASE_POLICY.account
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
    now: new Date(),
  });
  assertExactSplinterlandsRosterPurchaseOperation(["custom_json", fields], expected);
}

const BLOCKCHAIN_NODES = (process.env.AAGAARD_HIVE_ENGINE_BLOCKCHAIN_NODES ?? "https://api.hive-engine.com/rpc/blockchain,https://herpc.dtools.dev/blockchain")
  .split(",").map((value) => value.trim()).filter(Boolean);

async function transactionInfo(txid) {
  for (const node of BLOCKCHAIN_NODES) {
    try {
      const response = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionInfo", params: { txid } }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload?.result) return payload.result;
    } catch {
      // Try the next provider; absence is reported as unverified below.
    }
  }
  return null;
}

async function waitForRoundTripRows(outerId) {
  let latest = [null, null];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rows = await Promise.all([transactionInfo(`${outerId}-0`), transactionInfo(`${outerId}-1`)]);
    latest = rows.map((row, index) => row ?? latest[index]);
    if (latest[0] && latest[1]) return latest;
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return latest;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    fail(`hive-broadcast: stdin is not JSON: ${error.message}`);
    return;
  }

  const { account, role, lane, target, operation, keyFile, authorization } = payload;
  if (typeof account !== "string" || !account) fail("hive-broadcast: no account");
  if (!Array.isArray(operation) || operation.length !== 2) fail("hive-broadcast: no operation");
  const [opName, opFields] = operation;

  try { assertAccountMutationRole({ account, role, lane, operation: opName }); }
  catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`); }

  if (opName !== "vote" && opName !== "comment" && opName !== "custom_json" && opName !== "transfer" && opName !== "transfer_to_savings" && opName !== "transfer_from_savings") {
    fail(`hive-broadcast: refusing operation '${opName}' -- only vote, the exact one-shot product pilot post, wrap transfer, exact HBD savings touch, and a narrow allowlist of custom_json contract calls are signed and broadcast`);
    return;
  }

  if (opName === "vote") validateCurationVote(account, role, lane, target, opFields);
  if (opName === "comment") {
    try { assertExactExitValueServicePost({ account, role, lane, target, fields: opFields }); }
    catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (opName === "transfer_to_savings") {
    if (lane === "productive-savings") validateMichaelProductiveSavings(account, role, lane, target, opFields);
    else validateHbdSavingsTouch(account, role, lane, target, opFields);
  }
  if (opName === "transfer_from_savings") validateHbdSavingsExit(account, role, lane, target, opFields);

  let contractKey = null;
  let contractCalls = null;
  let customJsonRole = "active";
  if (opName === "custom_json") {
    let decoded;
    try {
      decoded = JSON.parse(opFields.json);
    } catch (error) {
      fail(`hive-broadcast: custom_json's own json field is not JSON: ${error.message}`);
      return;
    }
    assertNoProtectedAssetMutation({ account, decoded });
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
      await validateSplinterlandsRosterPurchase(account, role, lane, target, opFields, decoded);
      contractKey = "splinterlands.acquireModernRosterV1";
    } else if (opFields.id === "follow") {
      try { assertExactProductPilotReblog({ account, role, lane, target, fields: opFields }); }
      catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`); }
      contractKey = "follow.reblogProductPilot";
      customJsonRole = "posting";
    } else if (opFields.id === "rc") {
      try { assertExactProductRcDelegation({ account, role, lane, target, fields: opFields }); }
      catch (error) { fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`); }
      contractKey = "rc.delegateProductDistribution";
      customJsonRole = "posting";
    } else if (Array.isArray(decoded)) {
      const exactActiveAuth = role === "active"
        && Array.isArray(opFields.required_auths) && opFields.required_auths.length === 1 && opFields.required_auths[0] === account
        && Array.isArray(opFields.required_posting_auths) && opFields.required_posting_auths.length === 0
        && opFields.id === "ssc-mainnet-hive";
      if (!exactActiveAuth) fail("hive-broadcast: a Hive-Engine batch requires exactly the actor's active authority and canonical contract id");
      if (lane === "asset-yield") validateWorkerBeeYieldBatch(account, role, lane, target, opFields, decoded);
      else validateRoundTripBatch(decoded);
      contractCalls = decoded;
      contractKey = decoded.map(keyOfCall).join("+");
    } else {
      contractKey = keyOfCall(decoded);
      if (contractKey === "marketpools.swapTokens") {
        if (lane === "liquidity-bootstrap") {
          validateHelpLiquidityBootstrapSwap(account, role, lane, target, opFields, decoded);
          contractKey = "help.bootstrapLiquidity";
        } else {
          validateDCityRecovery(account, role, lane, target, opFields, decoded);
          contractKey = "dcity.recoverLiquidSim";
        }
      } else if (contractKey === "marketpools.addLiquidity" && lane === "liquidity") {
        validateHelpLiquidityAdd(account, role, lane, target, opFields, decoded, operation, authorization);
        contractKey = "help.addAuthorizedLiquidity";
      } else if (contractKey === "tokens.transfer" && lane === "treasury-rebalance") {
        validateArbitrageCapitalRebalance(account, role, lane, target, opFields, decoded);
        contractKey = "treasury.rebalanceArbitrageFloat";
      } else if (contractKey === "market.sell" && lane === "liquidity-exit") {
        validateTokenLiquidation(account, role, lane, target, opFields, decoded);
        contractKey = "market.liquidateOwnedToken";
      } else if (contractKey === "tokens.unstake" && lane === "liquidity-unlock") {
        validateTokenUnstake(account, role, lane, target, opFields, decoded);
        contractKey = "tokens.unlockOwnedStake";
      } else if (contractKey === "tokens.transfer" && lane === "gaming" && target === "terracore-engineering-upgrade") {
        validateTerraCoreEngineeringUpgrade(account, role, lane, target, opFields, decoded);
        contractKey = "terracore.engineeringUpgrade";
      } else if (!ALLOWED_CONTRACT_ACTIONS.has(contractKey)) {
        fail(`hive-broadcast: refusing contract call '${contractKey}' -- only ${[...ALLOWED_CONTRACT_ACTIONS].join(", ")} are verified and allowed as standalone calls`);
        return;
      }
    }
  }

  if (opName === "transfer") {
    if (opFields.to !== HONEY_SWAP_ACCOUNT) {
      fail(`hive-broadcast: refusing transfer to '${opFields.to}' -- transfer is only ever allowed to ${HONEY_SWAP_ACCOUNT} (the real HIVE/SWAP.HIVE peg), never any other destination`);
      return;
    }
    if (opFields.memo !== WRAP_MEMO) {
      fail("hive-broadcast: refusing transfer -- memo does not exactly match the verified wrap-deposit envelope, refusing rather than broadcasting a transfer whose purpose isn't the one this bridge verified");
      return;
    }
    if (typeof opFields.amount !== "string" || !/^\d+\.\d{3} HIVE$/.test(opFields.amount)) {
      fail(`hive-broadcast: refusing transfer -- amount '${opFields.amount}' is not a well-formed 'X.XXX HIVE' quantity`);
      return;
    }
  }

  if (typeof keyFile !== "string" || !keyFile) fail("hive-broadcast: no keyFile");

  let wif;
  try {
    wif = readFileSync(keyFile, "utf8").trim();
  } catch (error) {
    fail(`hive-broadcast: cannot read key file ${keyFile}: ${error.message}`);
    return;
  }

  const hive = new Waggle({ account, keys: { [role ?? "posting"]: wif } });

  try {
    let result;
    if (opName === "vote") {
      result = await hive.vote({ voter: opFields.voter ?? account, author: opFields.author, permlink: opFields.permlink, weight: opFields.weight });
    } else if (opName === "comment") {
      result = await hive.broadcast([["comment", opFields]], "posting");
    } else if (opName === "transfer" || opName === "transfer_to_savings" || opName === "transfer_from_savings") {
      // A native transfer requires active authority on Hive itself, same
      // as every custom_json contract call below requires it via
      // isSignedWithActiveKey.
      result = await hive.broadcast([[opName, opFields]], "active");
    } else {
      // Hive-Engine calls use active authority; TerraCore's two exact game
      // actions are the admitted posting-authorized custom_json shapes.
      result = await hive.broadcast([["custom_json", opFields]], customJsonRole);
    }
    // Older sovereign deployments predate the round-trip confirmation
    // module. Load it only for a round-trip act so unrelated admitted lanes
    // (votes, TerraCore claim, single Hive-Engine calls) remain deployable
    // without pretending confirmation support exists there.
    const economicEffect = contractCalls
      ? (await import("../src/integrations/hive-engine/hiveEngineConfirmation.mjs"))
        .assessRoundTripEconomicEffect(account, contractCalls, await waitForRoundTripRows(result.id))
      : undefined;
    process.stdout.write(JSON.stringify({ id: result.id, ...(economicEffect ? { economicEffect } : {}) }));
  } catch (error) {
    fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();
