import { witnessChainAct } from "./journal.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const HOLOZING_WILDS_SESSION_SCHEMA = "aagaard.holozing-wilds-session.v1";
export const HOLOZING_WILDS_SESSION_CATEGORY = "aagaard.holozing-wilds-session-event";
function finite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
    return number;
}
function validateReceipt(receipt) {
    if (receipt.kind !== "aagaard.holozing-wilds-receipt" || receipt.authenticated !== true) throw new TypeError("not an authenticated HoloZing Wilds receipt");
    const account = String(receipt.account ?? "");
    if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(account)) throw new TypeError("Wilds receipt account is not canonical");
    if (receipt.nftStarterSelected !== false) throw new TypeError("Wilds receipt does not prove that no NFT starter was selected");
    const reconciliation = receipt.reconciliation;
    if (reconciliation?.confirmed !== true || reconciliation.reserveRetained !== true || reconciliation.captureActionsSettled !== true) {
        throw new TypeError("Wilds receipt is not independently reconciled and reserve-safe");
    }
    const captures = finite(receipt.captureActionsSent, "capture action count");
    if (!Number.isSafeInteger(captures) || captures < 0 || captures > 3) throw new TypeError("Wilds capture count is outside the bounded operator");
    if (captures === 0 && (finite(reconciliation.captureAttemptsDelta, "capture attempt delta") !== 0 || finite(reconciliation.captureSuccessDelta, "capture success delta") !== 0 || finite(reconciliation.captureFailDelta, "capture fail delta") !== 0 || reconciliation.captureOutcome !== "not-requested")) throw new TypeError("no-capture Wilds receipt has changed capture counters");
    const initialDust = finite(receipt.initialDust, "initial Dust");
    const finalDust = finite(receipt.finalDust, "final Dust");
    const dustDelta = finite(reconciliation.dustDelta, "Dust delta");
    if (Math.round((finalDust - initialDust) * 100) / 100 !== dustDelta) throw new TypeError("Wilds Dust delta does not match the authoritative snapshots");
    const wilds = finite(reconciliation.wildsDefeatedDelta, "wilds defeated delta");
    const heals = finite(receipt.heals, "heal count");
    if (!Number.isSafeInteger(wilds) || wilds < 0 || !Number.isSafeInteger(heals) || heals < 0) throw new TypeError("Wilds counters are malformed");
    const completedAt = new Date(String(receipt.completedAt ?? "")).toISOString();
    const initialClock = finite(receipt.initialState?.clock, "initial session clock");
    const finalClock = finite(receipt.finalState?.clock, "final session clock");
    if (!(finalClock >= initialClock)) throw new TypeError("Wilds session clocks are reversed");
    return Object.freeze({
        account,
        completedAt,
        initialClock,
        finalClock,
        captures,
        dustDelta,
        wilds,
        heals
    });
}
export function holozingWildsSessionEvent(receipt, recordedAt = new Date().toISOString()) {
    const valid = validateReceipt(receipt);
    const digest = niUriDigest(semanticId([
        valid.account,
        valid.completedAt,
        valid.initialClock,
        valid.finalClock
    ]));
    return Object.freeze({
        holozingWildsSessionSchema: HOLOZING_WILDS_SESSION_SCHEMA,
        eventId: `urn:aagaard:holozing-wilds-session:${digest}`,
        recordedAt: new Date(recordedAt).toISOString(),
        account: valid.account,
        completedAt: valid.completedAt,
        metrics: Object.freeze({
            dustDelta: valid.dustDelta,
            wildsDefeatedDelta: valid.wilds,
            heals: valid.heals,
            captureActions: valid.captures
        }),
        protectedAlphaVialPreserved: true,
        transferableAssetCreated: false,
        revenueRecognized: "0.000 HIVE",
        receipt: Object.freeze({
            ...receipt
        })
    });
}
async function composeHolozingWildsSession(_dataDir, receipt, recordedAt) {
    const event = holozingWildsSessionEvent(receipt, recordedAt);
    return event;
}
/** Record HolozingWildsSession: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordHolozingWildsSession(dataDir, ...rest) {
    const result = await composeHolozingWildsSession(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, HOLOZING_WILDS_SESSION_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readHolozingWildsSessions(_dataDir) {
    throw new Error("HoloZing Wilds sessions are chain/API reconciled, not local history");
}
