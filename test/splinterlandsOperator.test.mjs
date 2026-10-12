import assert from "node:assert/strict";
import test from "node:test";
import { SPLINTERLANDS_OPERATOR_POLICY, admitOneSplinterlandsQueue, assessOwnedModernCoverage, buildSplinterlandsUnsignedBattleTransaction, buildSplinterlandsSubmitTeamData, parseSplinterlandsRankedMatch, parseSplinterlandsRuleCatalog, reconcileSplinterlandsBattle, selectOwnedModernTeam, splinterlandsFindMatchOperation, splinterlandsSubmitTeamOperation, splinterlandsTeamHash } from "../src/integrations/splinterlands/splinterlandsOperator.mjs";
const NOW = new Date("2026-07-22T04:00:00.000Z");
const MATCH_RAW = Object.freeze({
    id: "battle_12345678",
    match_type: "Ranked",
    format: "modern",
    mana_cap: 20,
    ruleset: "Standard",
    inactive: "Red,Green",
    submit_expiration_date: "2026-07-22T04:02:00.000Z"
});
const DETAILS = Object.freeze([
    {
        id: 640,
        name: "Prunda Undervesch",
        type: "Summoner",
        color: "White",
        secondary_color: "Blue",
        rarity: 1,
        editions: "12",
        stats: {
            mana: 3
        }
    },
    {
        id: 575,
        name: "Mar Toren Seeker",
        type: "Monster",
        color: "Blue",
        secondary_color: null,
        rarity: 1,
        editions: "12",
        stats: {
            mana: [
                4
            ],
            attack: [
                0
            ],
            ranged: [
                2
            ],
            magic: [
                0
            ],
            armor: [
                0
            ],
            health: [
                3
            ],
            speed: [
                3
            ],
            abilities: [
                [
                    "Snipe",
                    "Dodge"
                ]
            ]
        }
    },
    {
        id: 580,
        name: "Argarux Magus",
        type: "Monster",
        color: "Blue",
        secondary_color: null,
        rarity: 2,
        editions: "12",
        stats: {
            mana: [
                3
            ],
            attack: [
                0
            ],
            ranged: [
                0
            ],
            magic: [
                1
            ],
            armor: [
                0
            ],
            health: [
                2
            ],
            speed: [
                2
            ],
            abilities: [
                [
                    "Scattershot"
                ]
            ]
        }
    },
    {
        id: 611,
        name: "Kha'zi Fire Mage",
        type: "Monster",
        color: "Red",
        secondary_color: null,
        rarity: 1,
        editions: "12",
        stats: {
            mana: [
                4
            ],
            attack: [
                0
            ],
            ranged: [
                0
            ],
            magic: [
                1
            ],
            armor: [
                0
            ],
            health: [
                3
            ],
            speed: [
                2
            ],
            abilities: [
                [
                    "Scattershot",
                    "Dodge"
                ]
            ]
        }
    }
]);
function owned(uid, id) {
    return Object.freeze({
        uid,
        card_detail_id: id,
        edition: 12,
        level: 1,
        delegated_to: null,
        market_id: null,
        market_listing_status: null,
        stake_start_date: null,
        stake_end_date: null,
        last_transferred_date: null
    });
}
const OWNED = Object.freeze([
    owned("C12-640-5941874T9C", 640),
    owned("C12-575-ZQY8LUWF80", 575),
    owned("C12-580-GKO1GVSHU8", 580),
    owned("C12-611-5G8KJG6FKG", 611)
]);
test("Splinterlands operator is one-match, posting-only, owned-only, and energy-floored", ()=>{
    assert.deepEqual(SPLINTERLANDS_OPERATOR_POLICY, {
        account: "michael561",
        format: "modern",
        matchType: "Modern Ranked",
        minimumEnergy: 40,
        maximumMatchesPerRun: 1,
        minimumSubmitWindowMs: 25_000,
        authority: "posting",
        inventory: "owned-only"
    });
    assert.equal(admitOneSplinterlandsQueue({
        account: "michael561",
        energy: 49,
        outstandingMatches: 0,
        collectionReady: true,
        coverageReady: true,
        alreadyAttempted: 0
    }).kind, "queue-one");
    assert.equal(admitOneSplinterlandsQueue({
        account: "michael561",
        energy: 39.999,
        outstandingMatches: 0,
        collectionReady: true,
        coverageReady: true,
        alreadyAttempted: 0
    }).kind, "refuse");
    assert.equal(admitOneSplinterlandsQueue({
        account: "michael561",
        energy: 49,
        outstandingMatches: 1,
        collectionReady: true,
        coverageReady: true,
        alreadyAttempted: 0
    }).kind, "refuse");
    assert.equal(admitOneSplinterlandsQueue({
        account: "michael561",
        energy: 49,
        outstandingMatches: 0,
        collectionReady: true,
        coverageReady: true,
        alreadyAttempted: 1
    }).kind, "refuse");
    assert.equal(admitOneSplinterlandsQueue({
        account: "another",
        energy: 49,
        outstandingMatches: 0,
        collectionReady: true,
        coverageReady: true,
        alreadyAttempted: 0
    }).kind, "refuse");
    assert.match(admitOneSplinterlandsQueue({
        account: "michael561",
        energy: 49,
        outstandingMatches: 0,
        collectionReady: true,
        coverageReady: false,
        alreadyAttempted: 0
    }).reason, /does not cover/);
});
test("match parser accepts only fresh Modern Ranked offers with known selection semantics", ()=>{
    const match = parseSplinterlandsRankedMatch(MATCH_RAW, NOW);
    assert.equal(match.id, "battle_12345678");
    assert.deepEqual(match.rules, [
        "Standard"
    ]);
    assert.deepEqual(match.inactive, [
        "Red",
        "Green"
    ]);
    assert.throws(()=>parseSplinterlandsRankedMatch({
            ...MATCH_RAW,
            match_type: "Tournament"
        }, NOW), /Ranked matches only/);
    assert.throws(()=>parseSplinterlandsRankedMatch({
            ...MATCH_RAW,
            format: "wild"
        }, NOW), /Modern matches only/);
    assert.throws(()=>parseSplinterlandsRankedMatch({
            ...MATCH_RAW,
            ruleset: "Surprise New Rule"
        }, NOW), /unknown/);
    assert.throws(()=>parseSplinterlandsRankedMatch({
            ...MATCH_RAW,
            submit_expiration_date: "2026-07-22T04:00:24.999Z"
        }, NOW), /submission window/);
    const catalog = [
        {
            name: "Standard",
            active: true,
            type: null
        },
        {
            name: "Aim True",
            active: true,
            type: "Ability",
            invalid: [
                "Aimless"
            ],
            invalidTypes: [
                "Accuracy"
            ]
        },
        {
            name: "Shapeshift Happens",
            active: false,
            type: "Ability"
        }
    ];
    assert.equal(parseSplinterlandsRankedMatch({
        ...MATCH_RAW,
        ruleset: "Aim True"
    }, NOW, catalog).rules[0], "Aim True");
    assert.throws(()=>parseSplinterlandsRankedMatch({
            ...MATCH_RAW,
            ruleset: "Shapeshift Happens"
        }, NOW, catalog), /inactive, excluded, or unknown/);
    const parsedCatalog = parseSplinterlandsRuleCatalog(catalog);
    assert.deepEqual(parsedCatalog.map((rule)=>rule.name), [
        "Standard",
        "Aim True",
        "Shapeshift Happens"
    ]);
    assert.deepEqual(parsedCatalog[1]?.invalid, [
        "Aimless"
    ]);
    assert.deepEqual(parsedCatalog[1]?.invalidTypes, [
        "Accuracy"
    ]);
});
test("deterministic selector uses only available compatible owned Modern cards within mana", ()=>{
    const match = parseSplinterlandsRankedMatch(MATCH_RAW, NOW);
    const team = selectOwnedModernTeam({
        account: "michael561",
        match,
        owned: OWNED,
        details: DETAILS,
        modernEditions: [
            12,
            14,
            15,
            16
        ]
    });
    assert.equal(team.summoner.uid, "C12-640-5941874T9C");
    assert.deepEqual(team.monsters.map((card)=>card.uid), [
        "C12-575-ZQY8LUWF80",
        "C12-580-GKO1GVSHU8"
    ]);
    assert.equal(team.mana, 10);
    assert.equal(team.element, "White");
    assert.equal(team.allyColor, null);
    const rangedMatch = parseSplinterlandsRankedMatch({
        ...MATCH_RAW,
        mana_cap: 7,
        ruleset: "Going the Distance"
    }, NOW);
    const ranged = selectOwnedModernTeam({
        account: "michael561",
        match: rangedMatch,
        owned: OWNED,
        details: DETAILS,
        modernEditions: [
            12,
            14,
            15,
            16
        ]
    });
    assert.deepEqual(ranged.monsters.map((card)=>card.cardDetailId), [
        575
    ]);
    assert.equal(ranged.mana, 7);
    const inactiveMatch = parseSplinterlandsRankedMatch({
        ...MATCH_RAW,
        inactive: "White,Blue"
    }, NOW);
    assert.throws(()=>selectOwnedModernTeam({
            account: "michael561",
            match: inactiveMatch,
            owned: OWNED,
            details: DETAILS,
            modernEditions: [
                12,
                14,
                15,
                16
            ]
        }), /no legal owned-only/);
    const unavailable = OWNED.map((card)=>card.card_detail_id === 575 || card.card_detail_id === 580 ? {
            ...card,
            market_id: `listed-${card.card_detail_id}`,
            market_listing_status: 0
        } : card);
    assert.throws(()=>selectOwnedModernTeam({
            account: "michael561",
            match,
            owned: unavailable,
            details: DETAILS,
            modernEditions: [
                12,
                14,
                15,
                16
            ]
        }), /no legal owned-only/);
    const cooling = OWNED.map((card)=>({
            ...card,
            last_transferred_date: "2026-07-21T04:00:00.001Z"
        }));
    assert.throws(()=>selectOwnedModernTeam({
            account: "michael561",
            match,
            owned: cooling,
            details: DETAILS,
            modernEditions: [
                12,
                14,
                15,
                16
            ],
            now: NOW
        }), /no legal owned-only/);
});
test("Gold and Gray archons bind one explicit active ally element", ()=>{
    const match = parseSplinterlandsRankedMatch(MATCH_RAW, NOW);
    const kavor = {
        id: 802,
        name: "Kavor Skarn",
        type: "Summoner",
        color: "Gold",
        secondary_color: null,
        rarity: 2,
        editions: "14",
        stats: {
            mana: 3,
            attack: 0,
            ranged: 0,
            magic: 0,
            armor: 0,
            health: 0,
            speed: 0,
            abilities: [
                "Bloodline Dominion"
            ]
        }
    };
    const kavorOwned = {
        ...owned("C14-802-NXABEWYE74", 802),
        edition: 14
    };
    const team = selectOwnedModernTeam({
        account: "michael561",
        match,
        owned: [
            kavorOwned,
            OWNED[1]
        ],
        details: [
            kavor,
            DETAILS[1]
        ],
        modernEditions: [
            12,
            14,
            15,
            16
        ]
    });
    assert.equal(team.element, "Blue");
    assert.equal(team.allyColor, "Blue");
    assert.equal(buildSplinterlandsSubmitTeamData(match, team, "A1b2C3d4E5").allyColor, "Blue");
});
test("coverage assay prevents coarse inventory readiness from enabling an unattended queue", ()=>{
    const coverage = assessOwnedModernCoverage({
        account: "michael561",
        owned: OWNED,
        details: DETAILS,
        modernEditions: [
            12,
            14,
            15,
            16
        ]
    });
    assert.equal(coverage.readyForUnattendedQueue, false);
    assert.ok(coverage.singleRulesTested > 30);
    assert.ok(coverage.unplayableSingleRules.includes("Up Close & Personal"));
    assert.ok(coverage.unplayableSingleRules.includes("Heavy Metal"));
    assert.deepEqual(coverage.unplayableInactivePairs, [
        "Red+Blue",
        "Blue+Green",
        "Blue+White",
        "Blue+Black",
        "Blue+Gold"
    ]);
    assert.ok(coverage.ruleCombinationsTested > coverage.singleRulesTested);
    assert.equal(coverage.combinedScenariosTested, coverage.ruleCombinationsTested * coverage.inactivePairsTested);
    assert.ok(coverage.unplayableCombinedScenarios.length > 0);
    assert.match(coverage.limitation, /one through three rules/);
});
test("team commitment exactly matches the current first-party MD5 carrier", ()=>{
    const match = parseSplinterlandsRankedMatch(MATCH_RAW, NOW);
    const team = selectOwnedModernTeam({
        account: "michael561",
        match,
        owned: OWNED,
        details: DETAILS,
        modernEditions: [
            12,
            14,
            15,
            16
        ]
    });
    assert.equal(splinterlandsTeamHash(team, "A1b2C3d4E5"), "7ffedc93b1c6c83aad6929a33efd1fd5");
    assert.deepEqual(buildSplinterlandsSubmitTeamData(match, team, "A1b2C3d4E5"), {
        trx_id: "battle_12345678",
        team_hash: "7ffedc93b1c6c83aad6929a33efd1fd5",
        summoner: "C12-640-5941874T9C",
        monsters: [
            "C12-575-ZQY8LUWF80",
            "C12-580-GKO1GVSHU8"
        ],
        secret: "A1b2C3d4E5",
        match_type: "Ranked Modern",
        allyColor: null
    });
    assert.throws(()=>splinterlandsTeamHash(team, "too-short"), /ten alphanumeric/);
});
test("battle carrier is an exact one-operation posting-only transaction", ()=>{
    const queue = splinterlandsFindMatchOperation("michael561", "0.7.177", "A1b2C3d4E5");
    assert.deepEqual(queue, [
        "custom_json",
        {
            required_auths: [],
            required_posting_auths: [
                "michael561"
            ],
            id: "sm_find_match",
            json: '{"match_type":"Modern Ranked","app":"splinterlands/0.7.177","n":"A1b2C3d4E5"}'
        }
    ]);
    assert.deepEqual(buildSplinterlandsUnsignedBattleTransaction(queue, {
        ref_block_num: 108346581,
        ref_block_prefix: 4187824069,
        time: "2026-07-22T04:29:27"
    }), {
        ref_block_num: 15573,
        ref_block_prefix: 4187824069,
        expiration: "2026-07-22T04:39:27",
        operations: [
            queue
        ],
        extensions: []
    });
    const match = parseSplinterlandsRankedMatch(MATCH_RAW, NOW);
    const team = selectOwnedModernTeam({
        account: "michael561",
        match,
        owned: OWNED,
        details: DETAILS,
        modernEditions: [
            12,
            14,
            15,
            16
        ]
    });
    const submit = splinterlandsSubmitTeamOperation("michael561", "0.7.177", "Z9y8X7w6V5", buildSplinterlandsSubmitTeamData(match, team, "A1b2C3d4E5"));
    assert.equal(submit[1].id, "sm_submit_team");
    assert.equal(submit[1].required_auths.length, 0);
    assert.deepEqual(submit[1].required_posting_auths, [
        "michael561"
    ]);
    assert.deepEqual(JSON.parse(submit[1].json), {
        trx_id: "battle_12345678",
        team_hash: "7ffedc93b1c6c83aad6929a33efd1fd5",
        summoner: "C12-640-5941874T9C",
        monsters: [
            "C12-575-ZQY8LUWF80",
            "C12-580-GKO1GVSHU8"
        ],
        secret: "A1b2C3d4E5",
        match_type: "Ranked Modern",
        allyColor: null,
        app: "splinterlands/0.7.177",
        n: "Z9y8X7w6V5"
    });
    assert.throws(()=>splinterlandsFindMatchOperation("attacker", "0.7.177", "A1b2C3d4E5"), /hard-bound/);
    assert.throws(()=>splinterlandsFindMatchOperation("michael561", "0.7.177", "bad"), /ten alphanumeric/);
});
test("battle settlement binds result, rating, energy, and rewards to the exact match", ()=>{
    const settled = reconcileSplinterlandsBattle({
        account: "michael561",
        battleId: "battle_12345678",
        beforeRating: 260,
        afterRating: 278,
        beforeEnergy: 49,
        afterEnergy: 48,
        result: {
            id: "battle_12345678",
            player_1: "michael561",
            player_2: "opponent",
            winner: "michael561",
            reward_sps: "0.012",
            reward_glint: "8"
        }
    });
    assert.deepEqual(settled, {
        kind: "won",
        battleId: "battle_12345678",
        account: "michael561",
        opponent: "opponent",
        ratingDelta: 18,
        energyDelta: -1,
        rewardSps: "0.012",
        rewardGlint: "8"
    });
    assert.throws(()=>reconcileSplinterlandsBattle({
            account: "michael561",
            battleId: "battle_12345678",
            beforeRating: 260,
            afterRating: 260,
            beforeEnergy: 49,
            afterEnergy: 48,
            result: {
                id: "other_battle",
                player_1: "michael561",
                player_2: "opponent",
                winner: null
            }
        }), /not bound/);
    assert.throws(()=>reconcileSplinterlandsBattle({
            account: "michael561",
            battleId: "battle_12345678",
            beforeRating: 260,
            afterRating: 260,
            beforeEnergy: 49,
            afterEnergy: 50,
            result: {
                id: "battle_12345678",
                player_1: "michael561",
                player_2: "opponent",
                winner: null
            }
        }), /energy increased/);
});
