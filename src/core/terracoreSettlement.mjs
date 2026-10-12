import { witnessChainAct } from "./journal.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const TERRACORE_ACTION_SCHEMA = "aagaard.terracore-action.v1";
export const TERRACORE_ACTION_CATEGORY = "aagaard.terracore-action-event";
const FINAL_OR_PENDING = new Set([
    "claim-confirmed",
    "battle-won-confirmed",
    "battle-dodged-confirmed",
    "battle-settled-no-scrap",
    "settlement-pending"
]);
function validatedReceipt(receipt) {
    if (receipt.kind !== "aagaard.terracore-one-action-receipt") throw new TypeError("not a TerraCore one-action receipt");
    const account = String(receipt.account ?? "");
    const transactionId = String(receipt.transactionId ?? "");
    const status = String(receipt.status ?? "");
    if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account)) throw new TypeError("TerraCore receipt account is not canonical");
    if (!/^[0-9a-f]{40}$/.test(transactionId)) throw new TypeError("TerraCore receipt transaction id is not canonical");
    if (!FINAL_OR_PENDING.has(status)) throw new TypeError(`TerraCore receipt status '${status}' is not recordable`);
    return Object.freeze({
        account,
        transactionId,
        status
    });
}
function eventIdOf(transactionId, status) {
    const digest = niUriDigest(semanticId([
        transactionId,
        status
    ]));
    return `urn:aagaard:terracore-action:${digest}`;
}
async function composeTerraCoreActionReceipt(_dataDir, receipt, recordedAt = new Date().toISOString()) {
    const valid = validatedReceipt(receipt);
    const eventId = eventIdOf(valid.transactionId, valid.status);
    const event = Object.freeze({
        terraCoreActionSchema: TERRACORE_ACTION_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        account: valid.account,
        transactionId: valid.transactionId,
        status: valid.status,
        receipt: Object.freeze({
            ...receipt
        })
    });
    return event;
}
/** Record TerraCoreActionReceipt: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordTerraCoreActionReceipt(dataDir, ...rest) {
    const result = await composeTerraCoreActionReceipt(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, TERRACORE_ACTION_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readTerraCoreActionReceipts(_dataDir, _transactionId) {
    throw new Error("TerraCore action history is chain-derived; local projections were retired");
}
