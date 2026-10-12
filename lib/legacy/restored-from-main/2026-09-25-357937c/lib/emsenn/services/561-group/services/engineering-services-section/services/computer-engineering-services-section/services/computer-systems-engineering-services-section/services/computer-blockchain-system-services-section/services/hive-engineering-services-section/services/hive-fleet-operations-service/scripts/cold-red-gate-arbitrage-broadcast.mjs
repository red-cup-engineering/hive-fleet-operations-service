#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// Remote, active-authority signing boundary for the bounded capital
// circulation lanes (michael561, sigmund-vexler).  The active key remains on
// cold-red-gate; this process receives only an already-sized envelope for
// ONE Hive Engine action -- never a bundled multi-action custom_json (see
// the 2026-09-05 incident below) -- plus a standalone legacy bundle path
// kept for defensive compatibility only, never called by this package's own
// automatic-arbitrage-cycle.mjs.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { NET_FLOOR_MARGIN_SWAP_HIVE } from "../src/core/resourceCostModel.mjs";

const HOST = "cold-red-gate";
/** Declared parameter naming the directory each account's `<account>/active.wif`
 * lives under. The checkout path was the only value this ever held, which is
 * correct on bare-cedar-fog (the dev checkout the key files happen to also
 * live in) but wrong on cold-red-gate itself, where this script actually runs
 * in local-signer mode from a materialized release with no such checkout
 * present (verified 2026-09-05: the real keys live at
 * ~/.config/blockchain/hive/<account>/active.wif on cold-red-gate) --
 * AAGAARD_COLD_RED_GATE_KEY_ROOT overrides it per host, same pattern as
 * automatic-arbitrage-cycle.mjs's AAGAARD_MACHINES_RECORD_PATH. */
export const DEFAULT_KEY_ROOT =
  "/home/emsenn/info/lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-computer-services-section/services/computer-machine-services-section/services/persistent-computer-machine-services-section/services/bare-cedar-fog-services-section/data/runtime/config/blockchain/hive";
const KEY_ROOT_PARAMETER = "AAGAARD_COLD_RED_GATE_KEY_ROOT";
const KEY_ROOT = process.env[KEY_ROOT_PARAMETER] || DEFAULT_KEY_ROOT;
// Resolve the installed client dependency from this release, including local signer releases.
const WAGGLE_CLIENT_URL = "@red-cup-engineering/hive-blockchain-client-service";
const WAGGLE_KEYS_URL = "@red-cup-engineering/hive-blockchain-client-service/src/keys.mjs";
const RPC_URL = "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
const ACCOUNTS = Object.freeze({
  "sigmund-vexler": Object.freeze({ keySentinel: "cold-red-gate:sigmund-vexler/active", keyFile: `${KEY_ROOT}/sigmund-vexler/active.wif` }),
  michael561: Object.freeze({ keySentinel: "cold-red-gate:michael561/active", keyFile: `${KEY_ROOT}/michael561/active.wif` }),
});
const MAX_INPUT = 100_000_000n; // 1.00000000 SWAP.HIVE
const MIN_PROFIT = 100_000n; // 0.00100000 SWAP.HIVE
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function exactKeys(value, keys) { return value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(","); }

function units(value, precision) {
  const text = String(value ?? ""); const match = DECIMAL.exec(text);
  if (!match || (match[1]?.length ?? 0) > precision) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
}

function singleCall(request) {
  const fields = request?.operation?.[1];
  let calls;
  try { calls = JSON.parse(fields?.json ?? ""); } catch { return { fields, call: undefined }; }
  return { fields, call: Array.isArray(calls) && calls.length === 1 ? calls[0] : undefined };
}

function commonEnvelopeAdmitted(request, fields, extraKeys) {
  const scope = ACCOUNTS[request?.account];
  return Boolean(scope) && exactKeys(request, ["kind", "account", "role", "lane", "target", "keyFile", "leg", "operation", ...extraKeys])
    && request.kind === "aagaard.hive-write" && request.role === "active" && request.lane === "trading" && request.keyFile === scope.keySentinel
    && Array.isArray(request.operation) && request.operation[0] === "custom_json" && exactKeys(fields, ["id", "required_auths", "required_posting_auths", "json"])
    && fields.id === "ssc-mainnet-hive" && JSON.stringify(fields.required_auths) === JSON.stringify([request.account]) && JSON.stringify(fields.required_posting_auths) === "[]";
}

/**
 * A single `marketpools.swapTokens` (exactOutput) action -- never bundled
 * with the paired sell, so Hive-Engine's resourcemanager multi-transaction
 * fee (live params, never hardcoded) never applies. `pairedSellPriceSwapHive`
 * carries the round trip's other (not-yet-broadcast) leg's committed price,
 * so this leg still gates on the round trip's own worst-case profit before
 * spending anything.
 */
