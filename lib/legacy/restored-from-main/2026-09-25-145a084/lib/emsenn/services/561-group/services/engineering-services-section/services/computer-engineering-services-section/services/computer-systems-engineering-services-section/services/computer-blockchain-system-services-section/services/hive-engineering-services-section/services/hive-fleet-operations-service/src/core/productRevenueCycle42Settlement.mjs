import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const PRODUCT_REVENUE_CYCLE_42_SCHEMA = "aagaard.product-revenue-cycle-42.v1";
export const PRODUCT_REVENUE_CYCLE_42_CATEGORY = "aagaard.product-revenue-cycle-42-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
const RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function providers(value, label) {
    const result = rows(value, `${label} providers`).map(String).sort();
    if (result.length < 2 || new Set(result).size !== result.length || result.some((row)=>!row.startsWith("https://"))) throw new TypeError(`${label} lacks providers`);
    return Object.freeze(result);
}
function digest(value, label) {
    const text = String(value ?? "");
    if (!/^sha256:[0-9a-f]{64}$/u.test(text)) throw new TypeError(`${label} digest is malformed`);
    return text;
}
export function productRevenueCycle42Event(input) {
    const monitor = input.monitor;
    const commercial = record(monitor.commercialLedger, "commercial ledger");
    const requests = record(monitor.requestKnowledge, "request knowledge");
    const transfers = record(monitor.transferKnowledge, "transfer knowledge");
    if (monitor.kind !== "aagaard.exit-tightness-product-pilot-monitor" || monitor.credentialAccess !== false || monitor.chainMutation !== false || requests.knowledge !== "true" || transfers.knowledge !== "true" || rows(requests.requests, "interest requests").length !== 0 || rows(transfers.transfers, "incoming transfers").length !== 0 || commercial.interestRequests !== 0 || commercial.incomingHbdTransfers !== 0 || commercial.invoicesIssued !== 0 || commercial.settledPayments !== 0 || commercial.reportsDelivered !== 0 || commercial.revenue !== "0.000 HBD" || commercial.pilotPrice !== "0.250 HBD") {
        throw new TypeError("cycle 42 commercial funnel is not the exact zero-revenue pilot state");
    }
    const delegation = input.delegation;
    if (delegation.directRcDelegationSchema !== "aagaard.direct-rc-delegation.v1" || delegation.status !== "delegation-confirmed" || delegation.from !== "help-fund" || delegation.to !== "michael561" || delegation.amountRc !== "1618000000" || !/^[0-9a-f]{40}$/u.test(String(delegation.transactionId)) || !Number.isSafeInteger(Number(delegation.block)) || Number(delegation.block) <= 0 || delegation.credentialAccess !== true || delegation.chainMutation !== true || delegation.retryAllowed !== false) throw new TypeError("cycle 42 lacks the exact confirmed direct-RC allocation");
    const delegationProviders = providers(delegation.delegationProviders, "delegation state");
    providers(delegation.hiveProviders, "delegation transaction");
    const distribution = input.distribution;
    if (distribution.productPilotSchema !== "aagaard.product-pilot-event.v1" || distribution.event !== "offer-distribution" || distribution.status !== "distributed-confirmed" || distribution.account !== "michael561" || distribution.audience.followers !== 21 || BigInt(distribution.audience.currentRc) < BigInt(distribution.audience.requiredRc) || distribution.revenueRecognized !== "0.000 HBD" || distribution.block === null || distribution.block <= Number(delegation.block) || !/^[0-9a-f]{40}$/u.test(distribution.transactionId)) {
        throw new TypeError("cycle 42 lacks the exact confirmed product distribution");
    }
    const distributionProviders = providers(distribution.hiveProviders, "distribution transaction");
    if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");
    const requestDigest = digest(requests.stateDigest, "request");
    const transferDigest = digest(transfers.stateDigest, "transfer");
    const eventId = `urn:aagaard:product-revenue-cycle-42:${createHash("sha256").update(JSON.stringify([
        delegation.eventId,
        distribution.distributionId,
        requestDigest,
        transferDigest
    ])).digest("base64url")}`;
    return Object.freeze({
        productRevenueCycle42Schema: PRODUCT_REVENUE_CYCLE_42_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 42,
            angle: "product-revenue",
            nextAngle: "games-capability"
        }),
        funnel: Object.freeze({
            price: "0.250 HBD",
            interestRequests: 0,
            incomingHbdTransfers: 0,
            invoicesIssued: 0,
            settledPayments: 0,
            reportsDelivered: 0,
            realizedRevenue: "0.000 HBD",
            requestStateDigest: requestDigest,
            transferStateDigest: transferDigest
        }),
        resourceAllocation: Object.freeze({
            eventId: String(delegation.eventId),
            transactionId: String(delegation.transactionId),
            block: Number(delegation.block),
            from: "help-fund",
            to: "michael561",
            amountRc: "1618000000",
            providers: delegationProviders,
            liquidCapitalMoved: false
        }),
        distribution: Object.freeze({
            distributionId: distribution.distributionId,
            transactionId: distribution.transactionId,
            block: distribution.block,
            account: "michael561",
            followers: 21,
            providers: distributionProviders,
            revenueRecognized: "0.000 HBD"
        }),
        decision: "reallocate-idle-rc-and-distribute-one-existing-invoice-first-offer",
        capitalMoved: Object.freeze({
            hive: "0.000 HIVE",
            hbd: "0.000 HBD",
            tokens: false
        }),
        credentialAccess: true,
        chainMutation: true,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue: RESIDUE
        })
    });
}
export async function recordProductRevenueCycle42(_dataDir, input) {
    return productRevenueCycle42Event(input);
}
export async function readProductRevenueCycle42(_dataDir) {
    throw new Error("zero-capital product-cycle reports are retired");
}
