#!/usr/bin/env node
import { FLEET_DATA_DIR } from "../src/core/journal.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
import { engineTransaction } from "../src/core/hiveScriptSupport.mjs";
// Buy a bounded quantity of an income-paying Hive-Engine token. Observation is independent and
// keyless; execution revalidates market depth, the token's settled income (read from an account
// already holding it), the deployed peg code, fleet self-cross, capital and concentration limits,
// then hands one limit buy to the signer, whose income-token lane bounds the spend.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { planIncomeTokenAcquisition, recordIncomeTokenAcquisition } from "../src/index.mjs";
import { FLEET_ACCOUNTS as FLEET } from "../src/core/core.adapter.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { attestProviders } from "../src/core/providerAttestation.mjs";
import { engineCustomJson, market } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { EngineClient } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { operate as auditIncomeToken } from "./income-token-audit.mjs";
import { decimalUnits, formatUnits } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { liveEngineBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
import { sha256Digest } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
const hiveReader = new HiveClient();

const RPC_OPTIONS = Object.freeze({ timeout: 12000 });
const DATA_DIR = FLEET_DATA_DIR;
const CONTRACT_PROVIDERS = Object.freeze(["https://api.hive-engine.com/rpc", "https://herpc.dtools.dev", "https://herpc.liotes.com"]);
const PEG_PROVIDERS = Object.freeze(["https://api.hive-engine.com/rpc", "https://api2.hive-engine.com/rpc"]);
const BLOCKCHAIN_PROVIDERS = Object.freeze(["https://api.hive-engine.com/rpc", "https://herpc.dtools.dev"]);
const PEG_CODE_DIGEST = "sha256:ff93fd0ed74c24bff2152c517289c9de043129a74dadff190a843f49213bc575";

function fail(message) { throw new Error(`income-token-acquire: ${message}`); }
export function parseOptions(argv) {
  const options = { account: "", symbol: "", quantity: "", evidenceAccount: "", executeOne: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const take = () => { const value = argv[index + 1]; if (!value || value.startsWith("--")) fail(`${flag} requires a value`); index += 1; return value; };
    if (flag === "--account") options.account = take().toLowerCase();
    else if (flag === "--symbol") options.symbol = take().toUpperCase();
    else if (flag === "--quantity") options.quantity = take();
    else if (flag === "--evidence-account") options.evidenceAccount = take().toLowerCase();
    else if (flag === "--execute-one") options.executeOne = true;
    else fail(`unknown argument ${flag}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(options.account)) fail("a canonical Hive --account is required");
  if (!/^[A-Z][A-Z0-9.]{0,19}$/u.test(options.symbol) || options.symbol === "SWAP.HIVE") fail("an income-token --symbol is required");
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(options.quantity)) fail("a canonical --quantity is required");
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(options.evidenceAccount)) fail("an --evidence-account already holding the token is required");
  return Object.freeze(options);
}



async function marketObservation(provider, order) { const observedAt = new Date().toISOString();
  const rpcClient = new EngineClient({ nodes: [provider], timeout: 15_000, serial: true });
  try { const [tokens, swaps, fleetBalances, asks, bids] = await Promise.all([
    rpcClient.find("tokens", "tokens", { symbol: order.symbol }, { limit: 2 }),
    rpcClient.find("tokens", "balances", { account: order.account, symbol: "SWAP.HIVE" }, { limit: 2 }),
    rpcClient.find("tokens", "balances", { account: { $in: FLEET }, symbol: order.symbol }, { limit: 20 }),
    rpcClient.find("market", "sellBook", { symbol: order.symbol }, { limit: 1000, indexes: [{ index: "priceDec", descending: false }] }),
    rpcClient.find("market", "buyBook", { symbol: order.symbol }, { limit: 1000, indexes: [{ index: "priceDec", descending: true }] }),
  ]); if (tokens.length !== 1 || swaps.length !== 1) fail(`${provider} returned incomplete acquisition inventory`);
    const precision = Number(tokens[0].precision); if (!Number.isSafeInteger(precision) || precision < 0 || precision > 8) fail(`${order.symbol} precision is malformed`);
    const byAccount = Object.fromEntries(fleetBalances.map((row) => [String(row.account), formatUnits(decimalUnits(row.balance, precision), precision)]));
    const existing = fleetBalances.reduce((sum, row) => sum + decimalUnits(row.balance, precision), 0n);
    const state = Object.freeze({ tokenPrecision: precision, swapHiveBalance: formatUnits(decimalUnits(swaps[0].balance, 8), 8),
      accountTokenBalance: byAccount[order.account] ?? formatUnits(0n, precision), existingFleetQuantity: formatUnits(existing, precision),
      asks: liveEngineBook(asks, precision, "ask", Math.floor(Date.parse(observedAt) / 1000)),
      bids: liveEngineBook(bids, precision, "bid", Math.floor(Date.parse(observedAt) / 1000))
        .filter((row) => !FLEET.includes(row.account)) });
    return Object.freeze({ provider, status: "available", observedAt, stateDigest: semanticId(state), state });
  } catch (error) { return Object.freeze({ provider, status: "unavailable", problem: error instanceof Error ? error.message : String(error) }); } }

async function certifiedMarket(order) { const rows = await Promise.all(CONTRACT_PROVIDERS.map((provider) => marketObservation(provider, order)));
  const attested = attestProviders(rows);
  if (attested.value !== "true") fail(attested.refusal === "provider-state-contested" ? "Hive Engine acquisition state is contested" : "independent acquisition state support is insufficient");
  const [[stateDigest, winner]] = attested.groups; return Object.freeze({ state: winner.state, stateDigest,
    providers: Object.freeze([...winner.providers].sort()), unavailable: attested.unavailable }); }

async function revalidatePegCode() { const rows = await Promise.all(PEG_PROVIDERS.map(async (provider) => {
  try { const contract = await new EngineClient({ nodes: [provider], timeout: RPC_OPTIONS.timeout }).getContract("hivepegged"); const codeDigest = sha256Digest(String(contract?.code ?? ""));
    return Object.freeze({ provider, owner: String(contract?.owner ?? ""), version: Number(contract?.version), codeDigest }); }
  catch (error) { return Object.freeze({ provider, problem: error instanceof Error ? error.message : String(error) }); } }));
  if (rows.length !== 2 || rows.some((row) => row.codeDigest !== PEG_CODE_DIGEST || row.owner !== "honey-swap" || row.version !== 3)) fail("deployed peg code no longer matches the contracted fee-mechanics evidence");
  return Object.freeze({ codeDigest: PEG_CODE_DIGEST,
    providers: Object.freeze(rows.map((row) => row.provider)), depositFeeBps: 75, minimumFeeHive: "0.001",
    limits: Object.freeze(["deposit-mechanics-not-reserve-proof", "historical-cashflow-not-guaranteed"]) }); }

async function freshPlan(order) { const [market, income, peg] = await Promise.all([certifiedMarket(order), auditIncomeToken({ account: order.evidenceAccount, symbol: order.symbol, record: false }), revalidatePegCode()]);
  const position = income.position; const annual = String(position?.projection?.annualizedNativeHive ?? "").replace(/ HIVE$/u, "");
  const annualHolding = String(position?.realized?.latest?.reportedHolding ?? "");
  const result = planIncomeTokenAcquisition({ symbol: order.symbol, tokenPrecision: market.state.tokenPrecision, purchaseQuantity: order.quantity,
    swapHiveBalance: market.state.swapHiveBalance, existingFleetQuantity: market.state.existingFleetQuantity,
    annualizedNativeHive: annual, annualizedHoldingQuantity: annualHolding, asks: market.state.asks, bids: market.state.bids,
    fleetAccounts: FLEET, policy: { maximumSpendSwapHive: "1.02000000", minimumSwapHiveReserve: "70.00000000",
      maximumLiquidCapitalBps: 150, maximumExposureGrowthBps: 200, minimumHaircuttedYieldBps: 500,
      maximumImmediateDrawdownBps: 500, incomeRetentionBps: 5000, hiveDepositFeeBps: peg.depositFeeBps,
      hiveDepositMinimumFee: peg.minimumFeeHive } });
  const plan = result.admitted ? Object.freeze({ ...result, quote: Object.freeze({ ...result.quote,
    operation: engineCustomJson(order.account, market.buy({ symbol: order.symbol, quantity: QUANTITY, price: result.quote.limitPriceSwapHive, expiration: 300 })) }) }) : result;
  return Object.freeze({ market, income: position, peg, plan }); }

async function engineTransactions(txid) { const rows = await Promise.all(BLOCKCHAIN_PROVIDERS.map((node) => engineTransaction(node, txid, { timeoutMs: RPC_OPTIONS.timeout, fail })));
  return rows.every(Boolean) ? Object.freeze(rows) : null; }

async function effectState(node, txid, order) { const rpcClient = new EngineClient({ nodes: [node], timeout: 15_000, serial: true });
  const [tokens, swaps, orders] = await Promise.all([rpcClient.find("tokens", "balances", { account: order.account, symbol: order.symbol }, { limit: 2 }),
    rpcClient.find("tokens", "balances", { account: order.account, symbol: "SWAP.HIVE" }, { limit: 2 }), rpcClient.find("market", "buyBook", { account: order.account, symbol: order.symbol }, { limit: 1000 })]);
  return Object.freeze({ provider: node, tokenBalance: String(tokens[0]?.balance ?? "0"), swapHiveBalance: String(swaps[0]?.balance ?? "0.00000000"),
    matchingOpenOrders: Object.freeze(orders.filter((row) => String(row.txId ?? "").startsWith(txid)).map((row) => Object.freeze({ txId: String(row.txId), quantity: String(row.quantity), price: String(row.price) }))) }); }

async function waitForEffect(txid, before, maximumSpend, order) { for (let attempt = 0; attempt < 25; attempt += 1) { const [engine, states] = await Promise.all([engineTransactions(txid), Promise.all(CONTRACT_PROVIDERS.map((node) => effectState(node, txid, order)))]);
    const places = before.tokenPrecision; const expectedToken = decimalUnits(before.accountTokenBalance, places) + decimalUnits(order.quantity, places); const beforeSwap = decimalUnits(before.swapHiveBalance, 8); const max = decimalUnits(maximumSpend, 8);
    const exact = states.every((state) => decimalUnits(state.tokenBalance, places) === expectedToken && beforeSwap > decimalUnits(state.swapHiveBalance, 8)
      && beforeSwap - decimalUnits(state.swapHiveBalance, 8) <= max && state.matchingOpenOrders.length === 0)
      && new Set(states.map((state) => JSON.stringify([state.tokenBalance, state.swapHiveBalance, state.matchingOpenOrders]))).size === 1;
    if (engine && exact) return Object.freeze({ engine, states, acquiredQuantity: order.quantity, spentSwapHive: formatUnits(beforeSwap - decimalUnits(states[0].swapHiveBalance, 8), 8) });
    if (attempt < 24) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200)); }
  return null; }

export async function operate(options) { const order = options; const fresh = await freshPlan(order); const base = Object.freeze({ kind: "aagaard.income-token-acquisition-receipt",
  account: order.account, symbol: order.symbol, observedAt: new Date().toISOString(), market: Object.freeze({ stateDigest: fresh.market.stateDigest, providers: fresh.market.providers,
    unavailable: fresh.market.unavailable }), peg: fresh.peg, incomeEvidence: Object.freeze({ sourceAgreement: fresh.income.sourceAgreement,
    realized: fresh.income.realized, projection: fresh.income.projection }), before: Object.freeze({ tokenBalance: fresh.market.state.accountTokenBalance,
    swapHiveBalance: fresh.market.state.swapHiveBalance, existingFleetQuantity: fresh.market.state.existingFleetQuantity }), plan: fresh.plan });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed", credentialAccess: false, chainMutation: false });
  if (!fresh.plan.admitted) fail(`fresh plan is not admitted: ${fresh.plan.reason}`);
  const request = { account: order.account, role: "active", lane: "income-token-acquisition", target: `acquire:${order.symbol}:${order.quantity}:${fresh.plan.quote.limitPriceSwapHive}`,
    operation: fresh.plan.quote.operation }; let submission;
  try { submission = await submitToSigner(request); } catch (error) { throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  const transactionId = String(submission?.id ?? ""); if (!/^[0-9a-f]{40}$/u.test(transactionId)) fail("submission returned no canonical transaction id; do not retry automatically");
  let hive = null, effect = null, settlementError = null;
  try { hive = await hiveReader.confirmTransaction(transactionId, fresh.plan.quote.operation); effect = await waitForEffect(transactionId, fresh.market.state, fresh.plan.quote.maximumEscrowSwapHive, order);
    if (!effect) settlementError = "acquisition did not independently reconcile before timeout"; } catch (error) { settlementError = error instanceof Error ? error.message : String(error); }
  const completedAt = new Date().toISOString(); const receipt = Object.freeze({ ...base, transactionId, ...(hive ? { hive } : {}),
    status: effect ? "acquired-confirmed" : "settlement-pending", retryAllowed: false, credentialAccess: Object.freeze({ occurred: true, location: process.env.HIVE_SIGNER_HOST || "local-keystore", role: "active" }),
    ...(effect ? { engine: effect.engine, after: effect.states, acquiredQuantity: effect.acquiredQuantity, spentSwapHive: effect.spentSwapHive } : {}),
    ...(settlementError ? { settlementError } : {}), completedAt });
  const event = await recordIncomeTokenAcquisition(DATA_DIR, receipt, completedAt); return Object.freeze({ ...receipt, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }) }); }

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) { main().catch(reportFailure); }
