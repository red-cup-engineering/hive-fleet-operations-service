#!/usr/bin/env node
// The real AAGAARD_BROADCAST_COMMAND: bridges Aagaard's generic broadcast
// request (see hiveWrite.adapter.ts) to an actual signed, broadcast Hive
// transaction via the waggle library (src/integrations/hive/waggle/),
// copied in from the firm's own prior art -- built and unit-tested against
// a mocked transport, but per its own README never yet broadcast with real
// keys. This is that next step.
//
// Three operation shapes are signed and broadcast, and nothing else:
//
//   "vote" -- the native Hive vote operation, signed with the posting key.
//
//   "custom_json" whose decoded json is {contractName, contractAction,
//   contractPayload} for exactly one of the five contract/action pairs in
//   ALLOWED_CONTRACT_ACTIONS below -- each verified against the real,
//   open-source contract sources (github.com/hive-engine/hivesmartcontracts)
//   and, where available, against this fleet's own real prior broadcasts
//   (help-fund's real marketSell/addLiquidity, essiebee's real unstake).
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
  "market.marketBuy",
  "market.marketSell",
  "tokens.stake",
  "tokens.delegate",
  "hivepegged.withdraw",
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
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
  if (opName === "custom_json") {
    let decoded;
    try {
      decoded = JSON.parse(opFields.json);
    } catch (error) {
      fail(`hive-broadcast: custom_json's own json field is not JSON: ${error.message}`);
      return;
    }
    contractKey = `${decoded.contractName}.${decoded.contractAction}`;
    if (!ALLOWED_CONTRACT_ACTIONS.has(contractKey)) {
      fail(`hive-broadcast: refusing contract call '${contractKey}' -- only ${[...ALLOWED_CONTRACT_ACTIONS].join(", ")} are verified and allowed`);
      return;
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
      // custom_json Hive-Engine contract calls all require the active key
      // (verified: isSignedWithActiveKey === true in every one of
      // ALLOWED_CONTRACT_ACTIONS' own contract source).
      result = await hive.broadcast([["custom_json", opFields]], "active");
    }
    process.stdout.write(JSON.stringify({ id: result.id }));
  } catch (error) {
    fail(`hive-broadcast: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();
