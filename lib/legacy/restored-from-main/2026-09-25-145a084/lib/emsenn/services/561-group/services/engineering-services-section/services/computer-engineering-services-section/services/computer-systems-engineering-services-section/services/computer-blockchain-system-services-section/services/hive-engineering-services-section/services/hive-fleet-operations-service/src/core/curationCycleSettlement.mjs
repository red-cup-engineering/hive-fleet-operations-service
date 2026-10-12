import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const CURATION_CYCLE_SCHEMA = "aagaard.curation-cycle.v1";
export const CURATION_CYCLE_CATEGORY = "aagaard.curation-cycle-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function exactVests(value) {
    const amount = String(value ?? "");
    if (!/^(?:0|[1-9][0-9]*)\.[0-9]{6}$/u.test(amount)) throw new TypeError("baseline VESTS is malformed");
    return amount;
}
export function curationCycleEvent(input) {
    const action = input.action;
    if (action.curationActionSchema !== "aagaard.curation-action.v1" || action.account !== "emsenn0" || action.author !== "splinterlands" || action.permlink !== "the-arena-vanguard-is-coming-to-splinterlands" || action.weightBps !== 5000 || action.credentialLocation !== "cold-red-gate" || action.economicSettlement !== "pending-curation-reward" || action.realizedReward !== null) {
        throw new TypeError("cycle requires the exact pending cycle-35 curation action");
    }
    const receipt = record(action.receipt, "curation receipt");
    const plan = record(receipt.plan, "curation plan");
    if (plan.strategySignalUnit !== "aagaard.curation-strategy-signal.v1" || !Number.isFinite(Number(plan.strategySignal)) || Number(plan.manaBps) < 8000 || Number(plan.projectedManaBps) < 8000 || record(plan.resourceCredits, "curation RC plan").decision !== "ready") throw new TypeError("curation action lacks exact strategy or reserve evidence");
    const baseline = input.baseline;
    const knowledge = record(baseline.providerKnowledge, "baseline provider knowledge");
    const digests = rows(knowledge.stateDigests, "baseline state digests");
    if (baseline.kind !== "aagaard.curation-reward-baseline" || baseline.account !== "emsenn0" || baseline.status !== "certified" || baseline.requestedLimit !== 1000 || baseline.credentialAccess !== false || baseline.chainMutation !== false || knowledge.value !== "true" || digests.length !== 1) throw new TypeError("curation baseline is not independently certified");
    const digest = record(digests[0], "baseline state digest");
    const stateDigest = String(digest.stateDigest ?? "");
    const providers = rows(digest.providers, "baseline providers").map(String).sort();
    const value = record(baseline.baseline, "curation baseline");
    const reward = record(value.realizedReward, "baseline reward");
    if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length || value.boundedHistoryOnly !== true || reward.asset !== "VESTS") throw new TypeError("curation baseline exact evidence is malformed");
    const oldest = Number(value.oldestHistoryIndex);
    const newest = Number(value.newestHistoryIndex);
    const rewardCount = Number(value.rewardCount);
    if (![
        oldest,
        newest,
        rewardCount
    ].every(Number.isSafeInteger) || oldest < 0 || newest < oldest || rewardCount < 0 || rewardCount > 1000) {
        throw new TypeError("curation baseline history bounds are malformed");
    }
    const eventId = `urn:aagaard:curation-cycle:${createHash("sha256").update(JSON.stringify([
        action.eventId,
        stateDigest
    ])).digest("base64url")}`;
    return Object.freeze({
        curationCycleSchema: CURATION_CYCLE_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 35,
            angle: "curation-attention",
            nextAngle: "asset-utility-yield"
        }),
        vote: Object.freeze({
            actionEventId: action.eventId,
            transactionId: action.transactionId,
            block: action.block,
            account: "emsenn0",
            author: "splinterlands",
            permlink: "the-arena-vanguard-is-coming-to-splinterlands",
            weightBps: 5000,
            strategySignal: Number(plan.strategySignal),
            strategySignalUnit: "aagaard.curation-strategy-signal.v1",
            economicSettlement: "pending-curation-reward",
            realizedReward: null
        }),
        baseline: Object.freeze({
            observedAt: new Date(String(baseline.observedAt)).toISOString(),
            stateDigest,
            providers: Object.freeze(providers),
            requestedLimit: 1000,
            oldestHistoryIndex: oldest,
            newestHistoryIndex: newest,
            rewardCount,
            realizedReward: Object.freeze({
                amount: exactVests(reward.amount),
                asset: "VESTS"
            }),
            scope: "bounded-historical-baseline-not-cycle-profit"
        }),
        capitalMoved: "0.000 HIVE",
        credentialAccess: Object.freeze({
            occurred: true,
            location: "cold-red-gate",
            role: "posting"
        }),
        chainMutation: true
    });
}
export async function recordCurationCycle(_dataDir, input) {
    return curationCycleEvent(input);
}
export async function readCurationCycles(_dataDir) {
    throw new Error("curation cycle reports are retired; read native Hive history");
}
