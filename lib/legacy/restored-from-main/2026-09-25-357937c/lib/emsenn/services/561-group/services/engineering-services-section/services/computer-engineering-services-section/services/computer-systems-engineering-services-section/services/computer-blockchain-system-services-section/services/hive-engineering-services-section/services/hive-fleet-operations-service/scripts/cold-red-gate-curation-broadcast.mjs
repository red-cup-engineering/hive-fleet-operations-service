#!/usr/bin/env node
// Reusable remote safety gate for one independently planned emsenn0 curation
// vote. The posting key never leaves cold-red-gate. The local operator admits
// exactly one strategy-derived vote; this signer admits only the bounded vote
// lane and rechecks post, mana, RC, and authority before opening the key file.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HOST = "cold-red-gate";
const REMOTE_KEY_FILE = "/home/emsenn/info/lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-computer-services-section/services/computer-machine-services-section/services/persistent-computer-machine-services-section/services/bare-cedar-fog-services-section/data/runtime/config/blockchain/hive/emsenn0/posting.wif";
const KEY_SENTINEL = "cold-red-gate:emsenn0/posting";
const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/;
const PERMLINK = /^[a-z0-9][a-z0-9-]{0,254}$/;

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function validateRemoteCurationRequest(request) {
  const fields = request?.operation?.[1];
  if (!exactKeys(request, ["account", "role", "lane", "target", "keyFile", "operation"])
    || request.account !== "emsenn0" || request.role !== "posting" || request.lane !== "voting"
    || request.keyFile !== KEY_SENTINEL
    || !Array.isArray(request.operation) || request.operation.length !== 2 || request.operation[0] !== "vote"
    || !exactKeys(fields, ["voter", "author", "permlink", "weight"])
    || fields.voter !== "emsenn0" || !ACCOUNT.test(fields.author) || !PERMLINK.test(fields.permlink)
    || request.target !== `${fields.author}/${fields.permlink}`
    || !Number.isSafeInteger(fields.weight) || fields.weight < 100 || fields.weight > 5000) {
    throw new Error("cold-red-gate curation signer refused the unsafe operation");
  }
  return true;
}