function admittedSwapLeg(request) {
  const { fields, call } = singleCall(request);
  const sp = call?.contractPayload;
  if (!commonEnvelopeAdmitted(request, fields, ["pricedOverheadSwapHive", "pairedSellPriceSwapHive"]) || request.leg !== "swap"
    || !call || !exactKeys(call, ["contractName", "contractAction", "contractPayload"]) || call.contractName !== "marketpools" || call.contractAction !== "swapTokens"
    || !exactKeys(sp, ["tokenPair", "tokenSymbol", "tokenAmount", "tradeType", "maxAmountIn"]) || sp.tradeType !== "exactOutput"
    || typeof sp.tokenPair !== "string" || !sp.tokenPair.split(":").includes("SWAP.HIVE") || !sp.tokenPair.split(":").includes(sp.tokenSymbol)) return false;
  const quantityPrecision = DECIMAL.exec(String(sp.tokenAmount))?.[1]?.length ?? 0;
  const quantity = units(sp.tokenAmount, quantityPrecision); const input = units(sp.maxAmountIn, 8);
  const pairedPrice = units(request.pairedSellPriceSwapHive, 8);
  const overhead = units(request.pricedOverheadSwapHive, 8); const margin = units(NET_FLOOR_MARGIN_SWAP_HIVE, 8);
  if (quantity === null || input === null || pairedPrice === null || overhead === null || margin === null
    || quantity <= 0n || input <= 0n || pairedPrice <= 0n || overhead < 0n || input > MAX_INPUT) return false;
  const proceeds = quantity * pairedPrice / 10n ** BigInt(quantityPrecision);
  return proceeds >= input + MIN_PROFIT && proceeds >= input + overhead + margin
    && request.target === `${sp.tokenSymbol}:pool-to-book-round-trip`;
}

/**
 * A single `market.sell` action, two shapes: round-trip leg two (target
 * `<SYMBOL>:pool-to-book-round-trip`, carrying `pricedOverheadSwapHive` and
 * `pairedSwapMaxAmountInSwapHive` so the round trip's worst-case profit is
 * re-gated once more before this leg broadcasts), or a standalone
 * reconciliation sell (target `<SYMBOL>:reconciliation-sell`, neither field
 * present -- gated purely on price and book depth).
 */
function admittedSellLeg(request) {
  const { fields, call } = singleCall(request);
  const ep = call?.contractPayload;
  const isRoundTrip = typeof request?.target === "string" && request.target.endsWith(":pool-to-book-round-trip");
  const isReconciliation = typeof request?.target === "string" && request.target.endsWith(":reconciliation-sell");
  const extraKeys = isRoundTrip ? ["pricedOverheadSwapHive", "pairedSwapMaxAmountInSwapHive"] : [];
  if (!isRoundTrip && !isReconciliation) return false;
  if (!commonEnvelopeAdmitted(request, fields, extraKeys) || request.leg !== "sell"
    || !call || !exactKeys(call, ["contractName", "contractAction", "contractPayload"]) || call.contractName !== "market" || call.contractAction !== "sell"
    || !exactKeys(ep, ["symbol", "quantity", "price", "expiration"]) || !Number.isInteger(ep.expiration) || ep.expiration < 1 || ep.expiration > 300) return false;
  const quantityPrecision = DECIMAL.exec(String(ep.quantity))?.[1]?.length ?? 0;
  const quantity = units(ep.quantity, quantityPrecision); const price = units(ep.price, 8);
  if (quantity === null || price === null || quantity <= 0n || price <= 0n || request.target !== `${ep.symbol}:${isRoundTrip ? "pool-to-book-round-trip" : "reconciliation-sell"}`) return false;
  if (!isRoundTrip) return true;
  const pairedInput = units(request.pairedSwapMaxAmountInSwapHive, 8);
  const overhead = units(request.pricedOverheadSwapHive, 8); const margin = units(NET_FLOOR_MARGIN_SWAP_HIVE, 8);
  if (pairedInput === null || overhead === null || margin === null || pairedInput <= 0n || overhead < 0n) return false;
  const proceeds = quantity * price / 10n ** BigInt(quantityPrecision);
  return proceeds >= pairedInput + MIN_PROFIT && proceeds >= pairedInput + overhead + margin;
}

/**
 * The legacy two-action bundle (swapTokens + sell in one custom_json).
 * Never constructed by this package's own automatic-arbitrage-cycle.mjs
 * after 2026-09-05 (see the incident this split repairs), kept only as a
 * defensive, independently gated path: a live `resourcemanager` read
 * enforces the real Hive-Engine multi-transaction BEED floor no invented
 * check can substitute for.
 */
