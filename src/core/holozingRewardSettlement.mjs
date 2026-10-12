import { accountsWithLane } from "./accountStrategy.mjs";
import { decimalUnits } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { witnessChainAct } from "./journal.mjs";
import { assertPlainObject as object } from "./objectGuards.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const HOLOZING_REWARD_CLAIM_SCHEMA = "aagaard.holozing-reward-claim.v1";
export const HOLOZING_REWARD_CLAIM_CATEGORY = "aagaard.holozing-reward-claim-event";
const STATUSES = new Set([
    "claimed-confirmed",
    "claim-submission-unknown-do-not-retry",
    "claim-submitted-unreconciled-do-not-retry"
]);
function units3(value, label) {
    const text = String(value ?? "");
    if (!/\.[0-9]{3}$/u.test(text)) throw new TypeError(`${label} must have exactly three decimals`);
    return decimalUnits(text, 3);
}
function vial(observation, label) {
    const alpha = object(observation.alphaVials, `${label} Alpha Vials`);
    if (alpha.count !== 1 || JSON.stringify(alpha.ids) !== "[1831]" || alpha.disposition !== "preserved-unopened") {
        throw new TypeError(`${label} does not preserve Alpha Vial #1831`);
    }
}
function providers(value, label) {
    if (!Array.isArray(value) || value.length < 2) throw new TypeError(`${label} lacks witnesses`);
    const rows = value.map((row)=>object(row, label));
    const names = rows.map((row)=>String(row.node ?? ""));
    if (new Set(names).size !== names.length || names.some((name)=>!name.startsWith("https://"))) throw new TypeError(`${label} witnesses are malformed`);
    return rows;
}
export function holozingRewardClaimEvent(receipt, recordedAt = new Date().toISOString()) {
    if (receipt.kind !== "aagaard.holozing-reward-claim-receipt" || !accountsWithLane("holozing-rewards").includes(String(receipt.account ?? ""))) throw new TypeError("not the admitted HoloZing reward claim receipt");
    const status = String(receipt.status ?? "");
    if (!STATUSES.has(status) || receipt.retryAllowed !== false) throw new TypeError("HoloZing claim status is not durably recordable");
    const observedAt = new Date(String(receipt.observedAt ?? "")).toISOString();
    const before = object(receipt.before, "pre-claim observation");
    vial(before, "pre-claim observation");
    providers(receipt.providers, "pre-claim balance");
    const pending = object(before.pending, "pre-claim pending rewards");
    const zing = object(before.zing, "pre-claim ZING balance");
    const plan = object(receipt.plan, "claim plan");
    if (plan.kind !== "ready" || units3(plan.minimumClaimZing, "planned claim") !== units3(pending.total, "pending reward total") || units3(pending.total, "pending reward total") < 1_000n) throw new TypeError("claim receipt is not bound to an eligible exact reward total");
    const transactionText = receipt.transactionId === undefined ? "" : String(receipt.transactionId);
    const transactionId = transactionText === "" ? null : transactionText;
    if (transactionId !== null && !/^[0-9a-f]{40}$/iu.test(transactionId)) throw new TypeError("HoloZing claim transaction id is malformed");
    let claimedZing = null;
    if (status === "claimed-confirmed") {
        if (transactionId === null) throw new TypeError("confirmed HoloZing claim lacks a transaction id");
        claimedZing = String(receipt.claimedZing ?? "");
        const claimed = units3(claimedZing, "claimed ZING");
        if (claimed !== units3(pending.total, "pending reward total")) throw new TypeError("confirmed HoloZing claim differs from the planned reward total");
        const confirmations = providers(receipt.engineConfirmations, "claim execution");
        const blocks = confirmations.map((row)=>Number(row.blockNumber));
        if (blocks.some((block)=>!Number.isSafeInteger(block) || block <= 0) || new Set(blocks).size !== 1) throw new TypeError("claim execution witnesses disagree on one block");
        if (!Array.isArray(receipt.stakeEvents) || receipt.stakeEvents.length < 1) throw new TypeError("confirmed claim has no exact stake events");
        let eventTotal = 0n;
        for (const value of receipt.stakeEvents){
            const row = object(value, "claim stake event");
            if (!String(row.childTransactionId ?? "").startsWith(`${transactionId}-`) || Number(row.blockNumber) !== blocks[0] || !String(row.memo ?? "").startsWith("Your claim for ")) throw new TypeError("claim stake event does not bind the parent transaction");
            eventTotal += units3(row.quantity, "stake event quantity");
        }
        if (eventTotal !== claimed) throw new TypeError("claim stake events do not sum to claimed ZING");
        const after = object(receipt.after, "post-claim observation");
        vial(after, "post-claim observation");
        const afterZing = object(after.zing, "post-claim ZING balance");
        const afterPending = object(after.pending, "post-claim pending rewards");
        if (units3(afterZing.liquid, "post-claim liquid ZING") !== units3(zing.liquid, "pre-claim liquid ZING") || units3(afterZing.staked, "post-claim staked ZING") - units3(zing.staked, "pre-claim staked ZING") !== claimed || units3(afterPending.total, "post-claim pending rewards") >= units3(pending.total, "pre-claim pending rewards")) {
            throw new TypeError("confirmed HoloZing claim does not satisfy the exact balance and pending-reward effects");
        }
    }
    const identity = transactionId ?? observedAt;
    const eventId = `urn:aagaard:holozing-reward-claim:${niUriDigest(semanticId([
        identity,
        status
    ]))}`;
    return Object.freeze({
        holozingRewardClaimSchema: HOLOZING_REWARD_CLAIM_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        account: receipt.account,
        status,
        transactionId,
        claimedZing,
        alphaVial1831Preserved: true,
        retryAllowed: false,
        realizedRevenue: "0.000 HIVE",
        receipt: JSON.parse(JSON.stringify(receipt))
    });
}
async function composeHolozingRewardClaim(_dataDir, receipt, recordedAt) {
    const event = holozingRewardClaimEvent(receipt, recordedAt);
    return event;
}
/** Record HolozingRewardClaim: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordHolozingRewardClaim(dataDir, ...rest) {
    const result = await composeHolozingRewardClaim(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, HOLOZING_REWARD_CLAIM_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readHolozingRewardClaims(_dataDir) {
    throw new Error("HoloZing claim history is chain-derived; local projections are retired");
}
