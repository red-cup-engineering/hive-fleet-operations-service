#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// Restart-safe HELP liquidity CapCell. The chain is the state carrier: every
// cycle refreshes doctrine/capabilities, reconciles providers,
// and performs at most one bounded transition. A partial prior cycle is
// resumed from exact Hive operations instead of replayed from local state.

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { engineCustomJson, pools, tokens } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { admitHiveCapitalAllocation } from "../src/core/capitalAllocation.mjs";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";

const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const HERE = dirname(fileURLToPath(import.meta.url));
const ACCOUNT = "help-fund";
const SOURCE = "michael561";
const PAIR = "SWAP.HIVE:SWAP.BTC";
const FUND_MEMO = "AGRODAO shared allocator: HELP BTC-pool liquidity pilot";
const CONTRACT_NODES = Object.freeze(["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts", "https://herpc.liotes.com/contracts"]);
const BLOCKCHAIN_NODES = Object.freeze(["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"]);
const HIVE_NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
const NOTES = Object.freeze([
  resolve(HERE, "../../../../lenticule-science/content/text/documents/articles/notes/2026/07/24/2026-07-24-capability-cells-and-emergency-repair-discipline.md"),
  resolve(HERE, "../../../../lenticule-science/content/text/documents/articles/notes/2026/07/25/2026-07-25-note-on-the-structure-of-semiotic-foam.md"),
  resolve(HERE, "../../../../lenticule-science/content/text/documents/articles/notes/2026/07/25/2026-07-25-note-on-relational-physics-of-coordination.md"),
  resolve(HERE, "../content/text/documents/articles/notes/2026-07-24-account-strategy-doctrine.md"),
]);
const BROADCASTER = resolve(HERE, "hive-broadcast.mjs");

function fail(message) { throw new Error(`help-liquidity-cell: ${message}`); }
export function operationDigest(operation) { return `sha256:${createHash("sha256").update(canonical(operation)).digest("hex")}`; }


