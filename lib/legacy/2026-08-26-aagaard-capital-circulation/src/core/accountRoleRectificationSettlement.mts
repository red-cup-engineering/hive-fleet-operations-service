import { createHash } from "node:crypto";
import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";
export const ACCOUNT_ROLE_RECTIFICATION_SCHEMA = "aagaard.account-role-rectification.v1" as const;
export const ACCOUNT_ROLE_RECTIFICATION_CATEGORY = "aagaard.account-role-rectification-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d"; const ACTOR = "urn:ame:aagaard";
const RESIDUE = "an A2A RMN operation must carry exactly one application/rmn+cbor raw part";
function record(value: unknown, label: string): Readonly<Record<string, unknown>> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Readonly<Record<string, unknown>>; }
export function accountRoleRectificationEvent(input: Readonly<{ merchant: Readonly<Record<string, unknown>>; editorial: Readonly<Record<string, unknown>>;
  monitor: Readonly<Record<string, unknown>>; procurementResidue: string; recordedAt?: string }>) {
  const merchant = input.merchant; const editorial = input.editorial; const monitor = input.monitor;
  if (merchant.exitValuePublicationSchema !== "aagaard.exit-value-service-publication.v1" || merchant.publicationKind !== "merchant"
    || merchant.account !== "help-fund" || merchant.target !== "help-fund/hive-engine-exit-value-report-pilot"
    || editorial.exitValuePublicationSchema !== "aagaard.exit-value-service-publication.v1" || editorial.publicationKind !== "editorial"
    || editorial.account !== "sigmund-vexler" || editorial.target !== "sigmund-vexler/your-hive-engine-balance-is-not-your-exit-value"
    || Number(editorial.block) <= Number(merchant.block)) throw new TypeError("role rectification lacks the ordered exact publications");
  const request = record(monitor.requestKnowledge, "merchant request knowledge"); const transfer = record(monitor.transferKnowledge, "merchant transfer knowledge");
  const ledger = record(monitor.commercialLedger, "merchant commercial ledger");
  if (monitor.kind !== "aagaard.exit-value-service-monitor" || monitor.merchant !== "help-fund" || monitor.publicationId !== merchant.publicationId
    || request.knowledge !== "true" || transfer.knowledge !== "true" || ledger.interestRequests !== 0 || ledger.incomingHbdTransfers !== 0
    || ledger.invoicesIssued !== 0 || ledger.settledPayments !== 0 || ledger.reportsDelivered !== 0 || ledger.revenue !== "0.000 HBD") {
    throw new TypeError("role rectification merchant state is not independently known and commercially honest");
  }
  if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");
  const eventId = `urn:aagaard:account-role-rectification:${createHash("sha256").update(JSON.stringify([merchant.publicationId, editorial.publicationId])).digest("base64url")}`;
  return Object.freeze({ accountRoleRectificationSchema: ACCOUNT_ROLE_RECTIFICATION_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
    roles: Object.freeze({ emsenn0: "curation-vote-only" as const, "sigmund-vexler": "editorial-publisher" as const,
      "help-fund": "service-merchant-request-invoice-payment-and-delivery-counterparty" as const }),
    historicalMispublication: Object.freeze({ target: "emsenn0/your-hive-engine-balance-is-not-your-exit-value" as const,
      treatment: "preserved-as-history-not-canonical-storefront" as const, productSignerRetired: true as const }),
    merchantPublicationId: String(merchant.publicationId), editorialPublicationId: String(editorial.publicationId),
    signerMechanism: "src/core/accountMutationRoles.mts#assertAccountMutationRole" as const,
    merchantMonitor: Object.freeze({ requests: 0 as const, incomingHbdTransfers: 0 as const, invoices: 0 as const,
      payments: 0 as const, deliveries: 0 as const, revenue: "0.000 HBD" as const }),
    credentialAccess: true as const, chainMutation: true as const,
    procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue: RESIDUE }) });
}
export async function recordAccountRoleRectification(dataDir: string, input: Parameters<typeof accountRoleRectificationEvent>[0]) {
  const event = accountRoleRectificationEvent(input); const prior = ((await querySettlementRecords(ACCOUNT_ROLE_RECTIFICATION_CATEGORY)) as readonly Readonly<Record<string, unknown>>[]).find((row) => row.eventId === event.eventId);
  if (prior) return prior; const agentUrl = process.env["RWIL_RDF_AGENT"]; if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT, actor: ACTOR,
    category: ACCOUNT_ROLE_RECTIFICATION_CATEGORY, recordedAt: event.recordedAt, record: event }); return event;
}
export async function readAccountRoleRectifications(dataDir: string) { return Object.freeze(await querySettlementRecords(ACCOUNT_ROLE_RECTIFICATION_CATEGORY)); }