function admittedBundle(request) {
  const fields = request?.operation?.[1]; let calls;
  const scope = ACCOUNTS[request?.account];
  try { calls = JSON.parse(fields?.json ?? ""); } catch { return false; }
  const [swap, sell] = Array.isArray(calls) && calls.length === 2 ? calls : [];
  const sp = swap?.contractPayload; const ep = sell?.contractPayload;
  if (!scope || !exactKeys(request, ["kind", "account", "role", "lane", "target", "keyFile", "operation", "pricedOverheadSwapHive"])
    || request.kind !== "aagaard.hive-write" || request.role !== "active" || request.lane !== "trading" || request.keyFile !== scope.keySentinel
    || !Array.isArray(request.operation) || request.operation[0] !== "custom_json" || !exactKeys(fields, ["id", "required_auths", "required_posting_auths", "json"])
    || fields.id !== "ssc-mainnet-hive" || JSON.stringify(fields.required_auths) !== JSON.stringify([request.account]) || JSON.stringify(fields.required_posting_auths) !== "[]"
    || !exactKeys(swap, ["contractName", "contractAction", "contractPayload"]) || swap.contractName !== "marketpools" || swap.contractAction !== "swapTokens"
    || !exactKeys(sell, ["contractName", "contractAction", "contractPayload"]) || sell.contractName !== "market" || sell.contractAction !== "sell"
    || !exactKeys(sp, ["tokenPair", "tokenSymbol", "tokenAmount", "tradeType", "maxAmountIn"]) || sp.tradeType !== "exactOutput"
    || !exactKeys(ep, ["symbol", "quantity", "price", "expiration"]) || ep.symbol !== sp.tokenSymbol || ep.quantity !== sp.tokenAmount
    || typeof sp.tokenPair !== "string" || !sp.tokenPair.split(":").includes("SWAP.HIVE") || !sp.tokenPair.split(":").includes(sp.tokenSymbol)
    || !Number.isInteger(ep.expiration) || ep.expiration < 1 || ep.expiration > 300) return false;
  const quantityPrecision = DECIMAL.exec(String(sp.tokenAmount))?.[1]?.length ?? 0;
  const quantity = units(sp.tokenAmount, quantityPrecision); const input = units(sp.maxAmountIn, 8); const price = units(ep.price, 8);
  const overhead = units(request.pricedOverheadSwapHive, 8); const margin = units(NET_FLOOR_MARGIN_SWAP_HIVE, 8);
  if (quantity === null || input === null || price === null || overhead === null || margin === null
    || quantity <= 0n || input <= 0n || price <= 0n || overhead < 0n || input > MAX_INPUT) return false;
  const proceeds = quantity * price / 10n ** BigInt(quantityPrecision);
  return proceeds >= input + MIN_PROFIT && proceeds >= input + overhead + margin
    && request.target === `${sp.tokenSymbol}:pool-to-book-round-trip`;
}

export function validateSwapLegRequest(request) {
  if (!admittedSwapLeg(request)) throw new Error("cold-red-gate arbitrage signer refused the unsafe swap-leg envelope");
  return true;
}
export function validateSellLegRequest(request) {
  if (!admittedSellLeg(request)) throw new Error("cold-red-gate arbitrage signer refused the unsafe sell-leg envelope");
  return true;
}
export function validateBundledRoundTripRequest(request) {
  if (!admittedBundle(request)) throw new Error("cold-red-gate arbitrage signer refused the unsafe capital-circulation envelope");
  return true;
}

function remotePreamble(request) {
  const scope = ACCOUNTS[request.account];
  if (!scope) throw new Error("remote arbitrage signer has no account scope");
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
  const marginUnits = units(NET_FLOOR_MARGIN_SWAP_HIVE, 8);
  return { scope, source: `
import { readFileSync, statSync } from "node:fs";
const request = JSON.parse(Buffer.from("${encoded}", "base64").toString("utf8"));
const ACCOUNT = ${JSON.stringify(request.account)}; const KEY = ${JSON.stringify(scope.keyFile)}; const KEY_SENTINEL = ${JSON.stringify(scope.keySentinel)}; const MAX = 100000000n; const MIN = 100000n; const MARGIN = ${marginUnits}n;
const DEC = /^(?:0|[1-9][0-9]*)(?:\\.([0-9]+))?$/u;
const exact = (v, k) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === [...k].sort().join(",");
const units = (v, p) => { const t = String(v ?? ""), m = DEC.exec(t); if (!m || (m[1]?.length ?? 0) > p) return null; const [w,f=""] = t.split("."); return BigInt(w) * 10n ** BigInt(p) + BigInt((f + "0".repeat(p)).slice(0,p) || "0"); };
// A refusal reports one datum plus a reason on stdout and exits 0 -- never
// a throw -- so the systemd oneshot reports Result=success either way
// (every refusal here used to crash the unit, even a working-as-designed one).
const refuse = (datum, reason) => { process.stdout.write(JSON.stringify({status:"refused",datum,reason})); process.exit(0); };
try {
const fields = request?.operation?.[1]; let calls; try { calls = JSON.parse(fields?.json ?? ""); } catch { calls = null; }
` };
}

