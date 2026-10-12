#!/usr/bin/env node
// Remote, active-authority signing boundary for Sigmund's bounded capital
// circulation lane.  The active key remains on cold-red-gate; this process
// receives only an already-sized two-leg Hive Engine envelope.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HOST = "cold-red-gate";
const ACCOUNTS = Object.freeze({
  "sigmund-vexler": Object.freeze({ keySentinel: "cold-red-gate:sigmund-vexler/active", keyFile: "/home/emsenn/.config/blockchain/hive/sigmund-vexler/active.wif" }),
  michael561: Object.freeze({ keySentinel: "cold-red-gate:michael561/active", keyFile: "/home/emsenn/.config/blockchain/hive/michael561/active.wif" }),
});
const MAX_INPUT = 100_000_000n; // 1.00000000 SWAP.HIVE
const MIN_PROFIT = 100_000n; // 0.00100000 SWAP.HIVE
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function exactKeys(value, keys) { return value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === [...keys].sort().join(","); }

function units(value, precision) {
  const text = String(value ?? ""); const match = DECIMAL.exec(text);
  if (!match || (match[1]?.length ?? 0) > precision) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
}

function admittedRoundTrip(request) {
  const fields = request?.operation?.[1]; let calls;
  const scope = ACCOUNTS[request?.account];
  try { calls = JSON.parse(fields?.json ?? ""); } catch { return false; }
  const [swap, sell] = Array.isArray(calls) ? calls : [];
  const sp = swap?.contractPayload; const ep = sell?.contractPayload;
  if (!exactKeys(request, ["kind", "account", "role", "lane", "target", "keyFile", "operation"])
    || request.kind !== "aagaard.hive-write" || !scope || request.role !== "active" || request.lane !== "trading" || request.keyFile !== scope.keySentinel
    || !Array.isArray(request.operation) || request.operation[0] !== "custom_json" || !exactKeys(fields, ["id", "required_auths", "required_posting_auths", "json"])
    || fields.id !== "ssc-mainnet-hive" || JSON.stringify(fields.required_auths) !== JSON.stringify([request.account]) || JSON.stringify(fields.required_posting_auths) !== "[]"
    || !exactKeys(swap, ["contractName", "contractAction", "contractPayload"]) || swap.contractName !== "marketpools" || swap.contractAction !== "swapTokens"
    || !exactKeys(sell, ["contractName", "contractAction", "contractPayload"]) || sell.contractName !== "market" || sell.contractAction !== "sell"
    || !exactKeys(sp, ["tokenPair", "tokenSymbol", "tokenAmount", "tradeType", "maxAmountIn"]) || sp.tradeType !== "exactOutput"
    || !exactKeys(ep, ["symbol", "quantity", "price", "expiration"]) || ep.symbol !== sp.tokenSymbol || ep.quantity !== sp.tokenAmount
    || typeof sp.tokenPair !== "string" || !sp.tokenPair.split(":").includes("SWAP.HIVE") || !sp.tokenPair.split(":").includes(sp.tokenSymbol)
    || !Number.isInteger(ep.expiration) || ep.expiration < 1 || ep.expiration > 300) return false;
  const quantityPrecision = DECIMAL.exec(String(sp.tokenAmount))?.[1]?.length ?? 0;
  const quantity = units(sp.tokenAmount, quantityPrecision); const input = units(sp.maxAmountIn, 8); const price = units(ep.price, 8);
  if (quantity === null || input === null || price === null || quantity <= 0n || input <= 0n || price <= 0n || input > MAX_INPUT) return false;
  const proceeds = quantity * price / 10n ** BigInt(quantityPrecision);
  return proceeds >= input + MIN_PROFIT && request.target === `${sp.tokenSymbol}:pool-to-book-round-trip`;
}

export function validateRemoteArbitrageRequest(request) {
  if (!admittedRoundTrip(request)) throw new Error("cold-red-gate arbitrage signer refused the unsafe capital-circulation envelope");
  return true;
}

