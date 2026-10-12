#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// Read-only recovery monitor for michael561's exact queued 16.298 HBD savings
// exit. Delivery requires the exact fill_transfer_from_savings virtual source;
// a coincidental liquid-balance increase is never enough.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { hbdSavingsRecoveryEvent } from "../src/core/hbdSavingsRecoverySettlement.mjs";

const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const ACCOUNT = "michael561"; const REQUEST_ID = 108346161; const AMOUNT = "16.298 HBD";
const MEMO = "aagaard:hbd-savings-exit:v1"; const COMPLETE_AT = "2026-07-25T04:09:27.000Z";
const EXIT_ID = "urn:aagaard:hbd-savings-exit:e-DK_l-iSSU2Bsfvsz6_nFbeUWt7ivM-QR6XbrBu_QU";
const NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
function fail(message) { throw new Error(`hbd-savings-recovery: ${message}`); }
function digest(value) { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
export function parseOptions(argv) {
  const options = { account: "", record: false };
  for (let i = 0; i < argv.length; i += 1) { if (argv[i] === "--record") options.record = true;
    else if (argv[i] === "--account") { options.account = String(argv[++i] ?? "").toLowerCase(); } else fail(`unknown argument ${argv[i]}`); }
  if (options.account !== ACCOUNT) fail(`--account must be exactly ${ACCOUNT}`); return Object.freeze(options);
}

function requestOf(rows) {
  const matches = (Array.isArray(rows) ? rows : []).filter((row) => Number(row?.request_id) === REQUEST_ID);
  if (matches.length > 1) fail("provider exposed duplicate savings withdrawal requests"); if (matches.length === 0) return null;
  const row = matches[0]; const request = Object.freeze({ requestId: Number(row.request_id), from: String(row.from), to: String(row.to),
    amount: String(row.amount), memo: String(row.memo), completeAt: `${String(row.complete)}.000Z` });
  if (request.from !== ACCOUNT || request.to !== ACCOUNT || request.amount !== AMOUNT || request.memo !== MEMO || request.completeAt !== COMPLETE_AT) {
    fail("provider exposed a changed savings withdrawal request");
  }
  return request;
}
function deliveryOf(rows) {
  if (!Array.isArray(rows)) return null;
  for (const entry of [...rows].reverse()) {
    const row = entry?.[1]; const op = row?.op; if (!Array.isArray(op) || op[0] !== "fill_transfer_from_savings") continue;
    const fields = op[1]; if (Number(fields?.request_id) !== REQUEST_ID) continue;
    const delivery = Object.freeze({ requestId: Number(fields.request_id), from: String(fields.from), to: String(fields.to),
      amount: String(fields.amount), memo: String(fields.memo), historyIndex: Number(entry[0]), block: Number(row.block),
      timestamp: `${String(row.timestamp)}.000Z` });
    if (delivery.from !== ACCOUNT || delivery.to !== ACCOUNT || delivery.amount !== AMOUNT || delivery.memo !== MEMO
      || !Number.isSafeInteger(delivery.historyIndex) || !Number.isSafeInteger(delivery.block)) fail("provider exposed a changed savings delivery source");
    return delivery;
  }
  return null;
}
// The original withdrawal is a Hive transaction.  A separate local record is
// neither needed nor authoritative for tying this recovery to the request.
function sourceExitOf(rows) {
  if (!Array.isArray(rows)) return null;
  for (const entry of [...rows].reverse()) {
    const row = entry?.[1]; const op = row?.op; if (!Array.isArray(op) || op[0] !== "transfer_from_savings") continue;
    const fields = op[1];
    if (Number(fields?.request_id) !== REQUEST_ID || String(fields?.from) !== ACCOUNT || String(fields?.to) !== ACCOUNT
      || String(fields?.amount) !== AMOUNT || String(fields?.memo) !== MEMO) continue;
    const transactionId = String(row?.trx_id ?? ""); const block = Number(row?.block);
    if (!/^[0-9a-f]{40}$/u.test(transactionId) || !Number.isSafeInteger(block) || block <= 0) fail("provider exposed a malformed savings-exit transaction");
    return Object.freeze({ historyIndex: Number(entry[0]), block, transactionId, timestamp: `${String(row.timestamp)}.000Z` });
  }
  return null;
}
async function observeNode(node) {
  try {
    const [accounts, withdrawals] = await Promise.all([new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_accounts", [[ACCOUNT]]),
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_savings_withdraw_from", [ACCOUNT])]);
    const account = accounts?.[0]; if (account?.name !== ACCOUNT) fail(`${node} did not expose the account`);
    const request = requestOf(withdrawals);
    const history = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_account_history", [ACCOUNT, -1, 1000]);
    const sourceExit = sourceExitOf(history);
    if (!sourceExit) fail("provider cannot prove the exact queued savings-exit transaction from Hive history");
    const delivery = deliveryOf(history);
    const state = Object.freeze({ account: ACCOUNT, liquidHbd: String(account.hbd_balance), savingsHbd: String(account.savings_hbd_balance), request, delivery, sourceExit });
    if (!/^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/.test(state.liquidHbd) || !/^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/.test(state.savingsHbd)) fail("provider returned malformed HBD balances");
    return Object.freeze({ provider: node, status: "available", state, stateDigest: digest(state) });
  } catch (error) { return Object.freeze({ provider: node, status: "unavailable", problem: error instanceof Error ? error.message : String(error) }); }
}
export async function observe() {
  const observedAt = new Date().toISOString(); const observations = await Promise.all(NODES.map(observeNode)); const groups = new Map();
  for (const row of observations.filter((entry) => entry.status === "available")) { const group = groups.get(row.stateDigest) ?? { state: row.state, providers: [] };
    group.providers.push(row.provider); groups.set(row.stateDigest, group); }
  const supported = [...groups.entries()].filter(([, group]) => group.providers.length >= 2);
  const knowledge = supported.length === 1 && groups.size === 1 ? "true" : groups.size > 1 ? "both" : "neither";
  const providerKnowledge = Object.freeze({ value: knowledge, stateDigests: Object.freeze([...groups.entries()].map(([stateDigest, group]) => Object.freeze({
    stateDigest, providers: Object.freeze([...group.providers].sort()) }))), unavailable: Object.freeze(observations.filter((row) => row.status === "unavailable")
      .map((row) => Object.freeze({ provider: row.provider, problem: row.problem }))) });
  if (knowledge !== "true") return Object.freeze({ kind: "aagaard.hbd-savings-recovery-observation", sourceExitEventId: EXIT_ID,
    account: ACCOUNT, requestId: REQUEST_ID, amount: AMOUNT, completeAt: COMPLETE_AT, observedAt, status: "unknown", state: null,
    providerKnowledge, credentialAccess: false, chainMutation: false });
  const state = supported[0][1].state; const status = state.request ? "pending" : state.delivery ? "delivered" : "unknown";
  return Object.freeze({ kind: "aagaard.hbd-savings-recovery-observation", sourceExitEventId: EXIT_ID,
    account: ACCOUNT, requestId: REQUEST_ID, amount: AMOUNT, completeAt: COMPLETE_AT, observedAt, status, state,
    providerKnowledge, credentialAccess: false, chainMutation: false });
}
export async function operate(options) {
  const observation = await observe(); let event = null;
  if (options.record) { if (!["pending", "delivered"].includes(observation.status)) fail("only an exact pending or delivered recovery is recordable");
    event = hbdSavingsRecoveryEvent(observation); }
  return Object.freeze({ ...observation, durableRecord: Object.freeze({ confirmed: event !== null, eventId: event?.eventId ?? null }) });
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