async function find(url, contract, table, query, limit = 1000) { return await new RpcClient({ nodes: [url], timeout: (RPC_OPTIONS).timeout }).call("find", { contract, table, query, limit, offset: 0, indexes: [] }); }
function units8(value) { const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(String(value)); if (!match) fail(`invalid 8-decimal amount ${value}`);
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0")); }

async function refreshKnowledge(michaelKeyFile, helpKeyFile) {
  const noteRows = await Promise.all(NOTES.map(async (path) => { const bytes = await readFile(path); return Object.freeze({ path,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }); }));
  await Promise.all([access(BROADCASTER), access(resolve(HERE, "../src/core/capitalAllocation.mjs")),
    access(michaelKeyFile), access(helpKeyFile)]);
  return Object.freeze({ notes: Object.freeze(noteRows), capabilities: Object.freeze({ signer: true, agrodaoAdmission: true,
    michaelActiveCustody: true, helpActiveCustody: true }) });
}

async function providerState(provider) {
  const [helpBalances, michaelSwap, positions, pools] = await Promise.all([
    find(provider, "tokens", "balances", { account: ACCOUNT, symbol: { $in: ["SWAP.HIVE", "SWAP.BTC"] } }, 4),
    find(provider, "tokens", "balances", { account: SOURCE, symbol: "SWAP.HIVE" }, 2),
    find(provider, "marketpools", "liquidityPositions", { account: ACCOUNT, tokenPair: PAIR }, 2),
    find(provider, "marketpools", "pools", { tokenPair: PAIR }, 2),
  ]);
  const balance = Object.fromEntries(helpBalances.map((row) => [row.symbol, String(row.balance)]));
  const state = Object.freeze({ helpSwapHive: balance["SWAP.HIVE"] ?? "0.00000000", helpSwapBtc: balance["SWAP.BTC"] ?? "0.00000000",
    michaelSwapHive: String(michaelSwap[0]?.balance ?? "0.00000000"), shares: String(positions[0]?.shares ?? "0"),
    pool: Object.freeze({ baseQuantity: String(pools[0]?.baseQuantity ?? "0"), quoteQuantity: String(pools[0]?.quoteQuantity ?? "0"),
      baseVolume: String(pools[0]?.baseVolume ?? "0"), quoteVolume: String(pools[0]?.quoteVolume ?? "0"), totalShares: String(pools[0]?.totalShares ?? "0") }) });
  return Object.freeze({ provider, digest: `sha256:${createHash("sha256").update(canonical(state)).digest("hex")}`, state });
}
async function certifiedState() { const rows = await Promise.all(CONTRACT_NODES.map(providerState)); const groups = new Map();
  for (const row of rows) { const group = groups.get(row.digest) ?? []; group.push(row); groups.set(row.digest, group); }
  const winner = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (winner.length < 2) fail("fewer than two providers agree on HELP liquidity state");
  return Object.freeze({ state: winner[0].state, digest: winner[0].digest, providers: Object.freeze(winner.map((row) => row.provider)) }); }

function decodedCalls(history) { const calls = [];
  for (const row of history ?? []) { const event = Array.isArray(row) ? row[1] : row; const op = event?.op; const name = Array.isArray(op) ? op[0] : op?.type?.replace(/^.*::/u, "");
    const fields = Array.isArray(op) ? op[1] : op?.value; if (name !== "custom_json" || fields?.id !== "ssc-mainnet-hive") continue;
    try { const decoded = JSON.parse(fields.json); for (const call of Array.isArray(decoded) ? decoded : [decoded]) calls.push(call); } catch { /* unrelated */ }
  } return calls; }
async function accountCalls(account) { const observations = await Promise.all(HIVE_NODES.map(async (node) => {
  try { const history = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_account_history", [account, -1, 1000]); return Object.freeze({ node, calls: decodedCalls(history) }); }
  catch { return Object.freeze({ node, calls: null }); } }));
  const available = observations.filter((row) => row.calls); if (available.length < 2) fail(`insufficient Hive history witnesses for ${account}`); return available[0].calls; }
function isCall(call, action, payload) { return call?.contractName === payload.contractName && call?.contractAction === action
  && canonical(call.contractPayload) === canonical(payload.contractPayload); }

export function nextTransition({ funded, swapped, pooled, state }) {
  if (pooled) return "monitor";
  if (!funded) return units8(state.michaelSwapHive) >= 1_000_000_00n ? "fund" : "refuse-underfunded";
  if (!swapped) return units8(state.helpSwapHive) >= 50_000_000n ? "swap" : "refuse-funding-unsettled";
  if (units8(state.helpSwapHive) >= 49_000_000n && units8(state.helpSwapBtc) >= 37n) return "pool";
  return "refuse-swap-residue";
}

function submit(request) { return new Promise((resolvePromise, rejectPromise) => { const child = spawn(process.execPath, [BROADCASTER], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("close", (code) => { if (code !== 0) rejectPromise(new Error(stderr.trim() || `signer exited ${code}`));
    else { try { resolvePromise(JSON.parse(stdout)); } catch { rejectPromise(new Error("signer returned invalid JSON")); } } }); child.stdin.end(JSON.stringify(request)); }); }
async function confirmEngine(txid, action) { for (let attempt = 0; attempt < 20; attempt += 1) { const rows = await Promise.all(BLOCKCHAIN_NODES.map((node) => new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("getTransactionInfo", { txid }).catch(() => null)));
  if (rows.every(Boolean)) { for (const row of rows) { const logs = typeof row.logs === "string" ? JSON.parse(row.logs) : row.logs; if (logs?.errors?.length) fail(logs.errors.join("; "));
    if (row.contract !== action.contractName || row.action !== action.contractAction) fail("sidechain confirmed a different action"); } return rows; }
  if (attempt < 19) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200)); } fail("sidechain settlement timed out; do not retry until the next history-derived cycle"); }

function allocation(state, operation, observedAt) { const expiresAt = new Date(Date.parse(observedAt) + 240_000).toISOString(); const planDigest = operationDigest(operation);
  const request = { schema: "agrodao.hive-capital-allocation-request.v1", requestedBy: "urn:office:agrodao:treasury-steward",
    observationId: `urn:aagaard:help-liquidity-observation:${createHash("sha256").update(canonical(state)).digest("hex")}`, observedAt, expiresAt,
    inventory: [
      { assetId: "swap-hive", symbol: "SWAP.HIVE", custodyAccount: ACCOUNT, units: units8(state.helpSwapHive).toString(), precision: 8 },
      { assetId: "swap-btc", symbol: "SWAP.BTC", custodyAccount: ACCOUNT, units: units8(state.helpSwapBtc).toString(), precision: 8 },
    ], arbitrage: { enterprise: "urn:ame:sigmund-hive-arbitrage-enterprise", account: "sigmund-vexler",
      planDigest: `sha256:${createHash("sha256").update("no-help-capital-reserved-for-sigmund").digest("hex")}`, reserve: [] },
    liquidity: { enterprise: "urn:ame:help-hive-liquidity-enterprise", account: ACCOUNT, planDigest,
      minimumLiquid: [
        { assetId: "swap-hive", units: (units8(state.helpSwapHive) - 49_000_000n).toString(), reason: "merchant and LP recall reserve" },
        { assetId: "swap-btc", units: (units8(state.helpSwapBtc) - 37n).toString(), reason: "post-pilot BTC dust reserve" },
      ], uses: [
        { assetId: "swap-hive", units: "49000000", pool: PAIR }, { assetId: "swap-btc", units: "37", pool: PAIR },
      ] } };
  return admitHiveCapitalAllocation(request, new Date(observedAt)); }

export async function operate({ executeOne = false, michaelKeyFile = "", helpKeyFile = "" } = {}) {
  const knowledge = await refreshKnowledge(michaelKeyFile, helpKeyFile); const observed = await certifiedState();
  const [michaelCalls, helpCalls] = await Promise.all([accountCalls(SOURCE), accountCalls(ACCOUNT)]);
  const fundAction = engineCustomJson(SOURCE, tokens.transfer({ to: ACCOUNT, symbol: "SWAP.HIVE", quantity: "1.00000000", memo: FUND_MEMO })); const fundDecoded = JSON.parse(fundAction[1].json);
  const swapAction = engineCustomJson(ACCOUNT, pools.swapTokens({ tokenPair: PAIR, tokenSymbol: "SWAP.HIVE", tokenAmount: "0.50000000", tradeType: "exactInput", minAmountOut: "0.00000037" })); const swapDecoded = JSON.parse(swapAction[1].json);
  const poolAction = engineCustomJson(ACCOUNT, pools.addLiquidity({ tokenPair: PAIR, baseQuantity: "0.49000000", quoteQuantity: "0.00000037" })); const poolDecoded = JSON.parse(poolAction[1].json);
  const evidence = Object.freeze({ funded: michaelCalls.some((call) => isCall(call, "transfer", fundDecoded)),
    swapped: helpCalls.some((call) => isCall(call, "swapTokens", swapDecoded)), pooled: helpCalls.some((call) => isCall(call, "addLiquidity", poolDecoded)) });
  const transition = nextTransition({ ...evidence, state: observed.state }); const base = { kind: "aagaard.help-liquidity-capcell.v1", observedAt: new Date().toISOString(), knowledge,
    observation: observed, evidence, transition };
  if (!executeOne || transition === "monitor" || transition.startsWith("refuse-")) return Object.freeze({ ...base, status: transition, chainMutation: false, credentialAccess: false });
  let operation, request;
  if (transition === "fund") { operation = fundAction; request = { kind: "aagaard.hive-write", account: SOURCE, role: "active", lane: "treasury-rebalance",
    target: "help-fund:liquidity-capital", keyFile: michaelKeyFile, operation }; }
  else if (transition === "swap") { operation = swapAction; request = { kind: "aagaard.hive-write", account: ACCOUNT, role: "active", lane: "liquidity-bootstrap",
    target: "help-fund:liquidity-bootstrap:SWAP.HIVE:SWAP.BTC", keyFile: helpKeyFile, operation }; }
  else { operation = poolAction; const decision = allocation(observed.state, operation, new Date().toISOString()); request = { kind: "aagaard.hive-write", account: ACCOUNT,
    role: "active", lane: "liquidity", target: `help-fund:lp:${operationDigest(operation)}`, keyFile: helpKeyFile, operation, authorization: decision.authorizations.liquidity }; }
  const submission = await submit(request); const txid = String(submission?.id ?? ""); if (!/^[0-9a-f]{40}$/u.test(txid)) fail("submission returned no transaction id; do not retry");
  await confirmEngine(txid, JSON.parse(operation[1].json)); return Object.freeze({ ...base, status: `${transition}-confirmed`, transactionId: txid, retryAllowed: false,
    chainMutation: true, credentialAccess: Object.freeze({ occurred: true, role: "active", location: "local-key-file" }) });
}

function options(argv) { const result = { executeOne: false, michaelKeyFile: "", helpKeyFile: "" }; for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === "--execute-one") result.executeOne = true; else if (argv[i] === "--michael-key-file") result.michaelKeyFile = argv[++i] ?? "";
  else if (argv[i] === "--help-key-file") result.helpKeyFile = argv[++i] ?? ""; else fail(`unknown argument ${argv[i]}`); }
  if (!result.michaelKeyFile || !result.helpKeyFile) fail("both active key-file paths are required for capability refresh"); return result; }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) operate(options(process.argv.slice(2))).then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
  .catch(reportFailure);