function remoteSource(request) {
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
  return `
import { readFileSync, statSync } from "node:fs";
const request = JSON.parse(Buffer.from("${encoded}", "base64").toString("utf8"));
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const fields = request?.operation?.[1];
const admitted = exactKeys(request, ["account", "role", "lane", "target", "keyFile", "operation"])
  && request.account === "emsenn0" && request.role === "posting" && request.lane === "voting"
  && request.keyFile === "cold-red-gate:emsenn0/posting"
  && Array.isArray(request.operation) && request.operation.length === 2 && request.operation[0] === "vote"
  && exactKeys(fields, ["voter", "author", "permlink", "weight"])
  && fields.voter === "emsenn0" && /^[a-z][a-z0-9.-]{2,15}$/.test(fields.author)
  && /^[a-z0-9][a-z0-9-]{0,254}$/.test(fields.permlink)
  && request.target === fields.author + "/" + fields.permlink
  && Number.isSafeInteger(fields.weight) && fields.weight >= 100 && fields.weight <= 5000;
if (!admitted) throw new Error("remote curation signer refused the unsafe operation");
const { RpcClient } = await import("@red-cup-engineering/hive-blockchain-client-service/rpc.mjs");
const rpc = (method, params) => new RpcClient({ nodes: ["https://api.hive.blog"], timeout: 10000 }).call(method, params);
const [post, rcAccounts, rcStats, accounts] = await Promise.all([
  rpc("bridge.get_post", { author: fields.author, permlink: fields.permlink, observer: "emsenn0" }),
  rpc("rc_api.find_rc_accounts", { accounts: ["emsenn0"] }),
  rpc("rc_api.get_rc_operation_stats", { operation: "vote_operation" }),
  rpc("condenser_api.get_accounts", [["emsenn0"]]),
]);
const payoutMs = Date.parse(String(post?.payout_at ?? "") + (String(post?.payout_at ?? "").endsWith("Z") ? "" : "Z"));
const pending = /^([0-9]+(?:\\.[0-9]{1,3})?) HBD$/.exec(String(post?.pending_payout_value ?? ""));
const maximumPayout = /^([0-9]+(?:\\.[0-9]{1,3})?) HBD$/.exec(String(post?.max_accepted_payout ?? ""));
if (post?.author !== fields.author || post?.permlink !== fields.permlink
  || post?.is_paidout === true || !Number.isFinite(payoutMs) || payoutMs - Date.now() < 600000
  || !pending || Number(pending[1]) <= 0
  || !maximumPayout || Number(maximumPayout[1]) <= 0
  || !Array.isArray(post?.active_votes)
  || post.active_votes.some((vote) => vote?.voter === fields.voter)) {
  throw new Error("remote curation signer refused unsafe post viability");
}
const rc = rcAccounts?.rc_accounts?.[0];
const maximum = BigInt(String(rc?.max_rc ?? "0"));
const current = BigInt(String(rc?.rc_manabar?.current_mana ?? "0"));
const lastUpdate = Number(rc?.rc_manabar?.last_update_time);
const average = BigInt(String(rcStats?.avg_cost_rc ?? "0"));
const nowUnix = Math.floor(Date.now() / 1000);
if (maximum <= 0n || current < 0n || average <= 0n || !Number.isSafeInteger(lastUpdate)) throw new Error("remote curation RC evidence malformed");
const regenerated = current + BigInt(Math.max(0, nowUnix - lastUpdate)) * maximum / 432000n;
const available = regenerated > maximum ? maximum : regenerated;
if (available < 2n * average) throw new Error("remote curation signer refused insufficient RC reserve");
const account = accounts?.[0];
const asset = (value) => Number(String(value ?? "0").split(" ")[0]);
const maxMana = Math.max(0, Math.round((asset(account?.vesting_shares) - asset(account?.delegated_vesting_shares)
  + asset(account?.received_vesting_shares)) * 1000000));
const storedMana = Number(account?.voting_manabar?.current_mana);
const voteLastUpdate = Number(account?.voting_manabar?.last_update_time);
if (!(maxMana > 0) || !Number.isFinite(storedMana) || !Number.isSafeInteger(voteLastUpdate)) throw new Error("remote voting-mana evidence malformed");
const regeneratedMana = Math.min(maxMana, Math.max(0, Math.floor(storedMana
  + Math.max(0, nowUnix - voteLastUpdate) * maxMana / 432000)));
const manaBps = Math.floor(regeneratedMana * 10000 / maxMana);
const projectedManaBps = Math.floor(manaBps * (500000 - fields.weight) / 500000);
if (manaBps < 8000 || projectedManaBps < 8000) throw new Error("remote curation signer refused voting-mana reserve breach");
const keyFile = ${JSON.stringify(REMOTE_KEY_FILE)};
if ((statSync(keyFile).mode & 0o077) !== 0) throw new Error("remote posting key permissions are broader than 0600");
const wif = readFileSync(keyFile, "utf8").trim();
const [{ HiveClient }, { PrivateKey }] = await Promise.all([
  import("@red-cup-engineering/hive-blockchain-client-service"),
  import("@red-cup-engineering/hive-blockchain-client-service/src/keys.mjs"),
]);
const publicKey = PrivateKey.from(wif).createPublic("STM").toString();
const threshold = Number(account?.posting?.weight_threshold ?? 1);
const weight = Number((account?.posting?.key_auths ?? []).find(([candidate]) => candidate === publicKey)?.[1] ?? 0);
if (weight < threshold) throw new Error("remote key does not independently satisfy emsenn0 posting authority");
const result = await new HiveClient({ account: "emsenn0", keys: { posting: wif } }).broadcast([["vote", fields]], "posting");
if (!/^[0-9a-f]{40}$/.test(result?.id ?? "")) throw new Error("remote curation broadcast returned no canonical transaction id");
process.stdout.write(JSON.stringify({ id: result.id }));
`;
}

export function broadcastCurationViaColdRedGate(request) {
  validateRemoteCurationRequest(request);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", HOST, "sh", "-lc", "cd /home/emsenn/561-group/releases/hive-fleet-signer-current && exec node --input-type=module -"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => {
      if (code !== 0) rejectPromise(new Error(stderr.trim() || `remote signer exited ${code}`));
      else { try { resolvePromise(JSON.parse(stdout)); } catch { rejectPromise(new Error("remote signer returned invalid JSON")); } }
    });
    child.stdin.end(remoteSource(request));
  });
}

async function main() {
  let request;
  try { request = JSON.parse(readFileSync(0, "utf8")); }
  catch (error) { throw new Error(`cold-red-gate curation signer stdin is not JSON: ${error instanceof Error ? error.message : String(error)}`); }
  process.stdout.write(JSON.stringify(await broadcastCurationViaColdRedGate(request)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { await main(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
