import { witnessChainAct } from "./journal.mjs";
import { createHash } from "node:crypto";
import { EXIT_TIGHTNESS_PILOT_ACCOUNT, EXIT_TIGHTNESS_PILOT_BODY_SHA256, EXIT_TIGHTNESS_PILOT_MAX_REPORTS, EXIT_TIGHTNESS_PILOT_PERMLINK, EXIT_TIGHTNESS_PILOT_PRICE } from "./exitTightnessPilotPost.mjs";
export const PRODUCT_PILOT_SCHEMA = "aagaard.product-pilot-event.v1";
export const PRODUCT_PILOT_CATEGORY = "aagaard.product-pilot-event";
export function productPilotPublicationEvent(input) {
    if (!/^[0-9a-f]{40}$/.test(input.transactionId)) throw new TypeError("product pilot publication needs one canonical Hive transaction id");
    if (!Number.isSafeInteger(input.block) || input.block <= 0) throw new TypeError("product pilot publication needs one positive Hive block");
    const providers = [
        ...new Set(input.hiveProviders)
    ].sort();
    if (providers.length < 2 || providers.some((provider)=>!/^https:\/\//.test(provider))) {
        throw new TypeError("product pilot publication needs at least two distinct HTTPS Hive providers");
    }
    const recordedAt = new Date(input.recordedAt ?? new Date().toISOString()).toISOString();
    const digest = createHash("sha256").update(JSON.stringify([
        EXIT_TIGHTNESS_PILOT_ACCOUNT,
        EXIT_TIGHTNESS_PILOT_PERMLINK,
        input.transactionId
    ])).digest("base64url");
    return Object.freeze({
        productPilotSchema: PRODUCT_PILOT_SCHEMA,
        event: "offer-published",
        publicationId: `urn:aagaard:product-pilot-publication:${digest}`,
        recordedAt,
        account: EXIT_TIGHTNESS_PILOT_ACCOUNT,
        permlink: EXIT_TIGHTNESS_PILOT_PERMLINK,
        transactionId: input.transactionId,
        block: input.block,
        bodySha256: EXIT_TIGHTNESS_PILOT_BODY_SHA256,
        terms: Object.freeze({
            price: EXIT_TIGHTNESS_PILOT_PRICE,
            maximumPaidReports: EXIT_TIGHTNESS_PILOT_MAX_REPORTS,
            invoiceBeforePayment: true,
            revenueRecognized: "0.000 HBD"
        }),
        hiveProviders: Object.freeze(providers)
    });
}
async function composeProductPilotPublication(_dataDir, input) {
    const event = productPilotPublicationEvent(input);
    return event;
}
/** Record ProductPilotPublication: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordProductPilotPublication(dataDir, ...rest) {
    const result = await composeProductPilotPublication(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, PRODUCT_PILOT_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export function productPilotDistributionEvent(input) {
    if (!/^[0-9a-f]{40}$/u.test(input.transactionId)) throw new TypeError("product distribution needs one canonical Hive transaction id");
    const recordedAt = new Date(input.recordedAt ?? new Date().toISOString()).toISOString();
    const observedAt = new Date(input.observedAt).toISOString();
    if (!Number.isSafeInteger(input.followers) || input.followers < 10) throw new TypeError("product distribution needs a meaningful observed audience");
    if (!/^[1-9][0-9]*$/u.test(input.currentRc) || !/^[1-9][0-9]*$/u.test(input.requiredRc)) throw new TypeError("product distribution RC evidence is malformed");
    if (BigInt(input.currentRc) < BigInt(input.requiredRc)) throw new TypeError("product distribution RC reserve was not satisfied");
    const providers = [
        ...new Set(input.hiveProviders ?? [])
    ].sort();
    const block = input.block ?? null;
    if (input.status === "distributed-confirmed" && (!Number.isSafeInteger(block) || block === null || block <= 0 || providers.length < 2 || providers.some((provider)=>!/^https:\/\//u.test(provider)))) {
        throw new TypeError("confirmed product distribution needs one block and two Hive providers");
    }
    if (input.status === "settlement-pending" && (block !== null || providers.length !== 0)) {
        throw new TypeError("pending product distribution cannot carry invented confirmation evidence");
    }
    const digest = createHash("sha256").update(JSON.stringify([
        input.transactionId,
        input.status
    ])).digest("base64url");
    return Object.freeze({
        productPilotSchema: PRODUCT_PILOT_SCHEMA,
        event: "offer-distribution",
        distributionId: `urn:aagaard:product-pilot-distribution:${digest}`,
        recordedAt,
        status: input.status,
        account: "michael561",
        author: EXIT_TIGHTNESS_PILOT_ACCOUNT,
        permlink: EXIT_TIGHTNESS_PILOT_PERMLINK,
        transactionId: input.transactionId,
        block,
        hiveProviders: Object.freeze(providers),
        audience: Object.freeze({
            followers: input.followers,
            observedAt,
            currentRc: input.currentRc,
            requiredRc: input.requiredRc
        }),
        revenueRecognized: "0.000 HBD"
    });
}
async function composeProductPilotDistribution(_dataDir, input) {
    const event = productPilotDistributionEvent(input);
    return event;
}
/** Record ProductPilotDistribution: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordProductPilotDistribution(dataDir, ...rest) {
    const result = await composeProductPilotDistribution(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, PRODUCT_PILOT_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readProductPilotEvents(_dataDir) {
    throw new Error("product-pilot history is chain-derived; local projections are retired");
}
