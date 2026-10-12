#!/usr/bin/env node
import { reportFailure } from "../src/commandFailure.mjs";
// One-action HoloZing reward operator. It observes public pending rewards,
// Alpha Vials, and on-chain ZING balances by default. --execute-one uses only
// the named account's posting key to reproduce HoloZing's Keychain login, then
// submits exactly one empty-body reward claim. It has no vial-opening,
// staking, delegation, transfer, trade, or inventory mutation path.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertHoloZingApiMutationAllowed,
  assertProtectedAlphaVialObserved,
} from "../src/core/protectedAssets.mjs";
import { recordHolozingRewardClaim } from "../src/core/holozingRewardSettlement.mjs";
import {
  holozingDecimalUnits,
  parseHoloZingPendingRewards,
  planHoloZingRewardClaim,
  reconcileHoloZingRewardClaim,
} from "@red-cup-engineering/holozing-services-section";
import { sha256 } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/hash";
import { makeFail, parseAccountExecuteOneOptions, rpc as supportRpc, engineFind } from "../src/core/hiveScriptSupport.mjs";
import { loadVerifiedHiveKey } from "@red-cup-engineering/key-management-services-section/hive-keystore";

const API = "https://api.holozing.com";
const ENGINE_CONTRACT_NODES = ["https://api.hive-engine.com/rpc/contracts", "https://herpc.dtools.dev/contracts"];
const ENGINE_BLOCKCHAIN_NODES = ["https://api.hive-engine.com/rpc/blockchain", "https://herpc.dtools.dev/blockchain"];
const DATA_DIR = new URL("../data/", import.meta.url).pathname;

const fail = makeFail("holozing-rewards");

export function parseOptions(argv) { return parseAccountExecuteOneOptions(argv, fail); }

export function loginMessage(account, expiryUnix) {
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account)) fail("invalid login account");
  if (!Number.isSafeInteger(expiryUnix) || expiryUnix <= 0) fail("invalid login expiry");
  return JSON.stringify({ username: account, type: "login", app: "holozing", expiry: expiryUnix });
}

export function keychainLoginEnvelope(account, message, signature, publicKey) {
  if (!/^[0-9a-f]{130}$/i.test(signature)) fail("invalid Keychain compact signature");
  if (!/^STM[1-9A-HJ-NP-Za-km-z]+$/.test(publicKey)) fail("invalid Hive public key");
  return Object.freeze({
    success: true,
    error: null,
    result: signature,
    data: Object.freeze({
      type: "signBuffer",
      username: account,
      message,
      method: "Posting",
      rpc: null,
      title: "Login to HoloZing",
      domain: "holozing.com",
    }),
    message: "Message signed!",
    request_id: 1,
    publicKey,
  });
}

// One node, retried with backoff, refusing through this script's fail.
const rpc = (node, method, params, timeoutMs = 8_000) => supportRpc(node, method, params, { timeoutMs, fail });

const find = (node, contract, table, query, limit = 10, indexes = []) => engineFind(node, contract, table, query, { limit, indexes, fail });

async function getJson(path) {
  let residue = "unavailable";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { residue = "non-JSON response"; continue; }
      if (!response.ok) { residue = `HTTP ${response.status}`; continue; }
      return body;
    } catch (error) {
      residue = error instanceof Error ? error.message : String(error);
    }
    if (attempt === 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(`${path} failed after retry: ${residue}`);
}

