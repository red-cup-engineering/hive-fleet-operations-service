import { claimsOf, recordClaim } from "./journal.mjs";
import { createHash } from "node:crypto";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-code-engineering-services-section/semiotic-expression-notation/runtime";
import { canonicalJsonValue as canonicalize } from "@red-cup-engineering/json-services-section/canonical-json";
export const CURATION_STRATEGY_ARM_SCHEMA = "aagaard.curation-strategy-arm.v1";
export const CURATION_STRATEGY_ARM_CATEGORY = "aagaard.curation-strategy-arm-reading";
const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
const MAX_EXACT_CANDIDATES = 20;
const NEAR_OPTIMAL_TOLERANCE_BPS = 1;
const ALTERNATIVE_PROJECTION_LIMIT = 64;
function semanticIdentity(objectKind, value) {
    return identifyJsonSemanticContent({
        objectKind,
        value: canonicalize(value),
        witnessRoot: EMPTY_WITNESS_ROOT
    }).token;
}
export function candidateFieldDigest(posts) {
    const field = [
        ...posts
    ].sort((left, right)=>`${left.author}/${left.permlink}`.localeCompare(`${right.author}/${right.permlink}`)).map((post)=>({
            author: post.author,
            permlink: post.permlink,
            title: post.title,
            body: post.body,
            tags: [
                ...post.tags
            ].sort(),
            pendingPayout: post.pendingPayout,
            netRshares: post.netRshares,
            comments: post.comments,
            created: post.created,
            beneficiaries: [
                ...post.beneficiaries
            ].map((entry)=>({
                    account: entry.account,
                    weight: entry.weight
                })).sort((left, right)=>left.account.localeCompare(right.account)),
            votes: [
                ...post.votes
            ].map((vote)=>({
                    voter: vote.voter,
                    rshares: vote.rshares,
                    time: vote.time ?? null,
                    percent: vote.percent ?? null
                })).sort((left, right)=>`${left.voter}\u0000${left.time ?? ""}`.localeCompare(`${right.voter}\u0000${right.time ?? ""}`))
        }));
    return semanticIdentity("aagaard.strategy-candidate-field", field);
}
export function curationStrategyIdentity(wallet) {
    const objective = Object.freeze(Object.fromEntries(Object.entries(wallet.strategy.objective).sort(([left], [right])=>left.localeCompare(right))));
    const objectiveDigest = semanticIdentity("aagaard.curation-strategy-objective", objective);
    const identity = {
        archetype: wallet.strategy.archetype,
        feeds: [
            ...wallet.strategy.feeds
        ].sort(),
        objective,
        objectiveDigest,
        conviction: wallet.strategy.conviction
    };
    return Object.freeze({
        id: semanticIdentity("aagaard.curation-strategy", identity),
        archetype: identity.archetype,
        feeds: Object.freeze(identity.feeds),
        objective,
        objectiveDigest,
        conviction: identity.conviction
    });
}
function baseline(candidates, maxVotes) {
    return Object.freeze(candidates.filter((candidate)=>candidate.refusals.length === 0 && candidate.signal > 0 && Number.isFinite(candidate.signal)).sort((left, right)=>right.signal - left.signal || left.key.localeCompare(right.key)).slice(0, maxVotes).map((candidate)=>candidate.key));
}
function forEachBoundedSelection(candidates, maxVotes, visit) {
    const keys = [];
    const descend = (start, signal)=>{
        visit(keys, signal);
        if (keys.length >= maxVotes) return;
        for(let index = start; index < candidates.length; index += 1){
            keys.push(candidates[index].key);
            descend(index + 1, signal + candidates[index].signal);
            keys.pop();
        }
    };
    descend(0, 0);
}
function exactAlternativeSpace(candidates, maxVotes, ordinalForCount) {
    const admitted = candidates.filter((candidate)=>candidate.refusals.length === 0 && candidate.signal > 0 && Number.isFinite(candidate.signal)).sort((left, right)=>left.key.localeCompare(right.key));
    let optimum = 0;
    forEachBoundedSelection(admitted, maxVotes, (_keys, signal)=>{
        optimum = Math.max(optimum, signal);
    });
    const threshold = optimum * (1 - NEAR_OPTIMAL_TOLERANCE_BPS / 10_000);
    let count = 0;
    forEachBoundedSelection(admitted, maxVotes, (_keys, signal)=>{
        if (signal >= threshold) count += 1;
    });
    const ordinal = ordinalForCount(count);
    let alternativeIndex = 0;
    let selected = Object.freeze([]);
    const projected = [];
    const hash = createHash("sha256");
    forEachBoundedSelection(admitted, maxVotes, (keys, signal)=>{
        if (signal < threshold) return;
        const selection = Object.freeze([
            ...keys
        ]);
        hash.update(JSON.stringify(selection));
        hash.update("\n");
        if (projected.length < ALTERNATIVE_PROJECTION_LIMIT) projected.push(selection);
        if (alternativeIndex === ordinal) selected = selection;
        alternativeIndex += 1;
    });
    return Object.freeze({
        count,
        ordinal,
        selected,
        digest: semanticIdentity("aagaard.curation-strategy-alternative-set", {
            fold: "sha-256-json-lines/v1",
            foldedDigest: hash.digest("base64url"),
            alternativeCount: count
        }),
        projected: Object.freeze(projected)
    });
}
function deterministicAccountPhase(account, fleetAccounts, fieldDigest, strategyId, alternatives) {
    const roster = [
        ...new Set(fleetAccounts)
    ].sort();
    const accountIndex = Math.max(0, roster.indexOf(account));
    const rotation = Number(BigInt(`0x${createHash("sha256").update(`${fieldDigest}\u0000${strategyId}`).digest("hex")}`) % BigInt(alternatives));
    return (rotation + accountIndex) % alternatives;
}
export function readCurationStrategyArm(input) {
    const strategy = curationStrategyIdentity(input.wallet);
    const fieldDigest = candidateFieldDigest(input.posts);
    const candidates = Object.freeze([
        ...input.candidates
    ].sort((left, right)=>left.key.localeCompare(right.key)).map((candidate)=>Object.freeze({
            key: candidate.key,
            signal: Number(candidate.signal.toFixed(6)),
            weightBps: Math.max(0, Math.min(input.wallet.risk.maxVoteWeightBps, Math.floor(candidate.weightBps))),
            refusals: Object.freeze([
                ...new Set(candidate.refusals)
            ])
        })));
    const exact = input.posts.length <= MAX_EXACT_CANDIDATES;
    let selected;
    let exploration;
    if (exact) {
        const space = exactAlternativeSpace(candidates, input.wallet.strategy.maxVotesPerTick, (count)=>deterministicAccountPhase(input.wallet.account, input.fleetAccounts ?? [
                input.wallet.account
            ], fieldDigest, strategy.id, count));
        selected = space.selected;
        exploration = Object.freeze({
            exact: true,
            toleranceBps: NEAR_OPTIMAL_TOLERANCE_BPS,
            alternativeCount: space.count,
            choiceBits: Math.log2(space.count),
            alternativeSetDigest: space.digest,
            projectedAlternatives: space.projected,
            projectionLimit: ALTERNATIVE_PROJECTION_LIMIT,
            projectionTruncated: space.count > ALTERNATIVE_PROJECTION_LIMIT,
            selectedAlternativeOrdinal: space.ordinal,
            deterministicAccountPhase: space.ordinal,
            separationScope: "common-field-and-strategy-alternative-set",
            mode: "deterministic-account-phase-near-optimal",
            unavailableReason: null
        });
    } else {
        selected = baseline(candidates, input.wallet.strategy.maxVotesPerTick);
        exploration = Object.freeze({
            exact: false,
            toleranceBps: NEAR_OPTIMAL_TOLERANCE_BPS,
            alternativeCount: null,
            choiceBits: null,
            alternativeSetDigest: null,
            projectedAlternatives: null,
            projectionLimit: ALTERNATIVE_PROJECTION_LIMIT,
            projectionTruncated: null,
            selectedAlternativeOrdinal: null,
            deterministicAccountPhase: null,
            separationScope: null,
            mode: "baseline-no-exploration",
            unavailableReason: "candidate-field-exceeds-exact-limit"
        });
    }
    return Object.freeze({
        curationStrategyArmSchema: CURATION_STRATEGY_ARM_SCHEMA,
        kind: "aagaard.curation-strategy-arm-reading",
        at: input.at,
        account: input.wallet.account,
        candidateField: Object.freeze({
            digest: fieldDigest,
            candidateCount: input.posts.length
        }),
        strategy,
        safety: Object.freeze({
            votingPowerBps: input.votingPowerBps,
            votingPowerFloorBps: input.wallet.strategy.votingPowerFloorBps,
            maxVotesPerTick: input.wallet.strategy.maxVotesPerTick,
            maxVoteWeightBps: input.wallet.risk.maxVoteWeightBps
        }),
        scoreUnit: "aagaard.curation-strategy-signal.v1",
        candidates,
        admittedCandidateCount: candidates.filter((candidate)=>candidate.refusals.length === 0).length,
        exploration,
        selected: Object.freeze([
            ...selected
        ])
    });
}
const STRATEGY_ARM_CATEGORY = "aagaard.curation-strategy-arm";
export async function recordCurationStrategyArm(dataDir, reading) {
    recordClaim(dataDir, STRATEGY_ARM_CATEGORY, reading.at ?? reading.observedAt ?? new Date().toISOString(), reading);
}
export async function readCurationStrategyArms(dataDir, account) {
    return Object.freeze(claimsOf(dataDir, STRATEGY_ARM_CATEGORY).filter((reading) => account === undefined || reading.account === account));
}
