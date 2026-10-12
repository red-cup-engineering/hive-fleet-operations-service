import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const PRODUCT_REVENUE_CYCLE_37_SCHEMA = "aagaard.product-revenue-cycle-37.v1";
export const PRODUCT_REVENUE_CYCLE_37_CATEGORY = "aagaard.product-revenue-cycle-37-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function providers(value, label) {
    const result = rows(value, `${label} providers`).map(String).sort();
    if (result.length < 2 || new Set(result).size !== result.length || result.some((entry)=>!entry.startsWith("https://"))) {
        throw new TypeError(`${label} lacks providers`);
    }
    return Object.freeze(result);
}
function digest(value, label) {
    const result = String(value ?? "");
    if (!/^sha256:[0-9a-f]{64}$/u.test(result)) throw new TypeError(`${label} digest is malformed`);
    return result;
}
export function productRevenueCycle37Event(input) {
    const monitor = input.monitor;
    const plan = input.distributionPlan;
    if (monitor.kind !== "aagaard.exit-tightness-product-pilot-monitor" || monitor.credentialAccess !== false || monitor.chainMutation !== false) {
        throw new TypeError("cycle 37 requires the exact read-only product monitor");
    }
    const publication = record(monitor.publication, "publication");
    const request = record(monitor.requestKnowledge, "request knowledge");
    const transfer = record(monitor.transferKnowledge, "transfer knowledge");
    const commercial = record(monitor.commercialLedger, "commercial ledger");
    if (publication.account !== "emsenn0" || publication.permlink !== "your-hive-engine-balance-is-not-your-exit-value" || request.knowledge !== "true" || transfer.knowledge !== "true" || rows(request.requests, "interest requests").length !== 0 || rows(transfer.transfers, "incoming HBD transfers").length !== 0 || commercial.interestRequests !== 0 || commercial.incomingHbdTransfers !== 0 || commercial.invoicesIssued !== 0 || commercial.settledPayments !== 0 || commercial.reportsDelivered !== 0 || commercial.revenue !== "0.000 HBD" || commercial.pilotPrice !== "0.250 HBD") throw new TypeError("commercial funnel is not the exact zero-revenue pilot state");
    const availableRows = rows(monitor.providerRows, "product provider rows").map((entry)=>record(entry, "product provider row")).filter((entry)=>entry.available === true);
    const engagementGroups = new Map();
    for (const row of availableRows){
        const engagement = record(row.engagement, "product engagement");
        const key = JSON.stringify(engagement);
        const group = engagementGroups.get(key) ?? {
            value: engagement,
            providers: []
        };
        group.providers.push(String(row.node));
        engagementGroups.set(key, group);
    }
    if (engagementGroups.size !== 1) throw new TypeError("product engagement witnesses contradict one another");
    const engagementGroup = [
        ...engagementGroups.values()
    ][0];
    if (!engagementGroup || engagementGroup.providers.length < 2) throw new TypeError("product engagement lacks independent support");
    const engagement = engagementGroup.value;
    const activeVotes = Number(engagement.activeVotes);
    const children = Number(engagement.children);
    const pendingPayout = String(engagement.pendingPayout ?? "");
    if (!Number.isSafeInteger(activeVotes) || activeVotes < 1 || children !== 0 || engagement.paidOut !== false || !/^(?:0|[1-9][0-9]*)\.[0-9]{3} HBD$/u.test(pendingPayout)) throw new TypeError("product engagement is malformed or outside the active pilot");
    if (plan.kind !== "aagaard.product-reblog-plan" || plan.decision !== "wait-for-rc-regeneration" || plan.selectedAccount !== "michael561" || plan.credentialAccess !== false || plan.chainMutation !== false) {
        throw new TypeError("cycle 37 requires an exact RC-gated michael561 distribution wait");
    }
    const candidate = rows(plan.candidates, "distribution candidates").map((entry)=>record(entry, "distribution candidate")).find((entry)=>entry.account === "michael561");
    if (!candidate || candidate.followers !== 21 || candidate.meaningfulAudience !== true || candidate.authorSelfReblog !== false || candidate.alreadyReblogged !== false || candidate.rcReserveSatisfied !== false || candidate.eligibleNow !== false) {
        throw new TypeError("michael561 is not the exact deferred distribution candidate");
    }
    const currentRc = BigInt(String(candidate.currentRc));
    const requiredRc = BigInt(String(candidate.requiredRc));
    const observedAt = new Date(String(plan.observedAt)).toISOString();
    const eligibleAt = new Date(String(plan.eligibleAt)).toISOString();
    if (currentRc >= requiredRc || Date.parse(eligibleAt) <= Date.parse(observedAt)) throw new TypeError("distribution wait is not proved by RC and time");
    const evidence = record(plan.evidence, "distribution evidence");
    if (evidence.knowledge !== "true") throw new TypeError("distribution evidence is not independently known");
    const distributionProviders = providers(evidence.providers, "distribution");
    const stateDigest = digest(evidence.stateDigest, "distribution");
    const residue = input.procurementResidue.trim();
    if (residue !== "an A2A SEN operation must carry exactly one application/sen+cbor raw part") throw new TypeError("procurement residue is not exact");
    const eventId = `urn:aagaard:product-revenue-cycle-37:${createHash("sha256").update(JSON.stringify([
        digest(request.stateDigest, "request"),
        digest(transfer.stateDigest, "transfer"),
        stateDigest,
        engagement,
        eligibleAt
    ])).digest("base64url")}`;
    return Object.freeze({
        productRevenueCycle37Schema: PRODUCT_REVENUE_CYCLE_37_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 37,
            angle: "product-revenue",
            nextAngle: "games-capability"
        }),
        offer: Object.freeze({
            account: "emsenn0",
            permlink: "your-hive-engine-balance-is-not-your-exit-value",
            price: "0.250 HBD",
            interestRequests: 0,
            incomingHbdTransfers: 0,
            invoicesIssued: 0,
            settledPayments: 0,
            reportsDelivered: 0,
            realizedRevenue: "0.000 HBD"
        }),
        engagement: Object.freeze({
            activeVotes,
            children: 0,
            pendingAuthorPayout: pendingPayout,
            paidOut: false,
            pendingAuthorPayoutRecognizedAsRevenue: false,
            providers: Object.freeze([
                ...engagementGroup.providers
            ].sort())
        }),
        distribution: Object.freeze({
            decision: "wait-for-rc-regeneration",
            account: "michael561",
            followers: 21,
            currentRc: currentRc.toString(),
            requiredRc: requiredRc.toString(),
            eligibleAt,
            stateDigest,
            providers: distributionProviders,
            broadcast: false
        }),
        decision: "preserve-one-pilot-defer-reblog-and-build-no-second-sku",
        deferredTrigger: "reobserve-and-reblog-only-after-rc-gate",
        capitalMoved: "0.000 HBD",
        credentialAccess: false,
        chainMutation: false,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue
        })
    });
}
export async function recordProductRevenueCycle37(_dataDir, input) {
    return productRevenueCycle37Event(input);
}
export async function readProductRevenueCycle37(_dataDir) {
    throw new Error("zero-capital product-cycle reports are retired");
}
