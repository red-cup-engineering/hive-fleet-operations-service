import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

import type { HolozingWildsSessionEvent } from "./holozingWildsSettlement.mts";

export const GAME_CAPABILITY_CYCLE_38_SCHEMA = "aagaard.game-capability-cycle-38.v1" as const;
export const GAME_CAPABILITY_CYCLE_38_CATEGORY = "aagaard.game-capability-cycle-38-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface GameCapabilityCycle38Event {
  readonly gameCapabilityCycle38Schema: typeof GAME_CAPABILITY_CYCLE_38_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 38; angle: "games-capability"; nextAngle: "market-arbitrage" }>;
  readonly game: "holozing-wilds";
  readonly samples: readonly Readonly<{ eventId: string; dustDelta: number; wildsDefeated: number; heals: number; captures: 0 }>[];
  readonly repeatability: Readonly<{ sampleCount: 2; totalDustDelta: 29.17; totalWildsDefeated: 16; totalHeals: 12;
    totalCaptures: 0; productiveProgressRepeated: true; transferableAssetCreated: false; realizedRevenue: "0.000 HIVE" }>;
  readonly rectification: Readonly<{ observedFailureBoundary: "team-wipe"; discoveredInEventId: string;
    mechanism: "scripts/holozing-wilds.mjs#teamWiped"; obligation: "stop-without-revive-when-every-team-member-is-fainted";
    exercisedByTest: "test/holozingWilds.test.mjs" }>;
  readonly protectedAlphaVialPreserved: true;
  readonly capitalMoved: "0.000 HIVE";
  readonly credentialAccess: Readonly<{ occurred: true; role: "posting"; location: "local-0600-key" }>;
  readonly hiveChainMutation: false;
  readonly offChainGameProgress: true;
  readonly procurement: Readonly<{ status: "no-candidate-accepted"; residue: string }>;
}

function finite(value: unknown, label: string): number {
  const result = Number(value); if (!Number.isFinite(result)) throw new TypeError(`${label} must be finite`); return result;
}
function sessionMetrics(event: HolozingWildsSessionEvent, expected: Readonly<{ dust: number; wilds: number; heals: number }>) {
  if (event.holozingWildsSessionSchema !== "aagaard.holozing-wilds-session.v1" || event.account !== "michael561"
    || event.protectedAlphaVialPreserved !== true || event.transferableAssetCreated !== false || event.revenueRecognized !== "0.000 HIVE"
    || finite(event.metrics.captureActions, "capture actions") !== 0 || finite(event.metrics.dustDelta, "Dust delta") !== expected.dust
    || finite(event.metrics.wildsDefeatedDelta, "wilds defeated") !== expected.wilds || finite(event.metrics.heals, "heals") !== expected.heals) {
    throw new TypeError("cycle 38 Wilds session is not the exact safe settled sample");
  }
  return Object.freeze({ eventId: event.eventId, dustDelta: expected.dust, wildsDefeated: expected.wilds,
    heals: expected.heals, captures: 0 as const });
}

export function gameCapabilityCycle38Event(input: Readonly<{
  prior: HolozingWildsSessionEvent;
  current: HolozingWildsSessionEvent;
  procurementResidue: string;
  recordedAt?: string;
}>): GameCapabilityCycle38Event {
  const prior = sessionMetrics(input.prior, { dust: 22.15, wilds: 12, heals: 8 });
  const current = sessionMetrics(input.current, { dust: 7.02, wilds: 4, heals: 4 });
  if (prior.eventId !== "urn:aagaard:holozing-wilds-session:7x-24HJpatoViUwU4F88cuZd2hUWDFXuBp3Bw5ihunY"
    || current.eventId !== "urn:aagaard:holozing-wilds-session:b5HAKlMJzSCsvP-_dQxZ9k8jqYlJgzW8NHwxWEBfsts") {
    throw new TypeError("cycle 38 requires the exact two durable Wilds samples");
  }
  const finalState = input.current.receipt.finalState as Readonly<Record<string, unknown>> | undefined;
  const recentLog = Array.isArray(finalState?.recentLog) ? finalState.recentLog.map(String) : [];
  if (!recentLog.some((entry) => entry.includes("Team wiped"))) throw new TypeError("current sample does not expose the team-wipe correction boundary");
  const residue = input.procurementResidue.trim();
  if (residue !== "an A2A RMN operation must carry exactly one application/rmn+cbor raw part") throw new TypeError("procurement residue is not exact");
  const samples = Object.freeze([prior, current]);
  const eventId = `urn:aagaard:game-capability-cycle-38:${createHash("sha256").update(JSON.stringify(samples)).digest("base64url")}`;
  return Object.freeze({ gameCapabilityCycle38Schema: GAME_CAPABILITY_CYCLE_38_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 38 as const, angle: "games-capability" as const, nextAngle: "market-arbitrage" as const }),
    game: "holozing-wilds" as const, samples,
    repeatability: Object.freeze({ sampleCount: 2 as const, totalDustDelta: 29.17 as const, totalWildsDefeated: 16 as const,
      totalHeals: 12 as const, totalCaptures: 0 as const, productiveProgressRepeated: true as const,
      transferableAssetCreated: false as const, realizedRevenue: "0.000 HIVE" as const }),
    rectification: Object.freeze({ observedFailureBoundary: "team-wipe" as const, discoveredInEventId: current.eventId,
      mechanism: "scripts/holozing-wilds.mjs#teamWiped" as const,
      obligation: "stop-without-revive-when-every-team-member-is-fainted" as const,
      exercisedByTest: "test/holozingWilds.test.mjs" as const }),
    protectedAlphaVialPreserved: true as const, capitalMoved: "0.000 HIVE" as const,
    credentialAccess: Object.freeze({ occurred: true as const, role: "posting" as const, location: "local-0600-key" as const }),
    hiveChainMutation: false as const, offChainGameProgress: true as const,
    procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue }) });
}

export async function recordGameCapabilityCycle38(dataDir: string, input: Parameters<typeof gameCapabilityCycle38Event>[0]) {
  const event = gameCapabilityCycle38Event(input);
  const prior = ((await querySettlementRecords(GAME_CAPABILITY_CYCLE_38_CATEGORY)) as readonly GameCapabilityCycle38Event[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: GAME_CAPABILITY_CYCLE_38_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readGameCapabilityCycle38(dataDir: string): Promise<readonly GameCapabilityCycle38Event[]> {
  return Object.freeze((await querySettlementRecords(GAME_CAPABILITY_CYCLE_38_CATEGORY)) as readonly GameCapabilityCycle38Event[]);
}
