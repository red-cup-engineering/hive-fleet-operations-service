// core/dervishExperiment — a pure five-lens/six-phase experiment carrier.
//
// The schedule mirrors Obsmetrologia's machine-checked
// QuantumContextuality/DisclinationLink coordinate carrier:
//   linkOf i  = i mod 5
//   frameOf i = i mod 6
//   crtStep a b = (6a + 25b) mod 30
// The finite CRT coverage is theorem-grounded. Applying that carrier to a
// wallet fleet is an experimental design; a quasicrystal, crystalline circuit,
// or causal interpretation is a hypothesis and is not proved by this module.

import { createHash } from "node:crypto";

import { readSettlementRecords, recordSettlementRecord } from "@emsenn/rwil-rdf-services/client";

import type { CurationPredictionEvent, CurationSettlementEvent } from "./curationSettlement.mts";

export const DERVISH_EXPERIMENT_SCHEMA = "aagaard.dervish-experiment.v1" as const;
export const DERVISH_EXPERIMENT_CATEGORY = "aagaard.dervish-coupled-trial-observation" as const;
export const DERVISH_PERIOD_STEPS = 30 as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";

export const DERVISH_FORMAL_BASIS = Object.freeze({
  carrier: "Obsmetrologia.QuantumContextuality.DisclinationLink.link_frame_injective/link_frame_surjective",
  finiteCrtSchedule: "theorem-grounded" as const,
  fleetApplication: "experimental-carrier" as const,
  quasicrystalCircuitInterpretation: "hypothesis-not-proved" as const,
});

/** Five existing Aagaard measurement families, assigned to the finite link sites. */
export const DERVISH_LENSES = Object.freeze([
  Object.freeze({
    id: "reward-route-settlement" as const,
    family: "reward route and settlement" as const,
    sourceModules: Object.freeze(["analysis/reward", "core/curationSettlement"]),
  }),
  Object.freeze({
    id: "temporal-timing" as const,
    family: "temporal timing" as const,
    sourceModules: Object.freeze(["analysis/timing"]),
  }),
  Object.freeze({
    id: "spectral-field" as const,
    family: "spectral field" as const,
    sourceModules: Object.freeze(["analysis/spectral"]),
  }),
  Object.freeze({
    id: "social-topology-cartel-bridge" as const,
    family: "social topology, cartel, and bridge" as const,
    sourceModules: Object.freeze(["analysis/graph", "analysis/rigidity"]),
  }),
  Object.freeze({
    id: "market-liquidity-flow" as const,
    family: "market liquidity and flow" as const,
    sourceModules: Object.freeze(["analysis/capacity", "analysis/flow", "analysis/holonomy"]),
  }),
] as const);

export type DervishLens = (typeof DERVISH_LENSES)[number];
export type DervishLensId = DervishLens["id"];
export type SixWalletRoster = readonly [string, string, string, string, string, string];

export interface DervishScheduleCoordinate {
  readonly dervishExperimentSchema: typeof DERVISH_EXPERIMENT_SCHEMA;
  readonly globalStep: number;
  readonly cycle: number;
  readonly boundaryStep: number;
  /** The intrinsic finite link coordinate, globalStep mod 5. */
  readonly site: 0 | 1 | 2 | 3 | 4;
  readonly lens: DervishLens;
  /** The developed frame coordinate, globalStep mod 6. */
  readonly phase: 0 | 1 | 2 | 3 | 4 | 5;
  /** The configured wallet occupying this phase. */
  readonly account: string;
  readonly formalBasis: typeof DERVISH_FORMAL_BASIS;
}

function finiteIndex(value: number, modulus: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value % modulus;
}

/** Admit exactly six distinct, non-empty Hive account names as frame phases. */
export function makeSixWalletRoster(accounts: readonly string[]): SixWalletRoster {
  if (accounts.length !== 6) throw new RangeError("a dervish roster must contain exactly six accounts");
  const normalized = accounts.map((account) => account.trim());
  if (normalized.some((account) => account.length === 0)) throw new TypeError("dervish roster accounts must be non-empty");
  if (new Set(normalized).size !== 6) throw new TypeError("dervish roster accounts must be distinct");
  return Object.freeze(normalized) as unknown as SixWalletRoster;
}

/** Read the finite CRT coordinate assigned to one global experiment step. */
export function readDervishScheduleStep(
  globalStep: number,
  roster: SixWalletRoster,
): DervishScheduleCoordinate {
  const boundaryStep = finiteIndex(globalStep, DERVISH_PERIOD_STEPS, "globalStep");
  const site = finiteIndex(boundaryStep, 5, "boundaryStep") as DervishScheduleCoordinate["site"];
  const phase = finiteIndex(boundaryStep, 6, "boundaryStep") as DervishScheduleCoordinate["phase"];
  return Object.freeze({
    dervishExperimentSchema: DERVISH_EXPERIMENT_SCHEMA,
    globalStep,
    cycle: Math.floor(globalStep / DERVISH_PERIOD_STEPS),
    boundaryStep,
    site,
    lens: DERVISH_LENSES[site],
    phase,
    account: roster[phase],
    formalBasis: DERVISH_FORMAL_BASIS,
  });
}

