import { createHash } from "node:crypto";
import { claimsOf, recordClaim } from "./journal.mjs";
export const GAME_CAPABILITY_CYCLE_43_SCHEMA = "aagaard.game-capability-cycle-43.v1";
export const GAME_CAPABILITY_CYCLE_43_CATEGORY = "aagaard.game-capability-cycle-43-event";
const RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
    return value;
}
function units8(value, label) {
    const text = String(value ?? "");
    if (!/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(text)) throw new TypeError(`${label} is malformed`);
    return BigInt(text.replace(".", ""));
}
function providers(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} providers are absent`);
    const rows = value.map((entry)=>record(entry, label));
    const names = rows.map((row)=>String(row.node)).sort();
    if (names.length < 2 || new Set(names).size !== names.length || names.some((name)=>!name.startsWith("https://"))) throw new TypeError(`${label} lacks independent providers`);
    return Object.freeze(names);
}
export function gameCapabilityCycle43Event(input) {
    const action = input.action;
    const receipt = action.receipt;
    if (action.terraCoreActionSchema !== "aagaard.terracore-action.v1" || action.status !== "claim-confirmed" || action.account !== "michael561" || receipt.kind !== "aagaard.terracore-one-action-receipt" || receipt.status !== "claim-confirmed" || receipt.transactionId !== action.transactionId || !/^[0-9a-f]{40}$/u.test(action.transactionId)) throw new TypeError("cycle 43 requires the exact confirmed TerraCore claim");
    const plan = record(receipt.plan, "TerraCore plan");
    const before = record(receipt.before, "TerraCore before");
    const after = record(receipt.after, "TerraCore after");
    const beforePlayer = record(before.player, "TerraCore before player");
    const afterPlayer = record(after.player, "TerraCore after player");
    const rc = record(receipt.resourceCredits, "TerraCore RC");
    const rcPlan = record(rc.plan, "TerraCore RC plan");
    if (plan.kind !== "claim" || plan.amount !== "40.15178666" || rc.status !== "certified" || rcPlan.decision !== "ready" || String(beforePlayer.scrap) !== "40.15178666666666" || String(afterPlayer.scrap) !== "0.05656444444444444" || before.liquidScrap !== "158.59387428" || after.liquidScrap !== "198.75336909" || receipt.claimedScrap !== "40.15949481") {
        throw new TypeError("cycle 43 TerraCore claim source or effects changed");
    }
    const beforeUnits = units8(before.liquidScrap, "before SCRAP");
    const afterUnits = units8(after.liquidScrap, "after SCRAP");
    const claimedUnits = units8(receipt.claimedScrap, "claimed SCRAP");
    if (afterUnits - beforeUnits !== claimedUnits) throw new TypeError("cycle 43 liquid SCRAP delta does not reconcile");
    const hiveProviders = providers(receipt.hive, "Hive confirmation");
    const engineProviders = providers(receipt.providers, "Hive-Engine balance");
    const blocks = receipt.hive.map((entry)=>Number(record(entry, "Hive confirmation").block));
    if (blocks.some((block)=>!Number.isSafeInteger(block) || block <= 0) || new Set(blocks).size !== 1) throw new TypeError("cycle 43 Hive confirmations disagree");
    if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");
    const eventId = `urn:aagaard:game-capability-cycle-43:${createHash("sha256").update(JSON.stringify([
        action.eventId,
        receipt.claimedScrap
    ])).digest("base64url")}`;
    return Object.freeze({
        gameCapabilityCycle43Schema: GAME_CAPABILITY_CYCLE_43_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 43,
            angle: "games-capability",
            nextAngle: "market-arbitrage"
        }),
        game: "terracore",
        action: "claim-raid-exposed-scrap",
        sourceEventId: action.eventId,
        transactionId: action.transactionId,
        block: blocks[0],
        plannedScrap: "40.15178666",
        liquidScrapBefore: "158.59387428",
        liquidScrapAfter: "198.75336909",
        liquidInventoryCreated: "40.15949481 SCRAP",
        stashAfter: "0.05656444 SCRAP",
        accounting: Object.freeze({
            realizedRevenue: "0.000 HIVE",
            realizedProfit: null,
            inventoryMarkedToMarket: false,
            capitalSpent: "0.000 HIVE"
        }),
        evidence: Object.freeze({
            hiveProviders,
            engineProviders
        }),
        protectedAlphaVialPreserved: true,
        credentialAccess: Object.freeze({
            occurred: true,
            role: "posting",
            location: "local-0600-key"
        }),
        chainMutation: true,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue: RESIDUE
        })
    });
}
export async function recordGameCapabilityCycle43(dataDir, input) {
    const event = gameCapabilityCycle43Event(input);
    const prior = claimsOf(dataDir, GAME_CAPABILITY_CYCLE_43_CATEGORY).find((row)=>row.eventId === event.eventId);
    if (prior) return prior;
    recordClaim(dataDir, GAME_CAPABILITY_CYCLE_43_CATEGORY, event.recordedAt, event);
    return event;
}
export async function readGameCapabilityCycle43(dataDir) {
    return Object.freeze(claimsOf(dataDir, GAME_CAPABILITY_CYCLE_43_CATEGORY));
}
