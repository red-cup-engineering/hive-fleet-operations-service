#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// Publish one of the two exact account-role-corrected service posts. Merchant
// must exist before editorial. No arbitrary author, content, permlink, reply,
// edit, beneficiary, active key, or repeated publication is admitted.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { assertExactExitValueServicePost, EXIT_VALUE_POSTS, exitValueServiceComment } from "../src/core/exitValueServicePosts.mjs";
import { recordExitValuePublication } from "../src/core/exitValueServicePublicationSettlement.mjs";
import { PrivateKey } from "@red-cup-engineering/hive-blockchain-client-service/keys.mjs";
const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
const BROADCASTER = new URL("./hive-broadcast.mjs", import.meta.url); const DATA_DIR = new URL("../data/", import.meta.url).pathname;
function fail(message) { throw new Error(`publish-exit-value-service: ${message}`); }
export function parseOptions(argv) { const options = { kind: "", keyFile: "", executeOne: false, settleTx: "" };
  for (let i = 0; i < argv.length; i += 1) { const arg = argv[i]; const take = () => { const value = argv[i + 1]; if (!value || value.startsWith("--")) fail(`${arg} requires a value`); i += 1; return value; };
    if (arg === "--kind") options.kind = take().toLowerCase(); else if (arg === "--key-file") options.keyFile = take();
    else if (arg === "--execute-one") options.executeOne = true; else if (arg === "--settle-tx") options.settleTx = take().toLowerCase(); else fail(`unknown argument ${arg}`); }
  if (!Object.hasOwn(EXIT_VALUE_POSTS, options.kind)) fail("--kind must be merchant or editorial");
  if (options.executeOne && !options.keyFile) fail("--execute-one requires --key-file");
  if (!options.executeOne && options.keyFile) fail("--key-file is accepted only with --execute-one");
  if (options.settleTx && (options.executeOne || options.keyFile)) fail("--settle-tx cannot be combined with signing");
  if (options.settleTx && !/^[0-9a-f]{40}$/u.test(options.settleTx)) fail("--settle-tx must be a canonical Hive transaction id"); return Object.freeze(options); }

function exactVisible(raw, spec, expected) { return raw?.author === spec.account && raw?.permlink === spec.permlink && raw?.category === expected.parent_permlink
  && raw?.title === expected.title && raw?.body === expected.body && createHash("sha256").update(String(raw.body)).digest("hex") === spec.bodySha256; }
async function publicationState(kind) { const spec = EXIT_VALUE_POSTS[kind]; const expected = exitValueServiceComment(kind);
  const rows = await Promise.all(NODES.map(async (node) => { try { const raw = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("bridge.get_post", { author: spec.account, permlink: spec.permlink });
    const occupied = typeof raw?.author === "string" && raw.author.length > 0; return Object.freeze({ node, available: true, occupied, exact: exactVisible(raw, spec, expected) }); }
    catch { return Object.freeze({ node, available: true, occupied: false, exact: false }); } }));
  if (rows.some((row) => row.occupied && !row.exact)) fail(`foreign content occupies ${spec.target}`);
  const exact = rows.filter((row) => row.exact); const absent = rows.filter((row) => !row.occupied);
  if (exact.length >= 2) return Object.freeze({ status: "published", providers: Object.freeze(exact.map((row) => row.node).sort()) });
  if (exact.length > 0) fail(`${spec.target} publication is not independently visible yet`);
  if (absent.length >= 2) return Object.freeze({ status: "absent", providers: Object.freeze(absent.map((row) => row.node).sort()) });
  fail(`fewer than two providers establish ${spec.target}`); }
