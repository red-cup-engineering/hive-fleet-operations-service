#!/usr/bin/env node
import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
// Read-only fleet distribution planner for the exact exit-tightness pilot.
// It observes public audience, RC, and recent reblog history through three
// Hive providers. It has no key, execution flag, or broadcast path.

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { planProductReblog } from "../src/core/productDistribution.mjs";
import { EXIT_TIGHTNESS_PILOT_ACCOUNT, EXIT_TIGHTNESS_PILOT_PERMLINK } from "../src/core/exitTightnessPilotPost.mjs";

const RPC_OPTIONS = Object.freeze({ timeout: 15000 });
const HIVE_NODES = Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
const FLEET = Object.freeze(["emsenn0", "essiebee", "sigmund-vexler", "marshian", "michael561", "help-fund"]);
const TARGET = Object.freeze({ author: EXIT_TIGHTNESS_PILOT_ACCOUNT, permlink: EXIT_TIGHTNESS_PILOT_PERMLINK });

function fail(message) { throw new Error(`plan-product-pilot-distribution: ${message}`); }

export function parseOptions(argv) {
  if (argv.length !== 0) fail(`unknown argument ${argv[0]}`);
  return Object.freeze({});
}



function exactReblogInHistory(rows, account) {
  for (const row of rows) {
    const envelope = Array.isArray(row) ? row[1] : null;
    const operation = envelope?.op;
    if (!Array.isArray(operation) || operation[0] !== "custom_json") continue;
    const fields = operation[1];
    if (fields?.id !== "follow") continue;
    let decoded;
    try { decoded = JSON.parse(fields.json); } catch { continue; }
    if (Array.isArray(decoded) && decoded.length === 2 && decoded[0] === "reblog"
      && decoded[1]?.account === account && decoded[1]?.author === TARGET.author && decoded[1]?.permlink === TARGET.permlink) return true;
  }
  return false;
}

async function observeProvider(node) {
  try {
    const [rc, stats, followCounts] = await Promise.all([
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("rc_api.find_rc_accounts", { accounts: FLEET }),
      new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("rc_api.get_rc_operation_stats", { operation: "custom_json_operation" }),
      Promise.all(FLEET.map((account) => new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_follow_count", [account]))),
    ]);
    if (!Array.isArray(rc?.rc_accounts) || rc.rc_accounts.length !== FLEET.length || !Number.isSafeInteger(stats?.avg_cost_rc) || stats.avg_cost_rc <= 0) {
      throw new Error("RC or audience carrier malformed");
    }
    const audienceCandidates = FLEET.filter((account, index) => account !== TARGET.author && Number(followCounts[index]?.follower_count ?? 0) >= 10);
    const histories = new Map(await Promise.all(audienceCandidates.map(async (account) => [account,
      await new RpcClient({ nodes: [node], timeout: (RPC_OPTIONS).timeout }).call("condenser_api.get_account_history", [account, -1, 1_000])])));
    const candidates = FLEET.map((account, index) => {
      const manabar = rc.rc_accounts.find((entry) => entry.account === account);
      if (!manabar || !/^[0-9]+$/u.test(String(manabar.max_rc)) || !/^-?[0-9]+$/u.test(String(manabar.rc_manabar?.current_mana))
        || !Number.isSafeInteger(manabar.rc_manabar?.last_update_time)) throw new Error("RC manabar malformed");
      return Object.freeze({ account, followers: Number(followCounts[index]?.follower_count ?? 0), maximumRc: String(manabar.max_rc),
        manabarCurrent: String(manabar.rc_manabar.current_mana), manabarUpdatedAt: manabar.rc_manabar.last_update_time,
        alreadyReblogged: histories.has(account) ? exactReblogInHistory(histories.get(account), account) : false });
    });
    return Object.freeze({ node, status: "available", averageCustomJsonRc: String(stats.avg_cost_rc), candidates: Object.freeze(candidates) });
  } catch (error) {
    return Object.freeze({ node, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
  }
}

function digest(value) { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export async function observe() {
  const observedAt = new Date().toISOString();
  const rows = await Promise.all(HIVE_NODES.map(observeProvider));
  const available = rows.filter((row) => row.status === "available");
  const groups = new Map();
  for (const row of available) {
    const state = Object.freeze({ averageCustomJsonRc: row.averageCustomJsonRc, candidates: row.candidates });
    const key = digest(state); const group = groups.get(key) ?? { state, providers: [] };
    group.providers.push(row.node); groups.set(key, group);
  }
  if (groups.size !== 1 || available.length < 2) fail(groups.size > 1 ? "Hive providers contradict the exact distribution state" : "fewer than two Hive providers supplied distribution state");
  const agreed = [...groups.values()][0]; if (!agreed) fail("provider agreement is empty");
  const atSeconds = Math.floor(Date.parse(observedAt) / 1_000);
  const candidates = agreed.state.candidates.map((candidate) => {
    const maximum = BigInt(candidate.maximumRc);
    const elapsed = BigInt(Math.max(0, atSeconds - candidate.manabarUpdatedAt));
    const regenerated = BigInt(candidate.manabarCurrent) + elapsed * maximum / 432_000n;
    const current = regenerated > maximum ? maximum : regenerated < 1n ? 1n : regenerated;
    return Object.freeze({ account: candidate.account, followers: candidate.followers, currentRc: current.toString(),
      maximumRc: candidate.maximumRc, alreadyReblogged: candidate.alreadyReblogged });
  });
  return Object.freeze({ ...planProductReblog({ observedAt, author: TARGET.author,
    averageCustomJsonRc: agreed.state.averageCustomJsonRc, candidates }),
    target: TARGET, evidence: Object.freeze({ knowledge: "true", providers: Object.freeze([...agreed.providers].sort()), stateDigest: [...groups.keys()][0] }),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await observe(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