function remoteRcCheckFragment() {
  return `
const { RpcClient } = await import(${JSON.stringify(RPC_URL)});
const rpc = (node, method, params) => new RpcClient({ nodes: [node], timeout: 10000 }).call(method, params);
const nodes = ["https://api.hive.blog","https://api.openhive.network"];
const rows = await Promise.all(nodes.map(async (node) => { const [accounts,rcAccounts,rcStats] = await Promise.all([rpc(node,"condenser_api.get_accounts",[[ACCOUNT]]),rpc(node,"rc_api.find_rc_accounts",{accounts:[ACCOUNT]}),rpc(node,"rc_api.get_rc_operation_stats",{operation:"custom_json_operation"})]); return { account:accounts?.[0], rc:rcAccounts?.rc_accounts?.[0], average:BigInt(String(rcStats?.avg_cost_rc ?? "0")) }; }));
if (rows.length !== 2 || rows.some(({account,rc,average}) => !account || !rc || average <= 0n)) refuse("rc-evidence-unavailable", "remote arbitrage RC evidence unavailable");
for (const {rc,average} of rows) { const maximum = BigInt(String(rc.max_rc ?? "0")), current = BigInt(String(rc.rc_manabar?.current_mana ?? "0")), updated = Number(rc.rc_manabar?.last_update_time); const now = Math.floor(Date.now()/1000); if (maximum <= 0n || current < 0n || !Number.isSafeInteger(updated)) refuse("rc-evidence-malformed", "remote arbitrage RC evidence malformed"); const regenerated = current + BigInt(Math.max(0,now-updated))*maximum/432000n; if ((regenerated > maximum ? maximum : regenerated) < 2n*average) refuse("insufficient-rc-reserve", "remote arbitrage signer refused insufficient RC reserve"); }
`;
}

function remoteSignAndBroadcastFragment() {
  return `
if ((statSync(KEY).mode & 0o077) !== 0) refuse("key-permissions-too-broad", "remote active key permissions are broader than 0600");
const wif = readFileSync(KEY,"utf8").trim(); const [{HiveClient},{PrivateKey}] = await Promise.all([import(${JSON.stringify(WAGGLE_CLIENT_URL)}),import(${JSON.stringify(WAGGLE_KEYS_URL)})]);
const publicKey = PrivateKey.from(wif).createPublic("STM").toString(); const authority = rows[0].account.active; const threshold = Number(authority?.weight_threshold ?? 1), weight = Number((authority?.key_auths ?? []).find(([key]) => key === publicKey)?.[1] ?? 0); if (weight < threshold) refuse("key-authority-insufficient", "remote key does not independently satisfy active authority");
const result = await new HiveClient({account:ACCOUNT,keys:{active:wif}}).broadcast([request.operation],"active"); if (!/^[0-9a-f]{40}$/.test(result?.id ?? "")) refuse("broadcast-failed", "remote arbitrage broadcast returned no canonical transaction id");
process.stdout.write(JSON.stringify({status:"broadcast",id:result.id}));
} catch (error) { process.stdout.write(JSON.stringify({status:"refused",datum:"unexpected-error",reason: error instanceof Error ? error.message : String(error)})); }
`;
}

