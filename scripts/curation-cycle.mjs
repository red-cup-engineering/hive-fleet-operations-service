#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// One-vote Hive curation operator. The planner signal is explicitly not a
// VESTS or HBD prediction. This boundary re-reads mana and the selected post,
// broadcasts at most one positive vote, confirms the exact transaction, and
// leaves the economic lot pending until Hive later emits curation_reward.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  accountStateFromHive,
  createHiveClient,
  loadAagaardConfig,
  planVotes,
  planRcReserve,
  postCandidateFromHive,
  projectedVotingPowerAfterVoteBps,
  recordCurationAction,
  recordCurationPredictions,
} from "../src/index.mjs";
import { submitToSigner } from "../src/core/signer.mjs";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
const hiveReader = new HiveClient();

const RPC_OPTIONS = Object.freeze({ timeout: 10000 });
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const DATA_DIR = new URL("../data/", import.meta.url).pathname;

function fail(message) { throw new Error(`curation-cycle: ${message}`); }

export function parseOptions(argv) {
  const options = { account: "", executeOne: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      return value;
    };
    if (argument === "--account") options.account = take().toLowerCase();
    else if (argument === "--execute-one") options.executeOne = true;
    else fail(`unknown argument ${argument}`);
  }
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(options.account)) fail("a canonical Hive --account is required");
  return Object.freeze(options);
}



