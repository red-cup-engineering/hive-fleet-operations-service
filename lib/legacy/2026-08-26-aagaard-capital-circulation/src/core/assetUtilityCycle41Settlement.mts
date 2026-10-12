import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";
import type { HbdSavingsRecoveryEvent } from "./hbdSavingsRecoverySettlement.mts";

export const ASSET_UTILITY_CYCLE_41_SCHEMA = "aagaard.asset-utility-cycle-41.v1" as const;
export const ASSET_UTILITY_CYCLE_41_CATEGORY = "aagaard.asset-utility-cycle-41-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d"; const ACTOR = "urn:ame:aagaard";
const RESIDUE = "Agent Card has no valid signature";

export interface AssetUtilityCycle41Event {
  readonly assetUtilityCycle41Schema: typeof ASSET_UTILITY_CYCLE_41_SCHEMA;
  readonly eventId: string; readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 41; angle: "asset-utility-yield"; nextAngle: "product-revenue" }>;
  readonly recovery: Readonly<{ eventId: string; account: "michael561"; amount: "16.298 HBD"; requestId: 108346161;
    status: "pending"; completeAt: "2026-07-25T04:09:27.000Z"; stateDigest: string; providers: readonly string[] }>;
  readonly alternatives: Readonly<{
    workerBee: Readonly<{ delegated: "3.66758 WORKERBEE"; settledDistributionCount: 0; decision: "preserve-await-first-weekly-settlement" }>;
    holozing: Readonly<{ pending: "0.000 ZING"; staked: "26566.158 ZING"; alphaVial1831Preserved: true; decision: "no-claim" }>;
    terraCore: Readonly<{ claimableScrap: string; rcDecision: "wait-for-rc-regeneration"; eligibleAt: string; decision: "defer-claim" }>;
  }>;
  readonly decision: "track-largest-recoverable-position-and-refuse-new-locks";
  readonly capitalMoved: "0.000 HBD"; readonly realizedCycleIncome: null;
  readonly credentialAccess: false; readonly chainMutation: false;
  readonly procurement: Readonly<{ status: "no-candidate-accepted"; residue: typeof RESIDUE }>;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Readonly<Record<string, unknown>>; }
function rows(value: unknown, label: string): readonly unknown[] { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return value; }