/** The Lean module's explicit Chinese-remainder witness for one site/phase pair. */
export function dervishBoundaryStepForPair(site: number, phase: number): number {
  const admittedSite = finiteIndex(site, 5, "site");
  const admittedPhase = finiteIndex(phase, 6, "phase");
  if (admittedSite !== site) throw new RangeError("site must be in [0, 4]");
  if (admittedPhase !== phase) throw new RangeError("phase must be in [0, 5]");
  return (6 * admittedSite + 25 * admittedPhase) % DERVISH_PERIOD_STEPS;
}

export type VoteExecutionEvidence =
  | Readonly<{
    status: "not-run" | "planned" | "dry-run" | "propose-only" | "skipped" | "error" | "broadcast-unverified";
    actualVoteCast: false;
    transactionId: null;
  }>
  | Readonly<{
    status: "broadcast";
    actualVoteCast: true;
    transactionId: string;
  }>;

export type CurationSettlementEvidence =
  | Readonly<{
    status: "not-applicable";
    predictionId: null;
    settlementSourceId: null;
    rewardVests: null;
  }>
  | Readonly<{
    status: "pending";
    predictionId: string;
    settlementSourceId: null;
    rewardVests: null;
  }>
  | Readonly<{
    status: "broadcast-without-prediction-link";
    predictionId: null;
    settlementSourceId: null;
    rewardVests: null;
  }>
  | Readonly<{
    status: "matched";
    predictionId: string;
    settlementSourceId: string;
    rewardVests: Readonly<{ amount: string; asset: "VESTS" }>;
  }>
  | Readonly<{
    status: "observed-without-local-vote-link";
    predictionId: null;
    settlementSourceId: string;
    rewardVests: Readonly<{ amount: string; asset: "VESTS" }>;
  }>;

export type MarketExecutionEvidence =
  | Readonly<{
    status: "not-run" | "planned" | "dry-run" | "refused" | "error" | "confirmation-incomplete";
    realizedPnlSwapHive: null;
    economicEffectReferences: readonly string[];
  }>
  | Readonly<{
    status: "confirmed-complete-round-trip";
    /** Realized only from confirmed costs, fees, and proceeds of the complete round trip. */
    realizedPnlSwapHive: number;
    economicEffectReferences: readonly string[];
  }>;

export interface DervishReceiptInput {
  readonly lane: "voting" | "trading" | "incentive";
  readonly action: string;
  readonly target: string;
  readonly status: "broadcast" | "dry-run" | "propose-only" | "skipped" | "error";
  readonly txId?: string;
  readonly economicEffect?: Readonly<{
    readonly status: "confirmed" | "partial" | "unverified" | "not-recognized";
    readonly source: string;
    readonly reference?: string;
    readonly confirmedLegs?: number;
    readonly expectedLegs?: number;
    readonly realizedPnlSwapHive?: number;
  }>;
}

export interface DervishVoteObservation {
  readonly target: Readonly<{
    readonly key: string;
    readonly author: string | null;
    readonly permlink: string | null;
  }>;
  readonly execution: VoteExecutionEvidence;
  readonly curationSettlement: CurationSettlementEvidence;
}

/**
 * One coupled attention/market experimental observation. It carries evidence;
 * it does not write records, initiate votes or orders, value outcomes in HBD,
 * or infer a causal effect.
 */
export interface DervishCoupledTrialObservation {
  readonly dervishExperimentSchema: typeof DERVISH_EXPERIMENT_SCHEMA;
  readonly kind: "aagaard.dervish-coupled-trial-observation";
  readonly trialId: string;
  readonly observedAt: string;
  readonly coordinate: DervishScheduleCoordinate;
  readonly attention: Readonly<{
    votes: readonly DervishVoteObservation[];
    /** Settlement operations first observed during this tick, whether or not linked locally. */
    settlements: readonly CurationSettlementEvidence[];
  }>;
  readonly market: Readonly<{
    targets: readonly string[];
    execution: MarketExecutionEvidence;
  }>;
  readonly claims: Readonly<{
    /** No admitted VESTS/SWAP.HIVE-to-HBD valuation policy exists here. */
    realizedPnlHbd: null;
    /** Scheduling and co-observation do not identify a causal effect. */
    causalEffect: null;
    causalStatus: "not-identified";
    quasicrystalCircuitStatus: "hypothesis-not-proved";
  }>;
}

