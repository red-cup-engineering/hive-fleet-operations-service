#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// Read-only demand monitor for the public exit-tightness pilot. Interest
// comments, future invoices, HBD payments, report delivery, and revenue are
// deliberately separate states; this observer currently admits only the
// first one.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  EXIT_TIGHTNESS_PILOT_ACCOUNT,
  EXIT_TIGHTNESS_PILOT_PERMLINK,
  EXIT_TIGHTNESS_PILOT_PRICE,
} from "../src/core/exitTightnessPilotPost.mjs";

const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const HIVE_NODES = ["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"];
const PUBLICATION_BLOCK = 108350542;

function canonicalAccount(value) {
  return /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/.test(value);
}

export function parsePilotRequest(body) {
  const line = String(body ?? "").trim();
  const match = /^pilot account=([^\s]+) symbol=([^\s]+)(?: quantity=([^\s]+))?$/u.exec(line);
  if (!match) return null;
  const account = match[1].toLowerCase();
  const symbol = match[2].toUpperCase();
  const quantity = match[3] ?? null;
  if (!canonicalAccount(account) || !/^[A-Z][A-Z0-9.]{0,9}$/u.test(symbol)) return null;
  if (quantity !== null && (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(quantity)
    || BigInt(quantity.replace(".", "")) === 0n)) return null;
  return Object.freeze({ account, symbol, quantity });
}

function canonicalReply(reply) {
  const request = parsePilotRequest(reply?.body);
  if (!request || typeof reply?.author !== "string" || typeof reply?.permlink !== "string") return null;
  return Object.freeze({
    replyAuthor: reply.author,
    replyPermlink: reply.permlink,
    created: String(reply.created ?? ""),
    request,
    commercialState: "interest-not-invoice-or-payment",
  });
}

export function parseIncomingHbdTransfer(row) {
  if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0]) || !row[1] || typeof row[1] !== "object") return null;
  const envelope = row[1]; const operation = envelope.op;
  if (!Array.isArray(operation) || operation.length !== 2 || operation[0] !== "transfer" || !operation[1] || typeof operation[1] !== "object") return null;
  const value = operation[1];
  if (value.to !== EXIT_TIGHTNESS_PILOT_ACCOUNT || !String(value.amount ?? "").endsWith(" HBD")) return null;
  if (!Number.isSafeInteger(envelope.block) || envelope.block <= PUBLICATION_BLOCK) return null;
  const from = String(value.from ?? ""); const amount = String(value.amount ?? ""); const transactionId = String(envelope.trx_id ?? "");
  const operationIndex = Number(envelope.op_in_trx); const milliseconds = Date.parse(`${String(envelope.timestamp ?? "").replace(/Z$/u, "")}Z`);
  if (!canonicalAccount(from) || !/^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/u.test(amount)
    || BigInt(amount.slice(0, -4).replace(".", "")) === 0n
    || !/^[0-9a-f]{40}$/u.test(transactionId) || !Number.isSafeInteger(operationIndex) || operationIndex < 0 || !Number.isFinite(milliseconds)) {
    throw new TypeError("post-publication incoming HBD transfer carrier is malformed");
  }
  return Object.freeze({ historyIndex: row[0], block: envelope.block, operationIndex, transactionId,
    timestamp: new Date(milliseconds).toISOString(), from, amount, memo: String(value.memo ?? ""),
    commercialState: "incoming-hbd-not-invoiced-or-revenue" });
}

export function assertPublicationCoverage(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || !rows.some((row) => Array.isArray(row)
    && Number.isSafeInteger(row[1]?.block) && row[1].block <= PUBLICATION_BLOCK)) {
    throw new TypeError("account-history window does not cross the product publication boundary");
  }
  return true;
}

function digest(value) { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export function agreeOnRequests(rows) {
  const groups = new Map();
  for (const row of rows.filter((candidate) => candidate.available)) {
    const key = digest(row.requests);
    const group = groups.get(key) ?? [];
    group.push(row); groups.set(key, group);
  }
  const winner = [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
  if (winner.length < 2) return Object.freeze({ knowledge: "neither", requests: Object.freeze([]), providers: Object.freeze([]) });
  return Object.freeze({ knowledge: groups.size === 1 ? "true" : "both", requests: winner[0].requests,
    providers: Object.freeze(winner.map((row) => row.node)), stateDigest: digest(winner[0].requests) });
}

export function agreeOnIncomingHbd(rows) {
  const normalized = rows.map((row) => Object.freeze({ ...row, requests: row.incomingHbdTransfers ?? [] }));
  const agreed = agreeOnRequests(normalized);
  return Object.freeze({ knowledge: agreed.knowledge, transfers: agreed.requests, providers: agreed.providers,
    ...(agreed.stateDigest ? { stateDigest: agreed.stateDigest } : {}) });
}



export async function observe() {
  const observedAt = new Date().toISOString();
  const rows = await Promise.all(HIVE_NODES.map(async (node) => {
    try {
      const [post, history] = await Promise.all([
        new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("bridge.get_post", { author: EXIT_TIGHTNESS_PILOT_ACCOUNT, permlink: EXIT_TIGHTNESS_PILOT_PERMLINK }),
        new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_account_history", [EXIT_TIGHTNESS_PILOT_ACCOUNT, -1, 1_000]),
      ]);
      if (post?.author !== EXIT_TIGHTNESS_PILOT_ACCOUNT || !Array.isArray(history)) throw new Error("product evidence carrier malformed");
      assertPublicationCoverage(history);
      const requests = Object.freeze((Array.isArray(post.replies) ? post.replies : []).map(canonicalReply).filter(Boolean)
        .sort((left, right) => `${left.replyAuthor}/${left.replyPermlink}`.localeCompare(`${right.replyAuthor}/${right.replyPermlink}`)));
      const incomingHbdTransfers = Object.freeze(history.map(parseIncomingHbdTransfer).filter(Boolean)
        .sort((left, right) => left.historyIndex - right.historyIndex));
      return Object.freeze({ node, available: true, requests, incomingHbdTransfers, engagement: Object.freeze({
        children: Number(post.children ?? 0), activeVotes: Array.isArray(post.active_votes) ? post.active_votes.length : 0,
        pendingPayout: String(post.pending_payout_value ?? "0.000 HBD"), paidOut: post.is_paidout === true,
      }) });
    } catch (error) { return Object.freeze({ node, available: false, requests: Object.freeze([]),
      incomingHbdTransfers: Object.freeze([]), problem: error instanceof Error ? error.message : String(error) }); }
  }));
  const agreement = agreeOnRequests(rows);
  const transferAgreement = agreeOnIncomingHbd(rows);
  return Object.freeze({
    kind: "aagaard.exit-tightness-product-pilot-monitor",
    observedAt,
    publication: Object.freeze({ account: EXIT_TIGHTNESS_PILOT_ACCOUNT, permlink: EXIT_TIGHTNESS_PILOT_PERMLINK }),
    requestKnowledge: agreement,
    transferKnowledge: transferAgreement,
    providerRows: Object.freeze(rows),
    commercialLedger: Object.freeze({
      interestRequests: agreement.requests.length,
      invoicesIssued: 0,
      settledPayments: 0,
      reportsDelivered: 0,
      revenue: "0.000 HBD",
      pilotPrice: EXIT_TIGHTNESS_PILOT_PRICE,
      incomingHbdTransfers: transferAgreement.transfers.length,
      revenueReason: "no seller invoice, exact payment join, or delivered report digest exists",
    }),
    credentialAccess: false,
    chainMutation: false,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await observe(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