export function assetUtilityCycle41Event(input: Readonly<{ recovery: HbdSavingsRecoveryEvent; workerBee: Readonly<Record<string, unknown>>;
  pool: Readonly<Record<string, unknown>>; holozing: Readonly<Record<string, unknown>>; terraCore: Readonly<Record<string, unknown>>;
  procurementResidue: string; recordedAt?: string }>): AssetUtilityCycle41Event {
  const recovery = input.recovery;
  if (recovery.hbdSavingsRecoverySchema !== "aagaard.hbd-savings-recovery.v1" || recovery.account !== "michael561"
    || recovery.amount !== "16.298 HBD" || recovery.requestId !== 108346161 || recovery.status !== "pending"
    || recovery.completeAt !== "2026-07-25T04:09:27.000Z" || recovery.providers.length < 2
    || recovery.credentialAccess !== false || recovery.chainMutation !== false) throw new TypeError("cycle 41 requires the exact pending HBD recovery");
  const workerBefore = record(input.workerBee.before, "WORKERBEE state"); const workerBalance = record(workerBefore.balance, "WORKERBEE balance");
  const delegation = record(workerBefore.delegation, "WORKERBEE delegation"); const workerPlan = record(input.workerBee.plan, "WORKERBEE plan");
  if (input.workerBee.kind !== "aagaard.asset-yield-receipt" || input.workerBee.status !== "observed" || workerBefore.account !== "michael561"
    || workerBalance.liquid !== "0.00000" || delegation.to !== "ph1102" || delegation.quantity !== "3.66758"
    || workerPlan.kind !== "refuse" || workerPlan.reason !== "no liquid WORKERBEE remains") throw new TypeError("WORKERBEE alternative is not exact");
  if (input.pool.kind !== "aagaard.workerbee-pool-audit" || input.pool.account !== "michael561"
    || rows(input.pool.settledDistributions, "WORKERBEE distributions").length !== 0
    || input.pool.decision !== "preserve-delegation-await-first-weekly-settlement" || input.pool.expectedYieldIsRealizedYield !== false) {
    throw new TypeError("WORKERBEE pool alternative is not unsettled");
  }
  const holoBefore = record(input.holozing.before, "HoloZing state"); const pending = record(holoBefore.pending, "HoloZing pending");
  const zing = record(holoBefore.zing, "HoloZing ZING"); const vials = record(holoBefore.alphaVials, "HoloZing vials");
  if (input.holozing.kind !== "aagaard.holozing-reward-claim-receipt" || input.holozing.status !== "observed" || input.holozing.account !== "michael561"
    || pending.total !== "0.000" || zing.staked !== "26566.158" || vials.count !== 1
    || JSON.stringify(rows(vials.ids, "Alpha Vial ids")) !== "[1831]" || vials.disposition !== "preserved-unopened") throw new TypeError("HoloZing alternative violates the exact protected state");
  const terraBefore = record(input.terraCore.before, "TerraCore state"); const player = record(terraBefore.player, "TerraCore player");
  const terraPlan = record(input.terraCore.plan, "TerraCore plan"); const rc = record(input.terraCore.resourceCredits, "TerraCore RC");
  const rcPlan = record(rc.plan, "TerraCore RC plan");
  if (input.terraCore.kind !== "aagaard.terracore-one-action-receipt" || input.terraCore.status !== "observed" || input.terraCore.account !== "michael561"
    || terraPlan.kind !== "claim" || terraPlan.amount !== String(player.scrap).slice(0, String(player.scrap).indexOf(".") + 9)
    || rc.status !== "certified" || rcPlan.decision !== "wait-for-rc-regeneration") throw new TypeError("TerraCore alternative is not an exact RC-gated claim");
  const claimable = String(terraPlan.amount); if (!/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(claimable)) throw new TypeError("TerraCore claim is malformed");
  const eligibleAt = new Date(String(rcPlan.eligibleAt)).toISOString();
  if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");
  const eventId = `urn:aagaard:asset-utility-cycle-41:${createHash("sha256").update(JSON.stringify([recovery.eventId, claimable, eligibleAt])).digest("base64url")}`;
  return Object.freeze({ assetUtilityCycle41Schema: ASSET_UTILITY_CYCLE_41_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 41 as const, angle: "asset-utility-yield" as const, nextAngle: "product-revenue" as const }),
    recovery: Object.freeze({ eventId: recovery.eventId, account: "michael561" as const, amount: "16.298 HBD" as const,
      requestId: 108346161 as const, status: "pending" as const, completeAt: "2026-07-25T04:09:27.000Z" as const,
      stateDigest: recovery.stateDigest, providers: recovery.providers }),
    alternatives: Object.freeze({
      workerBee: Object.freeze({ delegated: "3.66758 WORKERBEE" as const, settledDistributionCount: 0 as const,
        decision: "preserve-await-first-weekly-settlement" as const }),
      holozing: Object.freeze({ pending: "0.000 ZING" as const, staked: "26566.158 ZING" as const,
        alphaVial1831Preserved: true as const, decision: "no-claim" as const }),
      terraCore: Object.freeze({ claimableScrap: claimable, rcDecision: "wait-for-rc-regeneration" as const,
        eligibleAt, decision: "defer-claim" as const }),
    }), decision: "track-largest-recoverable-position-and-refuse-new-locks" as const,
    capitalMoved: "0.000 HBD" as const, realizedCycleIncome: null, credentialAccess: false as const, chainMutation: false as const,
    procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue: RESIDUE }) });
}

export async function recordAssetUtilityCycle41(dataDir: string, input: Parameters<typeof assetUtilityCycle41Event>[0]) {
  const event = assetUtilityCycle41Event(input); const prior = ((await querySettlementRecords(ASSET_UTILITY_CYCLE_41_CATEGORY)) as readonly AssetUtilityCycle41Event[]).find((row) => row.eventId === event.eventId);
  if (prior) return prior; const agentUrl = process.env["RWIL_RDF_AGENT"]; if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT, actor: ACTOR,
    category: ASSET_UTILITY_CYCLE_41_CATEGORY, recordedAt: event.recordedAt, record: event }); return event;
}
export async function readAssetUtilityCycle41(dataDir: string): Promise<readonly AssetUtilityCycle41Event[]> { return Object.freeze((await querySettlementRecords(ASSET_UTILITY_CYCLE_41_CATEGORY)) as readonly AssetUtilityCycle41Event[]); }