export function majorityAgreement(rows, identity = (value) => JSON.stringify(value)) {
  const groups = new Map();
  for (const row of rows) {
    const key = identity(row.value);
    const prior = groups.get(key) ?? [];
    prior.push(row);
    groups.set(key, prior);
  }
  const winner = [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
  if (winner.length < 2) fail("fewer than two independent Hive providers agree");
  return Object.freeze({ value: winner[0].value, providers: Object.freeze(winner.map((row) => row.node)) });
}

export function majorityAvailableAgreement(rows, label, identity = (value) => JSON.stringify(value)) {
  const available = rows.filter((row) => row.status === "available");
  if (available.length < 2) {
    const residue = rows.filter((row) => row.status === "unavailable")
      .map((row) => `${row.node} ${row.problem}`).join("; ");
    fail(`fewer than two Hive providers exposed ${label}${residue ? `: ${residue}` : ""}`);
  }
  return majorityAgreement(available, identity);
}

function canonicalVote(vote) {
  return Object.freeze({
    voter: String(vote?.voter ?? ""),
    rshares: String(vote?.rshares ?? ""),
    percent: Number(vote?.percent ?? 0),
    time: String(vote?.time ?? ""),
  });
}

export function postEvidenceFromRaw(raw, account, nowMs = Date.now()) {
  const candidate = postCandidateFromHive(raw);
  if (!candidate) fail("selected post is malformed");
  const payoutAt = String(raw?.payout_at ?? "");
  const payoutMs = Date.parse(payoutAt.endsWith("Z") ? payoutAt : `${payoutAt}Z`);
  const pending = /^([0-9]+(?:\.[0-9]{1,3})?) HBD$/.exec(String(raw?.pending_payout_value ?? ""));
  const maxPayout = /^([0-9]+(?:\.[0-9]{1,3})?) HBD$/.exec(String(raw?.max_accepted_payout ?? ""));
  const votes = Object.freeze((Array.isArray(raw?.active_votes) ? raw.active_votes : [])
    .map(canonicalVote)
    .sort((left, right) => left.voter.localeCompare(right.voter)));
  if (raw?.is_paidout === true || !Number.isFinite(payoutMs) || payoutMs - nowMs < 600_000) {
    fail("selected post is paid out or has less than ten minutes before payout");
  }
  if (!pending || Number(pending[1]) <= 0 || !maxPayout || Number(maxPayout[1]) <= 0) {
    fail("selected post does not expose a positive pending and accepted payout");
  }
  if (votes.some((vote) => vote.voter === account)) fail("the actor already voted on the selected post");
  return Object.freeze({
    author: candidate.author,
    permlink: candidate.permlink,
    created: candidate.created,
    payoutAt: new Date(payoutMs).toISOString(),
    pendingPayout: String(raw.pending_payout_value),
    maxAcceptedPayout: String(raw.max_accepted_payout),
    netRshares: String(raw?.net_rshares ?? "0"),
    votes,
    candidate,
  });
}

export function postEvidenceIdentity(value) {
  return JSON.stringify({
    author: value.author,
    permlink: value.permlink,
    created: value.created,
    payoutAt: value.payoutAt,
    pendingPayout: value.pendingPayout,
    maxAcceptedPayout: value.maxAcceptedPayout,
    netRshares: value.netRshares,
    votes: value.votes,
  });
}

async function independentlyReadState(account) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const rows = await Promise.all(HIVE_NODES.map(async (node) => {
    try {
      const result = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_accounts", [[account]]);
      const state = accountStateFromHive(account, Array.isArray(result) ? result[0] : undefined, nowUnix);
      if (!state) fail(`${node} did not return the account`);
      return Object.freeze({ node, status: "available", value: state });
    } catch (error) {
      return Object.freeze({ node, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
    }
  }));
  return majorityAvailableAgreement(rows, "account state");
}

async function independentlyReadRc(account, nowMs = Date.now()) {
  const nowUnix = Math.floor(nowMs / 1000);
  const rows = await Promise.all(HIVE_NODES.map(async (node) => {
    try {
      const [accounts, stats] = await Promise.all([
        new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("rc_api.find_rc_accounts", { accounts: [account] }),
        new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("rc_api.get_rc_operation_stats", { operation: "vote_operation" }),
      ]);
      const row = accounts?.rc_accounts?.[0];
      const maximum = BigInt(String(row?.max_rc ?? "0"));
      const current = BigInt(String(row?.rc_manabar?.current_mana ?? "0"));
      const lastUpdate = Number(row?.rc_manabar?.last_update_time);
      const average = BigInt(String(stats?.avg_cost_rc ?? "0"));
      if (maximum <= 0n || current < 0n || average <= 0n || !Number.isSafeInteger(lastUpdate)) fail(`${node} returned malformed vote RC evidence`);
      const regenerated = current + BigInt(Math.max(0, nowUnix - lastUpdate)) * maximum / 432_000n;
      return Object.freeze({ node, status: "available", value: Object.freeze({
        currentRc: String(regenerated > maximum ? maximum : regenerated), maximumRc: maximum.toString(),
        averageVoteRc: average.toString(),
      }) });
    } catch (error) {
      return Object.freeze({ node, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
    }
  }));
  const available = rows.filter((row) => row.status === "available");
  if (available.length < 2) fail(`fewer than two Hive providers exposed vote RC evidence: ${rows.filter((row) => row.status === "unavailable").map((row) => `${row.node} ${row.problem}`).join("; ")}`);
  return majorityAgreement(available);
}

async function independentlyReadPost(author, permlink, account) {
  const nowMs = Date.now();
  const rows = await Promise.all(HIVE_NODES.map(async (node) => {
    try {
      return Object.freeze({ node, status: "available",
        value: postEvidenceFromRaw(await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("bridge.get_post", { author, permlink, observer: account }), account, nowMs) });
    } catch (error) {
      return Object.freeze({ node, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
    }
  }));
  return majorityAvailableAgreement(rows, "post evidence", postEvidenceIdentity);
}


export function exactVoteOperation(actual, expected) {
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object"
    || Array.isArray(actual) || Array.isArray(expected)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) return false;
  return actualKeys.every((key) => actual[key] === expected[key]);
}

export function voteVisible(raw, account) {
  return Array.isArray(raw?.active_votes) && raw.active_votes.some((vote) => {
    if (vote?.voter !== account || !/^-?[0-9]+$/.test(String(vote?.rshares ?? ""))) return false;
    return BigInt(String(vote.rshares)) > 0n;
  });
}

async function waitForVoteVisibility(author, permlink, account) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await Promise.all(HIVE_NODES.map(async (node) => Object.freeze({
      node,
      visible: voteVisible(await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("bridge.get_post", { author, permlink, observer: account }).catch(() => null), account),
    })));
    const visible = rows.filter((row) => row.visible);
    if (visible.length >= 2) return Object.freeze(visible.map((row) => row.node));
    if (attempt < 19) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  fail("fewer than two Hive providers exposed the exact vote before timeout");
}

export function settlementPendingReceipt(base, transactionId, hive, error, completedAt = new Date().toISOString()) {
  return Object.freeze({
    ...base,
    status: "settlement-pending",
    transactionId,
    hive,
    immediateEffect: Object.freeze({ confirmed: false, retryAllowed: false, reason: error instanceof Error ? error.message : String(error) }),
    completedAt,
  });
}

export function recordPendingReceipt(base, transactionId, hive, settlementIdentity, error, completedAt = new Date().toISOString()) {
  return Object.freeze({
    ...base,
    status: "record-pending",
    transactionId,
    hive,
    immediateEffect: Object.freeze({ confirmed: true, retryAllowed: false }),
    settlementIdentity,
    durableRecord: Object.freeze({ confirmed: false, error: error instanceof Error ? error.message : String(error) }),
    completedAt,
  });
}

async function freshPlan(config, wallet, hive) {
  const nowMs = Date.now();
  const [posts, stateReading, rcReading] = await Promise.all([
    hive.readCandidateField(wallet), independentlyReadState(wallet.account), independentlyReadRc(wallet.account, nowMs),
  ]);
  const observedAt = new Date(nowMs).toISOString();
  const rcPlan = planRcReserve({ observedAt, currentRc: rcReading.value.currentRc, maximumRc: rcReading.value.maximumRc,
    averageOperationRc: rcReading.value.averageVoteRc, operation: "vote_operation" });
  const rewardPrice = await new HiveClient().getCurationPrice();
  const plan = planVotes(wallet, posts, observedAt, stateReading.value, [wallet], undefined, rewardPrice);
  if (plan.votes.length === 0) return Object.freeze({ plan, wallet, vote: null, post: null, state: stateReading,
    rc: Object.freeze({ plan: rcPlan, providers: rcReading.providers }) });
  // One vote per run: the densest the selection chose.
  let vote = plan.votes[0];
  let post;
  try { post = await independentlyReadPost(vote.author, vote.permlink, wallet.account); }
  catch (error) {
    return Object.freeze({ plan, wallet, vote: null, post: null, state: stateReading,
      rc: Object.freeze({ plan: rcPlan, providers: rcReading.providers }),
      reason: `candidate-revalidation-refused: ${error instanceof Error ? error.message : String(error)}` });
  }
  const revalidatedPosts = posts.map((candidate) => candidate.author === vote.author && candidate.permlink === vote.permlink
    ? post.value.candidate : candidate);
  const revalidated = planVotes(wallet, revalidatedPosts, new Date().toISOString(), stateReading.value, [wallet], undefined, rewardPrice);
  const next = revalidated.votes.find((candidate) => candidate.author === vote.author && candidate.permlink === vote.permlink);
  if (!next || next.weightBps !== vote.weightBps) {
    fail("post revalidation changed the selected vote");
  }
  vote = next;
  return Object.freeze({ plan: revalidated, wallet, vote, post, state: stateReading, rc: Object.freeze({ plan: rcPlan, providers: rcReading.providers }) });
}

function safePlan(fresh) {
  const manaBps = Math.floor(Number(fresh.state.value.currentMana) * 10_000 / Number(fresh.state.value.maxMana));
  return Object.freeze({
    account: fresh.plan.account,
    manaBps,
    manaFloorBps: fresh.wallet.strategy.votingPowerFloorBps,
    author: fresh.vote.author,
    permlink: fresh.vote.permlink,
    weightBps: fresh.vote.weightBps,
    projectedManaBps: projectedVotingPowerAfterVoteBps(manaBps, fresh.vote.weightBps),
    rewardPredictionVests: null,
    rewardPredictionHbd: fresh.vote.expectedCurationHbd,
    reason: fresh.vote.reason,
    post: Object.freeze({
      payoutAt: fresh.post.value.payoutAt,
      pendingPayout: fresh.post.value.pendingPayout,
      maxAcceptedPayout: fresh.post.value.maxAcceptedPayout,
      netRshares: fresh.post.value.netRshares,
      evidenceProviders: fresh.post.providers,
    }),
    manaProviders: fresh.state.providers,
    resourceCredits: Object.freeze({ ...fresh.rc.plan, evidenceProviders: fresh.rc.providers }),
  });
}

export async function operate(options) {
  const config = loadAagaardConfig({ configPath: new URL("../aagaard.config.json", import.meta.url).pathname });
  const wallet = config.wallets.find((candidate) => candidate.account === options.account);
  if (!wallet) fail("account is not in the admitted Aagaard fleet");
  const hive = createHiveClient({ ...config.hive, timeoutMs: Math.max(10_000, config.hive.timeoutMs) });
  const fresh = await freshPlan(config, wallet, hive);
  if (fresh.vote === null) return Object.freeze({
    kind: "aagaard.curation-one-vote-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    status: "no-admissible-vote",
    reason: fresh.reason ?? "strategy-produced-no-vote",
    credentialAccess: false,
    chainMutation: false,
    resourceCredits: Object.freeze({ ...fresh.rc.plan, evidenceProviders: fresh.rc.providers }),
  });
  const plan = safePlan(fresh);
  const base = Object.freeze({
    kind: "aagaard.curation-one-vote-receipt",
    account: options.account,
    observedAt: new Date().toISOString(),
    plan,
  });
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed" });
  if (fresh.rc.plan.decision !== "ready") return Object.freeze({ ...base, status: "resource-credit-wait",
    credentialAccess: false, chainMutation: false });
  const operation = Object.freeze(["vote", Object.freeze({
    voter: options.account,
    author: fresh.vote.author,
    permlink: fresh.vote.permlink,
    weight: fresh.vote.weightBps,
  })]);
  const executionBase = Object.freeze({ ...base, credentialAccess: Object.freeze({ occurred: true,
    location: process.env.HIVE_SIGNER_HOST || "local-keystore", role: "posting" }) });
  let result;
  try {
    result = await submitToSigner({
      account: options.account,
      role: "posting",
      lane: "voting",
      target: `${fresh.vote.author}/${fresh.vote.permlink}`,
      operation,
    });
  } catch (error) {
    throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof result?.id !== "string" || !/^[0-9a-f]{40}$/.test(result.id)) fail("submission returned no canonical transaction id; do not retry automatically");
  const hiveConfirmations = await hiveReader.confirmTransaction(result.id, operation);
  const settlementIdentity = Object.freeze({
    account: options.account,
    author: fresh.vote.author,
    permlink: fresh.vote.permlink,
    transactionId: result.id,
    payoutAt: fresh.post.value.payoutAt,
    expectedOperation: "curation_reward",
    rewardAsset: "VESTS",
    status: "pending-payout",
  });
  const recordedAt = new Date().toISOString();
  let predictions;
  try {
    predictions = await recordCurationPredictions(DATA_DIR, options.account, [fresh.vote], Object.freeze({
      broadcast: 1,
      dryRun: 0,
      skipped: 0,
      errors: 0,
      receipts: Object.freeze([Object.freeze({
        lane: "voting",
        action: "vote",
        target: `${fresh.vote.author}/${fresh.vote.permlink}`,
        status: "broadcast",
        role: "posting",
        txId: result.id,
      })]),
    }), recordedAt);
  } catch (error) {
    return recordPendingReceipt(executionBase, result.id, hiveConfirmations, settlementIdentity, error, recordedAt);
  }
  const recordedPrediction = predictions[0] ?? null;
  let visibleProviders;
  try {
    visibleProviders = await waitForVoteVisibility(fresh.vote.author, fresh.vote.permlink, options.account);
  } catch (error) {
    return settlementPendingReceipt(Object.freeze({
      ...executionBase,
      settlementIdentity,
      durableRecord: Object.freeze({ confirmed: true, predictionId: recordedPrediction?.predictionId ?? null }),
    }), result.id, hiveConfirmations, error);
  }
  const receipt = Object.freeze({
    ...executionBase,
    status: "vote-observed",
    transactionId: result.id,
    hive: hiveConfirmations,
    immediateEffect: Object.freeze({ confirmed: true, visibleProviders }),
    settlementIdentity,
    durableRecord: Object.freeze({ confirmed: true, predictionId: recordedPrediction?.predictionId ?? null }),
    completedAt: new Date().toISOString(),
  });
  try {
    const action = await recordCurationAction(DATA_DIR, receipt);
    return Object.freeze({ ...receipt, actionRecord: Object.freeze({ confirmed: true, eventId: action.eventId }) });
  } catch (error) {
    return Object.freeze({ ...receipt, actionRecord: Object.freeze({ confirmed: false, retryAllowed: false,
      error: error instanceof Error ? error.message : String(error) }) });
  }
}

async function main() { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))))}\n`); }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(reportFailure);
}
