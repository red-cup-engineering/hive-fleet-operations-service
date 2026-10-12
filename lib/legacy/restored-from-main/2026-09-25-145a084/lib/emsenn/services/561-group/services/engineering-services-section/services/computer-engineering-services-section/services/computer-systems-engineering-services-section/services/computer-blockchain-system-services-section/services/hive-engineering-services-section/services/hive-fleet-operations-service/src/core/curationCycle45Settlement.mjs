import { createHash } from "node:crypto";
import { claimsOf, recordClaim } from "./journal.mjs";
export const CURATION_CYCLE_45_SCHEMA = "aagaard.curation-cycle-45.v1";
export const CURATION_CYCLE_45_CATEGORY = "aagaard.curation-cycle-45-event";
const PRIOR_ID = "urn:aagaard:market-cycle-44:ChF-LCTw1UIRr1XWJFSojgGIJo3isJm913rl7eDO9CA";
const ACTION_ID = "urn:aagaard:curation-action:s7kF8o4KdY-v5N1Ak1fa_ib-XAs6X7F6yIGtlICRa9c";
const TX_ID = "9641e00bbc3002ecd62ca61db94b830aa8bd99c6";
const PROCUREMENT_RESIDUE = "fetch failed";
function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
    return value;
}
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function exactVests(value, label) {
    const text = String(value ?? "");
    if (!/^(?:0|[1-9][0-9]*)\.[0-9]{6}$/u.test(text)) throw new TypeError(`${label} is not an exact VESTS amount`);
    return text;
}
function providerSet(value, label) {
    const providers = rows(value, label).map(String).sort();
    if (providers.length < 2 || new Set(providers).size !== providers.length || providers.some((provider)=>!provider.startsWith("https://"))) throw new TypeError(`${label} lacks independent providers`);
    return Object.freeze(providers);
}
export function curationCycle45Event(input) {
    const priorCycle = record(input.prior.cycle, "prior cycle");
    if (input.prior.eventId !== PRIOR_ID || input.prior.marketCycle44Schema !== "aagaard.market-cycle-44.v1" || priorCycle.globalStep !== 44 || priorCycle.angle !== "market-arbitrage" || priorCycle.nextAngle !== "curation-attention" || input.prior.decision !== "refuse-all-below-treasury-floor" || input.prior.tradeBroadcast !== false || input.prior.capitalMoved !== "0.00000000 SWAP.HIVE" || input.prior.protectedAlphaVialPreserved !== true) {
        throw new TypeError("cycle 45 requires the exact durable cycle 44 rotation and protected-asset witness");
    }
    const action = input.action;
    const receipt = record(action.receipt, "curation receipt");
    const plan = record(receipt.plan, "curation plan");
    const rc = record(plan.resourceCredits, "curation RC plan");
    const settlement = record(receipt.settlementIdentity, "curation settlement identity");
    if (action.curationActionSchema !== "aagaard.curation-action.v1" || action.eventId !== ACTION_ID || action.transactionId !== TX_ID || action.block !== 108361324 || action.account !== "emsenn0" || action.author !== "bozz" || action.permlink !== "hive-thrive-66-little-old-me" || action.weightBps !== 5000 || action.credentialLocation !== "cold-red-gate" || action.economicSettlement !== "pending-curation-reward" || action.realizedReward !== null || action.predictionId !== "urn:aagaard:curation-prediction:j3tGoVowMxJIrs6ZpQfdypN-BBCFQ5ieC88ku6DlQzw" || plan.strategySignal !== 75.218 || plan.strategySignalUnit !== "aagaard.curation-strategy-signal.v1" || plan.rewardPredictionVests !== null || plan.rewardPredictionHbd !== null || Number(plan.manaBps) !== 10000 || Number(plan.projectedManaBps) !== 9900 || Number(plan.manaFloorBps) !== 8000 || rc.decision !== "ready" || BigInt(String(rc.currentRc)) < BigInt(String(rc.requiredRc)) || settlement.account !== "emsenn0" || settlement.author !== "bozz" || settlement.permlink !== "hive-thrive-66-little-old-me" || settlement.transactionId !== TX_ID || settlement.payoutAt !== "2026-07-29T10:55:18.000Z" || settlement.expectedOperation !== "curation_reward" || settlement.rewardAsset !== "VESTS" || settlement.status !== "pending-payout") {
        throw new TypeError("cycle 45 requires the exact independently observed pending curation action");
    }
    const confirmationProviders = providerSet(action.confirmationProviders, "transaction confirmations");
    const visibilityProviders = providerSet(action.visibilityProviders, "vote visibility");
    const baseline = input.baseline;
    const knowledge = record(baseline.providerKnowledge, "baseline provider knowledge");
    const digestRows = rows(knowledge.stateDigests, "baseline state digests");
    if (baseline.kind !== "aagaard.curation-reward-baseline" || baseline.account !== "emsenn0" || baseline.status !== "certified" || baseline.requestedLimit !== 1000 || baseline.credentialAccess !== false || baseline.chainMutation !== false || knowledge.value !== "true" || digestRows.length !== 1 || Date.parse(String(baseline.observedAt)) <= Date.parse(action.recordedAt)) {
        throw new TypeError("cycle 45 baseline is not a fresh independently certified post-action reading");
    }
    const digestRow = record(digestRows[0], "baseline digest");
    const stateDigest = String(digestRow.stateDigest ?? "");
    const baselineProviders = providerSet(digestRow.providers, "baseline providers");
    const value = record(baseline.baseline, "baseline value");
    const reward = record(value.realizedReward, "baseline reward");
    const oldest = Number(value.oldestHistoryIndex);
    const newest = Number(value.newestHistoryIndex);
    const rewardCount = Number(value.rewardCount);
    if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || value.boundedHistoryOnly !== true || reward.asset !== "VESTS" || ![
        oldest,
        newest,
        rewardCount
    ].every(Number.isSafeInteger) || oldest < 0 || newest < oldest || rewardCount < 0 || rewardCount > 1000) throw new TypeError("cycle 45 baseline exact evidence is malformed");
    const telemetry = input.telemetry;
    if (telemetry.kind !== "aagaard.curation-settlement-telemetry" || telemetry.account !== "emsenn0" || telemetry.predictionsRecorded !== 6 || telemetry.settlementsObserved !== 356 || telemetry.settlementsMatchedToPredictions !== 0 || telemetry.settlementsWithoutPrediction !== 356 || telemetry.predictedRewardVests !== null || telemetry.predictionErrorVests !== null || telemetry.realizedRewardHbd !== null || telemetry.comparisonStatus !== "proxy-and-settlement-not-commensurate" || telemetry.historyScan !== "available" || telemetry.realizedReward.asset !== "VESTS" || telemetry.realizedReward.amount !== "2989.621476") {
        throw new TypeError("cycle 45 telemetry does not prove six pending predictions and bounded historical settlement state");
    }
    if (input.procurementResidue.trim() !== PROCUREMENT_RESIDUE) throw new TypeError("procurement residue is not exact");
    const baselineSummary = Object.freeze({
        observedAt: new Date(String(baseline.observedAt)).toISOString(),
        stateDigest,
        providers: baselineProviders,
        requestedLimit: 1000,
        oldestHistoryIndex: oldest,
        newestHistoryIndex: newest,
        rewardCount,
        realizedReward: Object.freeze({
            amount: exactVests(reward.amount, "baseline reward"),
            asset: "VESTS"
        }),
        scope: "bounded-rolling-history-not-cycle-profit"
    });
    const eventId = `urn:aagaard:curation-cycle-45:${createHash("sha256").update(JSON.stringify([
        PRIOR_ID,
        ACTION_ID,
        stateDigest,
        telemetry.predictionsRecorded,
        telemetry.settlementsMatchedToPredictions
    ])).digest("base64url")}`;
    return Object.freeze({
        curationCycle45Schema: CURATION_CYCLE_45_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        sourceCycleEventId: PRIOR_ID,
        cycle: Object.freeze({
            globalStep: 45,
            angle: "curation-attention",
            nextAngle: "asset-utility-yield"
        }),
        vote: Object.freeze({
            actionEventId: ACTION_ID,
            transactionId: TX_ID,
            block: 108361324,
            account: "emsenn0",
            author: "bozz",
            permlink: "hive-thrive-66-little-old-me",
            weightBps: 5000,
            strategySignal: 75.218,
            strategySignalUnit: "aagaard.curation-strategy-signal.v1",
            confirmationProviders,
            visibilityProviders,
            economicSettlement: "pending-curation-reward",
            payoutAt: "2026-07-29T10:55:18.000Z",
            realizedReward: null,
            retryAllowed: false
        }),
        rewardTelemetry: Object.freeze({
            predictionsRecorded: 6,
            settlementsObserved: 356,
            matchedManagedPredictions: 0,
            historicalRealizedReward: Object.freeze({
                amount: "2989.621476",
                asset: "VESTS"
            }),
            cycleRewardStatus: "pending",
            realizedCycleReward: null,
            realizedCycleRewardHbd: null,
            reason: "Hive has not emitted the target curation_reward and no VESTS-to-HBD valuation is admitted"
        }),
        baseline: baselineSummary,
        accountRole: "emsenn0-curation-vote-only",
        capitalMoved: "0.000 HIVE",
        liquidCapitalMoved: false,
        credentialAccess: Object.freeze({
            occurred: true,
            location: "cold-red-gate",
            role: "posting"
        }),
        chainMutation: true,
        protectedAlphaVialPreserved: true,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue: PROCUREMENT_RESIDUE
        })
    });
}
export async function recordCurationCycle45(dataDir, input) {
    const event = curationCycle45Event(input);
    const prior = claimsOf(dataDir, CURATION_CYCLE_45_CATEGORY).find((row)=>row.eventId === event.eventId);
    if (prior) return prior;
    recordClaim(dataDir, CURATION_CYCLE_45_CATEGORY, event.recordedAt, event);
    return event;
}
export async function readCurationCycle45(dataDir) {
    return Object.freeze(claimsOf(dataDir, CURATION_CYCLE_45_CATEGORY));
}
