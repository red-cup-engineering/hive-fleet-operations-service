#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { broadcastArbitrageViaColdRedGate } from "./cold-red-gate-arbitrage-broadcast.mjs";
import { observe as scanUniverse } from "./global-arbitrage-scan.mjs";
import { assessRoundTripEconomicEffect, observeBeedFeeWitness } from "../src/integrations/hive-engine/hiveEngineConfirmation.mjs";

const DEFAULT_ACCOUNT = "sigmund-vexler";
const AUTONOMOUS_ACCOUNTS = Object.freeze(new Set(["sigmund-vexler", "michael561"]));
const BROADCASTER = new URL("./hive-broadcast.mjs", import.meta.url);
function coldRedGateKey(account) { return `cold-red-gate:${account}/active`; }

function fail(message) { throw new Error(`automatic-arbitrage-cycle: ${message}`); }

export function selectOpportunity(scan, account = DEFAULT_ACCOUNT) {
  if (!AUTONOMOUS_ACCOUNTS.has(account) || scan?.status !== "certified" || scan.account !== account || scan.providerKnowledge?.value !== "true") return null;
  const candidates = (scan.opportunities ?? []).filter((row) => row.policyAdmitted === true && row.exact?.admitted === true);
  if (candidates.length === 0) return null;
  return candidates[0];
}

export function roundTripRequest(opportunity, keyFile, account = DEFAULT_ACCOUNT) {
  const quote = opportunity?.exact?.quote;
  if (!quote || typeof keyFile !== "string" || keyFile.length === 0) fail("an exact opportunity and key file are required");
  const calls = [
    { contractName: "marketpools", contractAction: "swapTokens", contractPayload: {
      tokenPair: opportunity.pool, tokenSymbol: opportunity.symbol, tokenAmount: quote.quantity,
      tradeType: "exactOutput", maxAmountIn: quote.maxInputSwapHive,
    } },
    { contractName: "market", contractAction: "sell", contractPayload: {
      symbol: opportunity.symbol, quantity: quote.quantity,
      price: quote.limitSellPriceSwapHive, expiration: 300,
    } },
  ];
  if (!AUTONOMOUS_ACCOUNTS.has(account)) fail("account is not admitted to autonomous arbitrage");
  return Object.freeze({ kind: "aagaard.hive-write", account, role: "active", lane: "trading",
    target: `${opportunity.symbol}:pool-to-book-round-trip`, keyFile,
    operation: Object.freeze(["custom_json", Object.freeze({ id: "ssc-mainnet-hive", required_auths: Object.freeze([account]),
      required_posting_auths: Object.freeze([]), json: JSON.stringify(calls) })]) });
}

