import { witnessChainAct } from "./journal.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const INCOME_TOKEN_DISTRIBUTION_SCHEMA = "aagaard.income-token-distribution.v1";
export const INCOME_TOKEN_DISTRIBUTION_CATEGORY = "aagaard.income-token-distribution-event";
const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/u;
const SYMBOL = /^[A-Z0-9.]{1,20}$/u;
const HIVE_AMOUNT = /^(0|[1-9][0-9]*)\.([0-9]{3}) HIVE$/u;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function canonicalTimestamp(value) {
    if (typeof value !== "string") throw new TypeError("distribution timestamp is absent");
    const milliseconds = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
    if (!Number.isFinite(milliseconds)) throw new TypeError("distribution timestamp is malformed");
    return new Date(milliseconds).toISOString();
}
export function incomeTokenDistributionFromHistoryRow(row, account, payer, symbol) {
    if (!ACCOUNT.test(account) || !ACCOUNT.test(payer) || !SYMBOL.test(symbol)) throw new TypeError("invalid income-token identity");
    if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0]) || !isRecord(row[1])) return null;
    const historyIndex = Number(row[0]);
    const envelope = row[1];
    const operation = envelope["op"];
    if (!Array.isArray(operation) || operation.length !== 2 || operation[0] !== "transfer" || !isRecord(operation[1])) return null;
    const value = operation[1];
    if (value["from"] !== payer || value["to"] !== account) return null;
    const memo = String(value["memo"] ?? "");
    if (!memo.includes(symbol)) return null;
    const memoPattern = new RegExp(`^Dividends for holding ((?:0|[1-9][0-9]*)(?:\\.[0-9]+)?) ${escapeRegex(symbol)} tokens\\.$`, "u");
    const holding = memoPattern.exec(memo);
    const amount = String(value["amount"] ?? "");
    if (!holding || !HIVE_AMOUNT.test(amount)) throw new TypeError("income-token distribution carrier is malformed");
    const block = Number(envelope["block"]);
    const operationIndex = Number(envelope["op_in_trx"]);
    const transactionId = String(envelope["trx_id"] ?? "");
    if (!Number.isSafeInteger(block) || block <= 0 || !Number.isSafeInteger(operationIndex) || operationIndex < 0 || !/^[0-9a-f]{40}$/u.test(transactionId)) throw new TypeError("income-token distribution identity is malformed");
    const sourceId = `urn:aagaard:hive-transfer:${niUriDigest(semanticId([
        account,
        historyIndex,
        block,
        operationIndex,
        transactionId
    ]))}`;
    return Object.freeze({
        sourceId,
        account,
        payer,
        symbol,
        historyIndex,
        block,
        operationIndex,
        transactionId,
        timestamp: canonicalTimestamp(envelope["timestamp"]),
        amount,
        memo,
        reportedHolding: holding[1]
    });
}
function hiveMillis(amount) {
    const match = HIVE_AMOUNT.exec(amount);
    if (!match) throw new TypeError("distribution amount is not exact HIVE");
    return BigInt(match[1]) * 1_000n + BigInt(match[2]);
}
function fixed(value, precision) {
    const scale = 10n ** BigInt(precision);
    return `${value / scale}.${(value % scale).toString().padStart(precision, "0")}`;
}
function validateScan(scan) {
    if (scan.kind !== "aagaard.income-token-distribution-scan" || !ACCOUNT.test(scan.account) || !ACCOUNT.test(scan.payer) || !SYMBOL.test(scan.symbol) || !Number.isSafeInteger(scan.requestedLimit) || scan.requestedLimit < 1 || scan.requestedLimit > 1_000 || scan.evidenceProviders.length < 2 || new Set(scan.evidenceProviders).size !== scan.evidenceProviders.length) {
        throw new TypeError("income-token distribution scan identity is malformed");
    }
    for (const source of scan.distributions){
        if (source.account !== scan.account || source.payer !== scan.payer || source.symbol !== scan.symbol || incomeTokenDistributionFromHistoryRow([
            source.historyIndex,
            {
                op: [
                    "transfer",
                    {
                        from: source.payer,
                        to: source.account,
                        amount: source.amount,
                        memo: source.memo
                    }
                ],
                block: source.block,
                op_in_trx: source.operationIndex,
                trx_id: source.transactionId,
                timestamp: source.timestamp
            }
        ], scan.account, scan.payer, scan.symbol)?.sourceId !== source.sourceId) {
            throw new TypeError("income-token distribution does not belong to its scan");
        }
    }
}
export function summarizeIncomeTokenPosition(input) {
    validateScan(input.scan);
    const observedAt = new Date(input.observedAt).toISOString();
    const ordered = [
        ...input.scan.distributions
    ].sort((left, right)=>left.timestamp.localeCompare(right.timestamp));
    const year = observedAt.slice(0, 4);
    const ytd = ordered.filter((entry)=>entry.timestamp.startsWith(`${year}-`));
    const recent = ordered.slice(-12);
    const sum = (rows)=>rows.reduce((total, row)=>total + hiveMillis(row.amount), 0n);
    const recentTotal = sum(recent);
    const annualizedMicros = recent.length === 0 ? null : recentTotal * 1_000n * 52n / BigInt(recent.length);
    const latest = ordered.at(-1) ?? null;
    const latestAgeDays = latest === null ? null : Math.floor((Date.parse(observedAt) - Date.parse(latest.timestamp)) / 86_400_000);
    const valuation = isRecord(input.exit["valuation"]) ? input.exit["valuation"] : null;
    const completeExit = input.exit["status"] === "certified" && valuation?.["completeExit"] === true;
    const active = latestAgeDays !== null && latestAgeDays >= 0 && latestAgeDays <= 10 && recent.length >= 4;
    return Object.freeze({
        schema: "aagaard.income-token-position.v1",
        observedAt,
        account: input.scan.account,
        symbol: input.scan.symbol,
        payer: input.scan.payer,
        sourceAgreement: Object.freeze({
            providers: input.scan.evidenceProviders,
            distributionCount: ordered.length
        }),
        realized: Object.freeze({
            scanTotal: `${fixed(sum(ordered), 3)} HIVE`,
            yearToDate: `${fixed(sum(ytd), 3)} HIVE`,
            yearToDateCount: ytd.length,
            latest: latest === null ? null : Object.freeze({
                amount: latest.amount,
                timestamp: latest.timestamp,
                reportedHolding: latest.reportedHolding
            })
        }),
        projection: Object.freeze({
            basis: `latest-${recent.length}-settled-distributions`,
            annualizedNativeHive: annualizedMicros === null ? null : `${fixed(annualizedMicros, 6)} HIVE`,
            status: annualizedMicros === null ? "unavailable" : "historical-run-rate-not-guaranteed"
        }),
        exit: input.exit,
        comparison: Object.freeze({
            yieldBps: null,
            reason: "native-HIVE-distributions-and-SWAP.HIVE-exit-proceeds-are-not-assumed-commensurate"
        }),
        decision: active && completeExit ? "hold-productive-position-and-monitor" : "manual-review",
        reasons: Object.freeze([
            active ? "recent recurring HIVE distributions are independently settled" : "recent recurring distribution evidence is insufficient",
            completeExit ? "complete displayed SWAP.HIVE bid exit is independently certified" : "complete displayed exit is not certified"
        ])
    });
}
async function composeIncomeTokenDistributions(_dataDir, scan, recordedAt = new Date().toISOString()) {
    validateScan(scan);
    const at = new Date(recordedAt).toISOString();
    const appended = [];
    for (const source of [
        ...scan.distributions
    ].sort((left, right)=>left.historyIndex - right.historyIndex)){
        const eventId = source.sourceId;
        const event = Object.freeze({
            incomeTokenDistributionSchema: INCOME_TOKEN_DISTRIBUTION_SCHEMA,
            event: "distribution-observed",
            eventId,
            recordedAt: at,
            source,
            realization: Object.freeze({
                quantity: source.amount.slice(0, -5),
                asset: "HIVE",
                status: "realized-transfer"
            }),
            valuation: Object.freeze({
                swapHive: null,
                reason: "native-HIVE-distribution-not-valued-as-SWAP.HIVE"
            })
        });
        appended.push(event);
    }
    return Object.freeze(appended);
}
/** Record IncomeTokenDistributions: the chain holds the act; the journal witnesses it by its transaction. */
export async function recordIncomeTokenDistributions(dataDir, ...rest) {
    const result = await composeIncomeTokenDistributions(dataDir, ...rest);
    for (const event of [result].flat()) witnessChainAct(dataDir, INCOME_TOKEN_DISTRIBUTION_CATEGORY, event.recordedAt ?? new Date().toISOString(), event);
    return result;
}
export async function readIncomeTokenDistributions(_dataDir, _account, _symbol) {
    throw new Error("income-token distributions must be re-collected from native Hive history; local projections are retired");
}
