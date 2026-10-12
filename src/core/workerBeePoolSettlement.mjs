import { witnessChainAct } from "./journal.mjs";
import { WORKER_BEE_POOL_ACCOUNT, WORKER_BEE_POOL_DISTRIBUTION_CATEGORY, WORKER_BEE_POOL_DISTRIBUTION_SCHEMA } from "@red-cup-engineering/workerbee-services-section/pool";
import { sha256Base64Url } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
function canonicalTimestamp(value) {
    if (typeof value !== "string") throw new TypeError("pool transfer timestamp is malformed");
    const milliseconds = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
    if (!Number.isFinite(milliseconds)) throw new TypeError("pool transfer timestamp is malformed");
    return new Date(milliseconds).toISOString();
}
function canonicalQuantity(value) {
    const quantity = String(value ?? "");
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(quantity);
    if (!match || BigInt(match[1]) === 0n && !/[1-9]/u.test(match[2] ?? "")) {
        throw new TypeError("pool transfer quantity is malformed or zero");
    }
    return quantity;
}
function canonicalSymbol(value) {
    const symbol = String(value ?? "");
    if (!/^[A-Z][A-Z0-9.]{0,9}$/u.test(symbol)) throw new TypeError("pool transfer symbol is malformed");
    return symbol;
}
function confirmedEngineEffect(candidate, result) {
    const rows = Array.isArray(result) ? result : [
        result
    ];
    const expectedId = rows.length === 1 ? candidate.transactionId : `${candidate.transactionId}-${candidate.actionIndex}`;
    const row = rows.find((entry)=>String(entry?.["transactionId"] ?? "") === expectedId);
    if (!row || row["sender"] !== candidate.from || row["contract"] !== "tokens" || row["action"] !== "transfer" || Number(row["refHiveBlockNumber"]) !== candidate.hiveBlock) return null;
    let payload;
    let logs;
    try {
        payload = typeof row["payload"] === "string" ? JSON.parse(row["payload"]) : row["payload"];
        logs = typeof row["logs"] === "string" ? JSON.parse(row["logs"]) : row["logs"];
    } catch  {
        return null;
    }
    if (payload?.["to"] !== candidate.to || payload?.["symbol"] !== candidate.symbol || payload?.["quantity"] !== candidate.quantity || String(payload?.["memo"] ?? "") !== candidate.memo || payload?.["isSignedWithActiveKey"] !== true) return null;
    if (Array.isArray(logs?.["errors"]) && logs["errors"].length > 0) return null;
    const events = Array.isArray(logs?.["events"]) ? logs["events"] : [];
    const exact = events.filter((event)=>{
        const typed = event;
        const data = typed["data"];
        return typed["contract"] === "tokens" && typed["event"] === "transfer" && JSON.stringify(data) === JSON.stringify({
            from: candidate.from,
            to: candidate.to,
            symbol: candidate.symbol,
            quantity: candidate.quantity
        });
    });
    const block = Number(row["blockNumber"]);
    if (events.length !== 1 || exact.length !== 1 || !Number.isSafeInteger(block) || block <= 0) return null;
    return Object.freeze({
        block,
        identity: JSON.stringify({
            payload,
            event: exact[0]
        })
    });
}
async function composeWorkerBeePoolDistributions(_dataDir, distributions, recordedAt = new Date().toISOString()) {
    const at = new Date(recordedAt).toISOString();
    const appended = [];
    for (const distribution of distributions){
        if (distribution.status !== "settled" || distribution.from !== WORKER_BEE_POOL_ACCOUNT) continue;
        const eventId = `urn:aagaard:workerbee-pool-distribution:${sha256Base64Url(distribution.sourceId)}`;
        const event = Object.freeze({
            workerBeePoolDistributionSchema: WORKER_BEE_POOL_DISTRIBUTION_SCHEMA,
            eventId,
            recordedAt: at,
            distribution,
            valuation: Object.freeze({
                swapHive: null,
                reason: "distribution-asset-not-independently-valued"
            })
        });
        appended.push(event);
    }
    return Object.freeze(appended);
}
/** Record WorkerBeePoolDistributions: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordWorkerBeePoolDistributions(dataDir, ...rest) {
    const result = await composeWorkerBeePoolDistributions(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, WORKER_BEE_POOL_DISTRIBUTION_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readWorkerBeePoolDistributions(_dataDir) {
    throw new Error("WorkerBee distributions must be re-collected from Hive Engine; local projections are retired");
}
