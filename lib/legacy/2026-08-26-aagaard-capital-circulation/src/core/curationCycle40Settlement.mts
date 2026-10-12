import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

import type { CurationActionEvent } from "./curationActionSettlement.mts";
import type { CurationCycleEvent } from "./curationCycleSettlement.mts";
import type { CurationTelemetry } from "./curationSettlement.mts";

export const CURATION_CYCLE_40_SCHEMA = "aagaard.curation-cycle-40.v1" as const;
export const CURATION_CYCLE_40_CATEGORY = "aagaard.curation-cycle-40-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
const PRIOR_ID = "urn:aagaard:curation-cycle:DPNzSfYyOowKtEIYspETgdxmC34gdL2qLbuJe6iqXQQ";
const ACTION_ID = "urn:aagaard:curation-action:4Nn4gehXP55V26iRsqdUgQZjORJpbvZoyZAoWqWkpjM";
const TX_ID = "0395691f00d57a9598fcdaf8e3318769886f55d4";
const PROCUREMENT_RESIDUE = "timed out awaiting tools/call after 300s";

export interface CurationCycle40Event {
  readonly curationCycle40Schema: typeof CURATION_CYCLE_40_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 40; angle: "curation-attention"; nextAngle: "asset-utility-yield" }>;
  readonly vote: Readonly<{ actionEventId: typeof ACTION_ID; transactionId: typeof TX_ID; block: 108358790;
    account: "emsenn0"; author: "ecency.stats"; permlink: "ecency-daily-2026-07-22"; weightBps: 5000;
    strategySignal: 110.427; strategySignalUnit: "aagaard.curation-strategy-signal.v1";
    economicSettlement: "pending-curation-reward"; realizedReward: null; payoutAt: "2026-07-29T13:13:48.000Z" }>;
  readonly rewardTelemetry: Readonly<{ predictionsRecorded: number; settlementsObserved: number; matchedManagedPredictions: 0;
    cycleRewardStatus: "pending"; realizedCycleReward: null }>;
  readonly baselineComparison: Readonly<{
    prior: Readonly<{ eventId: typeof PRIOR_ID; oldestHistoryIndex: number; newestHistoryIndex: number; rewardCount: number; amountVests: string }>;
    current: Readonly<{ observedAt: string; stateDigest: string; providers: readonly string[]; oldestHistoryIndex: number;
      newestHistoryIndex: number; rewardCount: number; amountVests: string }>;
    oldestIndexShift: number; newestIndexShift: number; rewardCountChange: number; windowAmountChangeVests: string;
    attribution: "not-attributable-window-composition-changed";
  }>;
  readonly rectification: Readonly<{ retiredCopy: "single-target-cold-signer";
    mechanism: "scripts/cold-red-gate-curation-broadcast.mjs#validateRemoteCurationRequest";
    obligation: "admit-only-one-positive-reserve-safe-planner-selected-vote";
    badIncumbentTest: "test/curationCycle.test.mts" }>;
  readonly capitalMoved: "0.000 HIVE";
  readonly credentialAccess: Readonly<{ occurred: true; location: "cold-red-gate"; role: "posting" }>;
  readonly chainMutation: true;
  readonly procurement: Readonly<{ status: "no-candidate-accepted"; residue: typeof PROCUREMENT_RESIDUE }>;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function rows(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}
