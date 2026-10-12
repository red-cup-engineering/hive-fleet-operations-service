import assert from "node:assert/strict";
import test from "node:test";
import { planTerraCoreEngineeringUpgrade } from "@red-cup-engineering/terracore-services-section";
import { terraCoreEngineeringUpgradeIntent } from "@red-cup-engineering/terracore-services-section";
import { selectTerraCoreBattleTarget } from "@red-cup-engineering/terracore-services-section";
import { parseTerraCoreBattleTargets } from "@red-cup-engineering/terracore-services-section";
import { terraCoreBattleIntent } from "@red-cup-engineering/terracore-services-section";
import { terraCoreClaimIntent } from "@red-cup-engineering/terracore-services-section";
import { createTerraCoreClient } from "@red-cup-engineering/terracore-services-section";
import { parseTerraCorePlayer } from "@red-cup-engineering/terracore-services-section";
import { planTerraCoreActions } from "@red-cup-engineering/terracore-services-section";
import { reconcileTerraCoreEngineeringUpgrade } from "@red-cup-engineering/terracore-services-section";
const PLAYER = JSON.stringify({
    username: "michael561",
    scrap: 68.8801328125,
    health: 10,
    damage: 180,
    defense: 170,
    engineering: 14,
    minerate: 0.0003255208333333333,
    attacks: 1,
    maxAttacks: 1,
    lastclaim: 1775819735940,
    lastBattle: 1784592711814,
    last_upgrade_time: 1744583671543
});
test("TerraCore player parsing preserves monetary source lexemes", ()=>{
    const state = parseTerraCorePlayer(PLAYER, "2026-07-21T12:00:00.000Z");
    assert.equal(state.account, "michael561");
    assert.equal(state.scrap, "68.8801328125");
    assert.equal(state.mineRate, "0.0003255208333333333");
    assert.equal(state.engineering, 14);
    assert.equal(state.lastClaimMs, 1775819735940);
});
test("TerraCore parser refuses duplicate exact-amount fields", ()=>{
    const duplicate = PLAYER.replace('"scrap":68.8801328125', '"scrap":68.8801328125,"scrap":70');
    assert.throws(()=>parseTerraCorePlayer(duplicate), /exactly once/);
});
test("TerraCore exact amount scanner ignores nested and quoted lookalikes", ()=>{
    const adversarial = PLAYER.replace('"lastBattle":1784592711814', '"note":"\\\"scrap\\\":999","nested":{"scrap":888},"lastBattle":1784592711814');
    assert.equal(parseTerraCorePlayer(adversarial).scrap, "68.8801328125");
});
test("TerraCore claim intent truncates, never rounds up, at token precision", ()=>{
    const intent = terraCoreClaimIntent("michael561", "68.8801328199");
    assert.deepEqual(intent.operation, [
        "custom_json",
        {
            required_auths: [],
            required_posting_auths: [
                "michael561"
            ],
            id: "terracore_claim",
            json: '{"amount":"68.88013281"}'
        }
    ]);
    assert.equal(intent.approvedForBroadcast, false);
    assert.throws(()=>terraCoreClaimIntent("michael561", "0.000000009"), /must be positive/);
});
test("TerraCore action policy proposes a locked claim and refuses unevidenced battle selection", ()=>{
    const state = parseTerraCorePlayer(PLAYER, "2026-07-21T12:00:00.000Z");
    const plan = planTerraCoreActions(state);
    assert.equal(plan.locked, true);
    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0]?.amount, "68.88013281");
    assert.match(plan.refusals[0]?.reason ?? "", /target-selection/);
});
test("TerraCore battle codec validates both accounts and remains locked", ()=>{
    const intent = terraCoreBattleIntent("michael561", "valid-target");
    assert.equal(intent.operation[1].id, "terracore_battle");
    assert.equal(intent.operation[1].json, '{"target":"valid-target"}');
    assert.equal(intent.approvedForBroadcast, false);
    assert.throws(()=>terraCoreBattleIntent("michael561", "michael561"), /must differ/);
    assert.throws(()=>terraCoreBattleIntent("michael561", "BAD"), /invalid Hive battle target/);
});
test("TerraCore client binds the requested account to the response", async ()=>{
    const reads = [];
    const client = createTerraCoreClient({
        endpoint: "https://example.invalid/",
        now: ()=>new Date("2026-07-21T12:00:00.000Z"),
        fetchImpl: async (input)=>{
            reads.push(String(input));
            return new Response(PLAYER, {
                status: 200,
                headers: {
                    "content-type": "application/json"
                }
            });
        }
    });
    const state = await client.readPlayer("michael561");
    assert.equal(state.observedAt, "2026-07-21T12:00:00.000Z");
    assert.deepEqual(reads, [
        "https://example.invalid/player/michael561"
    ]);
    await assert.rejects(()=>client.readPlayer("other-user"), /returned michael561/);
});
test("TerraCore battle selection uses a fresh conservative non-fleet target snapshot", ()=>{
    const actor = parseTerraCorePlayer(PLAYER, "2026-07-21T12:00:00.000Z");
    const snapshot = parseTerraCoreBattleTargets(JSON.stringify({
        players: [
            {
                username: "target-one",
                scrap: 50.123456789,
                stats: {
                    defense: 80,
                    dodge: 2,
                    protection: 0
                }
            },
            {
                username: "target-two",
                scrap: 30,
                stats: {
                    defense: 60,
                    dodge: 1,
                    protection: 0
                }
            },
            {
                username: "fleet-friend",
                scrap: 999,
                stats: {
                    defense: 1,
                    dodge: 0,
                    protection: 0
                }
            },
            {
                username: "protected-one",
                scrap: 999,
                stats: {
                    defense: 1,
                    dodge: 0,
                    protection: 1
                }
            }
        ]
    }), "2026-07-21T12:00:00.000Z");
    const selected = selectTerraCoreBattleTarget(actor, snapshot, [
        "michael561",
        "fleet-friend"
    ], new Date("2026-07-21T12:00:05.000Z"));
    assert.equal(selected.kind, "battle");
    if (selected.kind === "battle") {
        assert.equal(selected.target.account, "target-one");
        assert.equal(selected.target.scrap, "50.12345678");
        assert.equal(selected.operation[1].json, '{"target":"target-one"}');
        assert.equal(selected.approvedForBroadcast, false);
    }
    assert.equal(selectTerraCoreBattleTarget(actor, snapshot, [], new Date("2026-07-21T12:01:00.000Z")).kind, "refuse");
});
test("TerraCore battle selection refuses weak margins, high dodge, and malformed target evidence", ()=>{
    const actor = parseTerraCorePlayer(PLAYER, "2026-07-21T12:00:00.000Z");
    const snapshot = parseTerraCoreBattleTargets(JSON.stringify({
        players: [
            {
                username: "too-close",
                scrap: 100,
                stats: {
                    defense: 121,
                    dodge: 0,
                    protection: 0
                }
            },
            {
                username: "too-dodgy",
                scrap: 100,
                stats: {
                    defense: 50,
                    dodge: 10.1,
                    protection: 0
                }
            },
            {
                username: "too-small",
                scrap: 19.99999999,
                stats: {
                    defense: 50,
                    dodge: 0,
                    protection: 0
                }
            }
        ]
    }), "2026-07-21T12:00:00.000Z");
    assert.equal(selectTerraCoreBattleTarget(actor, snapshot, [], new Date("2026-07-21T12:00:01.000Z")).kind, "refuse");
    assert.throws(()=>parseTerraCoreBattleTargets('{"players":[{"username":"BAD","scrap":20,"stats":{"defense":1,"dodge":0,"protection":0}}]}'), /invalid Hive target username/);
});
test("TerraCore Engineering 14 upgrade has an exact bounded two-day payback", ()=>{
    const player = parseTerraCorePlayer(PLAYER, "2026-07-22T02:40:00.000Z");
    const plan = planTerraCoreEngineeringUpgrade({
        player,
        liquidScrap: "289.44439576",
        scrapPrecision: 8
    });
    assert.equal(plan.kind, "ready");
    if (plan.kind === "ready") {
        assert.deepEqual(plan.quote, {
            fromLevel: 14,
            toLevel: 15,
            costScrap: "196.00000000",
            retainedLiquidScrap: "93.44439576",
            currentScrapPerDay: "28.12499999",
            expectedScrapPerDay: "128.00000000",
            incrementalScrapPerDay: "99.87500001",
            paybackMilliDays: 1962
        });
        const intent = terraCoreEngineeringUpgradeIntent("michael561", plan.quote.costScrap, "0123456789abcdef");
        assert.equal(intent.role, "active");
        assert.deepEqual(JSON.parse(intent.operation[1].json), {
            contractName: "tokens",
            contractAction: "transfer",
            contractPayload: {
                symbol: "SCRAP",
                to: "null",
                quantity: "196.00000000",
                memo: "terracore_engineering-0123456789abcdef"
            }
        });
    }
});
test("TerraCore Engineering upgrade refuses reserve breach and reconciles exact effects", ()=>{
    const beforePlayer = parseTerraCorePlayer(PLAYER, "2026-07-22T02:40:00.000Z");
    assert.equal(planTerraCoreEngineeringUpgrade({
        player: beforePlayer,
        liquidScrap: "245.99999999",
        scrapPrecision: 8
    }).kind, "refuse");
    const plan = planTerraCoreEngineeringUpgrade({
        player: beforePlayer,
        liquidScrap: "289.44439576",
        scrapPrecision: 8
    });
    assert.equal(plan.kind, "ready");
    if (plan.kind !== "ready") return;
    const afterBody = PLAYER.replace('"engineering":14', '"engineering":15').replace('"minerate":0.0003255208333333333', '"minerate":0.0014814814814814814').replace('"last_upgrade_time":1744583671543', '"last_upgrade_time":1784688100000');
    const afterPlayer = parseTerraCorePlayer(afterBody, "2026-07-22T02:42:00.000Z");
    assert.deepEqual(reconcileTerraCoreEngineeringUpgrade({
        player: beforePlayer,
        liquidScrap: "289.44439576",
        scrapPrecision: 8
    }, {
        player: afterPlayer,
        liquidScrap: "93.44439576",
        scrapPrecision: 8
    }, plan.quote), {
        confirmed: true,
        reason: "Engineering, activity timestamp, mine rate, and exact SCRAP spend all reconciled"
    });
});
