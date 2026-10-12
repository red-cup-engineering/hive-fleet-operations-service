// core/strategyArms — independent curation strategy-arm readings.
//
// Every wallet reads one common candidate-field identity, but applies its own
// disclosed archetype and objective.  The resulting scores are strategy
// signals, not predictions of Hive rewards.  When the complete candidate
// field has at most twenty posts, this carrier enumerates every admitted
// selection of at most maxVotesPerTick and exposes the exact count, choice
// bits, and digest of the complete 1-bps near-optimal alternative set (plus a
// bounded projection). Larger fields retain a deterministic score-ranked
// baseline but explicitly refuse exploration telemetry.

import { createHash } from "node:crypto";

import { readSettlementRecords, recordSettlementRecord } from "@emsenn/rwil-rdf-services/client";

import type { PostCandidate, WalletActor } from "./core.adapter.ts";

export const CURATION_STRATEGY_ARM_SCHEMA = "aagaard.curation-strategy-arm.v1" as const;
export const CURATION_STRATEGY_ARM_CATEGORY = "aagaard.curation-strategy-arm-reading" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
const MAX_EXACT_CANDIDATES = 20;
const NEAR_OPTIMAL_TOLERANCE_BPS = 1;
const ALTERNATIVE_PROJECTION_LIMIT = 64;

export type StrategyArmRefusal =
  | "mana-below-floor"
  | "below-conviction"
  | "likely-cartel-trail"
  | "non-positive-or-non-finite-signal"
  | "already-voted";

export interface StrategyArmCandidate {
  readonly key: string;
  /** Dimensionless strategy signal. It is not a reward prediction. */
  readonly signal: number;
  readonly weightBps: number;
  readonly refusals: readonly StrategyArmRefusal[];
}

export interface CurationStrategyArmReading {
  readonly curationStrategyArmSchema: typeof CURATION_STRATEGY_ARM_SCHEMA;
  readonly kind: "aagaard.curation-strategy-arm-reading";
  readonly at: string;
  readonly account: string;
  readonly candidateField: {
    readonly digest: string;
    readonly candidateCount: number;
  };
  readonly strategy: {
    readonly id: string;
    readonly archetype: string;
    readonly feeds: readonly string[];
    readonly objective: Readonly<Record<string, number>>;
    readonly objectiveDigest: string;
    readonly conviction: number;
  };
  readonly safety: {
    readonly votingPowerBps: number;
    readonly votingPowerFloorBps: number;
    readonly maxVotesPerTick: number;
    readonly maxVoteWeightBps: number;
  };
  readonly scoreUnit: "aagaard.curation-strategy-signal.v1";
  readonly candidates: readonly StrategyArmCandidate[];
  readonly admittedCandidateCount: number;
  readonly exploration: {
    readonly exact: boolean;
    readonly toleranceBps: typeof NEAR_OPTIMAL_TOLERANCE_BPS;
    readonly alternativeCount: number | null;
    readonly choiceBits: number | null;
    /** Digest of the complete ordered alternative set. */
    readonly alternativeSetDigest: string | null;
    /** Bounded prefix projection; never the asserted full set when truncated. */
    readonly projectedAlternatives: readonly (readonly string[])[] | null;
    readonly projectionLimit: typeof ALTERNATIVE_PROJECTION_LIMIT;
    readonly projectionTruncated: boolean | null;
    readonly selectedAlternativeOrdinal: number | null;
    readonly deterministicAccountPhase: number | null;
    readonly separationScope: "common-field-and-strategy-alternative-set" | null;
    readonly mode: "deterministic-account-phase-near-optimal" | "baseline-no-exploration";
    readonly unavailableReason: "candidate-field-exceeds-exact-limit" | null;
  };
  readonly selected: readonly string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("base64url");
}

/** Identity of the observed post field, independent of RPC return order. */
export function candidateFieldDigest(posts: readonly PostCandidate[]): string {
  const field = [...posts]
    .sort((left, right) => `${left.author}/${left.permlink}`.localeCompare(`${right.author}/${right.permlink}`))
    .map((post) => ({
      author: post.author,
      permlink: post.permlink,
      title: post.title,
      body: post.body,
      tags: [...post.tags].sort(),
      pendingPayout: post.pendingPayout,
      netRshares: post.netRshares,
      comments: post.comments,
      // ageHours is a local Date.now-derived convenience and can differ by
      // milliseconds across identical RPC reads. `created` is the canonical
      // chain time carried in the field identity.
      created: post.created,
      beneficiaries: [...post.beneficiaries]
        .map((entry) => ({ account: entry.account, weight: entry.weight }))
        .sort((left, right) => left.account.localeCompare(right.account)),
      votes: [...post.votes]
        .map((vote) => ({ voter: vote.voter, rshares: vote.rshares, time: vote.time ?? null, percent: vote.percent ?? null }))
        .sort((left, right) => `${left.voter}\u0000${left.time ?? ""}`.localeCompare(`${right.voter}\u0000${right.time ?? ""}`)),
    }));
  return `ni:///sha-256;${digestOf(field)}`;
}

