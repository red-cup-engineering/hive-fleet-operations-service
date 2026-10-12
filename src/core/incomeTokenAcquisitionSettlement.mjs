import { accountsWithLane } from "./accountStrategy.mjs";
import { witnessChainAct } from "./journal.mjs";
import { assertPlainObject as object } from "./objectGuards.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const INCOME_TOKEN_ACQUISITION_SCHEMA = "aagaard.income-token-acquisition.v1";
export const INCOME_TOKEN_ACQUISITION_CATEGORY = "aagaard.income-token-acquisition-event";
function providers(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    const rows = value.map((entry)=>object(entry, label));
    const names = rows.map((entry)=>String(entry.node ?? entry.provider ?? ""));
    if (names.length < 2 || new Set(names).size !== names.length || names.some((name)=>!name.startsWith("https://"))) throw new TypeError(`${label} lacks witnesses`);
    return Object.freeze(names);
}
export function incomeTokenAcquisitionEvent(receipt, recordedAt = new Date().toISOString()) {
    if (receipt.kind !== "aagaard.income-token-acquisition-receipt" || !accountsWithLane("income-token-acquisition").includes(String(receipt.account ?? "")) || receipt.symbol !== "EDSI") {
        throw new TypeError("not the admitted income-token acquisition receipt");
    }
    const status = String(receipt.status ?? "");
    if (status !== "acquired-confirmed" && status !== "settlement-pending") throw new TypeError("income-token acquisition status is not recordable");
    const transactionId = String(receipt.transactionId ?? "");
    if (!/^[0-9a-f]{40}$/u.test(transactionId) || receipt.retryAllowed !== false) throw new TypeError("income-token transaction identity is malformed");
    const plan = object(receipt.plan, "acquisition plan");
    const quote = object(plan.quote, "acquisition quote");
    if (plan.admitted !== true || quote.symbol !== "EDSI" || quote.quantity !== "1.000" || quote.limitPriceSwapHive !== "1.01555000" || quote.executionAdmissible !== false) throw new TypeError("acquisition receipt does not bind the reviewed pilot");
    if (status === "acquired-confirmed") {
        providers(receipt.hive, "Hive confirmations");
        const hive = receipt.hive;
        const blocks = hive.map((row)=>Number(row.block));
        if (blocks.some((block)=>!Number.isSafeInteger(block) || block <= 0) || new Set(blocks).size !== 1) throw new TypeError("Hive confirmations disagree on one block");
    } else if (receipt.hive !== undefined) {
        throw new TypeError("pending acquisition cannot carry partial or invented Hive confirmation evidence");
    }
    let acquiredQuantity = null;
    let spentSwapHive = null;
    if (status === "acquired-confirmed") {
        providers(receipt.engine, "Hive Engine confirmations");
        providers(receipt.after, "effect confirmations");
        const engine = receipt.engine;
        const engineBlocks = engine.map((row)=>Number(row.block));
        if (engine.some((row)=>row.transactionId !== transactionId) || engineBlocks.some((block)=>!Number.isSafeInteger(block) || block <= 0) || new Set(engineBlocks).size !== 1 || new Set(engine.map((row)=>JSON.stringify(row.logs))).size !== 1) {
            throw new TypeError("Hive Engine confirmations disagree on the acquisition execution");
        }
        acquiredQuantity = String(receipt.acquiredQuantity ?? "");
        spentSwapHive = String(receipt.spentSwapHive ?? "");
        if (acquiredQuantity !== "1.000" || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(spentSwapHive) || BigInt(spentSwapHive.replace(".", "")) <= 0n || BigInt(spentSwapHive.replace(".", "")) > 101_555_000n) {
            throw new TypeError("confirmed acquisition economics exceed the pilot");
        }
        const before = object(receipt.before, "pre-acquisition state");
        if (before.tokenBalance !== "0.000" || before.swapHiveBalance !== "71.69561429" || before.existingFleetQuantity !== "89.568") {
            throw new TypeError("confirmed acquisition is not bound to the reviewed pre-state");
        }
        const after = receipt.after;
        const effectIdentities = after.map((row)=>JSON.stringify([
                row.tokenBalance,
                row.swapHiveBalance,
                row.matchingOpenOrders
            ]));
        if (new Set(effectIdentities).size !== 1 || after.some((row)=>row.tokenBalance !== "1.000" || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(String(row.swapHiveBalance ?? "")) || !Array.isArray(row.matchingOpenOrders) || row.matchingOpenOrders.length !== 0) || BigInt(String(after[0].swapHiveBalance).replace(".", "")) + BigInt(spentSwapHive.replace(".", "")) !== 7_169_561_429n) {
            throw new TypeError("confirmed acquisition effects do not satisfy the reviewed balance equation");
        }
    }
    const eventId = `urn:aagaard:income-token-acquisition:${niUriDigest(semanticId([
        transactionId,
        status
    ]))}`;
    return Object.freeze({
        incomeTokenAcquisitionSchema: INCOME_TOKEN_ACQUISITION_SCHEMA,
        eventId,
        recordedAt: new Date(recordedAt).toISOString(),
        account: receipt.account,
        symbol: "EDSI",
        transactionId,
        status,
        acquiredQuantity,
        spentSwapHive,
        futureIncomeSettlement: "unproven-until-native-hive-distribution",
        realizedIncome: null,
        receipt: JSON.parse(JSON.stringify(receipt))
    });
}
async function composeIncomeTokenAcquisition(_dataDir, receipt, recordedAt) {
    const event = incomeTokenAcquisitionEvent(receipt, recordedAt);
    return event;
}
/** Record IncomeTokenAcquisition: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordIncomeTokenAcquisition(dataDir, ...rest) {
    const result = await composeIncomeTokenAcquisition(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, INCOME_TOKEN_ACQUISITION_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readIncomeTokenAcquisitions(_dataDir) {
    throw new Error("income-token acquisition history is chain-derived; local projections are retired");
}
