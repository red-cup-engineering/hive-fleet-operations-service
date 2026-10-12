import { createHash } from "node:crypto";
import { claimsOf, recordClaim } from "./journal.mjs";
export const GAME_CAPABILITY_CYCLE_38_SCHEMA = "aagaard.game-capability-cycle-38.v1";
export const GAME_CAPABILITY_CYCLE_38_CATEGORY = "aagaard.game-capability-cycle-38-event";
function finite(value, label) {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new TypeError(`${label} must be finite`);
    return result;
}
function sessionMetrics(event, expected) {
    if (event.holozingWildsSessionSchema !== "aagaard.holozing-wilds-session.v1" || event.account !== "michael561" || event.protectedAlphaVialPreserved !== true || event.transferableAssetCreated !== false || event.revenueRecognized !== "0.000 HIVE" || finite(event.metrics.captureActions, "capture actions") !== 0 || finite(event.metrics.dustDelta, "Dust delta") !== expected.dust || finite(event.metrics.wildsDefeatedDelta, "wilds defeated") !== expected.wilds || finite(event.metrics.heals, "heals") !== expected.heals) {
        throw new TypeError("cycle 38 Wilds session is not the exact safe settled sample");
    }
    return Object.freeze({
        eventId: event.eventId,
        dustDelta: expected.dust,
        wildsDefeated: expected.wilds,
        heals: expected.heals,
        captures: 0
    });
}
export function gameCapabilityCycle38Event(input) {
    const prior = sessionMetrics(input.prior, {
        dust: 22.15,
        wilds: 12,
        heals: 8
    });
    const current = sessionMetrics(input.current, {
        dust: 7.02,
        wilds: 4,
        heals: 4
    });
    if (prior.eventId !== "urn:aagaard:holozing-wilds-session:7x-24HJpatoViUwU4F88cuZd2hUWDFXuBp3Bw5ihunY" || current.eventId !== "urn:aagaard:holozing-wilds-session:b5HAKlMJzSCsvP-_dQxZ9k8jqYlJgzW8NHwxWEBfsts") {
        throw new TypeError("cycle 38 requires the exact two durable Wilds samples");
    }
    const finalState = input.current.receipt.finalState;
    const recentLog = Array.isArray(finalState?.recentLog) ? finalState.recentLog.map(String) : [];
    if (!recentLog.some((entry)=>entry.includes("Team wiped"))) throw new TypeError("current sample does not expose the team-wipe correction boundary");
    const residue = input.procurementResidue.trim();
    if (residue !== "an A2A SEN operation must carry exactly one application/sen+cbor raw part") throw new TypeError("procurement residue is not exact");
    const samples = Object.freeze([
        prior,
        current
    ]);
    const eventId = `urn:aagaard:game-capability-cycle-38:${createHash("sha256").update(JSON.stringify(samples)).digest("base64url")}`;
    return Object.freeze({
        gameCapabilityCycle38Schema: GAME_CAPABILITY_CYCLE_38_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 38,
            angle: "games-capability",
            nextAngle: "market-arbitrage"
        }),
        game: "holozing-wilds",
        samples,
        repeatability: Object.freeze({
            sampleCount: 2,
            totalDustDelta: 29.17,
            totalWildsDefeated: 16,
            totalHeals: 12,
            totalCaptures: 0,
            productiveProgressRepeated: true,
            transferableAssetCreated: false,
            realizedRevenue: "0.000 HIVE"
        }),
        rectification: Object.freeze({
            observedFailureBoundary: "team-wipe",
            discoveredInEventId: current.eventId,
            mechanism: "scripts/holozing-wilds.mjs#teamWiped",
            obligation: "stop-without-revive-when-every-team-member-is-fainted",
            exercisedByTest: "test/holozingWilds.test.mjs"
        }),
        protectedAlphaVialPreserved: true,
        capitalMoved: "0.000 HIVE",
        credentialAccess: Object.freeze({
            occurred: true,
            role: "posting",
            location: "local-0600-key"
        }),
        hiveChainMutation: false,
        offChainGameProgress: true,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue
        })
    });
}
export async function recordGameCapabilityCycle38(dataDir, input) {
    const event = gameCapabilityCycle38Event(input);
    const prior = claimsOf(dataDir, GAME_CAPABILITY_CYCLE_38_CATEGORY).find((candidate)=>candidate.eventId === event.eventId);
    if (prior) return prior;
    recordClaim(dataDir, GAME_CAPABILITY_CYCLE_38_CATEGORY, event.recordedAt, event);
    return event;
}
export async function readGameCapabilityCycle38(dataDir) {
    return Object.freeze(claimsOf(dataDir, GAME_CAPABILITY_CYCLE_38_CATEGORY));
}