function broadcast(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BROADCASTER.pathname], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `broadcaster exited ${code}`));
      else { try { resolve(JSON.parse(stdout)); } catch { reject(new Error("broadcaster returned invalid JSON")); } }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function confirmRoundTrip(account, request, transactionId) {
  const calls = JSON.parse(request.operation[1].json);
  const nodes = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const observations = await Promise.all(nodes.map(async (node) => {
      try { const response = await fetch(node, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionInfo", params: { txid: transactionId } }), signal: AbortSignal.timeout(10_000) }); const body = await response.json(); return response.ok && !body?.error && Array.isArray(body?.result) ? body.result : null; }
      catch { return null; }
    }));
    if (observations[0] && JSON.stringify(observations[0]) === JSON.stringify(observations[1])) return assessRoundTripEconomicEffect(account, calls, observations[0]);
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return Object.freeze({ status: "unverified", source: "hive-engine.getTransactionInfo", expectedLegs: 2, confirmedLegs: 0 });
}

export async function operate({ account = DEFAULT_ACCOUNT, keyFile, executeOne = false, coldRedGateSigner = false, economicCostWitness = null, feeWitness = observeBeedFeeWitness, scan = scanUniverse, submit = broadcast } = {}) {
  if (!AUTONOMOUS_ACCOUNTS.has(account)) fail("account is not admitted to autonomous arbitrage");
  const observedAt = new Date().toISOString();
  const universe = await scan({ account });
  const opportunity = selectOpportunity(universe, account);
  const base = { kind: "aagaard.automatic-arbitrage-cycle", account, observedAt,
    scan: { status: universe.status, observedAt: universe.observedAt, admittedCount: universe.admittedCount ?? null,
      providers: universe.certifyingProviders ?? [] } };
  if (!opportunity) return Object.freeze({ ...base, status: "no-admissible-route", credentialAccess: false, chainMutation: false });
  if (!executeOne) return Object.freeze({ ...base, status: "admissible-route-observed", opportunity,
    credentialAccess: false, chainMutation: false });
  // Fail closed before key access.  The on-chain transfer rows can prove a
  // gross SWAP.HIVE delta but cannot price RC depletion,
  // signer, or runner/paymaster resources.  An autonomous deployment must
  // supply a fresh, independently witnessed net-cost settlement for all three.
  // Hive Engine's market leg can burn BEED.  Runner and RC capacity are not
  // monetary fees, but they do not erase that separate, spendable asset cost.
  // A cold-gate cycle therefore stays inert until it has a fresh, independent
  // BEED balance plus conservative exit-value witness.
  const costs = economicCostWitness ?? (coldRedGateSigner ? await feeWitness({ account, worstCaseProfitSwapHive: opportunity.exact.quote.worstCaseProfitSwapHive }) : null);
  if (!costs || costs.status !== "witnessed-net-cost"
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(costs.totalSwapHive ?? "")
    || !Array.isArray(costs.resources)
    || ["Hive Engine BEED market fee", "Hive RC", "signer", "runner/paymaster"].some((resource) => !costs.resources.includes(resource))) {
    return Object.freeze({ ...base, status: "unpriced-resource-cost-model", opportunity,
      credentialAccess: false, chainMutation: false });
  }
  const request = roundTripRequest(opportunity, coldRedGateSigner ? coldRedGateKey(account) : keyFile, account);
  const submitted = await (coldRedGateSigner ? broadcastArbitrageViaColdRedGate : submit)(request);
  const result = submitted?.id ? Object.freeze({ ...submitted, economicEffect: submitted.economicEffect ?? await confirmRoundTrip(account, request, submitted.id) }) : submitted;
  if (result?.economicEffect?.status !== "confirmed") return Object.freeze({ ...base, status: "execution-residue", opportunity,
    transactionId: result?.id ?? null, economicEffect: result?.economicEffect ?? null, retryAllowed: false, chainMutation: true });
  // A Hive Engine confirmation proves the two SWAP.HIVE/token legs only.  It
  // does not price the BEED charge, Hive RC consumption, or the runner's
  // authorization/paymaster cost.  Calling that gross delta "profit" was the
  // exact accounting lie that caused the earlier losing trades.  A separate,
  // witnessed resource-cost settlement must turn this residue into net P&L.
  return Object.freeze({ ...base, status: "round-trip-confirmed-unpriced-resource-costs", opportunity, transactionId: result.id,
    economicEffect: result.economicEffect, retryAllowed: false, chainMutation: true });
}

function parseOptions(argv) {
  let account = DEFAULT_ACCOUNT, keyFile = "", executeOne = false, coldRedGateSigner = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--account") account = argv[++index] ?? "";
    else if (argv[index] === "--execute-one") executeOne = true;
    else if (argv[index] === "--key-file") keyFile = argv[++index] ?? "";
    else if (argv[index] === "--cold-red-gate-signer") coldRedGateSigner = true;
    else fail(`unknown argument ${argv[index]}`);
  }
  if (keyFile && coldRedGateSigner) fail("--key-file and --cold-red-gate-signer are mutually exclusive");
  if (executeOne && !keyFile && !coldRedGateSigner) fail("--execute-one requires --key-file or --cold-red-gate-signer");
  if (!AUTONOMOUS_ACCOUNTS.has(account)) fail("--account must name an admitted autonomous account");
  return { account, keyFile, executeOne, coldRedGateSigner };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  operate(parseOptions(process.argv.slice(2))).then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
