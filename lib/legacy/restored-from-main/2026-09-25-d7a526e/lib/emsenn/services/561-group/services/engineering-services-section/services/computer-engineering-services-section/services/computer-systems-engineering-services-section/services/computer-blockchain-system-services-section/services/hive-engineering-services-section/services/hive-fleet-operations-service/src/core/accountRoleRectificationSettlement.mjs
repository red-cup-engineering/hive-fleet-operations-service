import { claimsOf, witnessChainAct } from "./journal.mjs";
import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const ACCOUNT_ROLE_RECTIFICATION_SCHEMA = "aagaard.account-role-rectification.v1";
export const ACCOUNT_ROLE_RECTIFICATION_CATEGORY = "aagaard.account-role-rectification-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
const RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
export function accountRoleRectificationEvent(input) {
    const merchant = input.merchant;
    const editorial = input.editorial;
    const monitor = input.monitor;
    if (merchant.exitValuePublicationSchema !== "aagaard.exit-value-service-publication.v1" || merchant.publicationKind !== "merchant" || merchant.account !== "help-fund" || merchant.target !== "help-fund/hive-engine-exit-value-report-pilot" || editorial.exitValuePublicationSchema !== "aagaard.exit-value-service-publication.v1" || editorial.publicationKind !== "editorial" || editorial.account !== "sigmund-vexler" || editorial.target !== "sigmund-vexler/your-hive-engine-balance-is-not-your-exit-value" || Number(editorial.block) <= Number(merchant.block)) throw new TypeError("role rectification lacks the ordered exact publications");
    const request = record(monitor.requestKnowledge, "merchant request knowledge");
    const transfer = record(monitor.transferKnowledge, "merchant transfer knowledge");
    const ledger = record(monitor.commercialLedger, "merchant commercial ledger");
    if (monitor.kind !== "aagaard.exit-value-service-monitor" || monitor.merchant !== "help-fund" || monitor.publicationId !== merchant.publicationId || request.knowledge !== "true" || transfer.knowledge !== "true" || ledger.interestRequests !== 0 || ledger.incomingHbdTransfers !== 0 || ledger.invoicesIssued !== 0 || ledger.settledPayments !== 0 || ledger.reportsDelivered !== 0 || ledger.revenue !== "0.000 HBD") {
        throw new TypeError("role rectification merchant state is not independently known and commercially honest");
    }
    if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");
    const eventId = `urn:aagaard:account-role-rectification:${createHash("sha256").update(JSON.stringify([
        merchant.publicationId,
        editorial.publicationId
    ])).digest("base64url")}`;
    return Object.freeze({
        accountRoleRectificationSchema: ACCOUNT_ROLE_RECTIFICATION_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        roles: Object.freeze({
            emsenn0: "curation-vote-only",
            "sigmund-vexler": "editorial-publisher",
            "help-fund": "service-merchant-request-invoice-payment-and-delivery-counterparty"
        }),
        historicalMispublication: Object.freeze({
            target: "emsenn0/your-hive-engine-balance-is-not-your-exit-value",
            treatment: "preserved-as-history-not-canonical-storefront",
            productSignerRetired: true
        }),
        merchantPublicationId: String(merchant.publicationId),
        editorialPublicationId: String(editorial.publicationId),
        signerMechanism: "src/core/accountMutationRoles.mts#assertAccountMutationRole",
        merchantMonitor: Object.freeze({
            requests: 0,
            incomingHbdTransfers: 0,
            invoices: 0,
            payments: 0,
            deliveries: 0,
            revenue: "0.000 HBD"
        }),
        credentialAccess: true,
        chainMutation: true,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue: RESIDUE
        })
    });
}
async function composeAccountRoleRectification(_dataDir, input) {
    return accountRoleRectificationEvent(input);
}
/** Record AccountRoleRectification: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordAccountRoleRectification(dataDir, ...rest) {
    const result = await composeAccountRoleRectification(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, ACCOUNT_ROLE_RECTIFICATION_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readAccountRoleRectifications(dataDir) {
    return Object.freeze(claimsOf(dataDir, ACCOUNT_ROLE_RECTIFICATION_CATEGORY));
}