export function curationStrategyIdentity(wallet: WalletActor): CurationStrategyArmReading["strategy"] {
  const objective = Object.freeze(Object.fromEntries(Object.entries(wallet.strategy.objective).sort(([left], [right]) => left.localeCompare(right))));
  const objectiveDigest = `ni:///sha-256;${digestOf(objective)}`;
  const identity = {
    archetype: wallet.strategy.archetype,
    feeds: [...wallet.strategy.feeds].sort(),
    objective,
    objectiveDigest,
    conviction: wallet.strategy.conviction,
  };
  return Object.freeze({
    id: `urn:aagaard:curation-strategy:${digestOf(identity)}`,
    archetype: identity.archetype,
    feeds: Object.freeze(identity.feeds),
    objective,
    objectiveDigest,
    conviction: identity.conviction,
  });
}

function baseline(candidates: readonly StrategyArmCandidate[], maxVotes: number): readonly string[] {
  return Object.freeze(candidates
    .filter((candidate) => candidate.refusals.length === 0 && candidate.signal > 0 && Number.isFinite(candidate.signal))
    .sort((left, right) => right.signal - left.signal || left.key.localeCompare(right.key))
    .slice(0, maxVotes)
    .map((candidate) => candidate.key));
}

function forEachBoundedSelection(
  candidates: readonly StrategyArmCandidate[],
  maxVotes: number,
  visit: (keys: readonly string[], signal: number) => void,
): void {
  const keys: string[] = [];
  const descend = (start: number, signal: number): void => {
    visit(keys, signal);
    if (keys.length >= maxVotes) return;
    for (let index = start; index < candidates.length; index += 1) {
      keys.push(candidates[index]!.key);
      descend(index + 1, signal + candidates[index]!.signal);
      keys.pop();
    }
  };
  descend(0, 0);
}

function exactAlternativeSpace(
  candidates: readonly StrategyArmCandidate[],
  maxVotes: number,
  ordinalForCount: (count: number) => number,
): {
  readonly count: number;
  readonly ordinal: number;
  readonly selected: readonly string[];
  readonly digest: string;
  readonly projected: readonly (readonly string[])[];
} {
  const admitted = candidates
    .filter((candidate) => candidate.refusals.length === 0 && candidate.signal > 0 && Number.isFinite(candidate.signal))
    .sort((left, right) => left.key.localeCompare(right.key));
  let optimum = 0;
  forEachBoundedSelection(admitted, maxVotes, (_keys, signal) => { optimum = Math.max(optimum, signal); });
  const threshold = optimum * (1 - NEAR_OPTIMAL_TOLERANCE_BPS / 10_000);
  let count = 0;
  forEachBoundedSelection(admitted, maxVotes, (_keys, signal) => { if (signal >= threshold) count += 1; });
  const ordinal = ordinalForCount(count);
  let alternativeIndex = 0;
  let selected: readonly string[] = Object.freeze([]);
  const projected: (readonly string[])[] = [];
  const hash = createHash("sha256");
  forEachBoundedSelection(admitted, maxVotes, (keys, signal) => {
    if (signal < threshold) return;
    const selection = Object.freeze([...keys]);
    hash.update(JSON.stringify(selection));
    hash.update("\n");
    if (projected.length < ALTERNATIVE_PROJECTION_LIMIT) projected.push(selection);
    if (alternativeIndex === ordinal) selected = selection;
    alternativeIndex += 1;
  });
  return Object.freeze({
    count,
    ordinal,
    selected,
    digest: `ni:///sha-256;${hash.digest("base64url")}`,
    projected: Object.freeze(projected),
  });
}

function deterministicAccountPhase(
  account: string,
  fleetAccounts: readonly string[],
  fieldDigest: string,
  strategyId: string,
  alternatives: number,
): number {
  const roster = [...new Set(fleetAccounts)].sort();
  const accountIndex = Math.max(0, roster.indexOf(account));
  const rotation = Number(BigInt(`0x${createHash("sha256").update(`${fieldDigest}\u0000${strategyId}`).digest("hex")}`) % BigInt(alternatives));
  return (rotation + accountIndex) % alternatives;
}