function swapLegRemoteSource(request) {
  const { source } = remotePreamble(request);
  return `${source}
const [call] = Array.isArray(calls) ? calls : []; const sp = call?.contractPayload;
const qp = DEC.exec(String(sp?.tokenAmount ?? ""))?.[1]?.length ?? 0; const q = units(sp?.tokenAmount, qp), input = units(sp?.maxAmountIn,8);
const pairedPrice = units(request?.pairedSellPriceSwapHive, 8); const overhead = units(request?.pricedOverheadSwapHive, 8);
const admitted = exact(request,["kind","account","role","lane","target","keyFile","leg","operation","pricedOverheadSwapHive","pairedSellPriceSwapHive"]) && request.leg === "swap" && request.kind === "aagaard.hive-write" && request.account === ACCOUNT && request.role === "active" && request.lane === "trading" && request.keyFile === KEY_SENTINEL
  && Array.isArray(calls) && calls.length === 1 && Array.isArray(request.operation) && request.operation[0] === "custom_json" && exact(fields,["id","required_auths","required_posting_auths","json"]) && fields.id === "ssc-mainnet-hive" && JSON.stringify(fields.required_auths) === JSON.stringify([ACCOUNT]) && JSON.stringify(fields.required_posting_auths) === "[]"
  && exact(call,["contractName","contractAction","contractPayload"]) && call.contractName === "marketpools" && call.contractAction === "swapTokens" && exact(sp,["tokenPair","tokenSymbol","tokenAmount","tradeType","maxAmountIn"]) && sp.tradeType === "exactOutput"
  && typeof sp.tokenPair === "string" && sp.tokenPair.split(":").includes("SWAP.HIVE") && sp.tokenPair.split(":").includes(sp.tokenSymbol)
  && q !== null && input !== null && pairedPrice !== null && overhead !== null && q > 0n && input > 0n && pairedPrice > 0n && overhead >= 0n && input <= MAX
  && q * pairedPrice / 10n ** BigInt(qp) >= input + MIN && request.target === sp.tokenSymbol + ":pool-to-book-round-trip";
if (!admitted) refuse("unsafe-envelope", "remote arbitrage signer refused the unsafe swap-leg envelope");
${remoteRcCheckFragment()}
// The pool's only fee is the default 25bps already netted into the
// certified quote (verified 2026-09-05); a fresh chain read still checks
// whether current reserves realize the exactOutput swap within the signed
// maxAmountIn, and whether worst-case profit still clears overhead+margin.
const poolState = await Promise.all(["https://api.hive-engine.com/rpc/contracts","https://herpc.dtools.dev/contracts"].map(async (node) => { const result = await rpc(node,"find",{contract:"marketpools",table:"pools",query:{tokenPair:sp.tokenPair},limit:2,offset:0,indexes:[]}); if (!Array.isArray(result) || result.length !== 1) throw new Error("remote pool reserve evidence unavailable"); return result[0]; }));
if (JSON.stringify(poolState[0]) !== JSON.stringify(poolState[1])) refuse("route-stale", "remote pool reserve evidence disagrees between providers");
const pool = poolState[0]; const [poolBase,poolQuote] = String(pool.tokenPair ?? "").split(":");
if (poolBase !== sp.tokenSymbol && poolQuote !== sp.tokenSymbol) refuse("route-stale", "remote pool reserve evidence names a different pair");
const toFraction = (v) => { const t = String(v ?? ""), m = DEC.exec(t); if (!m) throw new Error("remote pool reserve is not an exact decimal"); const digits = m[1]?.length ?? 0; return [BigInt(t.replace(".", "")), 10n ** BigInt(digits)]; };
const [baseNum,baseDen] = toFraction(pool.baseQuantity); const [quoteNum,quoteDen] = toFraction(pool.quoteQuantity);
const [reserveInNum,reserveInDen] = poolBase === sp.tokenSymbol ? [quoteNum,quoteDen] : [baseNum,baseDen];
const [reserveOutNum,reserveOutDen] = poolBase === sp.tokenSymbol ? [baseNum,baseDen] : [quoteNum,quoteDen];
const feeMultiplier = pool.tradeFeeMultiplier === undefined ? null : Number(pool.tradeFeeMultiplier);
if (feeMultiplier !== null && (!Number.isFinite(feeMultiplier) || feeMultiplier <= 0 || feeMultiplier > 1)) refuse("route-stale", "remote pool fee evidence is malformed");
const poolFeeBps = feeMultiplier === null ? 25 : Math.round((1 - feeMultiplier) * 10000);
const tokenScale = 10n ** BigInt(qp); const swapScale = 100000000n;
const reserveDifference = reserveOutNum * tokenScale - q * reserveOutDen;
if (reserveDifference <= 0n) refuse("route-stale", "pool reserves can no longer realize the certified output");
const expectedInput = (reserveInNum * q * reserveOutDen * swapScale * 10000n + reserveInDen * reserveDifference * BigInt(10000 - poolFeeBps) - 1n) / (reserveInDen * reserveDifference * BigInt(10000 - poolFeeBps));
if (expectedInput > input) refuse("route-stale", "current pool reserves would exceed the committed maxAmountIn");
const gross = q * pairedPrice / 10n ** BigInt(qp) - input;
if (gross < overhead + MARGIN) refuse("route-stale", "fresh worst-case profit is below the priced overhead plus margin");
${remoteSignAndBroadcastFragment()}`;
}

