import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const PRODUCT_REVENUE_CYCLE_SCHEMA = "aagaard.product-revenue-cycle.v1";
export const PRODUCT_REVENUE_CYCLE_CATEGORY = "aagaard.product-revenue-cycle-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
function exactProviders(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} providers are absent`);
    const providers = value.map(String);
    if (providers.length < 2 || new Set(providers).size !== providers.length || providers.some((provider)=>!provider.startsWith("https://"))) {
        throw new TypeError(`${label} lacks providers`);
    }
    return Object.freeze([
        ...providers
    ].sort());
}
function stateDigest(value, label) {
    const digest = String(value ?? "");
    if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw new TypeError(`${label} state digest is malformed`);
    return digest;
}
export function productRevenueCycleEvent(input) {
    const monitor = input.monitor;
    const plan = input.distributionPlan;
    if (monitor.kind !== "aagaard.exit-tightness-product-pilot-monitor" || monitor.credentialAccess !== false || monitor.chainMutation !== false) {
        throw new TypeError("product funnel monitor is not an exact non-mutating observation");
    }
    const request = record(monitor.requestKnowledge, "request knowledge");
    const transfer = record(monitor.transferKnowledge, "transfer knowledge");
    const commercial = record(monitor.commercialLedger, "commercial ledger");
    if (request.knowledge !== "true" || transfer.knowledge !== "true") throw new TypeError("product funnel evidence is not independently known");
    const requestProviders = exactProviders(request.providers, "request");
    const transferProviders = exactProviders(transfer.providers, "transfer");
    const requests = Array.isArray(request.requests) ? request.requests : null;
    const transfers = Array.isArray(transfer.transfers) ? transfer.transfers : null;
    if (!requests || !transfers || commercial.interestRequests !== requests.length || commercial.incomingHbdTransfers !== transfers.length || commercial.invoicesIssued !== 0 || commercial.settledPayments !== 0 || commercial.reportsDelivered !== 0 || commercial.revenue !== "0.000 HBD") {
        throw new TypeError("commercial funnel does not preserve zero-revenue settlement law");
    }
    if (plan.kind !== "aagaard.product-reblog-plan" || plan.credentialAccess !== false || plan.chainMutation !== false) {
        throw new TypeError("product distribution plan is not an exact non-mutating observation");
    }
    const evidence = record(plan.evidence, "distribution evidence");
    if (evidence.knowledge !== "true") throw new TypeError("product distribution evidence is not independently known");
    const distributionProviders = exactProviders(evidence.providers, "distribution");
    const decision = String(plan.decision ?? "");
    if (![
        "wait-for-rc-regeneration",
        "no-qualified-distribution-account",
        "reblog-one-exact-product-offer"
    ].includes(decision)) {
        throw new TypeError("product distribution decision is outside the admitted finite set");
    }
    const observedAt = new Date(String(monitor.observedAt)).toISOString();
    const distributionAt = new Date(String(plan.observedAt)).toISOString();
    const requestDigest = stateDigest(request.stateDigest, "request");
    const transferDigest = stateDigest(transfer.stateDigest, "transfer");
    const distributionDigest = stateDigest(evidence.stateDigest, "distribution");
    const selectedAccount = plan.selectedAccount === null ? null : String(plan.selectedAccount);
    const eligibleAt = plan.eligibleAt === null ? null : new Date(String(plan.eligibleAt)).toISOString();
    const eventId = `urn:aagaard:product-revenue-cycle:${createHash("sha256").update(JSON.stringify([
        requestDigest,
        transferDigest,
        distributionDigest,
        decision,
        selectedAccount,
        eligibleAt
    ])).digest("base64url")}`;
    return Object.freeze({
        productRevenueCycleSchema: PRODUCT_REVENUE_CYCLE_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 32,
            angle: "product-revenue",
            nextAngle: "games-capability"
        }),
        funnel: Object.freeze({
            observedAt,
            interestRequests: requests.length,
            incomingHbdTransfers: transfers.length,
            invoicesIssued: 0,
            settledPayments: 0,
            reportsDelivered: 0,
            realizedRevenue: "0.000 HBD",
            requestStateDigest: requestDigest,
            transferStateDigest: transferDigest,
            evidenceProviders: Object.freeze([
                ...new Set([
                    ...requestProviders,
                    ...transferProviders
                ])
            ].sort())
        }),
        distribution: Object.freeze({
            observedAt: distributionAt,
            decision,
            selectedAccount,
            eligibleAt,
            stateDigest: distributionDigest,
            evidenceProviders: distributionProviders
        }),
        decision: "preserve-offer-and-wait-for-rc-or-external-request",
        credentialAccess: false,
        chainMutation: false
    });
}
export async function recordProductRevenueCycle(_dataDir, input) {
    return productRevenueCycleEvent(input);
}
export async function readProductRevenueCycles(_dataDir) {
    throw new Error("zero-capital product-cycle reports are retired");
}
