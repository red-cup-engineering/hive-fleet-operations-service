import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

import type { CurationActionEvent } from "./curationActionSettlement.mts";

export const CURATION_CYCLE_SCHEMA = "aagaard.curation-cycle.v1" as const;
export const CURATION_CYCLE_CATEGORY = "aagaard.curation-cycle-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface CurationCycleEvent {
  readonly curationCycleSchema: typeof CURATION_CYCLE_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 35; angle: "curation-attention"; nextAngle: "asset-utility-yield" }>;
  readonly vote: Readonly<{ actionEventId: string; transactionId: string; block: number; account: "emsenn0";
    author: "splinterlands"; permlink: "the-arena-vanguard-is-coming-to-splinterlands"; weightBps: 5000;
    strategySignal: number; strategySignalUnit: "aagaard.curation-strategy-signal.v1";
    economicSettlement: "pending-curation-reward"; realizedReward: null }>;
  readonly baseline: Readonly<{ observedAt: string; stateDigest: string; providers: readonly string[]; requestedLimit: 1000;
    oldestHistoryIndex: number; newestHistoryIndex: number; rewardCount: number;
    realizedReward: Readonly<{ amount: string; asset: "VESTS" }>; scope: "bounded-historical-baseline-not-cycle-profit" }>;
  readonly capitalMoved: "0.000 HIVE";
  readonly credentialAccess: Readonly<{ occurred: true; location: "cold-red-gate"; role: "posting" }>;
  readonly chainMutation: true;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function rows(value: unknown, label: string): readonly unknown[] { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return value; }
function exactVests(value: unknown): string { const amount = String(value ?? ""); if (!/^(?:0|[1-9][0-9]*)\.[0-9]{6}$/u.test(amount)) throw new TypeError("baseline VESTS is malformed"); return amount; }

export function curationCycleEvent(input: Readonly<{ action: CurationActionEvent; baseline: Readonly<Record<string, unknown>>; recordedAt?: string }>): CurationCycleEvent {
  const action = input.action;
  if (action.curationActionSchema !== "aagaard.curation-action.v1" || action.account !== "emsenn0" || action.author !== "splinterlands"
    || action.permlink !== "the-arena-vanguard-is-coming-to-splinterlands" || action.weightBps !== 5000
    || action.credentialLocation !== "cold-red-gate" || action.economicSettlement !== "pending-curation-reward" || action.realizedReward !== null) {
    throw new TypeError("cycle requires the exact pending cycle-35 curation action");
  }
  const receipt = record(action.receipt, "curation receipt"); const plan = record(receipt.plan, "curation plan");
  if (plan.strategySignalUnit !== "aagaard.curation-strategy-signal.v1" || !Number.isFinite(Number(plan.strategySignal))
    || Number(plan.manaBps) < 8000 || Number(plan.projectedManaBps) < 8000
    || record(plan.resourceCredits, "curation RC plan").decision !== "ready") throw new TypeError("curation action lacks exact strategy or reserve evidence");
  const baseline = input.baseline; const knowledge = record(baseline.providerKnowledge, "baseline provider knowledge");
  const digests = rows(knowledge.stateDigests, "baseline state digests");
  if (baseline.kind !== "aagaard.curation-reward-baseline" || baseline.account !== "emsenn0" || baseline.status !== "certified"
    || baseline.requestedLimit !== 1000 || baseline.credentialAccess !== false || baseline.chainMutation !== false
    || knowledge.value !== "true" || digests.length !== 1) throw new TypeError("curation baseline is not independently certified");
  const digest = record(digests[0], "baseline state digest"); const stateDigest = String(digest.stateDigest ?? "");
  const providers = rows(digest.providers, "baseline providers").map(String).sort(); const value = record(baseline.baseline, "curation baseline");
  const reward = record(value.realizedReward, "baseline reward");
  if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length
    || value.boundedHistoryOnly !== true || reward.asset !== "VESTS") throw new TypeError("curation baseline exact evidence is malformed");
  const oldest = Number(value.oldestHistoryIndex); const newest = Number(value.newestHistoryIndex); const rewardCount = Number(value.rewardCount);
  if (![oldest, newest, rewardCount].every(Number.isSafeInteger) || oldest < 0 || newest < oldest || rewardCount < 0 || rewardCount > 1000) {
    throw new TypeError("curation baseline history bounds are malformed");
  }
  const eventId = `urn:aagaard:curation-cycle:${createHash("sha256").update(JSON.stringify([action.eventId, stateDigest])).digest("base64url")}`;
  return Object.freeze({ curationCycleSchema: CURATION_CYCLE_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 35 as const, angle: "curation-attention" as const, nextAngle: "asset-utility-yield" as const }),
    vote: Object.freeze({ actionEventId: action.eventId, transactionId: action.transactionId, block: action.block,
      account: "emsenn0" as const, author: "splinterlands" as const,
      permlink: "the-arena-vanguard-is-coming-to-splinterlands" as const, weightBps: 5000 as const,
      strategySignal: Number(plan.strategySignal), strategySignalUnit: "aagaard.curation-strategy-signal.v1" as const,
      economicSettlement: "pending-curation-reward" as const, realizedReward: null }),
    baseline: Object.freeze({ observedAt: new Date(String(baseline.observedAt)).toISOString(), stateDigest, providers: Object.freeze(providers),
      requestedLimit: 1000 as const, oldestHistoryIndex: oldest, newestHistoryIndex: newest, rewardCount,
      realizedReward: Object.freeze({ amount: exactVests(reward.amount), asset: "VESTS" as const }),
      scope: "bounded-historical-baseline-not-cycle-profit" as const }),
    capitalMoved: "0.000 HIVE" as const,
    credentialAccess: Object.freeze({ occurred: true as const, location: "cold-red-gate" as const, role: "posting" as const }),
    chainMutation: true as const });
}

export async function recordCurationCycle(dataDir: string, input: Parameters<typeof curationCycleEvent>[0]) {
  const event = curationCycleEvent(input);
  const prior = ((await querySettlementRecords(CURATION_CYCLE_CATEGORY)) as readonly CurationCycleEvent[]).find((row) => row.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: CURATION_CYCLE_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readCurationCycles(dataDir: string): Promise<readonly CurationCycleEvent[]> {
  return Object.freeze((await querySettlementRecords(CURATION_CYCLE_CATEGORY)) as readonly CurationCycleEvent[]);
}