function sellLegRemoteSource(request) {
  const { source } = remotePreamble(request);
  const isRoundTrip = typeof request?.target === "string" && request.target.endsWith(":pool-to-book-round-trip");
  return `${source}
const [call] = Array.isArray(calls) ? calls : []; const ep = call?.contractPayload;
const qp = DEC.exec(String(ep?.quantity ?? ""))?.[1]?.length ?? 0; const q = units(ep?.quantity, qp), price = units(ep?.price,8);
const roundTrip = ${isRoundTrip ? "true" : "false"};
const pairedInput = roundTrip ? units(request?.pairedSwapMaxAmountInSwapHive, 8) : null; const overhead = roundTrip ? units(request?.pricedOverheadSwapHive, 8) : null;
const expectedKeys = roundTrip ? ["kind","account","role","lane","target","keyFile","leg","operation","pricedOverheadSwapHive","pairedSwapMaxAmountInSwapHive"] : ["kind","account","role","lane","target","keyFile","leg","operation"];
const admitted = exact(request,expectedKeys) && request.leg === "sell" && request.kind === "aagaard.hive-write" && request.account === ACCOUNT && request.role === "active" && request.lane === "trading" && request.keyFile === KEY_SENTINEL
  && Array.isArray(calls) && calls.length === 1 && Array.isArray(request.operation) && request.operation[0] === "custom_json" && exact(fields,["id","required_auths","required_posting_auths","json"]) && fields.id === "ssc-mainnet-hive" && JSON.stringify(fields.required_auths) === JSON.stringify([ACCOUNT]) && JSON.stringify(fields.required_posting_auths) === "[]"
  && exact(call,["contractName","contractAction","contractPayload"]) && call.contractName === "market" && call.contractAction === "sell" && exact(ep,["symbol","quantity","price","expiration"]) && Number.isInteger(ep.expiration) && ep.expiration > 0 && ep.expiration <= 300
  && q !== null && price !== null && q > 0n && price > 0n && request.target === ep.symbol + (roundTrip ? ":pool-to-book-round-trip" : ":reconciliation-sell")
  && (!roundTrip || (pairedInput !== null && overhead !== null && pairedInput > 0n && overhead >= 0n && q * price / 10n ** BigInt(qp) >= pairedInput + MIN && q * price / 10n ** BigInt(qp) >= pairedInput + overhead + MARGIN));
if (!admitted) refuse("unsafe-envelope", "remote arbitrage signer refused the unsafe sell-leg envelope");
${remoteRcCheckFragment()}
// A fresh order-book read is the real "route-stale" check for a sell: the
// committed price only bounds against selling for LESS, never against the
// book lacking enough depth at or above it to fill the whole quantity --
// which would otherwise leave part of it resting, burning overhead for
// less than the certified proceeds.
const bookState = await Promise.all(["https://api.hive-engine.com/rpc/contracts","https://herpc.dtools.dev/contracts"].map(async (node) => { const result = await rpc(node,"find",{contract:"market",table:"buyBook",query:{symbol:ep.symbol},limit:200,offset:0,indexes:[{index:"priceDec",descending:true}]}); if (!Array.isArray(result)) throw new Error("remote order book evidence unavailable"); return result; }));
if (JSON.stringify(bookState[0]) !== JSON.stringify(bookState[1])) refuse("route-stale", "remote order book evidence disagrees between providers");
// Book levels carry their own decimal precision (the token's real
// precision, e.g. 8), independent of qp (our own committed quantity
// string's precision) -- floor-rescale to qp so a finer-grained level
// quantity never fails to parse and never overstates depth.
const floorUnits = (v, targetPrecision) => { const t = String(v ?? ""), m = DEC.exec(t); if (!m) return null; const ownDigits = m[1]?.length ?? 0; const [w,f=""] = t.split("."); const raw = BigInt(w) * 10n ** BigInt(ownDigits) + BigInt(f || "0"); return ownDigits <= targetPrecision ? raw * 10n ** BigInt(targetPrecision - ownDigits) : raw / 10n ** BigInt(ownDigits - targetPrecision); };
let depth = 0n, prior = null;
for (const level of bookState[0]) { const levelPrice = floorUnits(level.price, 8); const levelQty = floorUnits(level.quantity, qp); if (levelPrice === null || levelQty === null || levelPrice <= 0n || levelQty <= 0n || (prior !== null && levelPrice > prior)) refuse("route-stale", "remote order book evidence malformed"); prior = levelPrice; if (levelPrice < price) break; depth += levelQty; if (depth >= q) break; }
if (depth < q) refuse("route-stale", "current order book no longer has enough depth at or above the committed price to fill the whole quantity");
${remoteSignAndBroadcastFragment()}`;
}

