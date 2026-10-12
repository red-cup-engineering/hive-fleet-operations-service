import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const MARKET_ASSAY_SCHEMA = "aagaard.market-assay-settlement.v1" as const;
export const MARKET_ASSAY_CATEGORY = "aagaard.market-assay-event" as const;

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";

interface CertifiedGlobalRefusal {
  readonly schema: "aagaard.global-arbitrage-scan.v1";
  readonly observedAt: string;
  readonly status: "certified";
  readonly providerKnowledge: Readonly<{ value: "true"; stateDigests: readonly Readonly<{ stateDigest: string; providers: readonly string[] }>[] }>;
  readonly admittedCount: 0;
  readonly credentialAccess: false;
  readonly chainMutation: false;
  readonly executionAdmissible: false;
  readonly refusal: string;
}

interface CertifiedPoolCycleRefusal {
  readonly kind: "aagaard.exact-pool-cycle-opportunity";
  readonly observedAt: string;
  readonly decision: "refuse";
  readonly credentialAccess: false;
  readonly chainMutation: false;
  readonly executionAdmissible: false;
  readonly refusal: string;
  readonly assay: Readonly<{ status: "certified"; providerKnowledge: Readonly<{ value: "true"; stateDigests: readonly Readonly<{ stateDigest: string; providers: readonly string[] }>[] }> }>;
}

export interface MarketAssaySettlementEvent {
  readonly marketAssaySchema: typeof MARKET_ASSAY_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 29; angle: "market-arbitrage" }>;
  readonly observations: Readonly<{
    global: Readonly<{ observedAt: string; stateDigest: string; certifyingProviders: readonly string[]; admittedCount: 0; refusal: string }>;
    fleetOrders: Readonly<{ observedAt: string; complete: true; accountCount: number; orderCount: 0; candidateCount: 0 }>;
    poolCycle: Readonly<{ observedAt: string; stateDigest: string; certifyingProviders: readonly string[]; decision: "refuse"; refusal: string }>;
  }>;
  readonly tradeBroadcast: false;
  readonly credentialAccess: false;
  readonly chainMutation: false;
  readonly capitalMoved: "0.00000000 SWAP.HIVE";
  readonly realizedProfit: "0.00000000 SWAP.HIVE";
  readonly receipts: Readonly<{ global: CertifiedGlobalRefusal; poolCycle: CertifiedPoolCycleRefusal }>;
}

function certifiedDigest(knowledge: Readonly<{ stateDigests: readonly Readonly<{ stateDigest: string; providers: readonly string[] }>[] }>, label: string) {
  if (knowledge.stateDigests.length !== 1) throw new TypeError(`${label} must contain exactly one certified state digest`);
  const row = knowledge.stateDigests[0]!;
  if (!/^sha256:[0-9a-f]{64}$/u.test(row.stateDigest) || new Set(row.providers).size < 2) {
    throw new TypeError(`${label} lacks independent exact-state support`);
  }
  return row;
}

function rmnSafe<T>(value: T): T {
  // Live adapter objects can carry optional properties whose JavaScript value
  // is undefined. RMN deliberately has no undefined carrier, so preserve the
  // JSON-visible receipt and omit those absent properties before settlement.
  return JSON.parse(JSON.stringify(value)) as T;
}

export function marketAssaySettlementEvent(input: Readonly<{
  global: CertifiedGlobalRefusal;
  poolCycle: CertifiedPoolCycleRefusal;
  fleetOrders: Readonly<{ observedAt: string; complete: true; accountCount: number; orderCount: 0; candidateCount: 0 }>;
  recordedAt?: string;
}>): MarketAssaySettlementEvent {
  if (input.global.status !== "certified" || input.global.providerKnowledge.value !== "true" || input.global.admittedCount !== 0
    || input.global.credentialAccess !== false || input.global.chainMutation !== false || input.global.executionAdmissible !== false) {
    throw new TypeError("global scan is not a certified non-mutating refusal");
  }
  if (input.poolCycle.assay.status !== "certified" || input.poolCycle.assay.providerKnowledge.value !== "true"
    || input.poolCycle.decision !== "refuse" || input.poolCycle.credentialAccess !== false
    || input.poolCycle.chainMutation !== false || input.poolCycle.executionAdmissible !== false) {
    throw new TypeError("pool-cycle assay is not a certified non-mutating refusal");
  }
  if (input.fleetOrders.complete !== true || input.fleetOrders.orderCount !== 0 || input.fleetOrders.candidateCount !== 0
    || !Number.isSafeInteger(input.fleetOrders.accountCount) || input.fleetOrders.accountCount < 1) {
    throw new TypeError("fleet-order evidence is incomplete or exposes a candidate");
  }
  const global = certifiedDigest(input.global.providerKnowledge, "global scan");
  const poolCycle = certifiedDigest(input.poolCycle.assay.providerKnowledge, "pool-cycle assay");
  const globalAt = new Date(input.global.observedAt).toISOString();
  const poolAt = new Date(input.poolCycle.observedAt).toISOString();
  const fleetAt = new Date(input.fleetOrders.observedAt).toISOString();
  const digest = createHash("sha256").update(JSON.stringify([globalAt, global.stateDigest, fleetAt,
    input.fleetOrders.accountCount, poolAt, poolCycle.stateDigest])).digest("base64url");
  return Object.freeze({ marketAssaySchema: MARKET_ASSAY_SCHEMA, eventId: `urn:aagaard:market-assay:${digest}`,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 29 as const, angle: "market-arbitrage" as const }),
    observations: Object.freeze({
      global: Object.freeze({ observedAt: globalAt, stateDigest: global.stateDigest,
        certifyingProviders: Object.freeze([...global.providers].sort()), admittedCount: 0 as const, refusal: input.global.refusal }),
      fleetOrders: Object.freeze({ observedAt: fleetAt, complete: true as const, accountCount: input.fleetOrders.accountCount,
        orderCount: 0 as const, candidateCount: 0 as const }),
      poolCycle: Object.freeze({ observedAt: poolAt, stateDigest: poolCycle.stateDigest,
        certifyingProviders: Object.freeze([...poolCycle.providers].sort()), decision: "refuse" as const, refusal: input.poolCycle.refusal }),
    }), tradeBroadcast: false as const, credentialAccess: false as const, chainMutation: false as const,
    capitalMoved: "0.00000000 SWAP.HIVE" as const, realizedProfit: "0.00000000 SWAP.HIVE" as const,
    receipts: Object.freeze({ global: rmnSafe(input.global), poolCycle: rmnSafe(input.poolCycle) }) });
}

export async function recordMarketAssaySettlement(dataDir: string, input: Parameters<typeof marketAssaySettlementEvent>[0]) {
  const event = marketAssaySettlementEvent(input);
  const prior = ((await querySettlementRecords(MARKET_ASSAY_CATEGORY)) as readonly MarketAssaySettlementEvent[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR, category: MARKET_ASSAY_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readMarketAssaySettlements(dataDir: string): Promise<readonly MarketAssaySettlementEvent[]> {
  return Object.freeze((await querySettlementRecords(MARKET_ASSAY_CATEGORY)) as readonly MarketAssaySettlementEvent[]);
}
