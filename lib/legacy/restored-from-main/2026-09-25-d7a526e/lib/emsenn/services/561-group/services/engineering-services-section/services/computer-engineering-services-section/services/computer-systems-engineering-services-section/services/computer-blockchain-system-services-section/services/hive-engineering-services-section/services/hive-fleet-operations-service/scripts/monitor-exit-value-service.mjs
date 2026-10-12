#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// Canonical merchant monitor. Requests are replies to help-fund's offer;
// payments are HBD transfers to help-fund after publication. Neither becomes
// revenue without a later exact invoice and delivered report digest.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { EXIT_VALUE_MERCHANT } from "../src/core/exitValueServicePosts.mjs";
import { readExitValuePublications } from "../src/core/exitValueServicePublicationSettlement.mjs";
import { parsePilotRequest } from "./monitor-exit-tightness-pilot.mjs";
const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
function fail(message) { throw new Error(`monitor-exit-value-service: ${message}`); }
function digest(value) { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export function parseMerchantHbdTransfer(row, publicationBlock) { if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0])) return null;
  const envelope = row[1]; const op = envelope?.op; if (!Array.isArray(op) || op[0] !== "transfer" || op[1]?.to !== "help-fund"
    || !String(op[1]?.amount ?? "").endsWith(" HBD") || !Number.isSafeInteger(envelope?.block) || envelope.block <= publicationBlock) return null;
  const amount = String(op[1].amount); const txid = String(envelope.trx_id ?? ""); if (!/^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/u.test(amount)
    || BigInt(amount.slice(0, -4).replace(".", "")) === 0n || !/^[0-9a-f]{40}$/u.test(txid)) throw new TypeError("merchant HBD transfer is malformed");
  return Object.freeze({ historyIndex: row[0], block: envelope.block, transactionId: txid, from: String(op[1].from), to: "help-fund",
    amount, memo: String(op[1].memo ?? ""), commercialState: "incoming-hbd-not-invoiced-or-revenue" }); }
function agreement(rows, field) { const groups = new Map(); for (const row of rows.filter((entry) => entry.available)) { const value = row[field]; const key = digest(value);
  const group = groups.get(key) ?? { value, providers: [] }; group.providers.push(row.node); groups.set(key, group); }
  const supported = [...groups.entries()].filter(([, group]) => group.providers.length >= 2); if (supported.length !== 1 || groups.size !== 1) return Object.freeze({ knowledge: groups.size > 1 ? "both" : "neither", values: Object.freeze([]), providers: Object.freeze([]) });
  const [stateDigest, group] = supported[0]; return Object.freeze({ knowledge: "true", values: group.value, providers: Object.freeze(group.providers.sort()), stateDigest }); }
export async function observe() { const publication = readExitValuePublications(DATA_DIR).find((row) => row.publicationKind === "merchant"
  && row.account === "help-fund" && row.target === EXIT_VALUE_MERCHANT.target); if (!publication || !Number.isSafeInteger(Number(publication.block))) fail("canonical merchant publication is not durable");
  const publicationBlock = Number(publication.block); const observedAt = new Date().toISOString(); const rows = await Promise.all(NODES.map(async (node) => { try {
    const [post, history] = await Promise.all([new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("bridge.get_post", { author: "help-fund", permlink: EXIT_VALUE_MERCHANT.permlink }),
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_account_history", ["help-fund", -1, 1000])]); if (post?.author !== "help-fund" || !Array.isArray(history)
      || !history.some((row) => Number(row?.[1]?.block) <= publicationBlock)) throw new Error("merchant evidence window is incomplete");
    const requests = Object.freeze((Array.isArray(post.replies) ? post.replies : []).map((reply) => { const request = parsePilotRequest(reply?.body); return request ? Object.freeze({ replyAuthor: String(reply.author),
      replyPermlink: String(reply.permlink), created: String(reply.created), request, commercialState: "interest-not-invoice-or-payment" }) : null; }).filter(Boolean)
      .sort((a, b) => `${a.replyAuthor}/${a.replyPermlink}`.localeCompare(`${b.replyAuthor}/${b.replyPermlink}`)));
    const transfers = Object.freeze(history.map((row) => parseMerchantHbdTransfer(row, publicationBlock)).filter(Boolean)
      .sort((a, b) => a.historyIndex - b.historyIndex)); return Object.freeze({ node, available: true, requests, transfers }); }
    catch (error) { return Object.freeze({ node, available: false, requests: Object.freeze([]), transfers: Object.freeze([]), problem: error instanceof Error ? error.message : String(error) }); } }));
  const requestKnowledge = agreement(rows, "requests"); const transferKnowledge = agreement(rows, "transfers");
  return Object.freeze({ kind: "aagaard.exit-value-service-monitor", observedAt, merchant: "help-fund", publicationId: String(publication.publicationId),
    requestKnowledge: Object.freeze({ knowledge: requestKnowledge.knowledge, requests: requestKnowledge.values, providers: requestKnowledge.providers,
      ...(requestKnowledge.stateDigest ? { stateDigest: requestKnowledge.stateDigest } : {}) }),
    transferKnowledge: Object.freeze({ knowledge: transferKnowledge.knowledge, transfers: transferKnowledge.values, providers: transferKnowledge.providers,
      ...(transferKnowledge.stateDigest ? { stateDigest: transferKnowledge.stateDigest } : {}) }), providerRows: Object.freeze(rows),
    commercialLedger: Object.freeze({ interestRequests: requestKnowledge.values.length, incomingHbdTransfers: transferKnowledge.values.length,
      invoicesIssued: 0, settledPayments: 0, reportsDelivered: 0, revenue: "0.000 HBD", price: "0.250 HBD",
      reason: "no exact help-fund invoice, matching payment join, and delivered report digest exists" }), credentialAccess: false, chainMutation: false }); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) { try { process.stdout.write(`${JSON.stringify(await observe(), null, 2)}\n`); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; } }