function bundleRemoteSource(request) {
  const { source } = remotePreamble(request);
  return `${source}
const [swap,sell] = Array.isArray(calls) ? calls : []; const sp = swap?.contractPayload, ep = sell?.contractPayload;
const qp = DEC.exec(String(sp?.tokenAmount ?? ""))?.[1]?.length ?? 0; const q = units(sp?.tokenAmount, qp), input = units(sp?.maxAmountIn,8), price = units(ep?.price,8);
const overhead = units(request?.pricedOverheadSwapHive, 8);
const admitted = exact(request,["kind","account","role","lane","target","keyFile","operation","pricedOverheadSwapHive"]) && request.kind === "aagaard.hive-write" && request.account === ACCOUNT && request.role === "active" && request.lane === "trading" && request.keyFile === KEY_SENTINEL
  && Array.isArray(request.operation) && request.operation[0] === "custom_json" && exact(fields,["id","required_auths","required_posting_auths","json"]) && fields.id === "ssc-mainnet-hive" && JSON.stringify(fields.required_auths) === JSON.stringify([ACCOUNT]) && JSON.stringify(fields.required_posting_auths) === "[]"
  && exact(swap,["contractName","contractAction","contractPayload"]) && swap.contractName === "marketpools" && swap.contractAction === "swapTokens" && exact(sp,["tokenPair","tokenSymbol","tokenAmount","tradeType","maxAmountIn"]) && sp.tradeType === "exactOutput"
  && exact(sell,["contractName","contractAction","contractPayload"]) && sell.contractName === "market" && sell.contractAction === "sell" && exact(ep,["symbol","quantity","price","expiration"]) && ep.symbol === sp.tokenSymbol && ep.quantity === sp.tokenAmount && typeof sp.tokenPair === "string" && sp.tokenPair.split(":").includes("SWAP.HIVE") && sp.tokenPair.split(":").includes(sp.tokenSymbol) && Number.isInteger(ep.expiration) && ep.expiration > 0 && ep.expiration <= 300
  && q !== null && input !== null && price !== null && overhead !== null && overhead >= 0n && q > 0n && input > 0n && price > 0n && input <= MAX && q * price / 10n ** BigInt(qp) >= input + MIN && request.target === sp.tokenSymbol + ":pool-to-book-round-trip";
if (!admitted) refuse("unsafe-envelope", "remote arbitrage signer refused unsafe envelope");
${remoteRcCheckFragment()}
// Bundling 2+ actions crosses resourcemanager.numberOfFreeTx (live params,
// never hardcoded) and burns a real multiTransactionFee in burnSymbol from
// the sender -- verified 2026-09-05 against michael561's real
// a6308f23ba5026f1e670e61cea257eaf62524322: the swap leg succeeded, the
// sell leg failed on-chain holding only 0.0002 BEED against a 0.001 floor --
// the real fee the removed BEED bid-book check was wrongly approximating.
const paramsState = await Promise.all(["https://api.hive-engine.com/rpc/contracts","https://herpc.dtools.dev/contracts"].map(async (node) => { const result = await rpc(node,"find",{contract:"resourcemanager",table:"params",query:{},limit:2,offset:0,indexes:[]}); if (!Array.isArray(result) || result.length !== 1) throw new Error("remote resourcemanager params evidence unavailable"); return result[0]; }));
if (JSON.stringify(paramsState[0]) !== JSON.stringify(paramsState[1])) refuse("beed-balance-insufficient", "remote resourcemanager params evidence disagrees between providers");
const rmParams = paramsState[0]; const freeTx = Number(rmParams.numberOfFreeTx ?? 1); const burnSymbol = String(rmParams.burnSymbol ?? "BEED"); const feeUnits = units(rmParams.multiTransactionFee, 4);
if (!Number.isInteger(freeTx) || freeTx < 1 || feeUnits === null) refuse("beed-balance-insufficient", "remote resourcemanager params evidence malformed");
if (2 > freeTx) {
  const balanceState = await Promise.all(["https://api.hive-engine.com/rpc/contracts","https://herpc.dtools.dev/contracts"].map(async (node) => { const result = await rpc(node,"find",{contract:"tokens",table:"balances",query:{account:ACCOUNT,symbol:burnSymbol},limit:2,offset:0,indexes:[]}); if (!Array.isArray(result)) throw new Error("remote burn-symbol balance evidence unavailable"); return result; }));
  if (JSON.stringify(balanceState[0]) !== JSON.stringify(balanceState[1])) refuse("beed-balance-insufficient", "remote burn-symbol balance evidence disagrees between providers");
  const balance = units(balanceState[0][0]?.balance ?? "0", 4);
  if (balance === null || balance < feeUnits) refuse("beed-balance-insufficient", \`account holds fewer than \${rmParams.multiTransactionFee} \${burnSymbol}, the live resourcemanager multi-transaction fee for bundling \${2} actions\`);
}
const poolState = await Promise.all(["https://api.hive-engine.com/rpc/contracts","https://herpc.dtools.dev/contracts"].map(async (node) => { const result = await rpc(node,"find",{contract:"marketpools",table:"pools",query:{tokenPair:sp.tokenPair},limit:2,offset:0,indexes:[]}); if (!Array.isArray(result) || result.length !== 1) throw new Error("remote pool reserve evidence unavailable"); return result[0]; }));
if (JSON.stringify(poolState[0]) !== JSON.stringify(poolState[1])) refuse("route-stale", "remote pool reserve evidence disagrees between providers");
const pool = poolState[0]; const [poolBase,poolQuote] = String(pool.tokenPair ?? "").split(":");
if (poolBase !== sp.tokenSymbol && poolQuote !== sp.tokenSymbol) refuse("route-stale", "remote pool reserve evidence names a different pair");
const toFraction = (v) => { const t = String(v ?? ""), m = DEC.exec(t); if (!m) throw new Error("remote pool reserve is not an exact decimal"); const digits = m[1]?.length ?? 0; return [BigInt(t.replace(".", "")), 10n ** BigInt(digits)]; };
const [baseNum,baseDen] = toFraction(pool.baseQuantity); const [quoteNum,quoteDen] = toFraction(pool.quoteQuantity);
const [reserveInNum,reserveInDen] = poolBase === sp.tokenSymbol ? [quoteNum,quoteDen] : [baseNum,baseDen];
const [reserveOutNum,reserveOutDen] = poolBase === sp.tokenSymbol ? [baseNum,baseDen] : [quoteNum,quoteDen];
const feeMultiplier = pool.tradeFeeMultiplier === undefined ? null : Number(pool.tradeFeeMultiplier);
if (feeMultiplier !== null && (!Number.isFinite(feeMultiplier) || feeMultiplier <= 0 || feeMultiplier > 1)) refuse("route-stale", "remote pool fee evidence is malformed");
const poolFeeBps = feeMultiplier === null ? 25 : Math.round((1 - feeMultiplier) * 10000);
const tokenScale = 10n ** BigInt(qp); const swapScale = 100000000n;
const reserveDifference = reserveOutNum * tokenScale - q * reserveOutDen;
if (reserveDifference <= 0n) refuse("route-stale", "pool reserves can no longer realize the certified output");
const expectedInput = (reserveInNum * q * reserveOutDen * swapScale * 10000n + reserveInDen * reserveDifference * BigInt(10000 - poolFeeBps) - 1n) / (reserveInDen * reserveDifference * BigInt(10000 - poolFeeBps));
if (expectedInput > input) refuse("route-stale", "current pool reserves would exceed the committed maxAmountIn");
const gross = q * price / 10n ** BigInt(qp) - input;
if (gross < overhead + MARGIN) refuse("route-stale", "fresh worst-case profit is below the priced overhead plus margin");
${remoteSignAndBroadcastFragment()}`;
}