async function postJsonOnce(path, body, headers = {}) {
  assertHoloZingApiMutationAllowed(path, body);
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`${path} returned a non-JSON response after submission`); }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status} after submission`);
  return payload;
}

async function readZingBalance(account, node) {
  const [tokens, balances] = await Promise.all([
    find(node, "tokens", "tokens", { symbol: "ZING" }, 2),
    find(node, "tokens", "balances", { account, symbol: "ZING" }, 2),
  ]);
  if (tokens.length !== 1 || Number(tokens[0]?.precision) !== 3) fail(`${node} did not confirm ZING precision 3`);
  if (balances.length > 1) fail(`${node} returned duplicate ZING balances`);
  const row = balances[0] ?? { balance: "0.000", stake: "0.000" };
  const liquid = String(row.balance ?? "0.000");
  const staked = String(row.stake ?? "0.000");
  // Parsing normalizes and proves the exact three-decimal carrier.
  holozingDecimalUnits(liquid);
  holozingDecimalUnits(staked);
  return Object.freeze({ liquid, staked, observedAt: new Date().toISOString(), node });
}

export function balancesAgree(left, right) {
  return left.liquid === right.liquid && left.staked === right.staked;
}

async function readObservation(account) {
  const [pendingValue, packsValue, ...balances] = await Promise.all([
    getJson(`/rewards/pending?user=${encodeURIComponent(account)}`),
    getJson(`/packopen/inventory/packs?user=${encodeURIComponent(account)}`),
    ...ENGINE_CONTRACT_NODES.map((node) => readZingBalance(account, node)),
  ]);
  if (!Array.isArray(packsValue)) fail("HoloZing pack inventory is not an array");
  const alphaVialIds = packsValue.map((pack) => Number(pack?._id));
  assertProtectedAlphaVialObserved(account, alphaVialIds);
  const pending = parseHoloZingPendingRewards(account, new Date().toISOString(), pendingValue, alphaVialIds);
  if (!balancesAgree(balances[0], balances[1])) fail("independent Hive-Engine providers disagree on the ZING balance");
  return Object.freeze({
    pending,
    balance: Object.freeze({ liquid: balances[0].liquid, staked: balances[0].staked }),
    providers: Object.freeze(balances.map((balance) => Object.freeze({ node: balance.node, observedAt: balance.observedAt }))),
  });
}

function parseStakeRows(rows, account, baseTransactionId) {
  if (!Array.isArray(rows) || rows.length === 0) fail("claim transaction has no Hive-Engine rows");
  const normalized = rows.map((row) => {
    let payload;
    let logs;
    try { payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; } catch { fail("claim transaction payload is not JSON"); }
    try { logs = typeof row.logs === "string" ? JSON.parse(row.logs) : row.logs; } catch { fail("claim transaction logs are not JSON"); }
    if (row.sender !== "zingtoken" || row.contract !== "tokens" || row.action !== "stake") fail("claim transaction contains a foreign operation");
    if (!String(row.transactionId ?? "").startsWith(`${baseTransactionId}-`)) fail("claim child transaction does not bind the API transaction id");
    if (payload?.symbol !== "ZING" || payload?.to !== account || payload?.isSignedWithActiveKey !== true) fail("claim stake payload has a foreign target or symbol");
    if (typeof payload?.memo !== "string" || !payload.memo.startsWith("Your claim for ")) fail("claim stake payload has an unknown memo");
    const quantity = String(payload.quantity ?? "");
    holozingDecimalUnits(quantity);
    if (Array.isArray(logs?.errors) && logs.errors.length > 0) fail("claim transaction reports a Hive-Engine error");
    const matchingEvents = Array.isArray(logs?.events) ? logs.events.filter((event) => event?.contract === "tokens" && event?.event === "stake"
      && event?.data?.account === account && event?.data?.symbol === "ZING" && event?.data?.quantity === quantity) : [];
    if (matchingEvents.length !== 1) fail("claim transaction lacks one exact ZING stake event");
    return Object.freeze({
      transactionId: String(row.transactionId),
      blockNumber: Number(row.blockNumber),
      quantity,
      memo: payload.memo,
      executedCodeHash: String(row.executedCodeHash ?? ""),
    });
  }).sort((left, right) => left.transactionId.localeCompare(right.transactionId));
  if (normalized.some((event) => !Number.isSafeInteger(event.blockNumber) || event.blockNumber <= 0 || !/^[0-9a-f]{64}$/i.test(event.executedCodeHash))) {
    fail("claim transaction lacks exact block or code-hash evidence");
  }
  return Object.freeze(normalized);
}

function sameStakeEvents(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function waitForStakeEvents(account, transactionId) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const results = await Promise.all(ENGINE_BLOCKCHAIN_NODES.map((node) => rpc(node, "getTransactionInfo", { txid: transactionId }).catch(() => null)));
    if (results.every((rows) => Array.isArray(rows) && rows.length > 0)) {
      const parsed = results.map((rows) => parseStakeRows(rows, account, transactionId));
      if (!sameStakeEvents(parsed[0], parsed[1])) fail("independent Hive-Engine providers disagree on the claim events");
      return Object.freeze({
        events: parsed[0],
        confirmations: Object.freeze(ENGINE_BLOCKCHAIN_NODES.map((node, index) => Object.freeze({
          node,
          blockNumber: parsed[index][0].blockNumber,
          transactions: parsed[index].length,
        }))),
      });
    }
    if (attempt < 15) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  return null;
}

async function waitForEconomicEffect(account, before, events) {
  let lastReason = "economic effect was not observed";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const after = await readObservation(account);
      const reconciled = reconcileHoloZingRewardClaim(before.pending, after.pending, before.balance, after.balance, events);
      if (reconciled.confirmed) return Object.freeze({ after, reconciled });
      lastReason = reconciled.reason;
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 9) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000));
  }
  return Object.freeze({ after: null, reconciled: Object.freeze({ confirmed: false, reason: lastReason }) });
}

function safeObservation(observation) {
  return Object.freeze({
    observedAt: observation.pending.observedAt,
    pending: Object.freeze({
      holdingRewards: observation.pending.holdingRewards,
      stakeZing: observation.pending.stakeZing,
      delegation: observation.pending.delegation,
      total: observation.pending.total,
    }),
    zing: observation.balance,
    alphaVials: Object.freeze({
      count: observation.pending.alphaVialIds.length,
      ids: observation.pending.alphaVialIds,
      disposition: "preserved-unopened",
    }),
  });
}

export async function attachHolozingDurableRecord(receipt, recorder = recordHolozingRewardClaim) {
  try {
    const event = await recorder(DATA_DIR, receipt, receipt.completedAt);
    return Object.freeze({ ...receipt, durableRecord: Object.freeze({ confirmed: true, eventId: event.eventId }) });
  } catch (error) {
    // Submission has already happened for every caller of this helper. A
    // witness-provider outage is therefore settlement residue, never grounds
    // for repeating an economically effective claim.
    return Object.freeze({ ...receipt, retryAllowed: false,
      durableRecord: Object.freeze({ confirmed: false, error: error instanceof Error ? error.message : String(error) }) });
  }
}

export async function operate(options) {
  const before = await readObservation(options.account);
  const plan = planHoloZingRewardClaim(before.pending);
  const base = Object.freeze({
    kind: "aagaard.holozing-reward-claim-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    before: safeObservation(before),
    providers: before.providers,
    plan,
  });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  // Rewards below the claim minimum wait for a later tick: a receipt, not a failure.
  if (plan.kind !== "ready") return Object.freeze({ ...base, status: "waiting", credentialAccess: false, chainMutation: false });

  const key = await loadVerifiedHiveKey(options.account, "posting");
  const message = loginMessage(options.account, Math.floor(Date.now() / 1000) + 300);
  const signature = key.sign(sha256(Buffer.from(message, "utf8"))).toString("hex");
  const envelope = keychainLoginEnvelope(options.account, message, signature, key.createPublic("STM").toString());
  const login = await postJsonOnce("/login/hive", envelope);
  if (typeof login?.jwt !== "string" || !login.jwt) fail("HoloZing login did not return a JWT");

  let claim;
  try {
    // This request is deliberately never retried: a timeout can occur after
    // the server has already submitted the on-chain stake operations.
    claim = await postJsonOnce("/rewards/pending/", {}, { authorization: `Bearer ${login.jwt}` });
  } catch (error) {
    return attachHolozingDurableRecord(Object.freeze({
      ...base,
      status: "claim-submission-unknown-do-not-retry",
      retryAllowed: false,
      credentialAccess: Object.freeze({ occurred: true, location: "local-key-file", role: "posting" }),
      reason: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    }));
  }
  const transactionId = String(claim?.trxID ?? "");
  if (!/^[0-9a-f]{40}$/i.test(transactionId)) {
    return attachHolozingDurableRecord(Object.freeze({
      ...base,
      status: "claim-submitted-unreconciled-do-not-retry",
      retryAllowed: false,
      credentialAccess: Object.freeze({ occurred: true, location: "local-key-file", role: "posting" }),
      reason: "claim response did not contain a canonical Hive transaction id",
      completedAt: new Date().toISOString(),
    }));
  }
  const eventEvidence = await waitForStakeEvents(options.account, transactionId);
  if (!eventEvidence) {
    return attachHolozingDurableRecord(Object.freeze({
      ...base,
      status: "claim-submitted-unreconciled-do-not-retry",
      transactionId,
      retryAllowed: false,
      credentialAccess: Object.freeze({ occurred: true, location: "local-key-file", role: "posting" }),
      reason: "two Hive-Engine providers did not yet expose the claim transaction",
      completedAt: new Date().toISOString(),
    }));
  }
  const effect = await waitForEconomicEffect(options.account, before, eventEvidence.events);
  if (!effect.reconciled.confirmed) {
    return attachHolozingDurableRecord(Object.freeze({
      ...base,
      status: "claim-submitted-unreconciled-do-not-retry",
      transactionId,
      retryAllowed: false,
      credentialAccess: Object.freeze({ occurred: true, location: "local-key-file", role: "posting" }),
      engineConfirmations: eventEvidence.confirmations,
      reason: effect.reconciled.reason,
      completedAt: new Date().toISOString(),
    }));
  }
  return attachHolozingDurableRecord(Object.freeze({
    ...base,
    status: "claimed-confirmed",
    transactionId,
    retryAllowed: false,
    credentialAccess: Object.freeze({ occurred: true, location: "local-key-file", role: "posting" }),
    claimedZing: effect.reconciled.claimedZing,
    engineConfirmations: eventEvidence.confirmations,
    stakeEvents: eventEvidence.events.map(({ transactionId: childTransactionId, blockNumber, quantity, memo }) => Object.freeze({ childTransactionId, blockNumber, quantity, memo })),
    after: safeObservation(effect.after),
    completedAt: new Date().toISOString(),
  }));
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}
