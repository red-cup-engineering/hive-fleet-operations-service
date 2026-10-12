import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { HONEY_SWAP_ACCOUNT, WRAP_MEMO } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { aagaardParityReport, capabilityReport, createAagaardRuntime, createHiveClient, createHiveEngineClient, createOperatorAuth, dispositionIncentiveNomination, ensureStore, fleetWitnessDigest, isLocked, listIncentiveNominations, loadAagaardConfig, mergeWalletState, planGaming, planIncentives, planTrades, planVotes, readAlphaRadar, readLockedDrafts, readSubstrateSnapshots, postCandidateFromHive } from "../src/index.mjs";
import { hiveWalletMoves } from "../src/agent/hive-fleet-domain.mjs";
import { rationalOfBigInts } from "@red-cup-engineering/exact-number-data-service/exact-number";
function hoursAgoIso(hours, at) {
    return new Date(Date.parse(at) - hours * 3_600_000).toISOString();
}
const MOCK_NOW = new Date().toISOString();
// The signer must never find a real key under test.
process.env.HIVE_KEY_ROOT = "/nonexistent-hive-key-root";

/** A fixed candidate field for planner tests. */
const DEFAULT_POSTS = Object.freeze([
    {
        author: "alice",
        permlink: "community-market-notes",
        title: "Community market notes",
        body: "A well sourced look at HIVE/HBD routing. Reblog and comment to earn 5 PIZZA.",
        tags: Object.freeze([
            "finance",
            "hive-167922",
            "hive"
        ]),
        pendingPayout: 1.25,
        netRshares: 9000,
        comments: 12,
        ageHours: 8,
        created: hoursAgoIso(8, MOCK_NOW),
        beneficiaries: Object.freeze([]),
        votes: Object.freeze([
            {
                voter: "curator-a",
                rshares: 4000,
                time: hoursAgoIso(6, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "curator-b",
                rshares: 5000,
                time: hoursAgoIso(3, MOCK_NOW),
                percent: 10000
            }
        ])
    },
    {
        author: "bob",
        permlink: "splinterlands-week",
        title: "Splinterlands week",
        body: "Gaming field report and tournament notes.",
        tags: Object.freeze([
            "gaming",
            "hive-140217",
            "hive"
        ]),
        pendingPayout: 6.5,
        netRshares: 5200,
        comments: 4,
        ageHours: 26,
        created: hoursAgoIso(26, MOCK_NOW),
        beneficiaries: Object.freeze([
            {
                account: "splinterlands-fund",
                weight: 1000
            }
        ]),
        votes: Object.freeze([
            {
                voter: "train-a",
                rshares: 2000,
                time: hoursAgoIso(25.0, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "train-b",
                rshares: 2000,
                time: hoursAgoIso(24.9, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "train-c",
                rshares: 2000,
                time: hoursAgoIso(24.8, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "train-d",
                rshares: 2000,
                time: hoursAgoIso(24.7, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "train-e",
                rshares: 2000,
                time: hoursAgoIso(24.6, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "train-f",
                rshares: 2000,
                time: hoursAgoIso(24.5, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "train-g",
                rshares: 2000,
                time: hoursAgoIso(24.4, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "train-h",
                rshares: 2000,
                time: hoursAgoIso(24.3, MOCK_NOW),
                percent: 10000
            }
        ])
    },
    {
        author: "carol",
        permlink: "public-interest-dev",
        title: "Public interest development",
        body: "A durable technical writeup with code, citations, and open questions.",
        tags: Object.freeze([
            "dev",
            "stemgeeks",
            "hive"
        ]),
        pendingPayout: 0.4,
        netRshares: 18000,
        comments: 18,
        ageHours: 14,
        created: hoursAgoIso(14, MOCK_NOW),
        beneficiaries: Object.freeze([]),
        votes: Object.freeze([
            {
                voter: "researcher",
                rshares: 12000,
                time: hoursAgoIso(11, MOCK_NOW),
                percent: 10000
            },
            {
                voter: "builder",
                rshares: 6000,
                time: hoursAgoIso(4, MOCK_NOW),
                percent: 10000
            }
        ])
    },
    {
        author: "dana",
        permlink: "photography-bridge",
        title: "Photography bridge",
        body: "A cross-community photo essay connecting art and local history.",
        tags: Object.freeze([
            "photography",
            "art",
            "history",
            "hive"
        ]),
        pendingPayout: 0.85,
        netRshares: 8400,
        comments: 9,
        ageHours: 10,
        created: hoursAgoIso(10, MOCK_NOW),
        beneficiaries: Object.freeze([]),
        votes: Object.freeze([
            {
                voter: "artist",
                rshares: 8400,
                time: hoursAgoIso(7, MOCK_NOW),
                percent: 10000
            }
        ])
    }
]);
test("each account's vote ceiling comes from its config, bounded by the chain's 1 to 10000", ()=>{
    const config = loadAagaardConfig();
    const trader = config.wallets.find((wallet)=>wallet.account === "sigmund-vexler");
    assert.equal(trader?.tradingLive, true);
    assert.equal(trader?.risk.maxVoteWeightBps, 5000);
    assert.ok(config.wallets.every((wallet)=>wallet.risk.maxVoteWeightBps >= 1 && wallet.risk.maxVoteWeightBps <= 10000));
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-vote-risk-"));
    const configPath = path.join(root, "aagaard.config.json");
    try {
        writeFileSync(configPath, JSON.stringify({
            accounts: [
                {
                    account: "over-cap",
                    tradingLive: true,
                    maxVoteWeightBps: 10_000
                },
                {
                    account: "under-floor",
                    maxVoteWeightBps: -1
                }
            ]
        }));
        const adversarial = loadAagaardConfig({
            configPath
        });
        assert.equal(adversarial.wallets.find((wallet)=>wallet.account === "over-cap")?.risk.maxVoteWeightBps, 10000);
        assert.equal(adversarial.wallets.find((wallet)=>wallet.account === "under-floor")?.risk.maxVoteWeightBps, 1);
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
function roundTripMarket(tokens = {
    "SWAP.HIVE": "1.00000000"
}, observedAt = new Date().toISOString()) {
    return Object.freeze({
        observedAt,
        tokens,
        venues: Object.freeze([
            Object.freeze({
                venue: "hive-engine",
                pair: "DEC/SWAP.HIVE",
                midpoint: 0.00125,
                bestBid: 0.0012,
                bestAsk: 0.0013,
                bestBidQuantity: 10_000,
                bestAskQuantity: 10_000,
                bidDepth: 10_000,
                askDepth: 10_000,
                relativeSpreadBps: 800,
                imbalance: 0,
                thin: false,
                exactBook: Object.freeze({
                    observedAt,
                    bids: Object.freeze([
                        {
                            priceSwapHivePerToken: "0.00120000",
                            quantity: "10000.000"
                        }
                    ]),
                    asks: Object.freeze([
                        {
                            priceSwapHivePerToken: "0.00130000",
                            quantity: "10000.000"
                        }
                    ]),
                    bidComplete: true,
                    askComplete: true,
                    bidOrdered: true,
                    askOrdered: true
                })
            })
        ]),
        pools: Object.freeze([
            Object.freeze({
                pair: "DEC:SWAP.HIVE",
                impliedPrice: 0.001,
                baseQuantity: 1_000_000,
                quoteQuantity: 1_000,
                baseQuantityExact: "1000000.000",
                quoteQuantityExact: "1000.00000000",
                tvlQuote: 2_000,
                feeBps: 0
            })
        ]),
        precision: Object.freeze({
            DEC: 3,
            "SWAP.HIVE": 8
        })
    });
}
function reverseRoundTripMarket(tokens = {
    "SWAP.HIVE": "1.00000000"
}) {
    const observedAt = new Date().toISOString();
    return Object.freeze({
        observedAt,
        tokens,
        venues: Object.freeze([
            Object.freeze({
                venue: "hive-engine",
                pair: "DEC/SWAP.HIVE",
                midpoint: 0.000825,
                bestBid: 0.0008,
                bestAsk: 0.00085,
                bestBidQuantity: 10_000,
                bestAskQuantity: 10_000,
                bidDepth: 10_000,
                askDepth: 10_000,
                relativeSpreadBps: 606,
                imbalance: 0,
                thin: false,
                exactBook: Object.freeze({
                    observedAt,
                    bids: Object.freeze([
                        {
                            priceSwapHivePerToken: "0.00080000",
                            quantity: "10000.000"
                        }
                    ]),
                    asks: Object.freeze([
                        {
                            priceSwapHivePerToken: "0.00085000",
                            quantity: "10000.000"
                        }
                    ]),
                    bidComplete: true,
                    askComplete: true,
                    bidOrdered: true,
                    askOrdered: true
                })
            })
        ]),
        pools: Object.freeze([
            Object.freeze({
                pair: "DEC:SWAP.HIVE",
                impliedPrice: 0.0012,
                baseQuantity: 1_000_000,
                quoteQuantity: 1_200,
                baseQuantityExact: "1000000.000",
                quoteQuantityExact: "1200.00000000",
                tvlQuote: 2_400,
                feeBps: 0
            })
        ]),
        precision: Object.freeze({
            DEC: 3,
            "SWAP.HIVE": 8
        })
    });
}
function emptyFleetOrderScan(accounts, observedAt = new Date().toISOString()) {
    const normalized = Object.freeze([
        ...new Set(accounts.map((account)=>account.toLowerCase()))
    ].sort());
    return Object.freeze({
        kind: "aagaard.maker-order-scan",
        observedAt,
        source: "hive-engine.market.buyBook+sellBook",
        accountsRequested: normalized,
        accountsObserved: normalized,
        complete: true,
        orders: Object.freeze([]),
        limitations: Object.freeze([])
    });
}
function roundTripState(wallet) {
    return Object.freeze({
        account: wallet.account,
        hive: "1.000 HIVE",
        hbd: "1.000 HBD",
        currentMana: "9000",
        maxMana: "10000",
        tokens: Object.freeze({
            "SWAP.HIVE": "1.00000000"
        })
    });
}
function exactWalletConfig(config, account) {
    const wallet = config.wallets.find((entry)=>entry.account === account);
    assert.ok(wallet, `${account} must exist in the configured fleet`);
    return Object.freeze({
        ...config,
        wallets: Object.freeze([
            wallet
        ])
    });
}
test("replacement exposes the older Aagaard lane capabilities as wallet arenas", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-"));
    try {
        const config = loadAagaardConfig();
        const runtime = createAagaardRuntime(config, ensureStore(root));
        const readout = await runtime.runTick("2026-07-08T00:00:00.000Z");
        assert.equal(readout.accounts.length, 6);
        assert.ok(readout.witness.rows >= readout.accounts.length * 3);
        for (const account of readout.accounts){
            const arenaNames = new Set(account.arenas.map((arena)=>arena.name));
            assert.ok(arenaNames.has("voting"));
            assert.ok(arenaNames.has("trading"));
            assert.ok(arenaNames.has("incentive"));
            assert.ok(arenaNames.has("posting"));
            assert.ok(arenaNames.has("gaming"));
            assert.equal(account.posting.locked, true);
            assert.equal(account.gaming.locked, true);
        }
        assert.match(fleetWitnessDigest(readout), /aagaard\.fleet-tick/);
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
test("posting and gaming stay source-locked while voting/trading/incentive are runtime-gated", ()=>{
    const config = loadAagaardConfig();
    const runtime = createAagaardRuntime(config, ensureStore(mkdtempSync(path.join(tmpdir(), "aagaard-"))));
    const report = capabilityReport(config, runtime.control);
    assert.equal(isLocked("posting"), true);
    assert.equal(isLocked("gaming"), true);
    assert.equal(report.find((entry)=>entry.capability === "posting")?.enabled, false);
    assert.equal(report.find((entry)=>entry.capability === "gaming")?.enabled, false);
    assert.equal(runtime.control.enable("posting"), false);
});
test("parity report separates older route coverage from live write readiness", ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-parity-"));
    try {
        const keyRoot = path.join(root, "keys");
        const configPath = path.join(root, "aagaard.config.json");
        writeFileSync(configPath, JSON.stringify({ accounts: [{ account: "sigmund-vexler", archetype: "alpha-hunter", tradingLive: true }] }));
        const config = loadAagaardConfig({
            configPath,
            env: {
                ...process.env,
                AAGAARD_LIVE: "0",
                HIVE_KEY_ROOT: keyRoot
            }
        });
        const runtime = createAagaardRuntime(config, ensureStore(path.join(root, "store")));
        const report = aagaardParityReport(config, runtime.control);
        assert.equal(report.kind, "aagaard.parity-report");
        assert.equal(report.olderApplication, "lib/emsenn/lib/triage/sites/aagaard.561.group");
        assert.equal(report.routes.every((claim)=>claim.status !== "open"), true);
        assert.equal(report.capabilities.find((claim)=>claim.claim === "wallets are actors playing games in arenas")?.status, "exceeded");
        assert.equal(report.capabilities.find((claim)=>claim.claim === "Hive live write boundary")?.status, "open");
        assert.equal(report.complete, false);
        assert.ok(report.open.includes("fleet is disarmed"));
        assert.ok(report.open.includes("the fleet signer is not configured"));
        assert.ok(report.open.includes("no posting key found under keyRoot"));
        assert.ok(report.open.includes("no active key found under keyRoot"));
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
test("wallet plans cover alpha, trading liquidity, incentives, and locked game detection", ()=>{
    const config = loadAagaardConfig();
    const wallet = config.wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const radar = readAlphaRadar();
    assert.ok(radar.sinks.length > 0);
    const voting = planVotes(wallet);
    assert.equal(voting.arena.name, "voting");
    assert.ok(voting.intelligence.posts.length > 0);
    const trading = planTrades(wallet);
    assert.equal(trading.liveEligible, true);
    assert.ok(trading.liquidity.corridors.length > 0);
    const incentives = planIncentives(wallet);
    assert.ok(incentives.offers.length > 0);
    const noCustodyEvidence = planGaming(wallet);
    assert.equal(noCustodyEvidence.games.length, 0);
    const games = planGaming(wallet, "2026-07-22T08:00:00.000Z", Object.freeze({
        account: wallet.account,
        hive: "0.000 HIVE",
        hbd: "0.000 HBD",
        currentMana: "0",
        maxMana: "0",
        tokens: Object.freeze({
            DEC: "12.5",
            SPS: "3.2"
        })
    }));
    assert.equal(games.arena.locked, true);
    assert.ok(games.games.some((game)=>game.game === "Splinterlands"));
});
test("Rising Star detection requires observed custody and remains manual-only", ()=>{
    const config = loadAagaardConfig();
    const wallet = config.wallets.find((entry)=>entry.account === "essiebee");
    assert.ok(wallet);
    assert.equal(wallet.tokens["STARBITS"], undefined);
    assert.equal(planGaming(wallet).games.length, 0);
    const observed = planGaming(wallet, "2026-07-22T08:00:00.000Z", Object.freeze({
        account: wallet.account,
        hive: "0.000 HIVE",
        hbd: "0.000 HBD",
        currentMana: "0",
        maxMana: "0",
        tokens: Object.freeze({
            STARBITS: "1.00000000"
        })
    }));
    assert.deepEqual(observed.games, [
        Object.freeze({
            game: "Rising Star",
            heldTokens: Object.freeze([
                Object.freeze({
                    symbol: "STARBITS",
                    balance: "1.00000000"
                })
            ]),
            customJsonId: "server-session-no-custom-json",
            proposedMove: "manual-only inventory/recovery review while current terms prohibit bots and multiple accounts",
            approvedForBroadcast: false
        })
    ]);
});
test("curation planning refuses posts the wallet has already voted", ()=>{
    const config = loadAagaardConfig();
    const wallet = config.wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const at = "2026-09-25T12:00:00.000Z";
    const posts = ["one", "two", "three"].map((permlink)=>postCandidateFromHive({
            author: "writer", permlink, category: "hive-167922", created: "2026-09-25T10:00:00",
            net_rshares: "5000000", abs_rshares: "5000000", pending_payout_value: "0.500 HBD", children: 3,
            author_reputation: "100000000000", json_metadata: "{}", title: "t", body: "b",
            active_votes: [wallet.account, "v2", "v3", "v4", "v5"].map((voter)=>({ voter, rshares: "1000000" }))
        }, Date.parse(at)));
    const price = { hbdPerRshare: rationalOfBigInts(1n, 10_000_000n), percentCurationRewards: 5000, votePowerReserveRate: 10 };
    const plan = planVotes(wallet, posts, at, { currentMana: "30000000000000", maxMana: "30000000000000" }, [wallet], undefined, price);
    assert.equal(plan.votes.length, 0);
    assert.equal(plan.refusals.length, 3);
    assert.ok(plan.refusals.every((refusal)=>refusal.reason === "already-voted"));
});
test("Hive adapter maps ranked posts and regenerated account mana into the arena substrate", async ()=>{
    const now = Math.floor(Date.now() / 1000);
    const calls = [];
    const fetchImpl = async (_input, init)=>{
        const payload = JSON.parse(String(init?.body));
        calls.push(payload);
        const result = payload.method === "condenser_api.get_accounts" ? [
            {
                name: "sigmund-vexler",
                balance: "1.234 HIVE",
                hbd_balance: "5.678 HBD",
                voting_power: 1,
                vesting_shares: "100.000000 VESTS",
                delegated_vesting_shares: "10.000000 VESTS",
                received_vesting_shares: "25.000000 VESTS",
                voting_manabar: {
                    current_mana: "57500000",
                    last_update_time: now - 216_000
                }
            }
        ] : [
            {
                author: "chain-author",
                permlink: "chain-post",
                title: "Chain post",
                body: "Reblog and comment to earn 2 PIZZA.",
                category: "dev",
                json_metadata: JSON.stringify({
                    tags: [
                        "dev",
                        "hive-167922"
                    ]
                }),
                pending_payout_value: "0.100 HBD",
                net_rshares: "10000",
                children: 3,
                created: "2026-07-08T00:00:00",
                active_votes: [
                    {
                        voter: "reader",
                        rshares: "10000"
                    }
                ]
            }
        ];
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const config = loadAagaardConfig();
    const wallet = config.wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const hive = createHiveClient({
        nodes: [
            "https://example.invalid"
        ],
        timeoutMs: 1000,
        perSourceLimit: 1,
        fetch: fetchImpl
    });
    const [posts, state] = await Promise.all([
        hive.readCandidateField(wallet),
        hive.readWalletState(wallet)
    ]);
    assert.equal(posts[0]?.author, "chain-author");
    assert.equal(posts[0]?.votes[0]?.voter, "reader");
    assert.equal(state?.hive, "1.234 HIVE");
    assert.equal(state?.currentMana, "115000000");
    assert.equal(state?.maxMana, "115000000");
    assert.ok(calls.length >= 2);
});
test("Hive post mapper tolerates missing optional chain fields", ()=>{
    const post = postCandidateFromHive({
        author: "a",
        permlink: "p",
        json_metadata: "{bad"
    });
    assert.equal(post?.author, "a");
    assert.deepEqual(post?.tags, []);
});
test("Hive internal-market reader preserves executable bid quantities in absolute units", async ()=>{
    let calls = 0;
    const fetchImpl = async (_input, init)=>{
        calls += 1;
        const payload = JSON.parse(String(init?.body));
        const result = payload.method === "condenser_api.get_ticker" ? {
            latest: "0.050000",
            highest_bid: "0.050000",
            lowest_ask: "0.051000"
        } : {
            bids: [
                {
                    real_price: "0.050000",
                    hive: 20_000,
                    hbd: 1_000
                },
                {
                    real_price: "0.049000",
                    hive: 10_000,
                    hbd: 490
                }
            ],
            asks: [
                {
                    real_price: "0.051000",
                    hive: 30_000,
                    hbd: 1_530
                }
            ]
        };
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const hive = createHiveClient({
        nodes: [
            "https://example.invalid"
        ],
        timeoutMs: 1000,
        perSourceLimit: 1,
        fetch: fetchImpl
    });
    const reading = await hive.readInternalMarket?.();
    assert.equal(reading?.bestBid, 0.05);
    assert.equal(reading?.bestBidQuantityHive, 20);
    assert.equal(reading?.bidDepth, 1.49);
    assert.equal(reading?.asks?.[0]?.hiveQuantity, 30);
    assert.equal((await hive.readInternalMarket?.())?.bestBid, 0.05);
    assert.equal(calls, 2);
});
test("round-trip planner funds a whole bounded bundle and emits no independently executable legs", ()=>{
    const wallet = loadAagaardConfig().wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const plan = planTrades(wallet, "2026-07-08T00:00:00.000Z", roundTripState(wallet), roundTripMarket());
    const funded = plan.bundles.filter((bundle)=>bundle.funded);
    assert.equal(funded.length, 1);
    assert.equal(plan.trades.length, 0);
    assert.equal(plan.allocation.fundedCount, 1);
    assert.equal(plan.allocationUnit, "SWAP.HIVE");
    assert.equal(plan.allocation.totalCost, funded[0]?.capitalSwapHive);
    assert.equal(plan.allocation.totalBenefit, Number(funded[0]?.worstCaseProfitSwapHive));
    assert.equal(Number(funded[0]?.quantity) > 0, true);
    assert.equal(Number(funded[0]?.expectedInputSwapHive) <= Number(funded[0]?.maxInputSwapHive), true);
    assert.equal(Number(funded[0]?.maxInputSwapHive) <= 1, true);
    assert.equal(Number(funded[0]?.minimumProceedsSwapHive) > Number(funded[0]?.maxInputSwapHive), true);
    assert.equal(Number(funded[0]?.worstCaseProfitSwapHive) > 0, true);
    const reverse = planTrades(wallet, "2026-07-08T00:00:00.000Z", roundTripState(wallet), reverseRoundTripMarket());
    assert.equal(reverse.bundles.some((bundle)=>bundle.funded), false);
    assert.ok(reverse.bundles.some((bundle)=>bundle.refusalReason?.includes("cannot condition the pool exit")));
});
test("round-trip planner refuses the entire opportunity when admitted input capital is absent", async ()=>{
    const wallet = loadAagaardConfig().wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const state = Object.freeze({
        ...roundTripState(wallet),
        tokens: Object.freeze({})
    });
    const plan = planTrades(wallet, "2026-07-08T00:00:00.000Z", state, roundTripMarket({}));
    assert.equal(plan.bundles.some((bundle)=>bundle.funded), false);
    assert.equal(plan.bundles.some((bundle)=>bundle.refusalReason === "no admitted SWAP.HIVE capital balance"), true);
    const moves = hiveWalletMoves({ wallet, plans: { trading: plan }, armed: { voting: false, trading: true, incentive: false } });
    assert.ok(moves.length > 0 && moves.every((candidate)=>candidate.state === "blocked"));
});
test("hive-broadcast sends funds only to the peg or another fleet account", async ()=>{
    const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
    const run = (operation)=>new Promise((resolve)=>{
            const child = spawn(process.execPath, [
                script
            ], {
                stdio: [
                    "pipe",
                    "pipe",
                    "ignore"
                ]
            });
            let stdout = "";
            child.stdout.on("data", (chunk)=>{
                stdout += String(chunk);
            });
            child.on("close", (code)=>resolve({
                    code,
                    stdout
                }));
            child.stdin.end(JSON.stringify({
                account: "sigmund-vexler",
                role: "active",
                operation
            }));
        });
    const wrongAccount = await run([
        "transfer",
        {
            from: "sigmund-vexler",
            to: "some-random-account",
            amount: "1.000 HIVE",
            memo: WRAP_MEMO
        }
    ]);
    assert.equal(wrongAccount.code, 0);
    assert.ok(wrongAccount.stdout.includes("goes only to another fleet account or the HIVE/SWAP.HIVE peg"), wrongAccount.stdout);
    const wrongMemo = await run([
        "transfer",
        {
            from: "sigmund-vexler",
            to: HONEY_SWAP_ACCOUNT,
            amount: "1.000 HIVE",
            memo: "not the real memo"
        }
    ]);
    assert.equal(wrongMemo.code, 0);
    assert.ok(wrongMemo.stdout.includes("goes only to another fleet account or the HIVE/SWAP.HIVE peg"), wrongMemo.stdout);
    const malformedAmount = await run([
        "transfer",
        {
            from: "sigmund-vexler",
            to: HONEY_SWAP_ACCOUNT,
            amount: "1 HIVE",
            memo: WRAP_MEMO
        }
    ]);
    assert.equal(malformedAmount.code, 0);
    assert.ok(malformedAmount.stdout.includes("not a well-formed"));
    const wellFormed = await run([
        "transfer",
        {
            from: "sigmund-vexler",
            to: HONEY_SWAP_ACCOUNT,
            amount: "1.234 HIVE",
            memo: WRAP_MEMO
        }
    ]);
    assert.equal(wellFormed.code, 0);
    assert.ok(wellFormed.stdout.includes("key-unavailable"), `expected to fail past transfer validation and hit the keyFile read, got: ${wellFormed.stdout}`);
    const toFleet = await run([
        "transfer",
        {
            from: "sigmund-vexler",
            to: "michael561",
            amount: "2.500 HBD",
            memo: ""
        }
    ]);
    assert.ok(toFleet.stdout.includes("key-unavailable"), toFleet.stdout);
});
test("hive-broadcast admits only an exact posting-authorized TerraCore claim", async ()=>{
    const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
    const run = (payload)=>new Promise((resolve)=>{
            const child = spawn(process.execPath, [
                script
            ], {
                stdio: [
                    "pipe",
                    "pipe",
                    "ignore"
                ]
            });
            let stdout = "";
            child.stdout.on("data", (chunk)=>{
                stdout += String(chunk);
            });
            child.on("close", (code)=>resolve({
                    code,
                    stdout
                }));
            child.stdin.end(JSON.stringify(payload));
        });
    const operation = [
        "custom_json",
        {
            id: "terracore_claim",
            required_auths: [],
            required_posting_auths: [
                "michael561"
            ],
            json: '{"amount":"68.88013281"}'
        }
    ];
    const valid = await run({
        account: "michael561",
        role: "posting",
        operation
    });
    assert.equal(valid.code, 0);
    assert.ok(valid.stdout.includes("key-unavailable"), valid.stdout);
    const active = await run({
        account: "michael561",
        role: "active",
        operation
    });
    assert.ok(active.stdout.includes("posting authority"), active.stdout);
    const rounded = structuredClone(operation);
    rounded[1]["json"] = '{"amount":"68.8801328"}';
    const malformed = await run({
        account: "michael561",
        role: "posting",
        operation: rounded
    });
    assert.ok(malformed.stdout.includes("positive 8-decimal"), malformed.stdout);
    const battle = structuredClone(operation);
    battle[1]["id"] = "terracore_battle";
    battle[1]["json"] = '{"target":"some-player"}';
    const admittedBattle = await run({
        account: "michael561",
        role: "posting",
        lane: "gaming",
        target: "terracore-one-action",
        operation: battle
    });
    assert.equal(admittedBattle.code, 0);
    assert.ok(admittedBattle.stdout.includes("key-unavailable"), admittedBattle.stdout);
    const unboundedBattle = await run({
        account: "michael561",
        role: "posting",
        operation: battle
    });
    assert.ok(unboundedBattle.stdout.includes("one-action gaming lane"), unboundedBattle.stdout);
    const selfBattle = structuredClone(battle);
    selfBattle[1]["json"] = '{"target":"michael561"}';
    const refusedSelf = await run({
        account: "michael561",
        role: "posting",
        lane: "gaming",
        target: "terracore-one-action",
        operation: selfBattle
    });
    assert.ok(refusedSelf.stdout.includes("non-self target"), refusedSelf.stdout);
});
test("hive-broadcast admits only an exact TerraCore engineering SCRAP burn lane", async ()=>{
    const script = fileURLToPath(new URL("../scripts/hive-broadcast.mjs", import.meta.url));
    const run = (payload)=>new Promise((resolve)=>{
            const child = spawn(process.execPath, [
                script
            ], {
                stdio: [
                    "pipe",
                    "pipe",
                    "ignore"
                ]
            });
            let stdout = "";
            child.stdout.on("data", (chunk)=>{
                stdout += String(chunk);
            });
            child.on("close", (code)=>resolve({
                    code,
                    stdout
                }));
            child.stdin.end(JSON.stringify(payload));
        });
    const operation = [
        "custom_json",
        {
            id: "ssc-mainnet-hive",
            required_auths: [
                "michael561"
            ],
            required_posting_auths: [],
            json: JSON.stringify({
                contractName: "tokens",
                contractAction: "transfer",
                contractPayload: {
                    symbol: "SCRAP",
                    to: "null",
                    quantity: "196.00000000",
                    memo: "terracore_engineering-0123456789abcdef"
                }
            })
        }
    ];
    const valid = await run({
        account: "michael561",
        role: "active",
        lane: "gaming",
        target: "terracore-engineering-upgrade",
        operation
    });
    assert.equal(valid.code, 0);
    assert.ok(valid.stdout.includes("key-unavailable"), valid.stdout);
    const wrongStat = structuredClone(operation);
    const wrongFields = wrongStat[1];
    const wrongDecoded = JSON.parse(String(wrongFields["json"] ?? "{}"));
    wrongDecoded.contractPayload.memo = "terracore_damage-0123456789abcdef";
    wrongFields["json"] = JSON.stringify(wrongDecoded);
    const refusedStat = await run({
        account: "michael561",
        role: "active",
        lane: "gaming",
        target: "terracore-engineering-upgrade",
        operation: wrongStat
    });
    assert.ok(refusedStat.stdout.includes("engineering upgrade"), refusedStat.stdout);
    const wrongLane = await run({
        account: "michael561",
        role: "active",
        lane: "gaming",
        target: "some-other-burn",
        operation
    });
    assert.ok(wrongLane.stdout.includes("tokens move only between fleet accounts"), wrongLane.stdout);
});
test("Hive-Engine adapter maps balances, books, and pools into market state", async ()=>{
    const bookIndexes = [];
    const fetchImpl = async (_input, init)=>{
        const payload = JSON.parse(String(init?.body));
        const { contract, table, query } = payload.params;
        if (contract === "market" && (table === "buyBook" || table === "sellBook")) bookIndexes.push({
            table,
            indexes: payload.params.indexes
        });
        let result = [];
        if (contract === "tokens" && table === "balances") {
            result = [
                {
                    account: query["account"],
                    symbol: "DEC",
                    balance: "12.5"
                },
                {
                    account: query["account"],
                    symbol: "BUDS",
                    balance: "0"
                }
            ];
        } else if (contract === "market" && table === "buyBook" && query["symbol"] === "DEC") {
            result = [
                {
                    symbol: "DEC",
                    price: "0.00075",
                    quantity: "1000"
                }
            ];
        } else if (contract === "market" && table === "sellBook" && query["symbol"] === "DEC") {
            result = [
                {
                    symbol: "DEC",
                    price: "0.00085",
                    quantity: "800"
                }
            ];
        } else if (contract === "marketpools" && table === "pools") {
            result = [
                {
                    tokenPair: "DEC:SWAP.HIVE",
                    baseQuantity: "1000000",
                    quoteQuantity: "900",
                    tradeFeeMultiplier: "0.9975"
                }
            ];
        }
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const config = loadAagaardConfig();
    const wallet = config.wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const hiveEngine = createHiveEngineClient({
        nodes: [
            "https://example.invalid/contracts"
        ],
        timeoutMs: 1000,
        balanceLimit: 100,
        marketLimit: 10,
        poolLimit: 10,
        symbols: [
            "DEC"
        ],
        fetch: fetchImpl
    });
    const chainState = Object.freeze({
        account: wallet.account,
        hive: "1.000 HIVE",
        hbd: "1.000 HBD",
        currentMana: "9000",
        maxMana: "10000",
        tokens: Object.freeze({})
    });
    const market = await hiveEngine.readWalletMarket(wallet, chainState);
    assert.equal(market?.tokens["DEC"], "12.5");
    assert.ok(Math.abs((market?.venues.find((venue)=>venue.pair === "DEC/SWAP.HIVE")?.midpoint ?? 0) - 0.0008) < 0.0000001);
    assert.equal(market?.venues.find((venue)=>venue.pair === "DEC/SWAP.HIVE")?.bestBid, 0.00075);
    assert.equal(market?.pools.find((pool)=>pool.pair === "DEC:SWAP.HIVE")?.feeBps, 25);
    assert.equal(market?.pools.find((pool)=>pool.pair === "DEC:SWAP.HIVE")?.baseQuantity, 1_000_000);
    assert.deepEqual(bookIndexes.sort((left, right)=>left.table.localeCompare(right.table)), [
        {
            table: "buyBook",
            indexes: [
                {
                    index: "priceDec",
                    descending: true
                }
            ]
        },
        {
            table: "sellBook",
            indexes: [
                {
                    index: "priceDec",
                    descending: false
                }
            ]
        }
    ]);
    const merged = mergeWalletState(wallet, chainState, market);
    const games = planGaming(wallet, "2026-07-08T00:00:00.000Z", merged);
    assert.ok(games.games.some((game)=>game.game === "Splinterlands" && game.heldTokens.some((token)=>token.symbol === "DEC")));
    const trading = planTrades(wallet, "2026-07-08T00:00:00.000Z", merged, market);
    assert.ok(trading.liquidity.venues.some((venue)=>venue.pair === "DEC/SWAP.HIVE"));
    assert.ok(trading.liquidity.pools.some((pool)=>pool.pair === "DEC:SWAP.HIVE"));
});
test("a transient token-balance RPC failure does not erase shared market structure or invent capital", async ()=>{
    const fetchImpl = async (_input, init)=>{
        const payload = JSON.parse(String(init?.body));
        const { contract, table, query } = payload.params;
        if (contract === "tokens" && table === "balances") throw new Error("transient balance outage");
        let result = [];
        if (contract === "market" && table === "buyBook" && query["symbol"] === "DEC") result = [
            {
                price: "0.0012",
                quantity: "1000"
            }
        ];
        if (contract === "market" && table === "sellBook" && query["symbol"] === "DEC") result = [
            {
                price: "0.0013",
                quantity: "1000"
            }
        ];
        if (contract === "marketpools" && table === "pools") result = [
            {
                tokenPair: "DEC:SWAP.HIVE",
                baseQuantity: "1000000",
                quoteQuantity: "1000"
            }
        ];
        if (contract === "tokens" && table === "tokens") result = [
            {
                symbol: "DEC",
                precision: 3
            },
            {
                symbol: "SWAP.HIVE",
                precision: 8
            }
        ];
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result
        }), {
            status: 200,
            headers: {
                "content-type": "application/json"
            }
        });
    };
    const wallet = loadAagaardConfig().wallets.find((entry)=>entry.account === "sigmund-vexler");
    assert.ok(wallet);
    const client = createHiveEngineClient({
        nodes: [
            "https://example.invalid/contracts"
        ],
        timeoutMs: 1000,
        balanceLimit: 100,
        marketLimit: 10,
        poolLimit: 500,
        symbols: [
            "DEC"
        ],
        fetch: fetchImpl
    });
    const state = Object.freeze({
        ...roundTripState(wallet),
        tokens: Object.freeze({})
    });
    const market = await client.readWalletMarket(wallet, state);
    assert.deepEqual(market?.tokens, {});
    assert.equal(market?.availability?.balances, false);
    assert.equal(market?.availability?.pools, true);
    assert.equal(market?.venues[0]?.bestBid, 0.0012);
    assert.equal(market?.pools[0]?.baseQuantity, 1_000_000);
    assert.equal(market?.pools[0]?.feeBps, 25);
    const plan = planTrades(wallet, undefined, state, market);
    assert.equal(plan.bundles.some((bundle)=>bundle.funded), false);
});
test("Hive-Engine market reads serialize provider requests", async ()=>{
    const config = loadAagaardConfig();
    const wallet = config.wallets.find((entry)=>entry.account === "michael561");
    assert.ok(wallet);
    let inFlight = 0;
    let maximumInFlight = 0;
    const symbols = [
        "DEC",
        "SPS",
        "SPSP",
        "VOUCHER",
        "STARBITS",
        "STARPRO",
        "SIM",
        "BUDS",
        "SEEDS"
    ];
    const fetchImpl = async (_input, init)=>{
        inFlight += 1;
        maximumInFlight = Math.max(maximumInFlight, inFlight);
        if (inFlight > 1) throw new Error("provider request serialization failed");
        try {
            await new Promise((resolvePromise)=>setTimeout(resolvePromise, 5));
            const payload = JSON.parse(String(init?.body));
            const { contract, table, query } = payload.params;
            let result = [];
            if (contract === "marketpools" && table === "pools") result = symbols.map((symbol)=>({
                    tokenPair: `${symbol}:SWAP.HIVE`,
                    baseQuantity: "1000",
                    quoteQuantity: "1"
                }));
            if (contract === "market" && table === "buyBook") result = [
                {
                    price: "0.00100000",
                    quantity: "1000"
                }
            ];
            if (contract === "market" && table === "sellBook") result = [
                {
                    price: "0.00110000",
                    quantity: "1000"
                }
            ];
            if (contract === "tokens" && table === "tokens") {
                const requested = query["symbol"]?.$in ?? [];
                result = requested.map((symbol)=>({
                        symbol,
                        precision: symbol === "SWAP.HIVE" ? 8 : 3
                    }));
            }
            return new Response(JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                result
            }), {
                status: 200,
                headers: {
                    "content-type": "application/json"
                }
            });
        } finally{
            inFlight -= 1;
        }
    };
    const client = createHiveEngineClient({
        nodes: [
            "https://provider.example/rpc/contracts"
        ],
        timeoutMs: 1000,
        balanceLimit: 100,
        marketLimit: 10,
        poolLimit: 100,
        symbols,
        fetch: fetchImpl
    });
    const market = await client.readWalletMarket(wallet, Object.freeze({
        account: wallet.account,
        hive: "0.000 HIVE",
        hbd: "0.000 HBD",
        currentMana: "0",
        maxMana: "0",
        tokens: Object.freeze({})
    }));
    assert.ok(market);
    assert.equal(maximumInFlight, 1);
    assert.equal(market.availability?.booksObserved, market.availability?.booksRequested);
});
test("armed ticks use key-vault aware execution receipts instead of inferred broadcasts", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-"));
    const keyRoot = path.join(root, "keys");
    try {
        const loaded = loadAagaardConfig({
            env: {
                ...process.env,
                AAGAARD_LIVE: "1",
                HIVE_KEY_ROOT: keyRoot
            }
        });
        const config = exactWalletConfig(loaded, "sigmund-vexler");
        const evidenceAt = "2026-07-08T13:00:00.000Z";
        const market = {
            async readWalletMarket () {
                return roundTripMarket({
                    "SWAP.HIVE": "1.00000000"
                }, evidenceAt);
            },
            async readFleetOpenOrders (accounts) {
                return emptyFleetOrderScan(accounts, evidenceAt);
            }
        };
        const noKeyRuntime = createAagaardRuntime(config, ensureStore(path.join(root, "no-keys")), {
            sign: async ()=>({ status: "refused", datum: "key-unavailable", reason: "no posting key is stored" }),
            market,
            now: ()=>Date.parse(evidenceAt)
        });
        const noKeyReadout = await noKeyRuntime.runTick(evidenceAt);
        const noKeySigmund = noKeyReadout.accounts.find((account)=>account.account === "sigmund-vexler");
        assert.ok(noKeySigmund?.voting);
        assert.equal(noKeySigmund.voting.votesBroadcast, 0);
        assert.equal(noKeySigmund.voting.votesSkipped, noKeySigmund.voting.votesPlanned);
        assert.ok(noKeySigmund.voting.execution.receipts.every((entry)=>entry.status === "refused" && entry.error?.startsWith("key-unavailable")));
        assert.equal(noKeySigmund.trading?.mode, "live");
        const noKeyStatus = noKeyRuntime.status();
        assert.equal(noKeyStatus.accounts[0]?.keys.posting, false);
        mkdirSync(path.join(keyRoot, "sigmund-vexler"), {
            recursive: true
        });
        writeFileSync(path.join(keyRoot, "sigmund-vexler", "posting.wif"), "posting-key\n");
        writeFileSync(path.join(keyRoot, "sigmund-vexler", "active.wif"), "active-key\n");
        const sign = async (request)=>({ status: "broadcast", id: "b".repeat(40), request });
        const keyedRuntime = createAagaardRuntime(config, ensureStore(path.join(root, "with-keys")), {
            sign,
            market,
            now: ()=>Date.parse(evidenceAt)
        });
        const keyedReadout = await keyedRuntime.runTick(evidenceAt);
        const keyedSigmund = keyedReadout.accounts.find((account)=>account.account === "sigmund-vexler");
        assert.ok(keyedSigmund?.voting);
        assert.equal(keyedSigmund.voting.votesBroadcast, keyedSigmund.voting.votesPlanned);
        assert.ok(keyedSigmund.voting.execution.receipts.every((entry)=>entry.status === "broadcast" && entry.txId === "b".repeat(40)));
        assert.equal(keyedSigmund.trading?.mode, "live");
        assert.ok((keyedSigmund.trading?.execution.receipts ?? []).every((entry)=>entry.status !== "error"), JSON.stringify(keyedSigmund.trading?.execution.receipts ?? []));
        const keyedStatus = keyedRuntime.status();
        assert.equal(keyedStatus.accounts[0]?.keys.active, true);
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
test("a configured live runtime refuses unavailable substrate instead of trading seeded fallbacks", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-unavailable-substrate-"));
    const keyRoot = path.join(root, "keys");
    try {
        mkdirSync(path.join(keyRoot, "sigmund-vexler"), {
            recursive: true
        });
        writeFileSync(path.join(keyRoot, "sigmund-vexler", "posting.wif"), "posting-key\n");
        writeFileSync(path.join(keyRoot, "sigmund-vexler", "active.wif"), "active-key\n");
        const config = loadAagaardConfig({
            env: {
                ...process.env,
                AAGAARD_LIVE: "1",
                HIVE_KEY_ROOT: keyRoot
            }
        });
        const hive = {
            async readCandidateField () {
                throw new Error("Hive unavailable");
            },
            async readWalletState () {
                throw new Error("Hive unavailable");
            },
            async readInternalMarket () {
                throw new Error("Hive unavailable");
            }
        };
        const market = {
            async readWalletMarket () {
                throw new Error("Hive Engine unavailable");
            }
        };
        let writes = 0;
        const sign = async ()=>{
            writes += 1;
            return { status: "broadcast", id: "c".repeat(40) };
        };
        const store = ensureStore(path.join(root, "store"));
        const runtime = createAagaardRuntime(config, store, {
            hive,
            market,
            sign
        });
        const readout = await runtime.runTick("2026-07-08T13:06:00.000Z");
        assert.equal(writes, 0);
        assert.ok(readout.accounts.every((entry)=>(entry.voting?.votesPlanned ?? 0) === 0));
        assert.ok(readout.accounts.every((entry)=>(entry.trading?.tradesPlanned ?? 0) === 0));
        assert.ok(readout.accounts.every((entry)=>(entry.trading?.bundlesPlanned ?? 0) === 0));
        assert.ok(readSubstrateSnapshots(store, 20).every((snapshot)=>snapshot.posts.length === 0 && snapshot.market === null && snapshot.chainState.hive === "0.000 HIVE" && Object.keys(snapshot.chainState.tokens).length === 0));
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
test("armed runtime votes, and trades only in lanes the fleet config enables", async ()=>{
    const root = mkdtempSync(path.join(tmpdir(), "aagaard-runtime-broadcast-"));
    try {
        const config = exactWalletConfig(loadAagaardConfig({
            env: {
                ...process.env,
                AAGAARD_LIVE: "1"
            }
        }), "sigmund-vexler");
        const requests = [];
        const sign = async (request)=>{
            requests.push(request);
            return { status: "broadcast", id: "a".repeat(40) };
        };
        const evidenceAt = "2026-07-08T13:10:00.000Z";
        const market = {
            async readWalletMarket () {
                return roundTripMarket({
                    "SWAP.HIVE": "1.00000000"
                }, evidenceAt);
            },
            async readFleetOpenOrders (accounts) {
                return emptyFleetOrderScan(accounts, evidenceAt);
            }
        };
        const runtime = createAagaardRuntime(config, ensureStore(path.join(root, "store")), {
            sign,
            market,
            now: ()=>Date.parse(evidenceAt)
        });
        const readout = await runtime.runTick(evidenceAt);
        const account = readout.accounts.find((entry)=>entry.account === "sigmund-vexler");
        assert.ok(account?.voting);
        assert.ok(account.voting.execution.receipts.every((entry)=>entry.status !== "error"));
        assert.ok(account.trading?.execution.receipts.every((entry)=>entry.status !== "broadcast"), JSON.stringify(account.trading?.execution.receipts ?? []));
        assert.equal(account.trading?.tradesExecuted, 0);
        assert.equal(account.trading?.lpExecuted, 0);
        assert.equal(requests.some((entry)=>entry.lane === "trading" && entry.role === "active"), false);
    } finally{
        rmSync(root, {
            recursive: true,
            force: true
        });
    }
});
test("operator auth exposes protected-resource metadata and bearer decisions", async ()=>{
    const auth = createOperatorAuth({ publicBaseUrl: "http://127.0.0.1:18807/", opsToken: "secret", allowedEmail: "operator@example.invalid", openWhenUnconfigured: false });
    assert.equal(auth.mode, "bearer");
    assert.match(auth.challenge, /oauth-protected-resource/);
    assert.equal((await auth.authorize({})).status, 401);
    assert.equal((await auth.authorize({ authorization: "Bearer wrong" })).status, 403);
    assert.equal((await auth.authorize({ authorization: "Bearer secret" })).ok, true);
    const resource = await (await auth.handle(new Request("http://127.0.0.1:18807/.well-known/oauth-protected-resource"))).json();
    assert.equal(resource.resource, "http://127.0.0.1:18807/ops");
    assert.deepEqual(resource.authorization_servers, ["http://127.0.0.1:18807"]);
    assert.equal((await (await auth.handle(new Request("http://127.0.0.1:18807/.well-known/oauth-authorization-server"))).json()).issuer, "http://127.0.0.1:18807");
    const local = createOperatorAuth({ publicBaseUrl: "http://localhost:18807", allowedEmail: "operator@example.invalid", openWhenUnconfigured: true });
    assert.equal(local.mode, "open");
    assert.equal((await local.authorize({})).ok, true);
});
test("operator auth issues PKCE access tokens to the operator UI and revokes them", async ()=>{
    const base = "http://127.0.0.1:18807";
    const auth = createOperatorAuth({ publicBaseUrl: base, opsToken: "secret", allowedEmail: "operator@example.invalid", openWhenUnconfigured: false });
    const client = await (await auth.handle(new Request(`${base}/oauth/register`, { method: "POST", body: JSON.stringify({ client_name: "aagaard-webux", redirect_uris: [`${base}/ui`] }) }))).json();
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = (token) => auth.handle(new Request(`${base}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: `${base}/ui`, code_challenge: challenge, code_challenge_method: "S256", state: "state-1", operator_token: token })}`));
    const refused = await authorize("wrong");
    assert.equal(refused.status, 302);
    assert.equal(refused.headers.get("location"), "/ui");
    const granted = await authorize("secret");
    const redirected = new URL(granted.headers.get("location"));
    assert.equal(redirected.searchParams.get("state"), "state-1");
    const exchanged = await (await auth.handle(new Request(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: redirected.searchParams.get("code"), client_id: client.client_id, redirect_uri: `${base}/ui`, code_verifier: verifier }) }))).json();
    assert.equal((await auth.authorize({ authorization: `Bearer ${exchanged.access_token}` })).principal, "operator@example.invalid");
    await auth.handle(new Request(`${base}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: exchanged.access_token }) }));
    assert.equal((await auth.authorize({ authorization: `Bearer ${exchanged.access_token}` })).status, 403);
});
test("with a Google client the operator signs in with Google before any code is issued", async ()=>{
    const base = "https://aagaard.example";
    const auth = createOperatorAuth({ publicBaseUrl: base, allowedEmail: "operator@example.invalid", google: { clientId: "google-client", clientSecret: "google-secret" }, sessionSecret: "a-session-secret-for-the-test" });
    assert.equal(auth.mode, "google");
    const client = await (await auth.handle(new Request(`${base}/oauth/register`, { method: "POST", body: JSON.stringify({ client_name: "aagaard-webux", redirect_uris: [`${base}/ui`] }) }))).json();
    const toLogin = await auth.handle(new Request(`${base}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: `${base}/ui`, code_challenge: "c".repeat(43), code_challenge_method: "S256", state: "s" })}`));
    assert.match(toLogin.headers.get("location"), /^\/oauth\/login\?return_to=%2Foauth%2Fauthorize%3F/u);
    const toGoogle = await auth.handle(new Request(`${base}${toLogin.headers.get("location")}`));
    const google = new URL(toGoogle.headers.get("location"));
    assert.equal(google.searchParams.get("client_id"), "google-client");
    assert.equal(google.searchParams.get("redirect_uri"), `${base}/oauth/callback`);
});