async function verifyKey(spec, keyFile) { if ((statSync(keyFile).mode & 0o077) !== 0) fail("posting-key file must not be group/world accessible");
  const publicKey = PrivateKey.from(readFileSync(keyFile, "utf8").trim()).createPublic("STM").toString(); const accounts = await new RpcClient({ nodes: [NODES[0]], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_accounts", [[spec.account]]); const account = accounts?.[0];
  const threshold = Number(account?.posting?.weight_threshold ?? 1); const weight = Number((account?.posting?.key_auths ?? []).find(([candidate]) => candidate === publicKey)?.[1] ?? 0);
  if (weight < threshold) fail(`the supplied key does not independently satisfy ${spec.account}'s posting authority`); }
function broadcast(request) { return new Promise((resolve, reject) => { const child = spawn(process.execPath, [BROADCASTER.pathname], { stdio: ["pipe", "pipe", "pipe"] }); let out = ""; let err = "";
  child.stdout.on("data", (chunk) => { out += String(chunk); }); child.stderr.on("data", (chunk) => { err += String(chunk); }); child.on("close", (code) => { if (code !== 0) reject(new Error(err.trim() || `broadcaster exited ${code}`));
    else { try { resolve(JSON.parse(out)); } catch { reject(new Error("broadcaster returned invalid JSON")); } } }); child.stdin.end(JSON.stringify(request)); }); }
export function exactServicePublicationOperation(kind, operation) { if (!Array.isArray(operation) || operation.length !== 2) return false;
  const spec = EXIT_VALUE_POSTS[kind]; const name = operation[0]?.replace?.(/_operation$/u, "") ?? operation[0]; const fields = operation[1]?.value ?? operation[1];
  if (!spec || name !== "comment") return false; try { return assertExactExitValueServicePost({ account: spec.account, role: "posting", lane: spec.lane, target: spec.target, fields }) === kind; } catch { return false; } }
async function confirmTx(kind, txid) { const confirmations = [];
  for (let attempt = 0; attempt < 12 && confirmations.length < 2; attempt += 1) { await Promise.all(NODES.map(async (node) => { if (confirmations.some((row) => row.node === node)) return;
    const tx = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("account_history_api.get_transaction", { id: txid, include_reversible: true }).catch(() => null); const op = tx?.operations?.[0]; if (!op) return;
    if (!exactServicePublicationOperation(kind, op?.type ? [op.type, op.value] : op)) fail(`${node} confirmed changed publication content`);
    confirmations.push(Object.freeze({ node, block: Number(tx.block_num) })); })); if (confirmations.length < 2 && attempt < 11) await new Promise((resolve) => setTimeout(resolve, 1500)); }
  if (confirmations.length < 2 || new Set(confirmations.map((row) => row.block)).size !== 1) fail("providers did not agree on the publication transaction"); return Object.freeze(confirmations); }
async function waitVisible(kind) { for (let attempt = 0; attempt < 16; attempt += 1) { const state = await publicationState(kind).catch(() => null); if (state?.status === "published") return state;
  if (attempt < 15) await new Promise((resolve) => setTimeout(resolve, 1500)); } fail("publication did not become independently visible"); }
async function settle(kind, txid) { const hive = await confirmTx(kind, txid); const visible = await waitVisible(kind); const event = await recordExitValuePublication(DATA_DIR, { kind, transactionId: txid,
  block: hive[0].block, hiveProviders: hive.map((row) => row.node) }); return Object.freeze({ hive, visible, event }); }
export async function operate(options) { const kind = options.kind; const spec = EXIT_VALUE_POSTS[kind]; const before = await publicationState(kind);
  const prerequisite = kind === "editorial" ? await publicationState("merchant") : null; const base = Object.freeze({ kind: "aagaard.exit-value-service-publication-receipt",
    publicationKind: kind, account: spec.account, target: spec.target, before, prerequisite, observedAt: new Date().toISOString() });
  if (options.settleTx) { const settled = await settle(kind, options.settleTx); return Object.freeze({ ...base, status: "publication-recovered-confirmed", transactionId: options.settleTx,
    hive: settled.hive, visible: settled.visible, durableRecord: Object.freeze({ confirmed: true, publicationId: settled.event.publicationId }), credentialAccess: false, chainMutation: false, retryAllowed: false }); }
  if (!options.executeOne) return Object.freeze({ ...base, status: "observed", credentialAccess: false, chainMutation: false });
  if (before.status !== "absent") fail("the exact post already exists; refusing edit or duplicate");
  if (kind === "editorial" && prerequisite?.status !== "published") fail("merchant offer must be independently visible before editorial publication");
  await verifyKey(spec, options.keyFile);
  const fields = exitValueServiceComment(kind); const request = Object.freeze({ account: spec.account, role: "posting", lane: spec.lane,
    target: spec.target, keyFile: options.keyFile, operation: Object.freeze(["comment", fields]) }); let result;
  try { result = await broadcast(request); } catch (error) { throw new Error(`submission outcome unknown; do not retry automatically: ${error instanceof Error ? error.message : String(error)}`); }
  const txid = String(result?.id ?? ""); if (!/^[0-9a-f]{40}$/u.test(txid)) fail("submission returned no transaction id; do not retry automatically");
  const settled = await settle(kind, txid); return Object.freeze({ ...base, status: "published-confirmed", transactionId: txid, hive: settled.hive,
    visible: settled.visible, durableRecord: Object.freeze({ confirmed: true, publicationId: settled.event.publicationId }), retryAllowed: false,
    credentialAccess: true, chainMutation: true, completedAt: new Date().toISOString() }); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) { try { process.stdout.write(`${JSON.stringify(await operate(parseOptions(process.argv.slice(2))), null, 2)}\n`); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; } }
