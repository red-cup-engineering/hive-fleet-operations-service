import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const CURATION_CYCLE_40_SCHEMA = "aagaard.curation-cycle-40.v1";
export const CURATION_CYCLE_40_CATEGORY = "aagaard.curation-cycle-40-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
const PRIOR_ID = "urn:aagaard:curation-cycle:DPNzSfYyOowKtEIYspETgdxmC34gdL2qLbuJe6iqXQQ";
const ACTION_ID = "urn:aagaard:curation-action:4Nn4gehXP55V26iRsqdUgQZjORJpbvZoyZAoWqWkpjM";
const TX_ID = "0395691f00d57a9598fcdaf8e3318769886f55d4";
const PROCUREMENT_RESIDUE = "timed out awaiting tools/call after 300s";
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function vestsUnits(value, label) {
    const match = /^(?:0|[1-9][0-9]*)\.([0-9]{6})$/u.exec(String(value ?? ""));
    if (!match) throw new TypeError(`${label} must be exact VESTS`);
    const [whole, fraction] = String(value).split(".");
    return BigInt(whole) * 1_000_000n + BigInt(fraction);
}
function signedVests(value) {
    const sign = value < 0n ? "-" : "";
    const absolute = value < 0n ? -value : value;
    return `${sign}${absolute / 1_000_000n}.${(absolute % 1_000_000n).toString().padStart(6, "0")}`;
}
function certifiedBaseline(baseline) {
    const knowledge = record(baseline.providerKnowledge, "baseline provider knowledge");
    const groups = rows(knowledge.stateDigests, "baseline state digests");
    if (baseline.kind !== "aagaard.curation-reward-baseline" || baseline.account !== "emsenn0" || baseline.status !== "certified" || baseline.requestedLimit !== 1000 || baseline.credentialAccess !== false || baseline.chainMutation !== false || knowledge.value !== "true" || groups.length !== 1) throw new TypeError("current baseline is not independently certified");
    const group = record(groups[0], "baseline digest group");
    const stateDigest = String(group.stateDigest ?? "");
    const providers = rows(group.providers, "baseline providers").map(String).sort();
    const value = record(baseline.baseline, "baseline value");
    const reward = record(value.realizedReward, "baseline reward");
    const oldest = Number(value.oldestHistoryIndex);
    const newest = Number(value.newestHistoryIndex);
    const rewardCount = Number(value.rewardCount);
    if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length || value.boundedHistoryOnly !== true || reward.asset !== "VESTS" || ![
        oldest,
        newest,
        rewardCount
    ].every(Number.isSafeInteger) || oldest < 0 || newest < oldest || rewardCount < 0 || rewardCount > 1000) throw new TypeError("current baseline exact evidence is malformed");
    const amountVests = String(reward.amount);
    vestsUnits(amountVests, "current baseline reward");
    return Object.freeze({
        observedAt: new Date(String(baseline.observedAt)).toISOString(),
        stateDigest,
        providers: Object.freeze(providers),
        oldestHistoryIndex: oldest,
        newestHistoryIndex: newest,
        rewardCount,
        amountVests
    });
}
export function curationCycle40Event(input) {
    if (input.prior.eventId !== PRIOR_ID || input.prior.baseline.scope !== "bounded-historical-baseline-not-cycle-profit") {
        throw new TypeError("cycle 40 requires the exact durable cycle 35 baseline");
    }
    const action = input.action;
    const receipt = record(action.receipt, "curation action receipt");
    const plan = record(receipt.plan, "curation plan");
    const settlement = record(receipt.settlementIdentity, "curation settlement identity");
    if (action.eventId !== ACTION_ID || action.transactionId !== TX_ID || action.block !== 108358790 || action.account !== "emsenn0" || action.author !== "ecency.stats" || action.permlink !== "ecency-daily-2026-07-22" || action.weightBps !== 5000 || action.credentialLocation !== "cold-red-gate" || action.confirmationProviders.length < 2 || action.visibilityProviders.length < 2 || action.economicSettlement !== "pending-curation-reward" || action.realizedReward !== null || plan.strategySignal !== 110.427 || plan.strategySignalUnit !== "aagaard.curation-strategy-signal.v1" || Number(plan.manaBps) < 8000 || Number(plan.projectedManaBps) < 8000 || record(plan.resourceCredits, "curation RC plan").decision !== "ready" || settlement.payoutAt !== "2026-07-29T13:13:48.000Z") throw new TypeError("cycle 40 requires the exact independently settled pending vote");
    const current = certifiedBaseline(input.baseline);
    const prior = Object.freeze({
        eventId: PRIOR_ID,
        oldestHistoryIndex: input.prior.baseline.oldestHistoryIndex,
        newestHistoryIndex: input.prior.baseline.newestHistoryIndex,
        rewardCount: input.prior.baseline.rewardCount,
        amountVests: input.prior.baseline.realizedReward.amount
    });
    const oldestShift = current.oldestHistoryIndex - prior.oldestHistoryIndex;
    const newestShift = current.newestHistoryIndex - prior.newestHistoryIndex;
    if (oldestShift <= 0 || newestShift <= 0) throw new TypeError("bounded history did not expose a changed window composition");
    const windowChange = signedVests(vestsUnits(current.amountVests, "current reward") - vestsUnits(prior.amountVests, "prior reward"));
    const telemetry = input.telemetry;
    if (telemetry.kind !== "aagaard.curation-settlement-telemetry" || telemetry.account !== "emsenn0" || telemetry.settlementsMatchedToPredictions !== 0 || telemetry.predictionsRecorded < 1 || telemetry.settlementsObserved < 0) throw new TypeError("curation settlement telemetry does not prove the pending state");
    if (input.procurementResidue.trim() !== PROCUREMENT_RESIDUE) throw new TypeError("procurement residue is not exact");
    const baselineComparison = Object.freeze({
        prior,
        current,
        oldestIndexShift: oldestShift,
        newestIndexShift: newestShift,
        rewardCountChange: current.rewardCount - prior.rewardCount,
        windowAmountChangeVests: windowChange,
        attribution: "not-attributable-window-composition-changed"
    });
    const eventId = `urn:aagaard:curation-cycle-40:${createHash("sha256").update(JSON.stringify([
        action.eventId,
        baselineComparison
    ])).digest("base64url")}`;
    return Object.freeze({
        curationCycle40Schema: CURATION_CYCLE_40_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 40,
            angle: "curation-attention",
            nextAngle: "asset-utility-yield"
        }),
        vote: Object.freeze({
            actionEventId: ACTION_ID,
            transactionId: TX_ID,
            block: 108358790,
            account: "emsenn0",
            author: "ecency.stats",
            permlink: "ecency-daily-2026-07-22",
            weightBps: 5000,
            strategySignal: 110.427,
            strategySignalUnit: "aagaard.curation-strategy-signal.v1",
            economicSettlement: "pending-curation-reward",
            realizedReward: null,
            payoutAt: "2026-07-29T13:13:48.000Z"
        }),
        rewardTelemetry: Object.freeze({
            predictionsRecorded: telemetry.predictionsRecorded,
            settlementsObserved: telemetry.settlementsObserved,
            matchedManagedPredictions: 0,
            cycleRewardStatus: "pending",
            realizedCycleReward: null
        }),
        baselineComparison,
        rectification: Object.freeze({
            retiredCopy: "single-target-cold-signer",
            mechanism: "scripts/cold-red-gate-curation-broadcast.mjs#validateRemoteCurationRequest",
            obligation: "admit-only-one-positive-reserve-safe-planner-selected-vote",
            badIncumbentTest: "test/curationCycle.test.mts"
        }),
        capitalMoved: "0.000 HIVE",
        credentialAccess: Object.freeze({
            occurred: true,
            location: "cold-red-gate",
            role: "posting"
        }),
        chainMutation: true,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue: PROCUREMENT_RESIDUE
        })
    });
}
export async function recordCurationCycle40(_dataDir, input) {
    return curationCycle40Event(input);
}
export async function readCurationCycle40(_dataDir) {
    throw new Error("curation cycle reports are retired; read native Hive history");
}
