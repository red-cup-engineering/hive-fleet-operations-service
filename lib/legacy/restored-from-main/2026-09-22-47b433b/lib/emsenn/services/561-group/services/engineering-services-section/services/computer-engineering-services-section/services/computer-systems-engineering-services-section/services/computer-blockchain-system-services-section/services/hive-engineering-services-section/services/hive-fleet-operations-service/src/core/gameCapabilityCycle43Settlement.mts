import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";
import type { TerraCoreActionEvent } from "./terracoreSettlement.mts";

export const GAME_CAPABILITY_CYCLE_43_SCHEMA = "aagaard.game-capability-cycle-43.v1" as const;
export const GAME_CAPABILITY_CYCLE_43_CATEGORY = "aagaard.game-capability-cycle-43-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d"; const ACTOR = "urn:ame:aagaard";
const RESIDUE = "an A2A RMN operation must carry exactly one application/rmn+cbor raw part";
function record(value: unknown, label: string): Readonly<Record<string, unknown>> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Readonly<Record<string, unknown>>; }
function units8(value: unknown, label: string) { const text = String(value ?? ""); if (!/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(text)) throw new TypeError(`${label} is malformed`); return BigInt(text.replace(".", "")); }
function providers(value: unknown, label: string) { if (!Array.isArray(value)) throw new TypeError(`${label} providers are absent`); const rows = value.map((entry) => record(entry, label));
  const names = rows.map((row) => String(row.node)).sort(); if (names.length < 2 || new Set(names).size !== names.length || names.some((name) => !name.startsWith("https://"))) throw new TypeError(`${label} lacks independent providers`); return Object.freeze(names); }

export function gameCapabilityCycle43Event(input: Readonly<{ action: TerraCoreActionEvent; procurementResidue: string; recordedAt?: string }>) {
  const action = input.action; const receipt = action.receipt;
  if (action.terraCoreActionSchema !== "aagaard.terracore-action.v1" || action.status !== "claim-confirmed"
    || action.account !== "michael561" || receipt.kind !== "aagaard.terracore-one-action-receipt"
    || receipt.status !== "claim-confirmed" || receipt.transactionId !== action.transactionId
    || !/^[0-9a-f]{40}$/u.test(action.transactionId)) throw new TypeError("cycle 43 requires the exact confirmed TerraCore claim");
  const plan = record(receipt.plan, "TerraCore plan"); const before = record(receipt.before, "TerraCore before");
  const after = record(receipt.after, "TerraCore after"); const beforePlayer = record(before.player, "TerraCore before player");
  const afterPlayer = record(after.player, "TerraCore after player"); const rc = record(receipt.resourceCredits, "TerraCore RC");
  const rcPlan = record(rc.plan, "TerraCore RC plan");
  if (plan.kind !== "claim" || plan.amount !== "40.15178666" || rc.status !== "certified" || rcPlan.decision !== "ready"
    || String(beforePlayer.scrap) !== "40.15178666666666" || String(afterPlayer.scrap) !== "0.05656444444444444"
    || before.liquidScrap !== "158.59387428" || after.liquidScrap !== "198.75336909" || receipt.claimedScrap !== "40.15949481") {
    throw new TypeError("cycle 43 TerraCore claim source or effects changed");
  }
  const beforeUnits = units8(before.liquidScrap, "before SCRAP"); const afterUnits = units8(after.liquidScrap, "after SCRAP");
  const claimedUnits = units8(receipt.claimedScrap, "claimed SCRAP");
  if (afterUnits - beforeUnits !== claimedUnits) throw new TypeError("cycle 43 liquid SCRAP delta does not reconcile");
  const hiveProviders = providers(receipt.hive, "Hive confirmation"); const engineProviders = providers(receipt.providers, "Hive-Engine balance");
  const blocks = (receipt.hive as readonly unknown[]).map((entry) => Number(record(entry, "Hive confirmation").block));
  if (blocks.some((block) => !Number.isSafeInteger(block) || block <= 0) || new Set(blocks).size !== 1) throw new TypeError("cycle 43 Hive confirmations disagree");
  if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");
  const eventId = `urn:aagaard:game-capability-cycle-43:${createHash("sha256").update(JSON.stringify([action.eventId, receipt.claimedScrap])).digest("base64url")}`;
  return Object.freeze({ gameCapabilityCycle43Schema: GAME_CAPABILITY_CYCLE_43_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 43 as const, angle: "games-capability" as const, nextAngle: "market-arbitrage" as const }),
    game: "terracore" as const, action: "claim-raid-exposed-scrap" as const, sourceEventId: action.eventId,
    transactionId: action.transactionId, block: blocks[0], plannedScrap: "40.15178666" as const,
    liquidScrapBefore: "158.59387428" as const, liquidScrapAfter: "198.75336909" as const,
    liquidInventoryCreated: "40.15949481 SCRAP" as const, stashAfter: "0.05656444 SCRAP" as const,
    accounting: Object.freeze({ realizedRevenue: "0.000 HIVE" as const, realizedProfit: null,
      inventoryMarkedToMarket: false as const, capitalSpent: "0.000 HIVE" as const }),
    evidence: Object.freeze({ hiveProviders, engineProviders }), protectedAlphaVialPreserved: true as const,
    credentialAccess: Object.freeze({ occurred: true as const, role: "posting" as const, location: "local-0600-key" as const }),
    chainMutation: true as const, procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue: RESIDUE }) });
}

export async function recordGameCapabilityCycle43(dataDir: string, input: Parameters<typeof gameCapabilityCycle43Event>[0]) {
  const event = gameCapabilityCycle43Event(input); const prior = ((await querySettlementRecords(GAME_CAPABILITY_CYCLE_43_CATEGORY)) as readonly Readonly<Record<string, unknown>>[]).find((row) => row.eventId === event.eventId);
  if (prior) return prior; const agentUrl = process.env["RWIL_RDF_AGENT"]; if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT, actor: ACTOR,
    category: GAME_CAPABILITY_CYCLE_43_CATEGORY, recordedAt: event.recordedAt, record: event }); return event;
}
export async function readGameCapabilityCycle43(dataDir: string) { return Object.freeze(await querySettlementRecords(GAME_CAPABILITY_CYCLE_43_CATEGORY)); }
