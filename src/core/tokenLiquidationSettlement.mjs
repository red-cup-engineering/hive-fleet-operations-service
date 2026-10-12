import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const TOKEN_LIQUIDATION_SCHEMA = "aagaard.token-liquidation.v1";
export const TOKEN_LIQUIDATION_CATEGORY = "aagaard.token-liquidation-event";
export function tokenLiquidationEvent(receipt, recordedAt = new Date().toISOString()) {
    if (receipt.kind !== "aagaard.token-liquidation-receipt") throw new TypeError("not a token liquidation receipt");
    const account = String(receipt.account ?? "");
    const symbol = String(receipt.symbol ?? "");
    const transactionId = String(receipt.transactionId ?? "");
    const status = String(receipt.status ?? "");
    if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol) || !/^[0-9a-f]{40}$/.test(transactionId) || ![
        "liquidated-confirmed",
        "settlement-pending"
    ].includes(status)) {
        throw new TypeError("token liquidation receipt identity or status is not recordable");
    }
    const eventId = `urn:aagaard:token-liquidation:${niUriDigest(semanticId([
        transactionId,
        status
    ]))}`;
    return Object.freeze({
        tokenLiquidationSchema: TOKEN_LIQUIDATION_SCHEMA,
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
