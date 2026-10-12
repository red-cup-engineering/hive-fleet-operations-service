#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { reportFailure } from "../src/commandFailure.mjs";
// Michael's productive-capital CapCell: converts one bounded liquid HBD
// tranche into current-rate savings, using only independently agreed live
// law and chain history as its restart state.

import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalJson as canonical } from "@red-cup-engineering/json-services-section/canonical-json";

const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const HERE = dirname(fileURLToPath(import.meta.url));
const ACCOUNT = "michael561";
const AMOUNT = "10.000 HBD";
const MEMO = "aagaard:michael561:productive-savings:v1";
const HIVE_NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
const BROADCASTER = resolve(HERE, "hive-broadcast.mjs");
const NOTES = Object.freeze([
  resolve(HERE, "../content/text/documents/articles/notes/2026-07-24-account-strategy-doctrine.md"),
  resolve(HERE, "../content/text/documents/designs/2026-07-24-michael561-income-staking-acquisition-plan.md"),
  resolve(HERE, "../../../../lenticule-science/content/text/documents/articles/notes/2026/07/25/2026-07-25-note-on-the-structure-of-semiotic-foam.md"),
  resolve(HERE, "../../../../lenticule-science/content/text/documents/articles/notes/2026/07/25/2026-07-25-note-on-relational-physics-of-coordination.md"),
]);
function fail(message) { throw new Error(`michael-productive-savings-cell: ${message}`); }
function amount(value) { const match = /^(0|[1-9][0-9]*)\.([0-9]{3}) HBD$/u.exec(String(value)); if (!match) fail(`malformed HBD amount ${value}`); return BigInt(match[1]) * 1000n + BigInt(match[2]); }

