import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

import type { HolozingRewardClaimEvent } from "./holozingRewardSettlement.mts";

export const GAME_CAPABILITY_CYCLE_SCHEMA = "aagaard.game-capability-cycle.v1" as const;
export const GAME_CAPABILITY_CYCLE_CATEGORY = "aagaard.game-capability-cycle-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface GameCapabilityCycleEvent {
  readonly gameCapabilityCycleSchema: typeof GAME_CAPABILITY_CYCLE_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 33; angle: "games-capability"; nextAngle: "market-arbitrage" }>;
  readonly selection: Readonly<{ game: "holozing-rewards"; action: "claim-pending-zing";
    formula: "max_lex(admitted,benefit-class,capital-risk-class,mutation-surface,credential-surface,stable-identity)";
    basis: "productive-state-dominates-resettable-learning-after-hard-admission" }>;
  readonly outcome: Readonly<{ claimEventId: string; transactionId: string; claimedZing: string;
    stakedBefore: string; stakedAfter: string; pendingBefore: string; pendingAfter: string;
    alphaVial1831Preserved: true; retryAllowed: false }>;
  readonly capitalMoved: "0.000 HIVE";
  readonly realizedRevenue: "0.000 HIVE";
  readonly credentialAccess: Readonly<{ occurred: true; location: "local-key-file"; role: "posting" }>;
  readonly chainMutation: true;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function units3(value: unknown, label: string): bigint {
  const text = String(value ?? "");
  if (!/^(?:0|[1-9][0-9]*)\.[0-9]{3}$/u.test(text)) throw new TypeError(`${label} must have exactly three decimals`);
  return BigInt(text.replace(".", ""));
}

export function gameCapabilityCycleEvent(claim: HolozingRewardClaimEvent, recordedAt = new Date().toISOString()): GameCapabilityCycleEvent {
  if (claim.holozingRewardClaimSchema !== "aagaard.holozing-reward-claim.v1" || claim.status !== "claimed-confirmed"
    || claim.account !== "michael561" || claim.alphaVial1831Preserved !== true || claim.retryAllowed !== false
    || claim.realizedRevenue !== "0.000 HIVE" || claim.transactionId === null || claim.claimedZing === null) {
    throw new TypeError("cycle requires one confirmed protected HoloZing reward claim");
  }
  const receipt = record(claim.receipt, "claim receipt"); const before = record(receipt.before, "pre-claim observation");
  const after = record(receipt.after, "post-claim observation"); const beforeZing = record(before.zing, "pre-claim ZING");
  const afterZing = record(after.zing, "post-claim ZING"); const beforePending = record(before.pending, "pre-claim pending");
  const afterPending = record(after.pending, "post-claim pending"); const credential = record(receipt.credentialAccess, "credential access");
  if (credential.occurred !== true || credential.location !== "local-key-file" || credential.role !== "posting") {
    throw new TypeError("cycle claim lacks exact credential accountability");
  }
  const claimed = units3(claim.claimedZing, "claimed ZING");
  if (units3(afterZing.staked, "post-claim stake") - units3(beforeZing.staked, "pre-claim stake") !== claimed
    || units3(beforePending.total, "pre-claim pending") !== claimed
    || units3(afterPending.total, "post-claim pending") >= claimed) {
    throw new TypeError("cycle outcome does not bind the exact productive-state transition");
  }
  const eventId = `urn:aagaard:game-capability-cycle:${createHash("sha256").update(claim.eventId).digest("base64url")}`;
  return Object.freeze({ gameCapabilityCycleSchema: GAME_CAPABILITY_CYCLE_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(),
    cycle: Object.freeze({ globalStep: 33 as const, angle: "games-capability" as const, nextAngle: "market-arbitrage" as const }),
    selection: Object.freeze({ game: "holozing-rewards" as const, action: "claim-pending-zing" as const,
      formula: "max_lex(admitted,benefit-class,capital-risk-class,mutation-surface,credential-surface,stable-identity)" as const,
      basis: "productive-state-dominates-resettable-learning-after-hard-admission" as const }),
    outcome: Object.freeze({ claimEventId: claim.eventId, transactionId: claim.transactionId, claimedZing: claim.claimedZing,
      stakedBefore: String(beforeZing.staked), stakedAfter: String(afterZing.staked),
      pendingBefore: String(beforePending.total), pendingAfter: String(afterPending.total),
      alphaVial1831Preserved: true as const, retryAllowed: false as const }),
    capitalMoved: "0.000 HIVE" as const, realizedRevenue: "0.000 HIVE" as const,
    credentialAccess: Object.freeze({ occurred: true as const, location: "local-key-file" as const, role: "posting" as const }),
    chainMutation: true as const });
}

export async function recordGameCapabilityCycle(dataDir: string, claim: HolozingRewardClaimEvent, recordedAt?: string) {
  const event = gameCapabilityCycleEvent(claim, recordedAt);
  const prior = ((await querySettlementRecords(GAME_CAPABILITY_CYCLE_CATEGORY)) as readonly GameCapabilityCycleEvent[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: GAME_CAPABILITY_CYCLE_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readGameCapabilityCycles(dataDir: string): Promise<readonly GameCapabilityCycleEvent[]> {
  return Object.freeze((await querySettlementRecords(GAME_CAPABILITY_CYCLE_CATEGORY)) as readonly GameCapabilityCycleEvent[]);
}
