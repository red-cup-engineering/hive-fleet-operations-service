import { witnessChainAct } from "./journal.mjs";
import { sha256Base64Url } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const HBD_SAVINGS_TOUCH_SCHEMA = "aagaard.hbd-savings-touch.v1";
export const HBD_SAVINGS_TOUCH_CATEGORY = "aagaard.hbd-savings-touch-event";
export const HBD_SAVINGS_EXIT_SCHEMA = "aagaard.hbd-savings-exit.v1";
export const HBD_SAVINGS_EXIT_CATEGORY = "aagaard.hbd-savings-exit-event";
async function composeHbdSavingsTouch(_dataDir, receipt, recordedAt = new Date().toISOString()) {
    if (receipt.kind !== "aagaard.hbd-savings-interest-touch-receipt" || receipt.status !== "interest-confirmed") {
        throw new TypeError("only a confirmed HBD savings-interest touch receipt is recordable");
    }
    const account = String(receipt.account ?? "");
    const transactionId = String(receipt.transactionId ?? "");
    if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[0-9a-f]{40}$/.test(transactionId)) {
        throw new TypeError("HBD savings touch receipt identity is not canonical");
    }
    const eventId = `urn:aagaard:hbd-savings-touch:${sha256Base64Url(transactionId)}`;
    return Object.freeze({
        hbdSavingsTouchSchema: HBD_SAVINGS_TOUCH_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        account,
        transactionId,
        receipt: Object.freeze({
            ...receipt
        })
    });
}
/** Record HbdSavingsTouch: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordHbdSavingsTouch(dataDir, ...rest) {
    const result = await composeHbdSavingsTouch(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, HBD_SAVINGS_TOUCH_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
async function composeHbdSavingsExit(_dataDir, receipt, recordedAt = new Date().toISOString()) {
    if (receipt.kind !== "aagaard.hbd-savings-exit-receipt" || ![
        "withdrawal-queued",
        "settlement-pending"
    ].includes(String(receipt.status))) {
        throw new TypeError("only a queued or pending HBD savings exit receipt is recordable");
    }
    const account = String(receipt.account ?? "");
    const transactionId = String(receipt.transactionId ?? "");
    if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[0-9a-f]{40}$/.test(transactionId)) throw new TypeError("HBD savings exit identity is not canonical");
    const status = String(receipt.status);
    const eventId = `urn:aagaard:hbd-savings-exit:${niUriDigest(semanticId([
        transactionId,
        status
    ]))}`;
    return Object.freeze({
        hbdSavingsExitSchema: HBD_SAVINGS_EXIT_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        account,
        transactionId,
        status,
        receipt: Object.freeze({
            ...receipt
        })
    });
}
/** Record HbdSavingsExit: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordHbdSavingsExit(dataDir, ...rest) {
    const result = await composeHbdSavingsExit(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, HBD_SAVINGS_EXIT_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
