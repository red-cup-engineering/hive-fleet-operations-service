import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeVotingField, createAagaardRuntime, ensureStore, loadAagaardConfig, planVotes } from "../src/core/core.adapter.mjs";
import { candidateFieldDigest, readCurationStrategyArm, readCurationStrategyArms, recordCurationStrategyArm } from "../src/core/strategyArms.mjs";
function post(key) {
    return Object.freeze({
        author: "writer",
        permlink: key,
        title: key,
        body: `body ${key}`,
        tags: Object.freeze([
            "hive"
        ]),
        pendingPayout: 1,
        netRshares: 100,
        comments: 1,
        ageHours: 1,
        created: "2026-07-20T00:00:00.000Z",
        beneficiaries: Object.freeze([]),
        votes: Object.freeze([])
    });
}
function wallet(account, maxVotesPerTick = 1) {
    return Object.freeze({
        kind: "aagaard.wallet-actor",
        account,
        strategy: Object.freeze({
            archetype: "fixture-arm",
            feeds: Object.freeze([
                "hive"
            ]),
            objective: Object.freeze({
                quality: 1,
                underrecognition: 1
            }),
            conviction: 1,
            votingPowerFloorBps: 8000,
            maxVotesPerTick
        }),
        tradingLive: false,
        risk: Object.freeze({
            capHiveMilli: 0,
            capSwapHiveMilli: 0,
            capHbdMilli: 0,
            minLiquidHbdMilli: 0,
            maxVoteWeightBps: 4000
        }),
        tokens: Object.freeze({})
    });
}
function candidates(keys, signal = 10) {
    return Object.freeze(keys.map((key)=>Object.freeze({
            key: `writer/${key}`,
            signal,
            weightBps: 9000,
            refusals: Object.freeze([])
        })));
}
test("common field identity ignores RPC order and equal arms take distinct deterministic phases", ()=>{
    const posts = Object.freeze([
        post("a"),
        post("b")
    ]);
    assert.equal(candidateFieldDigest(posts), candidateFieldDigest([
        ...posts
    ].reverse()));
    const fleet = Object.freeze([
        "alpha",
        "beta"
    ]);
    const alpha = readCurationStrategyArm({
        wallet: wallet("alpha"),
        posts,
        candidates: candidates([
            "a",
            "b"
        ]),
        votingPowerBps: 9000,
        at: "2026-07-20T01:00:00.000Z",
        fleetAccounts: fleet
    });
    const beta = readCurationStrategyArm({
        wallet: wallet("beta"),
        posts,
        candidates: candidates([
            "a",
            "b"
        ]),
        votingPowerBps: 9000,
        at: "2026-07-20T01:00:00.000Z",
        fleetAccounts: fleet
    });
    assert.equal(alpha.candidateField.digest, beta.candidateField.digest);
    assert.equal(alpha.strategy.id, beta.strategy.id);
    assert.equal(alpha.exploration.alternativeCount, 2);
    assert.equal(alpha.exploration.choiceBits, 1);
    assert.equal(alpha.exploration.separationScope, "common-field-and-strategy-alternative-set");
    assert.notEqual(alpha.exploration.deterministicAccountPhase, beta.exploration.deterministicAccountPhase);
    assert.notDeepEqual(alpha.selected, beta.selected);
    assert.ok(alpha.candidates.every((candidate)=>candidate.weightBps <= 4000));
});
test("exploration cannot re-admit a refused high-signal candidate", ()=>{
    const posts = Object.freeze([
        post("unsafe"),
        post("safe")
    ]);
    const reading = readCurationStrategyArm({
        wallet: wallet("alpha"),
        posts,
        candidates: Object.freeze([
            Object.freeze({
                key: "writer/unsafe",
                signal: 100,
                weightBps: 4000,
                refusals: Object.freeze([
                    "likely-cartel-trail"
                ])
            }),
            Object.freeze({
                key: "writer/safe",
                signal: 10,
                weightBps: 4000,
                refusals: Object.freeze([])
            })
        ]),
        votingPowerBps: 9000,
        at: "2026-07-20T01:00:00.000Z"
    });
    assert.deepEqual(reading.selected, [
        "writer/safe"
    ]);
    assert.equal(reading.admittedCandidateCount, 1);
});
test("invalid mana evidence fails closed before alternative selection", ()=>{
    const actor = wallet("alpha");
    const plan = planVotes(actor, Object.freeze([
        post("a"),
        post("b")
    ]), "2026-07-20T01:00:00.000Z", Object.freeze({
        account: "alpha",
        hive: "0.000 HIVE",
        hbd: "0.000 HBD",
        savingsHbd: "0.000 HBD",
        currentMana: "not-a-number",
        maxMana: "10000",
        tokens: Object.freeze({})
    }));
    assert.equal(plan.votes.length, 0);
    assert.equal(plan.strategyArm.safety.votingPowerBps, 0);
    assert.ok(plan.strategyArm.candidates.every((candidate)=>candidate.refusals.includes("mana-below-floor")));
});
test("vote admission preserves the mana floor after Hive's vote cost", ()=>{
    const actor = wallet("alpha");
    const nearFloor = Object.freeze({
        account: "alpha",
        hive: "0.000 HIVE",
        hbd: "0.000 HBD",
        savingsHbd: "0.000 HBD",
        currentMana: "8001",
        maxMana: "10000",
        tokens: Object.freeze({})
    });
    const plan = planVotes(actor, Object.freeze([
        post("a")
    ]), "2026-07-20T01:00:00.000Z", nearFloor);
    assert.equal(plan.votes.length, 0);
    assert.ok(plan.strategyArm.candidates[0]?.refusals.includes("post-vote-mana-below-floor"));
});
test("fields over twenty posts refuse choice telemetry instead of fabricating uniqueness", ()=>{
    const posts = Object.freeze(Array.from({
        length: 21
    }, (_, index)=>post(`p${String(index).padStart(2, "0")}`)));
    const armCandidates = Object.freeze(posts.map((entry, index)=>Object.freeze({
            key: `${entry.author}/${entry.permlink}`,
            signal: 100 - index,
            weightBps: 4000,
            refusals: Object.freeze([])
        })));
    const reading = readCurationStrategyArm({
        wallet: wallet("alpha"),
        posts,
        candidates: armCandidates,
        votingPowerBps: 9000,
        at: "2026-07-20T01:00:00.000Z"
    });
    assert.equal(reading.exploration.exact, false);
    assert.equal(reading.exploration.alternativeCount, null);
    assert.equal(reading.exploration.choiceBits, null);
    assert.equal(reading.exploration.deterministicAccountPhase, null);
    assert.equal(reading.exploration.unavailableReason, "candidate-field-exceeds-exact-limit");
    assert.deepEqual(reading.selected, [
        "writer/p00"
    ]);
});
test("large exact alternative spaces persist only a bounded, explicitly truncated projection", ()=>{
    const posts = Object.freeze(Array.from({
        length: 20
    }, (_, index)=>post(`p${String(index).padStart(2, "0")}`)));
    const reading = readCurationStrategyArm({
        wallet: wallet("alpha", 2),
        posts,
        candidates: candidates(posts.map((entry)=>entry.permlink)),
        votingPowerBps: 9000,
        at: "2026-07-20T01:00:00.000Z"
    });
    assert.equal(reading.exploration.alternativeCount, 190);
    assert.equal(reading.exploration.choiceBits, Math.log2(190));
    assert.equal(reading.exploration.projectedAlternatives?.length, 64);
    assert.equal(reading.exploration.projectionTruncated, true);
    assert.match(reading.exploration.alternativeSetDigest ?? "", /^ni:\/\/\/sha-256;/);
    assert.equal(reading.selected.length, 2);
});
test("strategy-arm readings are recorded in Aagaard's journal and read back by account", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-strategy-arm-"));
    const posts = Object.freeze([
        post("a")
    ]);
    const reading = readCurationStrategyArm({
        wallet: wallet("alpha"),
        posts,
        candidates: candidates([
            "a"
        ]),
        votingPowerBps: 9000,
        at: "2026-07-20T01:00:00.000Z"
    });
    await recordCurationStrategyArm(root, reading);
    assert.deepEqual(await readCurationStrategyArms(root, "alpha"), [reading]);
    assert.deepEqual(await readCurationStrategyArms(root, "beta"), []);
});
test("runtime unions wallet feed reads into one field digest and threads the fleet roster", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-strategy-runtime-"));
    try {
        const base = loadAagaardConfig();
        const wallets = Object.freeze([
            wallet("alpha"),
            wallet("beta")
        ]);
        const config = Object.freeze({
            ...base,
            enabled: Object.freeze([
                "voting"
            ]),
            wallets
        });
        const runtime = createAagaardRuntime(config, ensureStore(root), {
            hive: {
                async readCandidateField (actor) {
                    return Object.freeze([
                        post(actor.account)
                    ]);
                },
                async readWalletState (actor) {
                    return Object.freeze({
                        account: actor.account,
                        hive: "0.000 HIVE",
                        hbd: "0.000 HBD",
                        savingsHbd: "0.000 HBD",
                        currentMana: "9000",
                        maxMana: "10000",
                        tokens: Object.freeze({})
                    });
                }
            }
        });
        const tick = await runtime.runTick("2026-07-20T02:00:00.000Z");
        const arms = tick.accounts.map((account)=>account.voting?.strategyArm);
        assert.equal(arms.length, 2);
        assert.ok(arms.every((arm)=>arm?.candidateFieldDigest === arms[0]?.candidateFieldDigest));
        assert.equal((await readCurationStrategyArms(runtime.store.dataDir)).length, 2);
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
test("wallet plans reuse one exact common-field analysis and refuse a mismatched field", ()=>{
    const posts = Object.freeze([
        post("a"),
        post("b")
    ]);
    const at = "2026-07-20T03:00:00.000Z";
    const analysis = analyzeVotingField(posts, at);
    assert.equal(analysis.radar.components, analysis.intelligence.spectral.components);
    assert.equal(analysis.radar.durable, analysis.intelligence.spectral.durable);
    const state = Object.freeze({
        account: "alpha",
        hive: "0.000 HIVE",
        hbd: "0.000 HBD",
        savingsHbd: "0.000 HBD",
        currentMana: "9000",
        maxMana: "10000",
        tokens: Object.freeze({})
    });
    const alpha = planVotes(wallet("alpha"), posts, at, state, Object.freeze([
        wallet("alpha"),
        wallet("beta")
    ]), analysis);
    const beta = planVotes(wallet("beta"), posts, at, Object.freeze({
        ...state,
        account: "beta"
    }), Object.freeze([
        wallet("alpha"),
        wallet("beta")
    ]), analysis);
    assert.equal(alpha.radar, analysis.radar);
    assert.equal(beta.intelligence, analysis.intelligence);
    assert.throws(()=>planVotes(wallet("alpha"), Object.freeze([
            post("other")
        ]), at, state, Object.freeze([
            wallet("alpha")
        ]), analysis), /does not match/);
});
