/** The Hive fleet agent domain: the fleet's wallets run as FeltOS agents. Each tick pages in a
 * wallet's chain state, market and post field; the fleet's planners (votes, trades, wraps,
 * incentives, staking) are its Plan; every act they propose becomes one strategy move whose
 * state carries its gates (disarmed, unfunded, not live, no key for the role); and every ready move
 * actuates through one RPC operation, `hive-fleet-sign`, which hands the move's request to the
 * fleet signer. The signer stays the one policy over what is signed: a move it refuses comes
 * back as a refusal, never as a broadcast. */

import { agentDomain } from "@red-cup-engineering/feltos/agents/domain";
import { contextPage, generalPageFault, writebackDuty } from "@red-cup-engineering/feltos/agents/context-image";
import { strategyGate as gate, strategyMove as move } from "@red-cup-engineering/feltos/agents/strategy";
import { agentActuationPlan, executeAgentActuationPlan } from "@red-cup-engineering/feltos/agents/actuation";
import { createOperationCatalog, operation } from "@red-cup-engineering/computer-system-engine/rpc/operation";
import { authorizationFromStanding } from "@red-cup-engineering/computer-system-engine/rpc/dispatch";
import { journalRpcWitness } from "@red-cup-engineering/computer-system-engine/rpc/journal-witness";

import { hiveWriteRequest } from "../integrations/hive/hiveWrite.adapter.mjs";
import { runSigner } from "../core/signer.mjs";

export const HIVE_FLEET_ACTOR = "agent:hive-fleet";
export const HIVE_FLEET_GOAL = "run the fleet's wallets inside their signer lanes";
export const HIVE_FLEET_SIGN = "hive-fleet-sign";

/** Every act the planners propose, and the one operation that actuates each. */
const ACTS = ["vote", "trade", "trade-bundle", "lp", "savings", "wrap", "unwrap", "stake", "delegate", "reblog", "follow"];
export const HIVE_FLEET_MOVE_OPERATIONS = Object.freeze(Object.fromEntries(ACTS.map((act) => [act, HIVE_FLEET_SIGN])));

// --- plans to moves ---

/** One planned act as a strategy move. `request` builds the signer request (it may throw: an act
 * with no real operation is blocked with that reason); `blocked` names why it cannot fire;
 * `armed` false leaves it waiting (a dry run). */
function actMove({ account, lane, action, target, role, armed, blocked, request, keys = null }) {
  if (!blocked && keys !== null && !keys.includes(role)) blocked = `the fleet holds no ${role} key for @${account}`;
  let input;
  let buildError;
  if (!blocked) {
    try { input = request(); } catch (error) { buildError = error instanceof Error ? error.message : String(error); }
  }
  const reasons = blocked ? [blocked] : buildError ? [buildError] : armed ? [] : ["fleet disarmed or lane disabled: dry run"];
  const state = blocked || buildError ? "blocked" : armed ? "ready" : "waiting";
  return move(`${lane}:${action}:${account}:${target}`, `hive-fleet:${lane}`, action, state, {
    target,
    reasons,
    evidence: [`lane:${lane}`, `role:${role}`, `account:${account}`],
    ...(input === undefined ? {} : { input, resource: `hive:${account}` }),
  });
}

/** Every act one wallet's plans propose this tick, gated. `armed` says, per lane, whether the
 * fleet is live with that lane enabled. A capital move also needs the wallet to be trading-live. */
