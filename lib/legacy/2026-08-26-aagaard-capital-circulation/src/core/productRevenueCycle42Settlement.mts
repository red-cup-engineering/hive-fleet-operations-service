import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";
import type { ProductPilotDistributionEvent } from "./productPilotSettlement.mts";

export const PRODUCT_REVENUE_CYCLE_42_SCHEMA = "aagaard.product-revenue-cycle-42.v1" as const;
export const PRODUCT_REVENUE_CYCLE_42_CATEGORY = "aagaard.product-revenue-cycle-42-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d"; const ACTOR = "urn:ame:aagaard";
const RESIDUE = "an A2A RMN operation must carry exactly one application/rmn+cbor raw part";

function record(value: unknown, label: string): Readonly<Record<string, unknown>> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Readonly<Record<string, unknown>>; }
function rows(value: unknown, label: string): readonly unknown[] { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return value; }
function providers(value: unknown, label: string): readonly string[] { const result = rows(value, `${label} providers`).map(String).sort();
  if (result.length < 2 || new Set(result).size !== result.length || result.some((row) => !row.startsWith("https://"))) throw new TypeError(`${label} lacks independent providers`); return Object.freeze(result); }
function digest(value: unknown, label: string) { const text = String(value ?? ""); if (!/^sha256:[0-9a-f]{64}$/u.test(text)) throw new TypeError(`${label} digest is malformed`); return text; }

export function productRevenueCycle42Event(input: Readonly<{ monitor: Readonly<Record<string, unknown>>;
  delegation: Readonly<Record<string, unknown>>; distribution: ProductPilotDistributionEvent;
  procurementResidue: string; recordedAt?: string }>) {
  const monitor = input.monitor; const commercial = record(monitor.commercialLedger, "commercial ledger");
  const requests = record(monitor.requestKnowledge, "request knowledge"); const transfers = record(monitor.transferKnowledge, "transfer knowledge");
  if (monitor.kind !== "aagaard.exit-tightness-product-pilot-monitor" || monitor.credentialAccess !== false || monitor.chainMutation !== false
    || requests.knowledge !== "true" || transfers.knowledge !== "true" || rows(requests.requests, "interest requests").length !== 0
    || rows(transfers.transfers, "incoming transfers").length !== 0 || commercial.interestRequests !== 0
    || commercial.incomingHbdTransfers !== 0 || commercial.invoicesIssued !== 0 || commercial.settledPayments !== 0
    || commercial.reportsDelivered !== 0 || commercial.revenue !== "0.000 HBD" || commercial.pilotPrice !== "0.250 HBD") {
    throw new TypeError("cycle 42 commercial funnel is not the exact zero-revenue pilot state");
  }
  const delegation = input.delegation;
  if (delegation.directRcDelegationSchema !== "aagaard.direct-rc-delegation.v1" || delegation.status !== "delegation-confirmed"
    || delegation.from !== "help-fund" || delegation.to !== "michael561" || delegation.amountRc !== "1618000000"
    || !/^[0-9a-f]{40}$/u.test(String(delegation.transactionId)) || !Number.isSafeInteger(Number(delegation.block))
    || Number(delegation.block) <= 0 || delegation.credentialAccess !== true || delegation.chainMutation !== true
    || delegation.retryAllowed !== false) throw new TypeError("cycle 42 lacks the exact confirmed direct-RC allocation");
  const delegationProviders = providers(delegation.delegationProviders, "delegation state");
  providers(delegation.hiveProviders, "delegation transaction");
  const distribution = input.distribution;
  if (distribution.productPilotSchema !== "aagaard.product-pilot-event.v1" || distribution.event !== "offer-distribution"
    || distribution.status !== "distributed-confirmed" || distribution.account !== "michael561"
    || distribution.audience.followers !== 21 || BigInt(distribution.audience.currentRc) < BigInt(distribution.audience.requiredRc)
    || distribution.revenueRecognized !== "0.000 HBD" || distribution.block === null
    || distribution.block <= Number(delegation.block) || !/^[0-9a-f]{40}$/u.test(distribution.transactionId)) {
    throw new TypeError("cycle 42 lacks the exact confirmed product distribution");
  }
  const distributionProviders = providers(distribution.hiveProviders, "distribution transaction");
  if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");
  const requestDigest = digest(requests.stateDigest, "request"); const transferDigest = digest(transfers.stateDigest, "transfer");
  const eventId = `urn:aagaard:product-revenue-cycle-42:${createHash("sha256").update(JSON.stringify([
    delegation.eventId, distribution.distributionId, requestDigest, transferDigest,
  ])).digest("base64url")}`;
  return Object.freeze({ productRevenueCycle42Schema: PRODUCT_REVENUE_CYCLE_42_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    cycle: Object.freeze({ globalStep: 42 as const, angle: "product-revenue" as const, nextAngle: "games-capability" as const }),
    funnel: Object.freeze({ price: "0.250 HBD" as const, interestRequests: 0 as const, incomingHbdTransfers: 0 as const,
      invoicesIssued: 0 as const, settledPayments: 0 as const, reportsDelivered: 0 as const, realizedRevenue: "0.000 HBD" as const,
      requestStateDigest: requestDigest, transferStateDigest: transferDigest }),
    resourceAllocation: Object.freeze({ eventId: String(delegation.eventId), transactionId: String(delegation.transactionId),
      block: Number(delegation.block), from: "help-fund" as const, to: "michael561" as const, amountRc: "1618000000" as const,
      providers: delegationProviders, liquidCapitalMoved: false as const }),
    distribution: Object.freeze({ distributionId: distribution.distributionId, transactionId: distribution.transactionId,
      block: distribution.block, account: "michael561" as const, followers: 21 as const, providers: distributionProviders,
      revenueRecognized: "0.000 HBD" as const }),
    decision: "reallocate-idle-rc-and-distribute-one-existing-invoice-first-offer" as const,
    capitalMoved: Object.freeze({ hive: "0.000 HIVE" as const, hbd: "0.000 HBD" as const, tokens: false as const }),
    credentialAccess: true as const, chainMutation: true as const,
    procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue: RESIDUE }) });
}

export async function recordProductRevenueCycle42(dataDir: string, input: Parameters<typeof productRevenueCycle42Event>[0]) {
  const event = productRevenueCycle42Event(input); const prior = ((await querySettlementRecords(PRODUCT_REVENUE_CYCLE_42_CATEGORY)) as readonly Readonly<Record<string, unknown>>[])
    .find((candidate) => candidate.eventId === event.eventId); if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"]; if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT, actor: ACTOR,
    category: PRODUCT_REVENUE_CYCLE_42_CATEGORY, recordedAt: event.recordedAt, record: event }); return event;
}
export async function readProductRevenueCycle42(dataDir: string) { return Object.freeze(await querySettlementRecords(PRODUCT_REVENUE_CYCLE_42_CATEGORY)); }