export function readCurationStrategyArm(input: {
  readonly wallet: WalletActor;
  readonly posts: readonly PostCandidate[];
  readonly candidates: readonly StrategyArmCandidate[];
  readonly votingPowerBps: number;
  readonly at: string;
  readonly fleetAccounts?: readonly string[];
}): CurationStrategyArmReading {
  const strategy = curationStrategyIdentity(input.wallet);
  const fieldDigest = candidateFieldDigest(input.posts);
  const candidates = Object.freeze([...input.candidates]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((candidate) => Object.freeze({
      key: candidate.key,
      signal: Number(candidate.signal.toFixed(6)),
      weightBps: Math.max(0, Math.min(input.wallet.risk.maxVoteWeightBps, Math.floor(candidate.weightBps))),
      refusals: Object.freeze([...new Set(candidate.refusals)]),
    })));
  const exact = input.posts.length <= MAX_EXACT_CANDIDATES;
  let selected: readonly string[];
  let exploration: CurationStrategyArmReading["exploration"];
  if (exact) {
    const space = exactAlternativeSpace(candidates, input.wallet.strategy.maxVotesPerTick, (count) => deterministicAccountPhase(
      input.wallet.account,
      input.fleetAccounts ?? [input.wallet.account],
      fieldDigest,
      strategy.id,
      count,
    ));
    selected = space.selected;
    exploration = Object.freeze({
      exact: true,
      toleranceBps: NEAR_OPTIMAL_TOLERANCE_BPS,
      alternativeCount: space.count,
      choiceBits: Math.log2(space.count),
      alternativeSetDigest: space.digest,
      projectedAlternatives: space.projected,
      projectionLimit: ALTERNATIVE_PROJECTION_LIMIT,
      projectionTruncated: space.count > ALTERNATIVE_PROJECTION_LIMIT,
      selectedAlternativeOrdinal: space.ordinal,
      deterministicAccountPhase: space.ordinal,
      separationScope: "common-field-and-strategy-alternative-set" as const,
      mode: "deterministic-account-phase-near-optimal" as const,
      unavailableReason: null,
    });
  } else {
    selected = baseline(candidates, input.wallet.strategy.maxVotesPerTick);
    exploration = Object.freeze({
      exact: false,
      toleranceBps: NEAR_OPTIMAL_TOLERANCE_BPS,
      alternativeCount: null,
      choiceBits: null,
      alternativeSetDigest: null,
      projectedAlternatives: null,
      projectionLimit: ALTERNATIVE_PROJECTION_LIMIT,
      projectionTruncated: null,
      selectedAlternativeOrdinal: null,
      deterministicAccountPhase: null,
      separationScope: null,
      mode: "baseline-no-exploration" as const,
      unavailableReason: "candidate-field-exceeds-exact-limit" as const,
    });
  }
  return Object.freeze({
    curationStrategyArmSchema: CURATION_STRATEGY_ARM_SCHEMA,
    kind: "aagaard.curation-strategy-arm-reading" as const,
    at: input.at,
    account: input.wallet.account,
    candidateField: Object.freeze({ digest: fieldDigest, candidateCount: input.posts.length }),
    strategy,
    safety: Object.freeze({
      votingPowerBps: input.votingPowerBps,
      votingPowerFloorBps: input.wallet.strategy.votingPowerFloorBps,
      maxVotesPerTick: input.wallet.strategy.maxVotesPerTick,
      maxVoteWeightBps: input.wallet.risk.maxVoteWeightBps,
    }),
    scoreUnit: "aagaard.curation-strategy-signal.v1" as const,
    candidates,
    admittedCandidateCount: candidates.filter((candidate) => candidate.refusals.length === 0).length,
    exploration,
    selected: Object.freeze([...selected]),
  });
}

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

export async function recordCurationStrategyArm(dataDir: string, reading: CurationStrategyArmReading): Promise<void> {
  await recordSettlementRecord({
    agentUrl: rwilAgent(),
    root: dataDir,
    nodeId: "aagaard",
    settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR,
    category: CURATION_STRATEGY_ARM_CATEGORY,
    recordedAt: reading.at,
    record: reading,
  });
}

export function readCurationStrategyArms(dataDir: string, account?: string): readonly CurationStrategyArmReading[] {
  const readings = readSettlementRecords(dataDir, CURATION_STRATEGY_ARM_CATEGORY) as readonly CurationStrategyArmReading[];
  return Object.freeze(readings
    .filter((reading) => reading.curationStrategyArmSchema === CURATION_STRATEGY_ARM_SCHEMA && (account === undefined || reading.account === account))
    .sort((left, right) => left.at.localeCompare(right.at)));
}