export function hiveWalletMoves({ wallet, plans, armed }) {
  const { account } = wallet;
  const keys = wallet.keys ?? null;
  const moves = [];
  const act = (input) => actMove({ ...input, keys });
  for (const vote of plans.voting?.votes ?? []) {
    moves.push(act({ account, lane: "voting", action: "vote", target: `${vote.author}/${vote.permlink}`, role: "posting",
      armed: armed.voting, request: () => hiveWriteRequest.vote(wallet, vote) }));
  }
  const trading = plans.trading;
  if (trading) {
    const capital = () => armed.trading && !trading.liveEligible ? "account not trading-live" : null;
    for (const bundle of trading.bundles) {
      const blocked = !bundle.executable ? bundle.refusalReason ?? "bundle is not executable"
        : !bundle.funded ? "not selected by this tick's bundle allocator"
          : "a bundled round trip is not signed as one transaction; its legs sign through automatic-arbitrage-cycle";
      moves.push(act({ account, lane: "trading", action: "trade-bundle", target: bundle.id, role: "active", armed: armed.trading, blocked }));
    }
    for (const trade of trading.trades) {
      moves.push(act({ account, lane: "trading", action: "trade", target: trade.pair, role: "active", armed: armed.trading,
        blocked: trade.funded ? capital("trade") : "not selected by this tick's budget allocator",
        request: () => hiveWriteRequest.trade(wallet, trade) }));
    }
    for (const entry of trading.lp) {
      moves.push(act({ account, lane: "trading", action: "lp", target: entry.pool, role: "active", armed: armed.trading,
        blocked: capital("lp"), request: () => hiveWriteRequest.liquidity(wallet, entry) }));
    }
    if (trading.savings) {
      moves.push(act({ account, lane: "trading", action: "savings", target: "HBD savings", role: "active", armed: armed.trading,
        blocked: capital("savings"), request: () => hiveWriteRequest.savings(wallet, trading.savings) }));
    }
  }
  for (const action of plans.wrap?.actions ?? []) {
    moves.push(act({ account, lane: "trading", action: action.kind, target: `HIVE<->SWAP.HIVE:${action.quantityHive}`, role: "active",
      armed: armed.trading, request: () => hiveWriteRequest.wrap(wallet, action) }));
  }
  for (const row of plans.incentive?.offers ?? []) {
    if (row.disposition !== "auto") continue;
    for (const action of row.offer.requiredActions) {
      const blocked = action === "delegate" ? "delegation requires manual review"
        : action === "comment" || action === "post" ? "posting lane locked" : null;
      moves.push(act({ account, lane: "incentive", action, target: row.offer.id, role: action === "delegate" ? "active" : "posting",
        armed: armed.incentive, blocked, request: () => hiveWriteRequest.incentive(wallet, row.offer, action) }));
    }
  }
  for (const action of plans.staking?.actions ?? []) {
    moves.push(act({ account, lane: "trading", action: action.kind, target: `${action.symbol}->${action.to}`, role: "active",
      armed: armed.trading, request: () => hiveWriteRequest.stake(wallet, action) }));
  }
  return Object.freeze(moves);
}

// --- the domain ---

function walletPages(input) {
  return (input.wallets ?? []).flatMap(({ wallet, state, market }) => [
    contextPage({
      id: `page:wallet:${wallet.account}`,
      layer: "chain-state",
      state: state ? "resident" : "required",
      priority: 90,
      source: "hive-chain",
      summary: state ? `@${wallet.account} chain state resident` : `@${wallet.account} chain state unavailable`,
      ...(state ? { material: state } : {}),
      evidence: [state ? `chain-state:${wallet.account}` : `chain-state:${wallet.account}:page-fault`],
    }),
    contextPage({
      id: `page:market:${wallet.account}`,
      layer: "market",
      state: market ? "resident" : "evicted",
      priority: 80,
      source: "hive-engine",
      summary: market ? `@${wallet.account} market observed` : `@${wallet.account} market not observed`,
      ...(market ? { material: market } : {}),
      evidence: [market ? `market:${wallet.account}` : `market:${wallet.account}:not-observed`],
    }),
  ]);
}

function pages(input) {
  return [
    ...walletPages(input),
    contextPage({
      id: "page:post-field",
      layer: "field",
      state: input.posts ? "resident" : "required",
      priority: 85,
      source: "hive-chain",
      summary: input.posts ? `post field resident; posts:${input.posts.length}` : "post field unavailable",
      ...(input.posts ? { material: input.posts } : {}),
      evidence: [input.posts ? `posts:${input.posts.length}` : "posts:page-fault"],
    }),
  ];
}

function pageFault(candidate) {
  if (candidate.layer === "chain-state") return { reason: `${candidate.id} is not resident`, requiredBefore: "strategize" };
  return generalPageFault(candidate);
}

function writeback() {
  return Object.freeze([
    writebackDuty("writeback:fleet-tick", "required", "aagaard.fleet-tick", Object.freeze(["every tick's readout is journaled"])),
    writebackDuty("writeback:curation-predictions", "required", "curation-predictions", Object.freeze(["every vote's predicted reward is recorded before payout"])),
    writebackDuty("writeback:scoreboard", "required", "scoreboard", Object.freeze(["every wallet's position is marked each tick"])),
  ]);
}

/** Which wallets the tick can plan for: those whose chain state is resident. */
function diagnose(observation) {
  const walletPagesOf = observation.pages.filter((page) => page.layer === "chain-state");
  const resident = walletPagesOf.filter((page) => page.state === "resident").map((page) => page.id.replace("page:wallet:", ""));
  return {
    fields: { residentWallets: resident, missingWallets: walletPagesOf.length - resident.length },
    rules: ["a wallet is planned only from resident chain state"],
    evidence: [`wallets-resident:${resident.length}`, `wallets-missing:${walletPagesOf.length - resident.length}`],
  };
}

