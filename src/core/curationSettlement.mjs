import { claimsOf, recordClaim } from "./journal.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const CURATION_VOTE_LOT_SCHEMA = "aagaard.curation-vote-lot.v1";
export const CURATION_VOTE_LOT_CATEGORY = "aagaard.curation-vote-lot-event";
const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
async function eventsOf(dataDir) {
    return claimsOf(dataDir, CURATION_VOTE_LOT_CATEGORY);
}
async function append(dataDir, recordedAt, record) { recordClaim(dataDir, CURATION_VOTE_LOT_CATEGORY, recordedAt, record); }
function predictionId(account, vote, txId) {
    const digest = niUriDigest(semanticId([
        account,
        vote.author,
        vote.permlink,
        txId
    ]));
    return `urn:aagaard:curation-prediction:${digest}`;
}
export async function recordCurationPredictions(dataDir, account, votes, execution, recordedAt) {
    const existing = new Set((await eventsOf(dataDir)).filter((event)=>event.event === "prediction-recorded").map((event)=>event.predictionId));
    const byTarget = new Map(votes.map((vote)=>[
            `${vote.author}/${vote.permlink}`,
            vote
        ]));
    const appended = [];
    for (const receipt of execution.receipts){
        if (receipt.lane !== "voting" || receipt.action !== "vote" || receipt.status !== "broadcast" || !receipt.txId) continue;
        const vote = byTarget.get(receipt.target);
        if (!vote) continue;
        const id = predictionId(account, vote, receipt.txId);
        if (existing.has(id)) continue;
        const event = Object.freeze({
            curationVoteLotSchema: CURATION_VOTE_LOT_SCHEMA,
            event: "prediction-recorded",
            predictionId: id,
            recordedAt,
            account,
            author: vote.author,
            permlink: vote.permlink,
            vote: Object.freeze({
                weightBps: vote.weightBps,
                txId: receipt.txId
            }),
            prediction: Object.freeze({
                expectedCurationHbd: vote.expectedCurationHbd ?? null,
                unit: "HBD",
                rewardVests: null
            })
        });
        await append(dataDir, recordedAt, event);
        existing.add(id);
        appended.push(event);
    }
    return Object.freeze(appended);
}
export async function recordCurationSettlements(dataDir, scan, recordedAt) {
    const prior = await eventsOf(dataDir);
    const predictions = prior.filter((event)=>event.event === "prediction-recorded" && event.account === scan.account).sort((left, right)=>left.recordedAt.localeCompare(right.recordedAt));
    const settlements = prior.filter((event)=>event.event === "settlement-observed");
    const seenSources = new Set(settlements.map((event)=>event.source.sourceId));
    const matchedPredictions = new Set(settlements.flatMap((event)=>event.matchedPredictionId ? [
            event.matchedPredictionId
        ] : []));
    const appended = [];
    const ordered = [
        ...scan.rewards
    ].sort((left, right)=>left.historyIndex - right.historyIndex);
    for (const source of ordered){
        if (seenSources.has(source.sourceId)) continue;
        const match = predictions.filter((prediction)=>prediction.author === source.author && prediction.permlink === source.permlink && prediction.recordedAt <= source.timestamp && !matchedPredictions.has(prediction.predictionId)).at(-1) ?? null;
        const event = Object.freeze({
            curationVoteLotSchema: CURATION_VOTE_LOT_SCHEMA,
            event: "settlement-observed",
            recordedAt,
            source,
            matchedPredictionId: match?.predictionId ?? null,
            matchedExpectedCurationHbd: match?.prediction.expectedCurationHbd ?? null,
            valuation: Object.freeze({
                hbd: null,
                reason: "no-admitted-vests-to-hbd-valuation"
            })
        });
        await append(dataDir, recordedAt, event);
        seenSources.add(source.sourceId);
        if (match) matchedPredictions.add(match.predictionId);
        appended.push(event);
    }
    return Object.freeze(appended);
}
function vestsMicros(amount) {
    const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(amount);
    if (!match) throw new Error(`invalid VESTS amount ${amount}`);
    return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
function formatVests(micros) {
    const whole = micros / 1_000_000n;
    const fraction = (micros % 1_000_000n).toString().padStart(6, "0");
    return `${whole}.${fraction}`;
}
export async function readCurationTelemetry(dataDir, account, historyScan = "not-run") {
    const events = await eventsOf(dataDir);
    const predictions = events.filter((event)=>event.event === "prediction-recorded" && event.account === account);
    const settlements = events.filter((event)=>event.event === "settlement-observed" && event.source.account === account);
    const matched = settlements.filter((event)=>event.matchedPredictionId !== null);
    const realizedMicros = settlements.reduce((sum, event)=>sum + vestsMicros(event.source.reward.amount), 0n);
    const expectedHbd = matched.reduce((sum, event)=>sum + Number(event.matchedExpectedCurationHbd ?? 0), 0);
    return Object.freeze({
        kind: "aagaard.curation-settlement-telemetry",
        account,
        predictionsRecorded: predictions.length,
        settlementsObserved: settlements.length,
        settlementsMatchedToPredictions: matched.length,
        settlementsWithoutPrediction: settlements.length - matched.length,
        matchedExpectedCurationHbd: expectedHbd.toFixed(6),
        predictedRewardVests: null,
        realizedReward: Object.freeze({
            amount: formatVests(realizedMicros),
            asset: "VESTS"
        }),
        predictionErrorVests: null,
        realizedRewardHbd: null,
        comparisonStatus: "proxy-and-settlement-not-commensurate",
        historyScan,
        gaps: Object.freeze([
            "strategy-signal-is-not-a-vests-prediction",
            "no-admitted-vests-to-hbd-valuation",
            "account-history-scan-is-bounded-not-full-chain-history",
            ...historyScan === "unavailable" ? [
                "current-account-history-scan-unavailable"
            ] : []
        ])
    });
}
