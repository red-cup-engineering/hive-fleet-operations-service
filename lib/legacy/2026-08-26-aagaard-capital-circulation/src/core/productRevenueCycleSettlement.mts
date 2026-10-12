import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const PRODUCT_REVENUE_CYCLE_SCHEMA = "aagaard.product-revenue-cycle.v1" as const;
export const PRODUCT_REVENUE_CYCLE_CATEGORY = "aagaard.product-revenue-cycle-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface ProductRevenueCycleEvent {
  readonly productRevenueCycleSchema: typeof PRODUCT_REVENUE_CYCLE_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly cycle: Readonly<{ globalStep: 32; angle: "product-revenue"; nextAngle: "games-capability" }>;
  readonly funnel: Readonly<{ observedAt: string; interestRequests: number; incomingHbdTransfers: number;
    invoicesIssued: 0; settledPayments: 0; reportsDelivered: 0; realizedRevenue: "0.000 HBD";
    requestStateDigest: string; transferStateDigest: string; evidenceProviders: readonly string[] }>;
  readonly distribution: Readonly<{ observedAt: string; decision: string; selectedAccount: string | null;
    eligibleAt: string | null; stateDigest: string; evidenceProviders: readonly string[] }>;
  readonly decision: "preserve-offer-and-wait-for-rc-or-external-request";
  readonly credentialAccess: false;
  readonly chainMutation: false;
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function exactProviders(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} providers are absent`);
  const providers = value.map(String);
  if (providers.length < 2 || new Set(providers).size !== providers.length || providers.some((provider) => !provider.startsWith("https://"))) {
    throw new TypeError(`${label} lacks independent providers`);
  }
  return Object.freeze([...providers].sort());
}
function stateDigest(value: unknown, label: string): string {
  const digest = String(value ?? "");
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw new TypeError(`${label} state digest is malformed`);
  return digest;
}

export function productRevenueCycleEvent(input: Readonly<{ monitor: Readonly<Record<string, unknown>>;
  distributionPlan: Readonly<Record<string, unknown>>; recordedAt?: string }>): ProductRevenueCycleEvent {
  const monitor = input.monitor; const plan = input.distributionPlan;
  if (monitor.kind !== "aagaard.exit-tightness-product-pilot-monitor" || monitor.credentialAccess !== false || monitor.chainMutation !== false) {
    throw new TypeError("product funnel monitor is not an exact non-mutating observation");
  }
  const request = record(monitor.requestKnowledge, "request knowledge"); const transfer = record(monitor.transferKnowledge, "transfer knowledge");
  const commercial = record(monitor.commercialLedger, "commercial ledger");
  if (request.knowledge !== "true" || transfer.knowledge !== "true") throw new TypeError("product funnel evidence is not independently known");
  const requestProviders = exactProviders(request.providers, "request"); const transferProviders = exactProviders(transfer.providers, "transfer");
  const requests = Array.isArray(request.requests) ? request.requests : null; const transfers = Array.isArray(transfer.transfers) ? transfer.transfers : null;
  if (!requests || !transfers || commercial.interestRequests !== requests.length || commercial.incomingHbdTransfers !== transfers.length
    || commercial.invoicesIssued !== 0 || commercial.settledPayments !== 0 || commercial.reportsDelivered !== 0 || commercial.revenue !== "0.000 HBD") {
    throw new TypeError("commercial funnel does not preserve zero-revenue settlement law");
  }
  if (plan.kind !== "aagaard.product-reblog-plan" || plan.credentialAccess !== false || plan.chainMutation !== false) {
    throw new TypeError("product distribution plan is not an exact non-mutating observation");
  }
  const evidence = record(plan.evidence, "distribution evidence");
  if (evidence.knowledge !== "true") throw new TypeError("product distribution evidence is not independently known");
  const distributionProviders = exactProviders(evidence.providers, "distribution");
  const decision = String(plan.decision ?? "");
  if (!["wait-for-rc-regeneration", "no-qualified-distribution-account", "reblog-one-exact-product-offer"].includes(decision)) {
    throw new TypeError("product distribution decision is outside the admitted finite set");
  }
  const observedAt = new Date(String(monitor.observedAt)).toISOString(); const distributionAt = new Date(String(plan.observedAt)).toISOString();
  const requestDigest = stateDigest(request.stateDigest, "request"); const transferDigest = stateDigest(transfer.stateDigest, "transfer");
  const distributionDigest = stateDigest(evidence.stateDigest, "distribution");
  const selectedAccount = plan.selectedAccount === null ? null : String(plan.selectedAccount);
  const eligibleAt = plan.eligibleAt === null ? null : new Date(String(plan.eligibleAt)).toISOString();
  const eventId = `urn:aagaard:product-revenue-cycle:${createHash("sha256").update(JSON.stringify([
    requestDigest, transferDigest, distributionDigest, decision, selectedAccount, eligibleAt,
  ])).digest("base64url")}`;
  return Object.freeze({ productRevenueCycleSchema: PRODUCT_REVENUE_CYCLE_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 32 as const, angle: "product-revenue" as const, nextAngle: "games-capability" as const }),
    funnel: Object.freeze({ observedAt, interestRequests: requests.length, incomingHbdTransfers: transfers.length,
      invoicesIssued: 0 as const, settledPayments: 0 as const, reportsDelivered: 0 as const, realizedRevenue: "0.000 HBD" as const,
      requestStateDigest: requestDigest, transferStateDigest: transferDigest,
      evidenceProviders: Object.freeze([...new Set([...requestProviders, ...transferProviders])].sort()) }),
    distribution: Object.freeze({ observedAt: distributionAt, decision, selectedAccount, eligibleAt,
      stateDigest: distributionDigest, evidenceProviders: distributionProviders }),
    decision: "preserve-offer-and-wait-for-rc-or-external-request" as const,
    credentialAccess: false as const, chainMutation: false as const });
}

export async function recordProductRevenueCycle(dataDir: string, input: Parameters<typeof productRevenueCycleEvent>[0]) {
  const event = productRevenueCycleEvent(input);
  const prior = ((await querySettlementRecords(PRODUCT_REVENUE_CYCLE_CATEGORY)) as readonly ProductRevenueCycleEvent[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: PRODUCT_REVENUE_CYCLE_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readProductRevenueCycles(dataDir: string): Promise<readonly ProductRevenueCycleEvent[]> {
  return Object.freeze((await querySettlementRecords(PRODUCT_REVENUE_CYCLE_CATEGORY)) as readonly ProductRevenueCycleEvent[]);
}