/** Plan: each wallet's planned acts become gated moves. */
function strategize(input) {
  const moves = (input.walletPlans ?? []).flatMap((entry) => hiveWalletMoves(entry));
  const count = (state) => moves.filter((candidate) => candidate.state === state).length;
  return {
    view: ["hive-fleet-plans"],
    gates: [
      gate("fleet-armed", count("waiting") > 0 && count("ready") === 0 ? "required" : "satisfied", "hive-fleet-control", [`waiting:${count("waiting")}`]),
      gate("signer-lanes", "satisfied", "hive-broadcast", ["the signer admits or refuses each request"]),
    ],
    strategies: [Object.freeze({
      kind: "metroplat.agent.strategy",
      id: "hive-fleet-acts",
      state: count("ready") > 0 ? "ready" : "waiting",
      gates: Object.freeze(["fleet-armed", "signer-lanes"]),
      moves: Object.freeze(moves),
      evidence: Object.freeze([`ready:${count("ready")}`, `waiting:${count("waiting")}`, `blocked:${count("blocked")}`]),
    })],
    moves,
    evidence: [`moves:${moves.length}`],
  };
}

export const hiveFleetAgentDomain = agentDomain({
  id: "hive-fleet",
  actor: HIVE_FLEET_ACTOR,
  goal: HIVE_FLEET_GOAL,
  pages,
  pageFault,
  writeback,
  diagnose,
  strategize,
  operations: HIVE_FLEET_MOVE_OPERATIONS,
});

// --- Execute ---

/** The one operation every fleet move actuates through: its input is a signer request, its
 * value the signer's answer. Keyed by the actuation request, so a replay never signs twice. */
export function hiveFleetOperations({ sign = runSigner } = {}) {
  return Object.freeze([operation({
    verb: HIVE_FLEET_SIGN,
    inputFormat: "json",
    outputFormat: "json",
    summary: "Hand one fleet write request to the Hive fleet signer.",
    description: "Domain: a signer request { account, role, lane, target, operation, ...lane fields }. Codomain: { status: \"broadcast\", id } or { status: \"refused\", datum, reason }.",
    effects: { class: "external", replay: "idempotency-key", coordination: "coordination-free", deterministic: "unmeasured", totality: "partial" },
    run: (input) => sign(input),
  })]);
}

/** Actuate a tick's moves: plan the ready ones once for `diagnosis`, sign each through the
 * RPC catalog (journaled under `dataDir`), and return the plan and its executions. */
export async function actuateHiveFleetMoves({ moves, diagnosis, date, dataDir, sign, now = () => new Date().toISOString(), actor = HIVE_FLEET_ACTOR }) {
  const plan = agentActuationPlan({ domain: hiveFleetAgentDomain, date, diagnosis, moves });
  if (plan.planned === 0) return Object.freeze({ plan, executions: Object.freeze([]) });
  const catalog = createOperationCatalog(hiveFleetOperations({ sign }));
  const standing = new Map(catalog.operations.map((candidate) => [candidate.ref, "held"]));
  const executions = await executeAgentActuationPlan({
    plan, catalog, witness: journalRpcWitness(dataDir, { namespace: "hive-fleet" }),
    authorize: authorizationFromStanding(standing, "hive-fleet-standing"), now, actor, diagnosis,
  });
  return Object.freeze({ plan, executions });
}

// --- Knowledge: executions back into per-lane receipts ---

function evidenceValue(candidate, key) {
  const entry = candidate.evidence.find((item) => item.startsWith(`${key}:`));
  return entry === undefined ? undefined : entry.slice(key.length + 1);
}

/** One receipt per move: dry-run (waiting), skipped (blocked, or not planned), broadcast,
 * refused (the signer said no), or error. */
export function hiveMoveReceipts(moves, executions) {
  const byMove = new Map(executions.map((execution) => [execution.move, execution]));
  return Object.freeze(moves.map((candidate) => {
    const base = { lane: evidenceValue(candidate, "lane"), action: candidate.action, target: candidate.target, role: evidenceValue(candidate, "role") };
    if (candidate.state === "waiting") return Object.freeze({ ...base, status: "dry-run" });
    if (candidate.state === "blocked") return Object.freeze({ ...base, status: "skipped", error: candidate.reasons.join("; ") });
    const execution = byMove.get(candidate.id);
    if (execution === undefined) return Object.freeze({ ...base, status: "skipped", error: "not planned for actuation" });
    if (!execution.ok) return Object.freeze({ ...base, status: "error", error: execution.evidence.slice(-1)[0] ?? "dispatch failed" });
    const answer = execution.outcome;
    if (answer?.status === "refused") return Object.freeze({ ...base, status: "refused", error: `${answer.datum}: ${answer.reason}` });
    return Object.freeze({
      ...base, status: "broadcast", txId: answer.id,
      economicEffect: Object.freeze({ status: "unverified", source: "outer-chain-broadcast-only", reference: answer.id }),
    });
  }));
}

/** A lane's receipts as the fleet readout's execution summary. */
export function laneExecution(receipts, lane, actions) {
  const own = receipts.filter((receipt) => receipt.lane === lane && (actions === undefined || actions.includes(receipt.action)));
  const count = (status) => own.filter((receipt) => receipt.status === status).length;
  return Object.freeze({
    broadcast: count("broadcast"),
    dryRun: count("dry-run"),
    skipped: count("skipped") + count("refused"),
    errors: count("error"),
    receipts: Object.freeze(own),
  });
}
