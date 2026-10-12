#!/usr/bin/env node
// The real AAGAARD_BROADCAST_COMMAND: bridges Aagaard's generic broadcast
// request (see hiveWrite.adapter.ts) to an actual signed, broadcast Hive
// transaction via the waggle library (src/integrations/hive/waggle/),
// copied in from the firm's own prior art -- built and unit-tested against
// a mocked transport, but per its own README never yet broadcast with real
// keys. This is that next step.
//
// Four operation shapes are signed and broadcast, and nothing else:
//
//   "vote" -- the native Hive vote operation, signed with the posting key.
//
//   "custom_json" whose decoded json is {contractName, contractAction,
//   contractPayload} for exactly one of the three contract/action pairs in
//   ALLOWED_CONTRACT_ACTIONS below -- each verified against the real,
//   open-source contract sources (github.com/hive-engine/hivesmartcontracts)
//   and, where available, against this fleet's own real prior broadcasts.
//   Unbundled market buys and sells are deliberately not in this set.
//   Signed with the active key, exactly as those contracts themselves
//   assert (isSignedWithActiveKey === true) and refuse without.
//
//   "transfer" -- ONLY to WRAP_TARGET, and ONLY with a memo that exactly
//   matches WRAP_MEMO (imported from hiveEngineOps.mjs, the single place
//   that string is constructed, so this check can never drift from what
//   wrapHive itself builds). This is real HIVE leaving the account for an
//   external account, verified against the live deployed hivepegged
//   contract (getContract "hivepegged" -> owner: "honey-swap") and cross-
//   checked against a real recent on-chain deposit (suara8's 0.398 HIVE
//   transfer, same memo shape, credited 0.395 SWAP.HIVE). The strict
//   target+memo check exists so this capability can never become a
//   general-purpose "send HIVE anywhere" primitive, even by a bug
//   elsewhere in the codebase that constructs a transfer op some other way.
//
//   "custom_json" id "terracore_claim" -- exactly one positive 8-decimal
//   SCRAP amount, with the actor as the sole posting authority. TerraCore's
//   own developer contract explicitly assigns claim to the posting key.
//
// Everything else is refused, including plain-Hive-valid operations this
// codebase has at points used as placeholders: "aagaard_trade_intent" is
// not a real Hive operation at all; a blanket "custom_json is real"
// allowance let six no-op transactions (a made-up "aagaard.lp" id nothing
// interprets) through on this bridge's first live run, which is exactly
// why the allowlist here is keyed on the actual contractName+contractAction
// pair, not just the outer custom_json shape.
//
// Reads one JSON request on stdin (HiveBroadcastRequest's shape), writes
// {"id": "<real transaction id>"} on stdout, exit 0. On refusal or error:
// stderr message, exit 1 -- matching hiveWrite.adapter.ts's own contract.

import { readFileSync } from "node:fs";
import { Waggle } from "../src/integrations/hive/waggle/client.mjs";
import { HONEY_SWAP_ACCOUNT, WRAP_MEMO } from "../src/integrations/hive-engine/hiveEngineOps.mjs";

const ALLOWED_CONTRACT_ACTIONS = new Set([
  "tokens.stake",
  "tokens.delegate",
  "hivepegged.withdraw",
]);

function keyOfCall(call) {
  return call && typeof call === "object" && !Array.isArray(call)
    ? `${call.contractName}.${call.contractAction}`
    : "invalid.invalid";
}