function runRemoteScript(source) {
  return new Promise((resolvePromise, rejectPromise) => {
    const localSigner = process.env.AAGAARD_COLD_RED_GATE_LOCAL_SIGNER === "1";
    const child = localSigner
      ? spawn(process.execPath, ["--input-type=module", "-"], { stdio: ["pipe", "pipe", "pipe"] })
      : spawn("ssh", ["-T", "-o", "BatchMode=yes", HOST, "sh", "-lc", "cd /home/emsenn/561-group/releases/hive-fleet-signer-current && exec node --input-type=module -"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => { if (code !== 0) rejectPromise(new Error(stderr.trim() || `remote signer exited ${code}`)); else { try { resolvePromise(JSON.parse(stdout)); } catch { rejectPromise(new Error("remote signer returned invalid JSON")); } } });
    child.stdin.end(source);
  });
}

/** @returns {Promise<{status:"broadcast",id:string}|{status:"refused",datum:string,reason:string}>} */
export function broadcastSwapLegViaColdRedGate(request) {
  validateSwapLegRequest(request);
  return runRemoteScript(swapLegRemoteSource(request));
}
/** @returns {Promise<{status:"broadcast",id:string}|{status:"refused",datum:string,reason:string}>} */
export function broadcastSellLegViaColdRedGate(request) {
  validateSellLegRequest(request);
  return runRemoteScript(sellLegRemoteSource(request));
}
/** @returns {Promise<{status:"broadcast",id:string}|{status:"refused",datum:string,reason:string}>} */
export function broadcastBundledRoundTripViaColdRedGate(request) {
  validateBundledRoundTripRequest(request);
  return runRemoteScript(bundleRemoteSource(request));
}

async function main() {
  const request = JSON.parse(readFileSync(0, "utf8"));
  const broadcast = request?.leg === "swap" ? broadcastSwapLegViaColdRedGate
    : request?.leg === "sell" ? broadcastSellLegViaColdRedGate
      : broadcastBundledRoundTripViaColdRedGate;
  process.stdout.write(JSON.stringify(await broadcast(request)));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch(reportFailure);
