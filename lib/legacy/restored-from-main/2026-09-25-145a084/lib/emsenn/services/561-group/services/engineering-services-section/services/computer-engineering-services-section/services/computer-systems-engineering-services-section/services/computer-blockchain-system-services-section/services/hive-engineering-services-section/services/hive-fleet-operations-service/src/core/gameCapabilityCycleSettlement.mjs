import { createHash } from "node:crypto";
import { claimsOf, recordClaim } from "./journal.mjs";
export const GAME_CAPABILITY_CYCLE_SCHEMA = "aagaard.game-capability-cycle.v1";
export const GAME_CAPABILITY_CYCLE_CATEGORY = "aagaard.game-capability-cycle-event";
function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
    return value;
}
function units3(value, label) {
    const text = String(value ?? "");
    if (!/^(?:0|[1-9][0-9]*)\.[0-9]{3}$/u.test(text)) throw new TypeError(`${label} must have exactly three decimals`);
    return BigInt(text.replace(".", ""));
}
export function gameCapabilityCycleEvent(claim, recordedAt = new Date().toISOString()) {
    if (claim.holozingRewardClaimSchema !== "aagaard.holozing-reward-claim.v1" || claim.status !== "claimed-confirmed" || claim.account !== "michael561" || claim.alphaVial1831Preserved !== true || claim.retryAllowed !== false || claim.realizedRevenue !== "0.000 HIVE" || claim.transactionId === null || claim.claimedZing === null) {
        throw new TypeError("cycle requires one confirmed protected HoloZing reward claim");
    }
    const receipt = record(claim.receipt, "claim receipt");
    const before = record(receipt.before, "pre-claim observation");
    const after = record(receipt.after, "post-claim observation");
    const beforeZing = record(before.zing, "pre-claim ZING");
    const afterZing = record(after.zing, "post-claim ZING");
    const beforePending = record(before.pending, "pre-claim pending");
    const afterPending = record(after.pending, "post-claim pending");
    const credential = record(receipt.credentialAccess, "credential access");
    if (credential.occurred !== true || credential.location !== "local-key-file" || credential.role !== "posting") {
        throw new TypeError("cycle claim lacks exact credential accountability");
    }
    const claimed = units3(claim.claimedZing, "claimed ZING");
    if (units3(afterZing.staked, "post-claim stake") - units3(beforeZing.staked, "pre-claim stake") !== claimed || units3(beforePending.total, "pre-claim pending") !== claimed || units3(afterPending.total, "post-claim pending") >= claimed) {
        throw new TypeError("cycle outcome does not bind the exact productive-state transition");
    }
    const eventId = `urn:aagaard:game-capability-cycle:${createHash("sha256").update(claim.eventId).digest("base64url")}`;
    return Object.freeze({
        gameCapabilityCycleSchema: GAME_CAPABILITY_CYCLE_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        cycle: Object.freeze({
            globalStep: 33,
            angle: "games-capability",
            nextAngle: "market-arbitrage"
        }),
        selection: Object.freeze({
            game: "holozing-rewards",
            action: "claim-pending-zing",
            formula: "max_lex(admitted,benefit-class,capital-risk-class,mutation-surface,credential-surface,stable-identity)",
            basis: "productive-state-dominates-resettable-learning-after-hard-admission"
        }),
        outcome: Object.freeze({
            claimEventId: claim.eventId,
            transactionId: claim.transactionId,
            claimedZing: claim.claimedZing,
            stakedBefore: String(beforeZing.staked),
            stakedAfter: String(afterZing.staked),
            pendingBefore: String(beforePending.total),
            pendingAfter: String(afterPending.total),
            alphaVial1831Preserved: true,
            retryAllowed: false
        }),
        capitalMoved: "0.000 HIVE",
        realizedRevenue: "0.000 HIVE",
        credentialAccess: Object.freeze({
            occurred: true,
            location: "local-key-file",
            role: "posting"
        }),
        chainMutation: true
    });
}
export async function recordGameCapabilityCycle(dataDir, claim, recordedAt) {
    const event = gameCapabilityCycleEvent(claim, recordedAt);
    const prior = claimsOf(dataDir, GAME_CAPABILITY_CYCLE_CATEGORY).find((candidate)=>candidate.eventId === event.eventId);
    if (prior) return prior;
    recordClaim(dataDir, GAME_CAPABILITY_CYCLE_CATEGORY, event.recordedAt, event);
    return event;
}
export async function readGameCapabilityCycles(dataDir) {
    return Object.freeze(claimsOf(dataDir, GAME_CAPABILITY_CYCLE_CATEGORY));
}