function validateRoundTripBatch(calls) {
  const poolToBook = calls.length === 2 && keyOfCall(calls[0]) === "marketpools.swapTokens" && keyOfCall(calls[1]) === "market.sell";
  if (!poolToBook) {
    fail("hive-broadcast: a batched custom_json must be exactly pool exact-output swap -> limit sell");
    return;
  }
  const swap = calls[0].contractPayload;
  const order = calls[1].contractPayload;
  const bound = swap?.maxAmountIn;
  const tradeType = "exactOutput";
  if (!swap || !order || swap.tradeType !== tradeType
    || typeof bound !== "string" || !bound
    || typeof swap.tokenPair !== "string" || !swap.tokenPair.includes(":")) {
    fail(`hive-broadcast: round-trip swap must be ${tradeType} with tokenPair and its slippage bound`);
    return;
  }
  if (swap.tokenSymbol !== order.symbol || swap.tokenAmount !== order.quantity
    || typeof order.price !== "string" || !order.price
    || !Number.isInteger(order.expiration) || order.expiration < 1 || order.expiration > 300) {
    fail("hive-broadcast: round-trip order and swap must use the exact same symbol and quantity at a bounded price within 300 seconds");
  }
  const exactKeys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
  if (!exactKeys(swap, ["maxAmountIn", "tokenAmount", "tokenPair", "tokenSymbol", "tradeType"])
    || !exactKeys(order, ["expiration", "price", "quantity", "symbol"])) {
    fail("hive-broadcast: round-trip payload contains missing or extra fields");
  }
  const quantityMatch = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(swap.tokenAmount ?? "");
  if (!quantityMatch || BigInt(String(swap.tokenAmount).replace(".", "")) === 0n
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(bound)
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(order.price)
    || BigInt(bound.replace(".", "")) === 0n || BigInt(order.price.replace(".", "")) === 0n) {
    fail("hive-broadcast: round-trip amounts must be positive canonical decimals with 8-decimal SWAP.HIVE bounds");
  }
  const pair = swap.tokenPair.split(":");
  if (pair.length !== 2 || !pair.includes("SWAP.HIVE") || !pair.includes(swap.tokenSymbol)) {
    fail("hive-broadcast: round-trip pool must pair the exact order token with SWAP.HIVE");
  }
  const quantityDecimals = quantityMatch[1]?.length ?? 0;
  const quantityUnits = BigInt(swap.tokenAmount.replace(".", ""));
  const priceUnits = BigInt(order.price.replace(".", ""));
  const maximumInputUnits = BigInt(bound.replace(".", ""));
  const conservativeProceedsUnits = quantityUnits * priceUnits / (10n ** BigInt(quantityDecimals));
  if (conservativeProceedsUnits <= maximumInputUnits) {
    fail("hive-broadcast: round-trip hard limit does not prove positive proceeds over maximum input");
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function validateTerraCoreClaim(account, role, fields, decoded) {
  const exactPostingAuth = Array.isArray(fields.required_posting_auths)
    && fields.required_posting_auths.length === 1
    && fields.required_posting_auths[0] === account;
  if (role !== "posting" || !Array.isArray(fields.required_auths) || fields.required_auths.length !== 0 || !exactPostingAuth) {
    fail("hive-broadcast: TerraCore claim requires only the actor's posting authority");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)
    || Object.keys(decoded).length !== 1 || typeof decoded.amount !== "string"
    || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/.test(decoded.amount)
    || BigInt(decoded.amount.replace(".", "")) === 0n) {
    fail("hive-broadcast: TerraCore claim must contain exactly one positive 8-decimal amount");
  }
}

const BLOCKCHAIN_NODES = (process.env.AAGAARD_HIVE_ENGINE_BLOCKCHAIN_NODES ?? "https://api.hive-engine.com/rpc/blockchain,https://herpc.dtools.dev/blockchain")
  .split(",").map((value) => value.trim()).filter(Boolean);

async function transactionInfo(txid) {
  for (const node of BLOCKCHAIN_NODES) {
    try {
      const response = await fetch(node, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransactionInfo", params: { txid } }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload?.result) return payload.result;
    } catch {
      // Try the next provider; absence is reported as unverified below.
    }
  }
  return null;
}

async function waitForRoundTripRows(outerId) {
  let latest = [null, null];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rows = await Promise.all([transactionInfo(`${outerId}-0`), transactionInfo(`${outerId}-1`)]);
    latest = rows.map((row, index) => row ?? latest[index]);
    if (latest[0] && latest[1]) return latest;
    if (attempt < 9) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return latest;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch (error) {
    fail(`hive-broadcast: stdin is not JSON: ${error.message}`);
    return;
  }

  const { account, role, operation, keyFile } = payload;
  if (typeof account !== "string" || !account) fail("hive-broadcast: no account");
  if (!Array.isArray(operation) || operation.length !== 2) fail("hive-broadcast: no operation");
  const [opName, opFields] = operation;

  if (opName !== "vote" && opName !== "custom_json" && opName !== "transfer") {
    fail(`hive-broadcast: refusing operation '${opName}' -- only vote, transfer (wrap-deposit only), and a narrow allowlist of custom_json contract calls are signed and broadcast`);
    return;
  }

  let contractKey = null;
  let contractCalls = null;
  let customJsonRole = "active";
  if (opName === "custom_json") {
    let decoded;
    try {
      decoded = JSON.parse(opFields.json);
    } catch (error) {
      fail(`hive-broadcast: custom_json's own json field is not JSON: ${error.message}`);
      return;
    }
    if (opFields.id === "terracore_claim") {
      validateTerraCoreClaim(account, role, opFields, decoded);
      contractKey = "terracore.claim";
      customJsonRole = "posting";
    } else if (Array.isArray(decoded)) {
      const exactActiveAuth = role === "active"
        && Array.isArray(opFields.required_auths) && opFields.required_auths.length === 1 && opFields.required_auths[0] === account
        && Array.isArray(opFields.required_posting_auths) && opFields.required_posting_auths.length === 0
        && opFields.id === "ssc-mainnet-hive";
      if (!exactActiveAuth) fail("hive-broadcast: Hive-Engine round trip requires exactly the actor's active authority and canonical contract id");
      validateRoundTripBatch(decoded);
      contractCalls = decoded;
      contractKey = decoded.map(keyOfCall).join("+");
    } else {
      contractKey = keyOfCall(decoded);
      if (!ALLOWED_CONTRACT_ACTIONS.has(contractKey)) {
        fail(`hive-broadcast: refusing contract call '${contractKey}' -- only ${[...ALLOWED_CONTRACT_ACTIONS].join(", ")} are verified and allowed as standalone calls`);
        return;
      }
    }
  }

  if (opName === "transfer") {
    if (opFields.to !== HONEY_SWAP_ACCOUNT) {
      fail(`hive-broadcast: refusing transfer to '${opFields.to}' -- transfer is only ever allowed to ${HONEY_SWAP_ACCOUNT} (the real HIVE/SWAP.HIVE peg), never any other destination`);
      return;
    }
    if (opFields.memo !== WRAP_MEMO) {
      fail("hive-broadcast: refusing transfer -- memo does not exactly match the verified wrap-deposit envelope, refusing rather than broadcasting a transfer whose purpose isn't the one this bridge verified");
      return;
    }
    if (typeof opFields.amount !== "string" || !/^\d+\.\d{3} HIVE$/.test(opFields.amount)) {
      fail(`hive-broadcast: refusing transfer -- amount '${opFields.amount}' is not a well-formed 'X.XXX HIVE' quantity`);
      return;
    }
  }

  if (typeof keyFile !== "string" || !keyFile) fail("hive-broadcast: no keyFile");

  let wif;
  try {
    wif = readFileSync(keyFile, "utf8").trim();
  } catch (error) {
    fail(`hive-broadcast: cannot read key file ${keyFile}: ${error.message}`);
    return;
  }

  const hive = new Waggle({ account, keys: { [role ?? "posting"]: wif } });

  try {
    let result;
    if (opName === "vote") {
      result = await hive.vote({ voter: opFields.voter ?? account, author: opFields.author, permlink: opFields.permlink, weight: opFields.weight });
    } else if (opName === "transfer") {
      // A native transfer requires active authority on Hive itself, same
      // as every custom_json contract call below requires it via
      // isSignedWithActiveKey.
      result = await hive.broadcast([["transfer", opFields]], "active");
    } else {
      // Hive-Engine calls use active authority; TerraCore claim is the one
      // admitted posting-authorized custom_json shape.
      result = await hive.broadcast([["custom_json", opFields]], customJsonRole);
    }
    // Older sovereign deployments predate the round-trip confirmation
    // module. Load it only for a round-trip act so unrelated admitted lanes
    // (votes, TerraCore claim, single Hive-Engine calls) remain deployable
    // without pretending confirmation support exists there.
    const economicEffect = contractCalls
      ? (await import("../src/integrations/hive-engine/hiveEngineConfirmation.mjs"))
        .assessRoundTripEconomicEffect(account, contractCalls, await waitForRoundTripRows(result.id))
      : undefined;
    process.stdout.write(JSON.stringify({ id: result.id, ...(economicEffect ? { economicEffect } : {}) }));
  } catch (error) {
    fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();