function remoteSource(request) {
  const scope = ACCOUNTS[request.account];
  if (!scope) throw new Error("remote arbitrage signer has no account scope");
  const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
  return `
import { readFileSync, statSync } from "node:fs";
const request = JSON.parse(Buffer.from("${encoded}", "base64").toString("utf8"));
const ACCOUNT = ${JSON.stringify(request.account)}; const KEY = ${JSON.stringify(scope.keyFile)}; const KEY_SENTINEL = ${JSON.stringify(scope.keySentinel)}; const MAX = 100000000n; const MIN = 100000n;
const DEC = /^(?:0|[1-9][0-9]*)(?:\\.([0-9]+))?$/u;
const exact = (v, k) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === [...k].sort().join(",");
const units = (v, p) => { const t = String(v ?? ""), m = DEC.exec(t); if (!m || (m[1]?.length ?? 0) > p) return null; const [w,f=""] = t.split("."); return BigInt(w) * 10n ** BigInt(p) + BigInt((f + "0".repeat(p)).slice(0,p) || "0"); };
const fields = request?.operation?.[1]; let calls; try { calls = JSON.parse(fields?.json ?? ""); } catch { calls = null; }
const [swap,sell] = Array.isArray(calls) ? calls : []; const sp = swap?.contractPayload, ep = sell?.contractPayload;
const qp = DEC.exec(String(sp?.tokenAmount ?? ""))?.[1]?.length ?? 0; const q = units(sp?.tokenAmount, qp), input = units(sp?.maxAmountIn,8), price = units(ep?.price,8);
const admitted = exact(request,["kind","account","role","lane","target","keyFile","operation"]) && request.kind === "aagaard.hive-write" && request.account === ACCOUNT && request.role === "active" && request.lane === "trading" && request.keyFile === KEY_SENTINEL
  && Array.isArray(request.operation) && request.operation[0] === "custom_json" && exact(fields,["id","required_auths","required_posting_auths","json"]) && fields.id === "ssc-mainnet-hive" && JSON.stringify(fields.required_auths) === JSON.stringify([ACCOUNT]) && JSON.stringify(fields.required_posting_auths) === "[]"
  && exact(swap,["contractName","contractAction","contractPayload"]) && swap.contractName === "marketpools" && swap.contractAction === "swapTokens" && exact(sp,["tokenPair","tokenSymbol","tokenAmount","tradeType","maxAmountIn"]) && sp.tradeType === "exactOutput"
  && exact(sell,["contractName","contractAction","contractPayload"]) && sell.contractName === "market" && sell.contractAction === "sell" && exact(ep,["symbol","quantity","price","expiration"]) && ep.symbol === sp.tokenSymbol && ep.quantity === sp.tokenAmount && typeof sp.tokenPair === "string" && sp.tokenPair.split(":").includes("SWAP.HIVE") && sp.tokenPair.split(":").includes(sp.tokenSymbol) && Number.isInteger(ep.expiration) && ep.expiration > 0 && ep.expiration <= 300
  && q !== null && input !== null && price !== null && q > 0n && input > 0n && price > 0n && input <= MAX && q * price / 10n ** BigInt(qp) >= input + MIN && request.target === sp.tokenSymbol + ":pool-to-book-round-trip";
if (!admitted) throw new Error("remote arbitrage signer refused unsafe envelope");
const rpc = async (node, method, params) => { const r = await fetch(node,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(10000)}); const b = await r.json(); if (!r.ok || b?.error) throw new Error("remote active-authority RPC failed"); return b.result; };
const nodes = ["https://api.hive.blog","https://api.openhive.network"];
const rows = await Promise.all(nodes.map(async (node) => { const [accounts,rcAccounts,rcStats] = await Promise.all([rpc(node,"condenser_api.get_accounts",[[ACCOUNT]]),rpc(node,"rc_api.find_rc_accounts",{accounts:[ACCOUNT]}),rpc(node,"rc_api.get_rc_operation_stats",{operation:"custom_json_operation"})]); return { account:accounts?.[0], rc:rcAccounts?.rc_accounts?.[0], average:BigInt(String(rcStats?.avg_cost_rc ?? "0")) }; }));
if (rows.length !== 2 || rows.some(({account,rc,average}) => !account || !rc || average <= 0n)) throw new Error("remote arbitrage RC evidence unavailable");
for (const {rc,average} of rows) { const maximum = BigInt(String(rc.max_rc ?? "0")), current = BigInt(String(rc.rc_manabar?.current_mana ?? "0")), updated = Number(rc.rc_manabar?.last_update_time); const now = Math.floor(Date.now()/1000); if (maximum <= 0n || current < 0n || !Number.isSafeInteger(updated)) throw new Error("remote arbitrage RC evidence malformed"); const regenerated = current + BigInt(Math.max(0,now-updated))*maximum/432000n; if ((regenerated > maximum ? maximum : regenerated) < 2n*average) throw new Error("remote arbitrage signer refused insufficient RC reserve"); }
const feeState = await Promise.all(["https://api.hive-engine.com/rpc/contracts","https://herpc.dtools.dev/contracts"].map(async (node) => { const find = async (params) => { const r = await fetch(node,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"find",params}),signal:AbortSignal.timeout(10000)}); const b = await r.json(); if (!r.ok || b?.error || !Array.isArray(b?.result)) throw new Error("remote BEED fee evidence unavailable"); return b.result; }; const [balances,bids] = await Promise.all([find({contract:"tokens",table:"balances",query:{account:ACCOUNT,symbol:"BEED"},limit:2,offset:0,indexes:[]}),find({contract:"market",table:"buyBook",query:{symbol:"BEED"},limit:200,offset:0,indexes:[{index:"priceDec",descending:true}]})]); if (balances.length>1) throw new Error("remote BEED balance ambiguous"); return {balance:String(balances[0]?.balance ?? "0.0000"),bids:bids.map((x)=>({quantity:String(x.quantity),price:String(x.price)}))}; }));
if (JSON.stringify(feeState[0]) !== JSON.stringify(feeState[1])) throw new Error("remote BEED fee evidence disagrees"); let remaining=10n, feeValue=0n, prior=null; const balance=units(feeState[0].balance,4); for (const bid of feeState[0].bids) { const qty=units(bid.quantity,4), bidPrice=units(bid.price,8); if (qty===null || bidPrice===null || qty<=0n || bidPrice<=0n || (prior!==null && bidPrice>prior)) throw new Error("remote BEED bid evidence malformed"); const take=qty<remaining?qty:remaining; feeValue+=take*bidPrice/10000n; remaining-=take; prior=bidPrice; if (remaining===0n) break; } const gross=q*price/10n**BigInt(qp)-input; if (balance===null || balance<10n || remaining!==0n || gross<feeValue+MIN) throw new Error("remote signer refused BEED-fee-unprofitable route");
if ((statSync(KEY).mode & 0o077) !== 0) throw new Error("remote active key permissions are broader than 0600");
const wif = readFileSync(KEY,"utf8").trim(); const [{Waggle},{PrivateKey}] = await Promise.all([import("file:///home/emsenn/aagaard/src/integrations/hive/waggle/client.mjs"),import("file:///home/emsenn/aagaard/src/integrations/hive/waggle/keys.mjs")]);
const publicKey = PrivateKey.from(wif).createPublic("STM").toString(); const authority = rows[0].account.active; const threshold = Number(authority?.weight_threshold ?? 1), weight = Number((authority?.key_auths ?? []).find(([key]) => key === publicKey)?.[1] ?? 0); if (weight < threshold) throw new Error("remote key does not independently satisfy active authority");
const result = await new Waggle({account:ACCOUNT,keys:{active:wif}}).broadcast([request.operation],"active"); if (!/^[0-9a-f]{40}$/.test(result?.id ?? "")) throw new Error("remote arbitrage broadcast returned no canonical transaction id"); process.stdout.write(JSON.stringify({id:result.id}));`;
}

export function broadcastArbitrageViaColdRedGate(request) {
  validateRemoteArbitrageRequest(request);
  return new Promise((resolvePromise, rejectPromise) => {
    const localSigner = process.env.AAGAARD_COLD_RED_GATE_LOCAL_SIGNER === "1";
    const child = localSigner
      ? spawn(process.execPath, ["--input-type=module", "-"], { stdio: ["pipe", "pipe", "pipe"] })
      : spawn("ssh", ["-T", "-o", "BatchMode=yes", HOST, "node", "--input-type=module", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", (chunk) => { stdout += String(chunk); }); child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => { if (code !== 0) rejectPromise(new Error(stderr.trim() || `remote signer exited ${code}`)); else { try { resolvePromise(JSON.parse(stdout)); } catch { rejectPromise(new Error("remote signer returned invalid JSON")); } } });
    child.stdin.end(remoteSource(request));
  });
}

async function main() { process.stdout.write(JSON.stringify(await broadcastArbitrageViaColdRedGate(JSON.parse(readFileSync(0, "utf8"))))); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