async function refreshKnowledge(keyFile) { const notes = await Promise.all(NOTES.map(async (path) => { const bytes = await readFile(path); return Object.freeze({ path,
  digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` }); })); await Promise.all([access(BROADCASTER), access(keyFile)]);
  return Object.freeze({ notes: Object.freeze(notes), capabilities: Object.freeze({ signer: true, michaelActiveCustody: true }) }); }
async function stateAt(node) { const [accounts, props, pending] = await Promise.all([new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_accounts", [[ACCOUNT]]),
  new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_dynamic_global_properties", []), new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_savings_withdraw_from", [ACCOUNT])]); const account = accounts?.[0];
  return Object.freeze({ hbdBalance: String(account?.hbd_balance), savingsHbdBalance: String(account?.savings_hbd_balance),
    interestRateBps: Number(props?.hbd_interest_rate), pendingWithdrawalCount: Array.isArray(pending) ? pending.length : -1 }); }
async function certifiedState() { const rows = await Promise.all(HIVE_NODES.map(async (node) => Object.freeze({ node, state: await stateAt(node) })));
  const groups = new Map(); for (const row of rows) { const key = canonical(row.state); const group = groups.get(key) ?? []; group.push(row); groups.set(key, group); }
  const winner = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? []; if (winner.length < 2) fail("fewer than two Hive providers agree on savings state");
  return Object.freeze({ state: winner[0].state, providers: Object.freeze(winner.map((row) => row.node)),
    digest: `sha256:${createHash("sha256").update(canonical(winner[0].state)).digest("hex")}` }); }
function exactDeposit(fields) { return fields?.from === ACCOUNT && fields?.to === ACCOUNT && fields?.amount === AMOUNT && fields?.memo === MEMO; }
export function normalizeSavingsFields(fields) { const value = fields?.amount; const normalizedAmount = value && typeof value === "object"
  && value.nai === "@@000000013" && Number(value.precision) === 3 && /^(?:0|[1-9][0-9]*)$/u.test(String(value.amount))
  ? `${BigInt(value.amount) / 1000n}.${(BigInt(value.amount) % 1000n).toString().padStart(3, "0")} HBD` : value;
  return Object.freeze({ from: fields?.from, to: fields?.to, amount: normalizedAmount, memo: fields?.memo }); }
async function depositedBefore() { const rows = await Promise.all(HIVE_NODES.map(async (node) => { const history = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_account_history", [ACCOUNT, -1, 1000]);
  return Object.freeze({ node, found: history.some((entry) => { const op = entry?.[1]?.op; const name = Array.isArray(op) ? op[0] : op?.type?.replace(/^.*::/u, "");
    const fields = Array.isArray(op) ? op[1] : op?.value; return name === "transfer_to_savings" && exactDeposit(fields); }) }); }));
  if (rows.filter((row) => row.found).length >= 2) return true; if (rows.filter((row) => !row.found).length >= 2) return false; fail("Hive providers disagree on productive-savings history"); }
export function decide(state, prior) { if (prior) return "monitor"; if (state.interestRateBps < 1000) return "refuse-rate-below-10-percent";
  if (state.pendingWithdrawalCount !== 0) return "refuse-pending-withdrawal"; if (amount(state.hbdBalance) < 10_000n) return "refuse-insufficient-liquid-hbd"; return "deposit"; }
function submit(request) { return new Promise((resolvePromise, rejectPromise) => { const child = spawn(process.execPath, [BROADCASTER], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("close", (code) => { if (code !== 0) rejectPromise(new Error(stderr.trim() || `signer exited ${code}`)); else { try { resolvePromise(JSON.parse(stdout)); }
    catch { rejectPromise(new Error("signer returned invalid JSON")); } } }); child.stdin.end(JSON.stringify(request)); }); }
async function confirm(txid, fields) { const rows = new Map(); for (let attempt = 0; attempt < 15 && rows.size < 2; attempt += 1) {
  await Promise.all(HIVE_NODES.map(async (node) => { if (rows.has(node)) return; const tx = await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("account_history_api.get_transaction", { id: txid, include_reversible: true }).catch(() => null);
    const actual = tx?.operations?.[0]?.value ?? tx?.operations?.[0]?.[1]; if (!actual) return; if (canonical(normalizeSavingsFields(actual)) !== canonical(fields)) fail(`${node} confirmed a different savings operation`);
    rows.set(node, Number(tx.block_num)); })); if (rows.size < 2 && attempt < 14) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200)); }
  if (rows.size < 2 || new Set(rows.values()).size !== 1) fail("savings deposit did not reach two-provider confirmation"); }
export async function operate({ executeOne = false, keyFile = "" } = {}) { const knowledge = await refreshKnowledge(keyFile); const observation = await certifiedState();
  const prior = await depositedBefore(); const transition = decide(observation.state, prior); const base = { kind: "aagaard.michael-productive-savings-capcell.v1",
    observedAt: new Date().toISOString(), knowledge, observation, evidence: Object.freeze({ priorExactDeposit: prior }), transition };
  if (!executeOne || transition !== "deposit") return Object.freeze({ ...base, status: transition, chainMutation: false, credentialAccess: false });
  const fields = Object.freeze({ from: ACCOUNT, to: ACCOUNT, amount: AMOUNT, memo: MEMO }); const operation = Object.freeze(["transfer_to_savings", fields]);
  const result = await submit({ kind: "aagaard.hive-write", account: ACCOUNT, role: "active", lane: "productive-savings", target: ACCOUNT, keyFile, operation });
  const txid = String(result?.id ?? ""); if (!/^[0-9a-f]{40}$/u.test(txid)) fail("submission returned no transaction id; do not retry"); await confirm(txid, fields);
  return Object.freeze({ ...base, status: "deposit-confirmed", transactionId: txid, retryAllowed: false, chainMutation: true,
    credentialAccess: Object.freeze({ occurred: true, role: "active", location: "local-key-file" }) }); }
function options(argv) { const out = { executeOne: false, keyFile: "" }; for (let i = 0; i < argv.length; i += 1) { if (argv[i] === "--execute-one") out.executeOne = true;
  else if (argv[i] === "--key-file") out.keyFile = argv[++i] ?? ""; else fail(`unknown argument ${argv[i]}`); } if (!out.keyFile) fail("--key-file is required for capability refresh"); return out; }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) operate(options(process.argv.slice(2))).then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
  .catch(reportFailure);
