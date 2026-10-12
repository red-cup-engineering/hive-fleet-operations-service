import { accountsWithLane } from "./accountStrategy.mjs";
import { witnessChainAct } from "./journal.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const ASSET_YIELD_SCHEMA = "aagaard.asset-yield.v1";
export const ASSET_YIELD_CATEGORY = "aagaard.asset-yield-event";
async function composeAssetYield(_dataDir, receipt, recordedAt = new Date().toISOString()) {
    if (receipt.kind !== "aagaard.asset-yield-receipt") throw new TypeError("not an asset yield receipt");
    const account = String(receipt.account ?? "");
    const symbol = String(receipt.symbol ?? "");
    const transactionId = String(receipt.transactionId ?? "");
    const status = String(receipt.status ?? "");
    if (!accountsWithLane("workerbee-yield").includes(account) || symbol !== "WORKERBEE" || !/^[0-9a-f]{40}$/.test(transactionId) || ![
        "yield-delegation-confirmed",
        "settlement-pending"
    ].includes(status)) {
        throw new TypeError("asset yield receipt identity or status is not recordable");
    }
    const eventId = `urn:aagaard:asset-yield:${niUriDigest(semanticId([
        transactionId,
        status
    ]))}`;
    const event = Object.freeze({
        assetYieldSchema: ASSET_YIELD_SCHEMA,
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
    return event;
}
/** Record AssetYield: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordAssetYield(dataDir, ...rest) {
    const result = await composeAssetYield(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, ASSET_YIELD_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readAssetYields(_dataDir, _account) {
    throw new Error("asset-yield history is chain-derived; local projections are retired");
}