export interface DervishTrialSummary {
  readonly trialId: string;
  readonly globalStep: number;
  readonly cycle: number;
  readonly boundaryStep: number;
  readonly site: DervishScheduleCoordinate["site"];
  readonly lens: DervishLensId;
  readonly phase: DervishScheduleCoordinate["phase"];
  readonly account: string;
}

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

function isTrialObservation(value: unknown): value is DervishCoupledTrialObservation {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record["dervishExperimentSchema"] !== DERVISH_EXPERIMENT_SCHEMA
    || record["kind"] !== "aagaard.dervish-coupled-trial-observation") return false;
  const coordinate = record["coordinate"];
  return coordinate !== null
    && typeof coordinate === "object"
    && Number.isSafeInteger((coordinate as Record<string, unknown>)["globalStep"]);
}

export function readDervishTrialObservations(dataDir: string): readonly DervishCoupledTrialObservation[] {
  return Object.freeze((readSettlementRecords(dataDir, DERVISH_EXPERIMENT_CATEGORY) as readonly unknown[])
    .filter(isTrialObservation)
    .sort((left, right) => left.coordinate.globalStep - right.coordinate.globalStep || left.observedAt.localeCompare(right.observedAt)));
}

export function nextDervishGlobalStep(dataDir: string): number {
  const prior = readDervishTrialObservations(dataDir);
  return prior.reduce((latest, observation) => Math.max(latest, observation.coordinate.globalStep), -1) + 1;
}

export async function recordDervishTrialObservation(
  dataDir: string,
  observation: DervishCoupledTrialObservation,
): Promise<void> {
  await recordSettlementRecord({
    agentUrl: rwilAgent(),
    root: dataDir,
    nodeId: "aagaard",
    settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR,
    category: DERVISH_EXPERIMENT_CATEGORY,
    recordedAt: observation.observedAt,
    record: observation,
  });
}

function targetOf(key: string): DervishVoteObservation["target"] {
  const separator = key.indexOf("/");
  return Object.freeze({
    key,
    author: separator > 0 ? key.slice(0, separator) : null,
    permlink: separator > 0 && separator < key.length - 1 ? key.slice(separator + 1) : null,
  });
}

function voteObservation(
  account: string,
  receipt: DervishReceiptInput,
  predictions: readonly CurationPredictionEvent[],
): DervishVoteObservation {
  const target = targetOf(receipt.target);
  if (receipt.status !== "broadcast") {
    return Object.freeze({
      target,
      execution: Object.freeze({ status: receipt.status, actualVoteCast: false as const, transactionId: null }),
      curationSettlement: Object.freeze({
        status: "not-applicable" as const,
        predictionId: null,
        settlementSourceId: null,
        rewardVests: null,
      }),
    });
  }
  if (typeof receipt.txId !== "string" || receipt.txId.length === 0) {
    return Object.freeze({
      target,
      execution: Object.freeze({ status: "broadcast-unverified" as const, actualVoteCast: false as const, transactionId: null }),
      curationSettlement: Object.freeze({
        status: "broadcast-without-prediction-link" as const,
        predictionId: null,
        settlementSourceId: null,
        rewardVests: null,
      }),
    });
  }
  const prediction = predictions.find((event) => event.account === account
    && event.author === target.author
    && event.permlink === target.permlink
    && event.vote.txId === receipt.txId);
  return Object.freeze({
    target,
    execution: Object.freeze({ status: "broadcast" as const, actualVoteCast: true as const, transactionId: receipt.txId }),
    curationSettlement: prediction
      ? Object.freeze({
        status: "pending" as const,
        predictionId: prediction.predictionId,
        settlementSourceId: null,
        rewardVests: null,
      })
      : Object.freeze({
        status: "broadcast-without-prediction-link" as const,
        predictionId: null,
        settlementSourceId: null,
        rewardVests: null,
      }),
  });
}

function marketReceiptReference(receipt: DervishReceiptInput): string | null {
  const effect = receipt.economicEffect;
  if (!effect) return null;
  return `${effect.source}#${effect.reference ?? receipt.target}`;
}