function vestsUnits(value: unknown, label: string): bigint {
  const match = /^(?:0|[1-9][0-9]*)\.([0-9]{6})$/u.exec(String(value ?? ""));
  if (!match) throw new TypeError(`${label} must be exact VESTS`);
  const [whole, fraction] = String(value).split("."); return BigInt(whole!) * 1_000_000n + BigInt(fraction!);
}
function signedVests(value: bigint): string {
  const sign = value < 0n ? "-" : ""; const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, "0")}`;
}

function certifiedBaseline(baseline: Readonly<Record<string, unknown>>) {
  const knowledge = record(baseline.providerKnowledge, "baseline provider knowledge");
  const groups = rows(knowledge.stateDigests, "baseline state digests");
  if (baseline.kind !== "aagaard.curation-reward-baseline" || baseline.account !== "emsenn0" || baseline.status !== "certified"
    || baseline.requestedLimit !== 1000 || baseline.credentialAccess !== false || baseline.chainMutation !== false
    || knowledge.value !== "true" || groups.length !== 1) throw new TypeError("current baseline is not independently certified");
  const group = record(groups[0], "baseline digest group"); const stateDigest = String(group.stateDigest ?? "");
  const providers = rows(group.providers, "baseline providers").map(String).sort();
  const value = record(baseline.baseline, "baseline value"); const reward = record(value.realizedReward, "baseline reward");
  const oldest = Number(value.oldestHistoryIndex); const newest = Number(value.newestHistoryIndex); const rewardCount = Number(value.rewardCount);
  if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length
    || value.boundedHistoryOnly !== true || reward.asset !== "VESTS" || ![oldest, newest, rewardCount].every(Number.isSafeInteger)
    || oldest < 0 || newest < oldest || rewardCount < 0 || rewardCount > 1000) throw new TypeError("current baseline exact evidence is malformed");
  const amountVests = String(reward.amount); vestsUnits(amountVests, "current baseline reward");
  return Object.freeze({ observedAt: new Date(String(baseline.observedAt)).toISOString(), stateDigest,
    providers: Object.freeze(providers), oldestHistoryIndex: oldest, newestHistoryIndex: newest, rewardCount, amountVests });
}

export function curationCycle40Event(input: Readonly<{ prior: CurationCycleEvent; action: CurationActionEvent;
  baseline: Readonly<Record<string, unknown>>; telemetry: CurationTelemetry; procurementResidue: string; recordedAt?: string }>): CurationCycle40Event {
  if (input.prior.eventId !== PRIOR_ID || input.prior.baseline.scope !== "bounded-historical-baseline-not-cycle-profit") {
    throw new TypeError("cycle 40 requires the exact durable cycle 35 baseline");
  }
  const action = input.action; const receipt = record(action.receipt, "curation action receipt"); const plan = record(receipt.plan, "curation plan");
  const settlement = record(receipt.settlementIdentity, "curation settlement identity");
  if (action.eventId !== ACTION_ID || action.transactionId !== TX_ID || action.block !== 108358790 || action.account !== "emsenn0"
    || action.author !== "ecency.stats" || action.permlink !== "ecency-daily-2026-07-22" || action.weightBps !== 5000
    || action.credentialLocation !== "cold-red-gate" || action.confirmationProviders.length < 2 || action.visibilityProviders.length < 2
    || action.economicSettlement !== "pending-curation-reward" || action.realizedReward !== null
    || plan.strategySignal !== 110.427 || plan.strategySignalUnit !== "aagaard.curation-strategy-signal.v1"
    || Number(plan.manaBps) < 8000 || Number(plan.projectedManaBps) < 8000
    || record(plan.resourceCredits, "curation RC plan").decision !== "ready"
    || settlement.payoutAt !== "2026-07-29T13:13:48.000Z") throw new TypeError("cycle 40 requires the exact independently settled pending vote");
  const current = certifiedBaseline(input.baseline);
  const prior = Object.freeze({ eventId: PRIOR_ID, oldestHistoryIndex: input.prior.baseline.oldestHistoryIndex,
    newestHistoryIndex: input.prior.baseline.newestHistoryIndex, rewardCount: input.prior.baseline.rewardCount,
    amountVests: input.prior.baseline.realizedReward.amount });
  const oldestShift = current.oldestHistoryIndex - prior.oldestHistoryIndex;
  const newestShift = current.newestHistoryIndex - prior.newestHistoryIndex;
  if (oldestShift <= 0 || newestShift <= 0) throw new TypeError("bounded history did not expose a changed window composition");
  const windowChange = signedVests(vestsUnits(current.amountVests, "current reward") - vestsUnits(prior.amountVests, "prior reward"));
  const telemetry = input.telemetry;
  if (telemetry.kind !== "aagaard.curation-settlement-telemetry" || telemetry.account !== "emsenn0"
    || telemetry.settlementsMatchedToPredictions !== 0 || telemetry.predictionsRecorded < 1
    || telemetry.settlementsObserved < 0) throw new TypeError("curation settlement telemetry does not prove the pending state");
  if (input.procurementResidue.trim() !== PROCUREMENT_RESIDUE) throw new TypeError("procurement residue is not exact");
  const baselineComparison = Object.freeze({ prior, current, oldestIndexShift: oldestShift, newestIndexShift: newestShift,
    rewardCountChange: current.rewardCount - prior.rewardCount, windowAmountChangeVests: windowChange,
    attribution: "not-attributable-window-composition-changed" as const });
  const eventId = `urn:aagaard:curation-cycle-40:${createHash("sha256").update(JSON.stringify([action.eventId, baselineComparison])).digest("base64url")}`;
  return Object.freeze({ curationCycle40Schema: CURATION_CYCLE_40_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 40 as const, angle: "curation-attention" as const, nextAngle: "asset-utility-yield" as const }),
    vote: Object.freeze({ actionEventId: ACTION_ID, transactionId: TX_ID, block: 108358790 as const, account: "emsenn0" as const,
      author: "ecency.stats" as const, permlink: "ecency-daily-2026-07-22" as const, weightBps: 5000 as const,
      strategySignal: 110.427 as const, strategySignalUnit: "aagaard.curation-strategy-signal.v1" as const,
      economicSettlement: "pending-curation-reward" as const, realizedReward: null,
      payoutAt: "2026-07-29T13:13:48.000Z" as const }),
    rewardTelemetry: Object.freeze({ predictionsRecorded: telemetry.predictionsRecorded, settlementsObserved: telemetry.settlementsObserved,
      matchedManagedPredictions: 0 as const, cycleRewardStatus: "pending" as const, realizedCycleReward: null }),
    baselineComparison,
    rectification: Object.freeze({ retiredCopy: "single-target-cold-signer" as const,
      mechanism: "scripts/cold-red-gate-curation-broadcast.mjs#validateRemoteCurationRequest" as const,
      obligation: "admit-only-one-positive-reserve-safe-planner-selected-vote" as const,
      badIncumbentTest: "test/curationCycle.test.mts" as const }),
    capitalMoved: "0.000 HIVE" as const,
    credentialAccess: Object.freeze({ occurred: true as const, location: "cold-red-gate" as const, role: "posting" as const }),
    chainMutation: true as const,
    procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue: PROCUREMENT_RESIDUE }) });
}

export async function recordCurationCycle40(dataDir: string, input: Parameters<typeof curationCycle40Event>[0]) {
  const event = curationCycle40Event(input);
  const prior = ((await querySettlementRecords(CURATION_CYCLE_40_CATEGORY)) as readonly CurationCycle40Event[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: CURATION_CYCLE_40_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readCurationCycle40(dataDir: string): Promise<readonly CurationCycle40Event[]> {
  return Object.freeze((await querySettlementRecords(CURATION_CYCLE_40_CATEGORY)) as readonly CurationCycle40Event[]);
}
