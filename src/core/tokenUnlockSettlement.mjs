import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const TOKEN_UNLOCK_SCHEMA = "aagaard.token-unlock.v1";
export const TOKEN_UNLOCK_CATEGORY = "aagaard.token-unlock-event";
export function tokenUnlockEvent(receipt, recordedAt = new Date().toISOString()) {
    if (receipt.kind !== "aagaard.token-unstake-receipt") throw new TypeError("not a token unstake receipt");
    const account = String(receipt.account ?? "");
    const symbol = String(receipt.symbol ?? "");
    const transactionId = String(receipt.transactionId ?? "");
    const status = String(receipt.status ?? "");
    if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) || !/^[0-9a-f]{40}$/.test(transactionId) || ![
        "unstake-start-confirmed",
        "settlement-pending"
    ].includes(status)) {
        throw new TypeError("token unlock receipt identity or status is not recordable");
    }
    const eventId = `urn:aagaard:token-unlock:${niUriDigest(semanticId([
        transactionId,
        status
    ]))}`;
    return Object.freeze({
        tokenUnlockSchema: TOKEN_UNLOCK_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        account,
        symbol,
        transactionId,
        status,
        receipt: Object.freeze({
            ...receipt
        })
    });
}