function marketExecution(receipts: readonly DervishReceiptInput[]): MarketExecutionEvidence {
  if (receipts.length === 0) {
    return Object.freeze({ status: "not-run" as const, realizedPnlSwapHive: null, economicEffectReferences: Object.freeze([]) });
  }
  const references = Object.freeze(receipts.flatMap((receipt) => {
    const reference = marketReceiptReference(receipt);
    return reference ? [reference] : [];
  }));
  const broadcasts = receipts.filter((receipt) => receipt.status === "broadcast");
  const hasError = receipts.some((receipt) => receipt.status === "error");
  const provenRoundTrips = broadcasts.filter((receipt) => receipt.action === "trade-bundle"
    && receipt.economicEffect?.status === "confirmed"
    && receipt.economicEffect.expectedLegs === 2
    && receipt.economicEffect.confirmedLegs === 2
    && typeof receipt.economicEffect.realizedPnlSwapHive === "number"
    && Number.isFinite(receipt.economicEffect.realizedPnlSwapHive));
  if (!hasError && broadcasts.length > 0 && provenRoundTrips.length === broadcasts.length) {
    return Object.freeze({
      status: "confirmed-complete-round-trip" as const,
      realizedPnlSwapHive: Number(provenRoundTrips
        .reduce((sum, receipt) => sum + receipt.economicEffect!.realizedPnlSwapHive!, 0)
        .toFixed(8)),
      economicEffectReferences: references,
    });
  }
  const status: Exclude<MarketExecutionEvidence["status"], "confirmed-complete-round-trip"> = hasError
    ? "error"
    : broadcasts.length > 0
      ? "confirmation-incomplete"
      : receipts.some((receipt) => receipt.status === "dry-run")
        ? "dry-run"
        : receipts.every((receipt) => receipt.status === "skipped" || receipt.status === "propose-only")
          ? "refused"
          : "confirmation-incomplete";
  return Object.freeze({ status, realizedPnlSwapHive: null, economicEffectReferences: references });
}

export function buildDervishTrialObservation(input: {
  readonly coordinate: DervishScheduleCoordinate;
  readonly observedAt: string;
  readonly votingReceipts: readonly DervishReceiptInput[];
  readonly curationPredictions: readonly CurationPredictionEvent[];
  readonly curationSettlements?: readonly CurationSettlementEvent[];
  readonly tradingReceipts: readonly DervishReceiptInput[];
}): DervishCoupledTrialObservation {
  const votes = Object.freeze(input.votingReceipts
    .filter((receipt) => receipt.lane === "voting" && receipt.action === "vote")
    .map((receipt) => voteObservation(input.coordinate.account, receipt, input.curationPredictions)));
  const settlements = Object.freeze((input.curationSettlements ?? []).map((event): CurationSettlementEvidence => event.matchedPredictionId
    ? Object.freeze({
      status: "matched" as const,
      predictionId: event.matchedPredictionId,
      settlementSourceId: event.source.sourceId,
      rewardVests: event.source.reward,
    })
    : Object.freeze({
      status: "observed-without-local-vote-link" as const,
      predictionId: null,
      settlementSourceId: event.source.sourceId,
      rewardVests: event.source.reward,
    })));
  const marketReceipts = Object.freeze(input.tradingReceipts.filter((receipt) => receipt.lane === "trading"));
  const identity = JSON.stringify([
    input.coordinate.globalStep,
    input.observedAt,
    input.coordinate.account,
    votes.map((vote) => [
      vote.target.key,
      vote.execution.status,
      vote.execution.transactionId,
      vote.curationSettlement.status,
      vote.curationSettlement.predictionId,
    ]),
    settlements.map((settlement) => [
      settlement.status,
      settlement.predictionId,
      settlement.settlementSourceId,
      settlement.rewardVests?.amount ?? null,
    ]),
    marketReceipts.map((receipt) => [
      receipt.action,
      receipt.target,
      receipt.status,
      receipt.txId ?? null,
      receipt.economicEffect ?? null,
    ]),
  ]);
  return Object.freeze({
    dervishExperimentSchema: DERVISH_EXPERIMENT_SCHEMA,
    kind: "aagaard.dervish-coupled-trial-observation" as const,
    trialId: `urn:aagaard:dervish-trial:${createHash("sha256").update(identity).digest("base64url")}`,
    observedAt: input.observedAt,
    coordinate: input.coordinate,
    attention: Object.freeze({ votes, settlements }),
    market: Object.freeze({
      targets: Object.freeze(marketReceipts.map((receipt) => receipt.target)),
      execution: marketExecution(marketReceipts),
    }),
    claims: Object.freeze({
      realizedPnlHbd: null,
      causalEffect: null,
      causalStatus: "not-identified" as const,
      quasicrystalCircuitStatus: "hypothesis-not-proved" as const,
    }),
  });
}

export function summarizeDervishTrial(observation: DervishCoupledTrialObservation): DervishTrialSummary {
  return Object.freeze({
    trialId: observation.trialId,
    globalStep: observation.coordinate.globalStep,
    cycle: observation.coordinate.cycle,
    boundaryStep: observation.coordinate.boundaryStep,
    site: observation.coordinate.site,
    lens: observation.coordinate.lens.id,
    phase: observation.coordinate.phase,
    account: observation.coordinate.account,
  });
}
