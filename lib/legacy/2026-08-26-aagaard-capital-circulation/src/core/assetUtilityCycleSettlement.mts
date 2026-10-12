import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

import type { IncomeTokenDistributionEvent } from "./incomeTokenSettlement.mts";

export const ASSET_UTILITY_CYCLE_SCHEMA = "aagaard.asset-utility-cycle.v1" as const;
export const ASSET_UTILITY_CYCLE_CATEGORY = "aagaard.asset-utility-cycle-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface AssetUtilityCycleEvent {
  readonly assetUtilityCycleSchema: typeof ASSET_UTILITY_CYCLE_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 36; angle: "asset-utility-yield"; nextAngle: "product-revenue" }>;
  readonly position: Readonly<{
    account: "emsenn0"; symbol: "BRO"; payer: "brodivs"; quantity: "2.02059643";
    settledDistributionEventIds: readonly string[]; settledDistributionCount: 2;
    observedNativeHive: "0.006 HIVE"; latestDistributionAt: "2025-10-18T10:17:21.000Z";
    historicalAnnualizedNativeHive: "0.156000 HIVE"; currentYieldClaim: false;
    exitStateDigest: string; exitProviders: readonly string[]; completeDisplayedExitSwapHive: "0.00060617";
  }>;
  readonly decision: "preserve-bro-and-require-manual-review-of-stale-income";
  readonly capitalMoved: "0.00000000 SWAP.HIVE";
  readonly realizedCycleIncome: "0.000 HIVE";
  readonly credentialAccess: false;
  readonly chainMutation: false;
  readonly priorArt: readonly Readonly<{ source: string; adopted: string }>[];
  readonly procurement: Readonly<{ status: "no-candidate-accepted"; residue: string }>;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function rows(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

/** Close cycle 36 only from exact, independently witnessed BRO evidence.
 * Historical receipts remain historical: the event refuses to turn a stale
 * annualization or a SWAP.HIVE exit sidecar into current realized income. */
export function assetUtilityCycleEvent(input: Readonly<{
  audit: Readonly<Record<string, unknown>>;
  distributions: readonly IncomeTokenDistributionEvent[];
  procurementResidue: string;
  recordedAt?: string;
}>): AssetUtilityCycleEvent {
  const audit = input.audit;
  if (audit.kind !== "aagaard.income-token-audit" || audit.mode !== "record-verified-distributions"
    || audit.credentialAccess !== false || audit.chainMutation !== false) throw new TypeError("cycle requires a read-only recorded income-token audit");
  const position = record(audit.position, "BRO position");
  const sourceAgreement = record(position.sourceAgreement, "BRO source agreement");
  const realized = record(position.realized, "BRO realized income");
  const latest = record(realized.latest, "BRO latest income");
  const projection = record(position.projection, "BRO projection");
  if (position.account !== "emsenn0" || position.symbol !== "BRO" || position.payer !== "brodivs"
    || sourceAgreement.distributionCount !== 2 || rows(sourceAgreement.providers, "BRO Hive providers").length < 2
    || realized.scanTotal !== "0.006 HIVE" || realized.yearToDate !== "0.000 HIVE"
    || latest.timestamp !== "2025-10-18T10:17:21.000Z" || latest.reportedHolding !== "2.02059643"
    || projection.annualizedNativeHive !== "0.156000 HIVE" || projection.status !== "historical-run-rate-not-guaranteed"
    || position.decision !== "manual-review") throw new TypeError("BRO position does not prove the exact stale-income refusal");
  const exit = record(position.exit, "BRO exit"); const knowledge = record(exit.providerKnowledge, "BRO exit knowledge");
  const digestRows = rows(knowledge.stateDigests, "BRO exit state digests");
  if (exit.status !== "certified" || exit.symbol !== "BRO" || exit.requestedQuantity !== "2.02059643"
    || knowledge.value !== "true" || digestRows.length !== 1) throw new TypeError("BRO exit is not independently certified");
  const digestRow = record(digestRows[0], "BRO exit digest"); const stateDigest = String(digestRow.stateDigest ?? "");
  const providers = rows(digestRow.providers, "BRO exit providers").map(String).sort();
  const valuation = record(exit.valuation, "BRO exit valuation");
  if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length
    || valuation.completeExit !== true || valuation.grossDepthProceeds !== "0.00060617") throw new TypeError("BRO exit exact evidence is malformed");
  const distributions = [...input.distributions].sort((left, right) => left.source.historyIndex - right.source.historyIndex);
  if (distributions.length !== 2 || distributions.some((event) => event.source.account !== "emsenn0"
    || event.source.symbol !== "BRO" || event.source.payer !== "brodivs" || event.realization.asset !== "HIVE")
    || JSON.stringify(distributions.map((event) => event.source.historyIndex)) !== JSON.stringify([219288, 219529])) {
    throw new TypeError("cycle requires the two exact durable BRO distribution events");
  }
  const eventIds = Object.freeze(distributions.map((event) => event.eventId));
  const residue = input.procurementResidue.trim();
  if (residue !== "an A2A RMN operation must carry exactly one application/rmn+cbor raw part") throw new TypeError("procurement residue is not exact");
  const eventId = `urn:aagaard:asset-utility-cycle:${createHash("sha256").update(JSON.stringify([stateDigest, eventIds])).digest("base64url")}`;
  return Object.freeze({ assetUtilityCycleSchema: ASSET_UTILITY_CYCLE_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 36 as const, angle: "asset-utility-yield" as const, nextAngle: "product-revenue" as const }),
    position: Object.freeze({ account: "emsenn0" as const, symbol: "BRO" as const, payer: "brodivs" as const,
      quantity: "2.02059643" as const, settledDistributionEventIds: eventIds, settledDistributionCount: 2 as const,
      observedNativeHive: "0.006 HIVE" as const, latestDistributionAt: "2025-10-18T10:17:21.000Z" as const,
      historicalAnnualizedNativeHive: "0.156000 HIVE" as const, currentYieldClaim: false as const,
      exitStateDigest: stateDigest, exitProviders: Object.freeze(providers), completeDisplayedExitSwapHive: "0.00060617" as const }),
    decision: "preserve-bro-and-require-manual-review-of-stale-income" as const,
    capitalMoved: "0.00000000 SWAP.HIVE" as const, realizedCycleIncome: "0.000 HIVE" as const,
    credentialAccess: false as const, chainMutation: false as const,
    priorArt: Object.freeze([
      Object.freeze({ source: "src/core/incomeTokenSettlement.mts", adopted: "Recognize income only from exact beneficiary-bound native-HIVE transfers." }),
      Object.freeze({ source: "scripts/income-token-audit.mjs", adopted: "Require multi-provider history agreement and an exact payer per admitted symbol." }),
      Object.freeze({ source: "src/core/exitTightness.mts", adopted: "Carry complete displayed exit depth beside utility without treating it as realized profit." }),
    ]), procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue }) });
}

export async function recordAssetUtilityCycle(dataDir: string, input: Parameters<typeof assetUtilityCycleEvent>[0]) {
  const event = assetUtilityCycleEvent(input);
  const prior = ((await querySettlementRecords(ASSET_UTILITY_CYCLE_CATEGORY)) as readonly AssetUtilityCycleEvent[]).find((row) => row.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: ASSET_UTILITY_CYCLE_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readAssetUtilityCycles(dataDir: string): Promise<readonly AssetUtilityCycleEvent[]> {
  return Object.freeze((await querySettlementRecords(ASSET_UTILITY_CYCLE_CATEGORY)) as readonly AssetUtilityCycleEvent[]);
}
