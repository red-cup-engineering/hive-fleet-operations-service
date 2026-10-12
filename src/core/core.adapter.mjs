import { hiveKeyStatus } from "@red-cup-engineering/key-management-services-section/hive-keystore";
import { claimsOf, recordClaim } from "./journal.mjs";
import { ingestOffers } from "../analysis/incentives.mjs";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { tm, canonicalWitnessValue, witnessCell, witnessLogInformation } from "./witness.mjs";
import { hivePostTerm, hiveTagTerm, hiveTagUtterance, induceHiveTopology } from "@red-cup-engineering/hive-computing-service/computing/topology";
import { alphaDecay, capturableSinks, mispricingEnergy } from "@red-cup-engineering/hive-computing-service/computing/analysis/alpha";
import { decimalOfRational } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { gradedFromParts, gradedValue } from "@red-cup-engineering/computer-data-engineering-services-section/number/graded";
import { readVotingIntelligenceOf } from "../analysis/intelligence.mjs";
import { readHolonomy, MIN_POOL_TVL_QUOTE } from "../analysis/holonomy.mjs";
import { recordScoreboardTick } from "./scoreboard.mjs";
import { allocateBudget } from "../analysis/allocation.mjs";
import { readRigidity, edgesFromPools } from "../analysis/rigidity.mjs";
import { detailedBalance } from "../analysis/flow.mjs";
import { catabolicCapacity } from "../analysis/capacity.mjs";
import { readScreening, edgesForScreening } from "../analysis/screening.mjs";
import { readCurationTelemetry, recordCurationPredictions, recordCurationSettlements } from "./curationSettlement.mjs";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-content-address-engineering-services-section/semantic-content-identity";
import { canonicalJsonValue as canonicalize } from "@red-cup-engineering/json-services-section/canonical-json";
import { selectCurationVotes } from "@red-cup-engineering/hive-computing-service/computing/curation";
import { guardFleetSelfCross, recordMakerOrderScan } from "./makerOrders.mjs";
import { sizeExactPoolToBook } from "../analysis/exactArbitrage.mjs";
import { actuateHiveFleetMoves, hiveMoveReceipts, hiveWalletMoves, laneExecution } from "../agent/hive-fleet-domain.mjs";
import { automaticArbitrageReceipt, operateAutomaticArbitrage } from "./automaticArbitrageCycle.mjs";
export const ALL_CAPABILITIES = Object.freeze([
    "voting",
    "trading",
    "incentive",
    "posting",
    "gaming"
]);
export const LOCKED_CAPABILITIES = Object.freeze([
    "posting",
    "gaming"
]);
const DEFAULT_OBJECTIVES = Object.freeze({
    "alpha-hunter": Object.freeze({
        underrecognition: 1.8,
        communityFit: 0.5,
        conversation: 0.5,
        durability: 1.2,
        bridge: 1.2,
        quality: 1.0,
        cartelAversion: 1.4
    }),
    "patron-steward": Object.freeze({
        underrecognition: 1.0,
        communityFit: 1.6,
        conversation: 1.1,
        durability: 1.2,
        bridge: 0.6,
        quality: 1.3,
        cartelAversion: 1.0
    }),
    curator: Object.freeze({
        underrecognition: 1.0,
        communityFit: 1.0,
        conversation: 1.0,
        durability: 1.0,
        bridge: 1.0,
        quality: 1.0,
        cartelAversion: 1.0
    }),
    gardener: Object.freeze({
        underrecognition: 0.9,
        communityFit: 1.7,
        conversation: 1.4,
        durability: 1.0,
        bridge: 0.5,
        quality: 1.1,
        cartelAversion: 0.8
    }),
    scout: Object.freeze({
        underrecognition: 1.4,
        communityFit: 0.8,
        conversation: 1.0,
        durability: 0.8,
        bridge: 1.8,
        quality: 1.0,
        cartelAversion: 1.0
    }),
    archivist: Object.freeze({
        underrecognition: 0.8,
        communityFit: 1.0,
        conversation: 0.7,
        durability: 1.9,
        bridge: 0.7,
        quality: 1.5,
        cartelAversion: 1.2
    })
});
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function strings(value, fallback) {
    return Array.isArray(value) ? Object.freeze(value.filter((entry)=>typeof entry === "string")) : fallback;
}
function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function expandHome(value, env) {
    return value === "~" || value.startsWith("~/") ? path.join(env["HOME"] ?? process.cwd(), value.slice(2)) : value;
}
function readJsonFile(file) {
    return JSON.parse(readFileSync(file, "utf8"));
}
function capability(value) {
    return ALL_CAPABILITIES.includes(value);
}
function enabledCapabilities(raw) {
    const values = Array.isArray(raw) ? raw.filter((entry)=>typeof entry === "string" && capability(entry)) : [
        "voting",
        "trading",
        "incentive"
    ];
    return Object.freeze(values.filter((entry)=>!LOCKED_CAPABILITIES.includes(entry)));
}
function strategyFor(archetype, feeds, overlay) {
    const objectiveRaw = isRecord(overlay["objective"]) ? overlay["objective"] : {};
    const baseObjective = DEFAULT_OBJECTIVES[archetype] ?? DEFAULT_OBJECTIVES["curator"];
    const objective = Object.freeze(Object.fromEntries(Object.entries(baseObjective).map(([key, value])=>[
            key,
            numberOr(objectiveRaw[key], value)
        ])));
    return Object.freeze({
        archetype,
        feeds: Object.freeze([
            ...feeds
        ]),
        objective,
        conviction: numberOr(overlay["conviction"], archetype === "alpha-hunter" ? 1.35 : 1.15),
        votingPowerFloorBps: numberOr(overlay["votingPowerFloorBps"], archetype === "alpha-hunter" ? 6500 : 8000),
        maxVotesPerTick: Math.max(1, Math.floor(numberOr(overlay["maxVotesPerTick"], 1)))
    });
}
function walletFrom(raw) {
    if (!isRecord(raw) || typeof raw["account"] !== "string") return null;
    const account = raw["account"];
    const archetype = typeof raw["archetype"] === "string" ? raw["archetype"] : "curator";
    const feeds = strings(raw["feeds"], [
        "trending"
    ]);
    const tokens = isRecord(raw["tokens"]) ? Object.freeze(Object.fromEntries(Object.entries(raw["tokens"]).filter((entry)=>typeof entry[1] === "string"))) : Object.freeze({});
    return Object.freeze({
        kind: "aagaard.wallet-actor",
        account,
        strategy: strategyFor(archetype, feeds, raw),
        tradingLive: raw["tradingLive"] === true,
        risk: Object.freeze({
            capHiveMilli: numberOr(raw["capHiveMilli"], raw["tradingLive"] === true ? 5000 : 1000),
            capSwapHiveMilli: numberOr(raw["capSwapHiveMilli"], numberOr(raw["capHiveMilli"], raw["tradingLive"] === true ? 5000 : 1000)),
            capHbdMilli: numberOr(raw["capHbdMilli"], raw["tradingLive"] === true ? 5000 : 1000),
            minLiquidHbdMilli: numberOr(raw["minLiquidHbdMilli"], raw["tradingLive"] === true ? 500 : 1000),
            maxVoteWeightBps: Math.max(1, Math.min(10000, Math.floor(numberOr(raw["maxVoteWeightBps"], 5000))))
        }),
        keys: Array.isArray(raw["keys"]) ? Object.freeze(strings(raw["keys"], [])) : null,
        stakeTokens: Object.freeze(strings(raw["stakeTokens"], [])),
        delegateTo: Object.freeze(isRecord(raw["delegateTo"]) ? Object.fromEntries(Object.entries(raw["delegateTo"]).filter((entry)=>typeof entry[1] === "string")) : {}),
        drafts: Object.freeze(strings(raw["drafts"], [])),
        incentiveAuto: Object.freeze(strings(raw["incentiveAuto"], [])),
        // Lanes are operational authority, not presentation metadata: the
        // runtime needs them to choose which wallet can carry each effect.
        lanes: Object.freeze(strings(raw["lanes"], [])),
        tokens
    });
}
function hiveConfig(raw) {
    const hive = isRecord(raw["hive"]) ? raw["hive"] : {};
    const nodes = strings(hive["nodes"], [
        "https://api.hive.blog",
        "https://api.deathwing.me",
        "https://rpc.mahdiyari.info"
    ]);
    return Object.freeze({
        enabled: hive["enabled"] !== false,
        nodes,
        timeoutMs: Math.max(1000, Math.floor(numberOr(hive["timeoutMs"], 6000))),
        perSourceLimit: Math.max(1, Math.min(100, Math.floor(numberOr(hive["perSourceLimit"], 20))))
    });
}
function hiveEngineConfig(raw) {
    const hiveEngine = isRecord(raw["hiveEngine"]) ? raw["hiveEngine"] : {};
    const nodes = strings(hiveEngine["nodes"], [
        "https://api.hive-engine.com/rpc",
        "https://herpc.dtools.dev"
    ]);
    return Object.freeze({
        enabled: hiveEngine["enabled"] !== false,
        nodes,
        timeoutMs: Math.max(1000, Math.floor(numberOr(hiveEngine["timeoutMs"], 6000))),
        balanceLimit: Math.max(1, Math.min(1000, Math.floor(numberOr(hiveEngine["balanceLimit"], 500)))),
        marketLimit: Math.max(1, Math.min(200, Math.floor(numberOr(hiveEngine["marketLimit"], 50)))),
        poolLimit: Math.max(1, Math.min(1000, Math.floor(numberOr(hiveEngine["poolLimit"], 500)))),
        symbols: strings(hiveEngine["symbols"], [
            "DEC",
            "SPS",
            "STARBITS",
            "SIM",
            "BUDS",
            "PIZZA"
        ])
    });
}
export function loadAagaardConfig(options = {}) {
    const env = options.env ?? process.env;
    let raw = {};
    const configPath = options.configPath ?? path.join(path.dirname(new URL(import.meta.url).pathname), "../../aagaard.config.json");
    if (existsSync(configPath)) {
        const parsed = readJsonFile(configPath);
        if (isRecord(parsed)) raw = parsed;
    }
    const accountRows = Array.isArray(raw["accounts"]) ? raw["accounts"] : [];
    const wallets = Object.freeze(accountRows.map(walletFrom).filter((entry)=>entry !== null));
    return Object.freeze({
        kind: "aagaard.config",
        name: typeof raw["name"] === "string" ? raw["name"] : "aagaard",
        live: env["AAGAARD_LIVE"] === "1" || raw["live"] === true,
        enabled: enabledCapabilities(raw["enabled"]),
        cadenceSeconds: Math.max(60, Math.floor(numberOr(raw["cadenceSeconds"], 900))),
        keyRoot: expandHome(env["HIVE_KEY_ROOT"] ?? (typeof raw["keyRoot"] === "string" ? raw["keyRoot"] : "~/.config/blockchain/hive"), env),
        hive: hiveConfig(raw),
        hiveEngine: hiveEngineConfig(raw),
        wallets
    });
}
export function isLocked(capabilityName) {
    return LOCKED_CAPABILITIES.includes(capabilityName);
}
export function termForCapability(name, verb) {
    return tm.pair(tm.mark(`aagaard.${name}`), tm.mark(verb));
}
function witnessMove(arena, move, at) {
    return witnessCell(`wallet/${move.actor}`, move.action, {
        arena,
        target: move.target,
        charge: move.charge,
        reason: move.reason,
        value: move.value
    }, at);
}
export function arenaOf(input) {
    const at = input.at ?? new Date().toISOString();
    const witnesses = input.moves.map((move)=>witnessMove(input.name, move, at));
    return Object.freeze({
        kind: "aagaard.wallet-arena",
        name: input.name,
        game: input.game,
        actors: Object.freeze([
            ...input.actors
        ]),
        moves: Object.freeze([
            ...input.moves
        ]),
        converged: input.moves.some((move)=>move.charge === "stable" || move.charge === "active"),
        locked: input.locked ?? isLocked(input.name),
        witnesses: Object.freeze(witnesses)
    });
}
function postKey(post) {
    return `${post.author}/${post.permlink}`;
}
function average(values) {
    return values.length === 0 ? 0 : values.reduce((sum, value)=>sum + value, 0) / values.length;
}
// The alpha radar is the exact mispricing of the post field's reward: each post's pending payout
// (capped at 64 HBD) against the mean of the posts sharing each of its tags, over the post–tag
// attention graph of the field's settled Hive carrier (see @red-cup-engineering/hive-computing-service's alpha).
function readAlphaRadarSignal(posts) {
    const milli = (payout)=>BigInt(Math.round(Math.min(64, Math.max(0, payout)) * 1000));
    const byTerm = new Map(posts.map((post)=>[hivePostTerm(post.author, post.permlink), post]));
    const tagTotals = new Map();
    for (const post of posts)for (const tag of new Set(post.tags)){
        const total = tagTotals.get(hiveTagTerm(tag)) ?? { sum: 0n, n: 0n };
        tagTotals.set(hiveTagTerm(tag), { sum: total.sum + milli(post.pendingPayout), n: total.n + 1n });
    }
    const valueOf = (term)=>{
        const post = byTerm.get(term);
        if (post) return gradedFromParts(milli(post.pendingPayout), 1000n, "HBD");
        const total = tagTotals.get(term);
        return gradedFromParts(total?.sum ?? 0n, 1000n * (total?.n || 1n), "HBD");
    };
    const carrier = induceHiveTopology(posts.flatMap((post)=>post.tags.map((tag)=>hiveTagUtterance(post.author, post.permlink, tag))));
    const decimal = (value)=>Number(decimalOfRational(gradedValue(value), 3, { rounding: "toward-zero" }));
    const sinks = capturableSinks(carrier, valueOf).flatMap(({ term, deficit })=>{
        const post = byTerm.get(term);
        return post ? [Object.freeze({ key: postKey(post), author: post.author, permlink: post.permlink, deficit: decimal(deficit), cohort: post.tags[0] ?? "untagged" })] : [];
    });
    return Object.freeze({
        posts: posts.length,
        mispricingEnergy: decimal(mispricingEnergy(carrier, valueOf)),
        sinks: Object.freeze(sinks),
        components: alphaDecay(carrier).components
    });
}
function alphaRadarFromSignal(signal, components) {
    return Object.freeze({
        kind: "aagaard.alpha-radar",
        ...signal,
        components: Math.max(1, components),
        durable: components > 1
    });
}
export function readAlphaRadar(posts) {
    const signal = readAlphaRadarSignal(posts);
    return alphaRadarFromSignal(signal, signal.components);
}
export function readVotingIntelligence(posts, radar, at) {
    const signal = radar ?? readAlphaRadarSignal(posts);
    const sinkDeficits = new Map(signal.sinks.map((sink)=>[
            sink.key,
            sink.deficit
        ]));
    const composite = readVotingIntelligenceOf(posts, sinkDeficits, at !== undefined ? Date.parse(at) : undefined);
    return Object.freeze({
        kind: "aagaard.voting-intelligence",
        spectral: Object.freeze({
            fiedler: composite.spectral.fiedler,
            lambdaMax: composite.spectral.lambdaMax,
            components: composite.spectral.components,
            decayHalfLife: composite.spectral.decayHalfLife,
            durable: composite.spectral.durable
        }),
        curvature: Object.freeze({
            bridges: composite.curvature.bridges
        }),
        cartels: Object.freeze({
            b1: composite.cartels.cycle.b1,
            cycleDensity: composite.cartels.cycle.cycleDensity,
            tightPairs: Object.freeze(composite.cartels.tightPairs.map((pair)=>Object.freeze({
                    a: pair.a,
                    b: pair.b,
                    overlap: pair.coVotes
                })))
        }),
        bridges: composite.bridges,
        posts: composite.posts
    });
}
export function analyzeVotingField(posts, at = new Date().toISOString()) {
    const signal = readAlphaRadarSignal(posts);
    const intelligence = readVotingIntelligence(posts, alphaRadarFromSignal(signal, 1), at);
    const radar = alphaRadarFromSignal(signal, intelligence.spectral.components);
    return Object.freeze({
        candidateFieldDigest: candidateFieldDigest(posts),
        radar,
        intelligence
    });
}
function clamp01(x) {
    return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}
function normDeficit(deficit) {
    const d = Math.max(0, deficit);
    return d / (1 + d);
}
export function projectedVotingPowerAfterVoteBps(votingPowerBps, weightBps) {
    if (!Number.isFinite(votingPowerBps) || !Number.isFinite(weightBps)) return 0;
    const current = Math.max(0, Math.min(10_000, Math.floor(votingPowerBps)));
    const weight = Math.max(0, Math.min(10_000, Math.floor(Math.abs(weightBps))));
    return Math.floor(current * (500_000 - weight) / 500_000);
}
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

// The fleet's curation votes: the one curation selection (@red-cup-engineering/hive-computing-service's
// selectCurationVotes) over the field's post observations, priced at the chain's rate, under the
// wallet's weight cap and mana floor, excluding likely cartel trails. The radar and intelligence
// remain the field's readings; they do not choose votes.
export function planVotes(wallet, posts, at = new Date().toISOString(), state, fleetWallets = [
    wallet
], fieldAnalysis, rewardPrice) {
    const expectedFieldDigest = candidateFieldDigest(posts);
    if (fieldAnalysis && fieldAnalysis.candidateFieldDigest !== expectedFieldDigest) {
        throw new Error("voting field analysis does not match the candidate field");
    }
    const analysis = fieldAnalysis ?? analyzeVotingField(posts, at);
    const radar = analysis.radar;
    const intelligence = analysis.intelligence;
    const currentMana = state?.currentMana ?? "0";
    const maxMana = state?.maxMana ?? "0";
    const cartelTrail = new Set(intelligence.posts.filter((post)=>post.likelyCartelTrail).map((post)=>post.key));
    const observed = posts.filter((post)=>post.observation);
    const selection = rewardPrice && observed.length > 0 ? selectCurationVotes({
        account: wallet.account,
        observations: observed.map((post)=>post.observation),
        mana: {
            currentMana: BigInt(currentMana),
            maxMana: BigInt(maxMana)
        },
        price: rewardPrice,
        policy: {
            weightBps: wallet.risk.maxVoteWeightBps,
            manaFloorBps: wallet.strategy.votingPowerFloorBps,
            neverVoteAuthors: wallet.strategy.neverVoteAuthors ?? [],
            exclude: (observation)=>cartelTrail.has(`${observation.author}/${observation.permlink}`) ? "likely-cartel-trail" : null
        }
    }) : null;
    const hbd = (value)=>decimalOfRational(gradedValue(value), 6, { rounding: "toward-zero" });
    const votes = Object.freeze((selection?.votes ?? []).map((proposal)=>Object.freeze({
            author: proposal.action.author,
            permlink: proposal.action.permlink,
            weightBps: proposal.action.weightBps,
            expectedCurationHbd: hbd(proposal.expectedHbd),
            reason: `${wallet.strategy.archetype} expects ${hbd(proposal.expectedHbd)} HBD curation (${proposal.window} window)`
        })));
    const refusals = Object.freeze((selection?.decisions ?? []).filter((decision)=>!decision.accepted).map((decision)=>Object.freeze({
            key: decision.proposal.id,
            reason: decision.reason
        })));
    const waitReason = !rewardPrice ? "the chain's curation price is unavailable"
        : observed.length === 0 ? "no observed candidate field"
            : votes.length === 0 ? `no candidate admitted: ${[...new Set(refusals.map((refusal)=>refusal.reason))].join(", ") || "none offered"}` : "";
    const moves = votes.length > 0 ? votes.map((vote)=>Object.freeze({
            actor: wallet.account,
            action: termForCapability("voting", "cast"),
            target: `${vote.author}/${vote.permlink}`,
            value: {
                weightBps: vote.weightBps,
                expectedCurationHbd: vote.expectedCurationHbd
            },
            charge: "active",
            reason: vote.reason
        })) : [
        Object.freeze({
            actor: wallet.account,
            action: termForCapability("voting", "wait"),
            target: "mana",
            value: {
                currentMana,
                maxMana
            },
            charge: "potential",
            reason: waitReason
        })
    ];
    return Object.freeze({
        account: wallet.account,
        currentMana,
        maxMana,
        radar,
        intelligence,
        refusals,
        votes,
        decision: votes.length > 0 ? `${wallet.strategy.archetype} casts ${votes.length} vote(s)` : `${wallet.strategy.archetype} waits: ${waitReason}`,
        arena: arenaOf({
            name: "voting",
            game: "curation reward allocation",
            actors: [
                wallet
            ],
            moves,
            at
        })
    });
}
export function readLiquidity(wallet, state, market, internalMarket, flow = {}) {
    const real = internalMarket && internalMarket.midpoint > 0 ? internalMarket : null;
    const internalVenue = real ? Object.freeze({
        venue: "internal",
        pair: "HIVE/HBD",
        midpoint: real.midpoint,
        ...real.bestBid !== undefined ? {
            bestBid: real.bestBid
        } : {},
        ...real.bestAsk !== undefined ? {
            bestAsk: real.bestAsk
        } : {},
        ...real.bestBidQuantityHive !== undefined ? {
            bestBidQuantity: real.bestBidQuantityHive
        } : {},
        ...real.bestAskQuantityHive !== undefined ? {
            bestAskQuantity: real.bestAskQuantityHive
        } : {},
        bidDepth: real.bidDepth,
        askDepth: real.askDepth,
        relativeSpreadBps: real.relativeSpreadBps,
        imbalance: real.bidDepth + real.askDepth > 0 ? (real.bidDepth - real.askDepth) / (real.bidDepth + real.askDepth) : 0,
        thin: real.bidDepth + real.askDepth < 1000
    }) : null;
    const venues = Object.freeze([
        ...internalVenue ? [
            internalVenue
        ] : [],
        ...market?.venues ?? []
    ]);
    const pools = Object.freeze([...market?.pools ?? []]);
    const corridorRows = [];
    const twoSided = (v)=>v.bidDepth > 0 && v.askDepth > 0;
    for (const pool of pools){
        const [base, quote] = pool.pair.split(":");
        if (!base || !quote) continue;
        let symbol;
        let poolPriceInHive;
        if (quote === "SWAP.HIVE") {
            symbol = base;
            poolPriceInHive = pool.impliedPrice;
        } else if (base === "SWAP.HIVE") {
            symbol = quote;
            poolPriceInHive = pool.impliedPrice > 0 ? 1 / pool.impliedPrice : 0;
        } else {
            continue;
        }
        const venue = venues.find((entry)=>entry.pair === `${symbol}/SWAP.HIVE`);
        if (!venue || venue.midpoint <= 0 || poolPriceInHive <= 0) continue;
        if (!twoSided(venue) || pool.tvlQuote < MIN_POOL_TVL_QUOTE) continue;
        const cheap = poolPriceInHive < venue.midpoint ? {
            venue: `pool:${pool.pair}`,
            price: poolPriceInHive,
            feeBps: pool.feeBps
        } : {
            venue: venue.venue,
            price: venue.midpoint,
            feeBps: 0
        };
        const rich = poolPriceInHive < venue.midpoint ? {
            venue: venue.venue,
            price: venue.midpoint,
            feeBps: 0
        } : {
            venue: `pool:${pool.pair}`,
            price: poolPriceInHive,
            feeBps: pool.feeBps
        };
        const divergenceBps = Math.round((rich.price - cheap.price) / cheap.price * 10000);
        if (divergenceBps > 0) corridorRows.push(Object.freeze({
            symbol,
            cheapVenue: cheap.venue,
            richVenue: rich.venue,
            divergenceBps,
            netCorridorBps: divergenceBps - cheap.feeBps - rich.feeBps
        }));
    }
    const corridors = Object.freeze(corridorRows.sort((left, right)=>right.netCorridorBps - left.netCorridorBps));
    return Object.freeze({
        kind: "aagaard.liquidity",
        venues,
        pools,
        corridors,
        totalDepthProxy: venues.reduce((sum, venue)=>sum + venue.bidDepth + venue.askDepth, 0) + pools.reduce((sum, pool)=>sum + pool.tvlQuote, 0),
        rigidity: readRigidity(edgesFromPools(pools)),
        flow: Object.freeze(Object.values(flow)),
        screening: (()=>{
            const screeningEdges = edgesForScreening(pools);
            const tokens = [
                ...new Set(screeningEdges.flatMap((edge)=>[
                        edge.a,
                        edge.b
                    ]))
            ];
            return Object.freeze(tokens.map((token)=>readScreening(token, screeningEdges)));
        })()
    });
}
const BUNDLE_SLIPPAGE_BPS = 50;
function refusedBundle(symbol, pool, edgeBps, reason) {
    return Object.freeze({
        id: `pool-book:${pool}:${symbol}`,
        kind: "pool-to-orderbook-round-trip",
        symbol,
        pool,
        quantity: "0",
        expectedInputSwapHive: "0",
        maxInputSwapHive: "0",
        limitBuyPriceSwapHive: "0",
        limitSellPriceSwapHive: "0",
        minimumProceedsSwapHive: "0",
        expectedProfitSwapHive: "0",
        worstCaseProfitSwapHive: "0",
        edgeBps,
        capitalSwapHive: 0,
        executable: false,
        funded: false,
        refusalReason: reason,
        marketObservedAt: null
    });
}
function sizePoolToBookBundle(corridor, liquidity, wallet, state, precision, marketObservedAt) {
    const poolLabel = corridor.cheapVenue.startsWith("pool:") ? corridor.cheapVenue.slice("pool:".length) : "";
    if (poolLabel === "" || corridor.richVenue.startsWith("pool:")) {
        return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "only pool-buy/orderbook-sell round trips are admitted");
    }
    const pool = liquidity.pools.find((entry)=>entry.pair === poolLabel);
    const venue = liquidity.venues.find((entry)=>entry.pair === `${corridor.symbol}/SWAP.HIVE` && entry.venue === corridor.richVenue);
    const tokenDecimals = precision[corridor.symbol];
    const hiveDecimals = precision["SWAP.HIVE"];
    if (!pool || !(pool.baseQuantity > 0) || !(pool.quoteQuantity > 0) || typeof pool.baseQuantityExact !== "string" || typeof pool.quoteQuantityExact !== "string") {
        return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "live pool reserves unavailable");
    }
    if (!venue || !venue.exactBook) {
        return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "lossless ordered bid-book evidence unavailable");
    }
    if (tokenDecimals === undefined || hiveDecimals === undefined || tokenDecimals < 0 || hiveDecimals < 0) {
        return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "on-chain precision unavailable");
    }
    const [base, quote] = poolLabel.split(":");
    let reserveIn;
    let reserveOut;
    if (base === corridor.symbol && quote === "SWAP.HIVE") {
        reserveIn = pool.quoteQuantityExact;
        reserveOut = pool.baseQuantityExact;
    } else if (base === "SWAP.HIVE" && quote === corridor.symbol) {
        reserveIn = pool.baseQuantityExact;
        reserveOut = pool.quoteQuantityExact;
    } else {
        return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "pool does not exchange the corridor token against SWAP.HIVE");
    }
    const exact = sizeExactPoolToBook({
        tokenPrecision: tokenDecimals,
        swapHivePrecision: hiveDecimals,
        reserveInSwapHive: reserveIn,
        reserveOutToken: reserveOut,
        balanceSwapHive: state?.tokens["SWAP.HIVE"] ?? wallet.tokens["SWAP.HIVE"] ?? "0",
        capSwapHiveMilli: wallet.risk.capSwapHiveMilli,
        poolFeeBps: pool.feeBps,
        slippageBps: BUNDLE_SLIPPAGE_BPS,
        bids: venue.exactBook.bids,
        bidBookComplete: venue.exactBook.bidComplete,
        bidBookOrdered: venue.exactBook.bidOrdered
    });
    if (!exact.admitted) return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, exact.reason);
    const q = exact.quote;
    return Object.freeze({
        id: `pool-book:${poolLabel}:${corridor.symbol}`,
        kind: "pool-to-orderbook-round-trip",
        symbol: corridor.symbol,
        pool: poolLabel,
        quantity: q.quantity,
        expectedInputSwapHive: q.expectedInputSwapHive,
        maxInputSwapHive: q.maxInputSwapHive,
        limitBuyPriceSwapHive: "0",
        limitSellPriceSwapHive: q.limitSellPriceSwapHive,
        minimumProceedsSwapHive: q.minimumProceedsSwapHive,
        expectedProfitSwapHive: q.expectedProfitSwapHive,
        worstCaseProfitSwapHive: q.worstCaseProfitSwapHive,
        edgeBps: q.edgeBps,
        capitalSwapHive: Number(q.maxInputSwapHive),
        executable: true,
        funded: false,
        refusalReason: null,
        marketObservedAt: marketObservedAt ?? venue.exactBook.observedAt
    });
}
function sizeBookToPoolBundle(corridor) {
    return refusedBundle(corridor.symbol, corridor.richVenue.replace(/^pool:/, ""), corridor.netCorridorBps, "order-book acquisition cannot condition the pool exit on a complete first-leg fill");
}
function sizeCorridorBundle(corridor, liquidity, wallet, state, precision, marketObservedAt) {
    return corridor.cheapVenue.startsWith("pool:") ? sizePoolToBookBundle(corridor, liquidity, wallet, state, precision, marketObservedAt) : sizeBookToPoolBundle(corridor);
}
function applyMakerSelfCrossGuard(bundle, account, scan) {
    if (!bundle.executable) return bundle;
    const side = bundle.kind === "pool-to-orderbook-round-trip" ? "sell" : "buy";
    const priceSwapHivePerToken = side === "sell" ? bundle.limitSellPriceSwapHive : bundle.limitBuyPriceSwapHive;
    const selfCrossGuard = guardFleetSelfCross({
        account,
        symbol: bundle.symbol,
        side,
        priceSwapHivePerToken
    }, scan);
    if (selfCrossGuard.admitted) return Object.freeze({
        ...bundle,
        selfCrossGuard
    });
    if (selfCrossGuard.reason === "fleet-order-reading-unavailable") return Object.freeze({
        ...bundle,
        selfCrossGuard
    });
    return Object.freeze({
        ...bundle,
        executable: false,
        funded: false,
        refusalReason: `maker self-cross safety refusal: ${selfCrossGuard.detail}`,
        selfCrossGuard
    });
}
function cycleDepthProxy(cycle, liquidity) {
    const depths = cycle.venues.map((label)=>{
        if (label.startsWith("pool:")) {
            const pair = label.slice("pool:".length);
            return liquidity.pools.find((pool)=>pool.pair === pair)?.tvlQuote ?? 0;
        }
        const venue = liquidity.venues.find((entry)=>entry.venue === label);
        return venue ? venue.bidDepth + venue.askDepth : 0;
    }).filter((depth)=>depth > 0);
    if (depths.length === 0) return 0;
    return Math.min(...depths);
}
export function planTrades(wallet, at = new Date().toISOString(), state, market, internalMarket, flow = {}, makerOrderScan) {
    const liquidity = readLiquidity(wallet, state, market, internalMarket, flow);
    const MAX_SANE_EDGE_BPS = 5000;
    const arbitrageCycles = readHolonomy(liquidity, {
        minNetHolonomyBps: 50,
        limit: 5
    });
    const tickBudgetSwapHive = wallet.risk.capSwapHiveMilli / 1000;
    const cycleCapacities = Object.freeze(arbitrageCycles.map((cycle)=>catabolicCapacity(cycle.netHolonomyBps, cycleDepthProxy(cycle, liquidity), tickBudgetSwapHive)));
    const sizedBundles = liquidity.corridors.filter((corridor)=>corridor.netCorridorBps > 100 && corridor.netCorridorBps <= MAX_SANE_EDGE_BPS).map((corridor)=>sizeCorridorBundle(corridor, liquidity, wallet, state, market?.precision ?? {}, market?.observedAt));
    const draftBundles = Object.freeze(makerOrderScan ? sizedBundles.map((bundle)=>applyMakerSelfCrossGuard(bundle, wallet.account, makerOrderScan)) : sizedBundles);
    const candidates = draftBundles.filter((bundle)=>bundle.executable).map((bundle)=>Object.freeze({
            id: bundle.id,
            cost: bundle.capitalSwapHive,
            benefit: Number(bundle.worstCaseProfitSwapHive)
        }));
    const allocation = allocateBudget(candidates, tickBudgetSwapHive);
    const fundedIds = new Set(allocation.funded);
    const bundles = Object.freeze(draftBundles.map((bundle)=>Object.freeze({
            ...bundle,
            funded: bundle.executable && fundedIds.has(bundle.id)
        })));
    const trades = Object.freeze([]);
    const lp = Object.freeze([]);
    const savings = null;
    const moves = [
        ...bundles.map((bundle)=>Object.freeze({
                actor: wallet.account,
                action: termForCapability("trading", "round-trip"),
                target: bundle.id,
                value: {
                    bundleId: bundle.id,
                    kind: bundle.kind,
                    symbol: bundle.symbol,
                    pool: bundle.pool,
                    quantity: bundle.quantity,
                    funded: bundle.funded,
                    executable: bundle.executable,
                    refusalReason: bundle.refusalReason,
                    selfCrossAdmitted: bundle.selfCrossGuard?.admitted ?? null,
                    selfCrossObservedAt: bundle.selfCrossGuard?.observedAt ?? null,
                    selfCrossRefusal: bundle.selfCrossGuard && !bundle.selfCrossGuard.admitted ? bundle.selfCrossGuard.reason : null
                },
                charge: bundle.funded ? "active" : "potential",
                reason: bundle.refusalReason ?? `bounded ${bundle.pool} -> order-book round trip`
            }))
    ];
    return Object.freeze({
        account: wallet.account,
        hive: state?.hive ?? "0.000 HIVE",
        hbd: state?.hbd ?? "0.000 HBD",
        liveEligible: wallet.tradingLive,
        liquidity,
        trades,
        bundles,
        lp,
        savings,
        arbitrageCycles,
        cycleCapacities,
        allocation,
        allocationUnit: "SWAP.HIVE",
        arena: arenaOf({
            name: "trading",
            game: "cross-venue capital allocation",
            actors: [
                wallet
            ],
            moves,
            at
        })
    });
}
function tokenValueHbd(symbol, liquidity) {
    if (symbol === "HBD") return 1;
    if (symbol === "HIVE") return liquidity.venues.find((venue)=>venue.pair === "HIVE/HBD")?.midpoint ?? 0;
    if (symbol === "SWAP.HIVE") return 0;
    const hivePrice = liquidity.venues.find((venue)=>venue.pair === "HIVE/HBD")?.midpoint ?? 0;
    if (!(hivePrice > 0)) return 0;
    const asBase = liquidity.pools.find((entry)=>entry.pair.startsWith(`${symbol}:`));
    if (asBase) return asBase.impliedPrice * hivePrice;
    const asQuote = liquidity.pools.find((entry)=>entry.pair.endsWith(`:${symbol}`));
    if (asQuote && asQuote.impliedPrice > 0) return 1 / asQuote.impliedPrice * hivePrice;
    return 0;
}
export function planIncentives(wallet, posts, liquidity, at = new Date().toISOString()) {
    const costs = { vote: 0.001, reblog: 0.002, follow: 0.002, delegate: 0.05, comment: 0.1, post: 0.5 };
    const allow = new Set(wallet.incentiveAuto ?? []);
    const offers = ingestOffers(posts).map(offer => {
        const rewardHbd = offer.reward ? (offer.reward.amount ?? 1) * tokenValueHbd(offer.reward.token, liquidity) : 0;
        const text = offer.evidenceText;
        const scamReasons = [
            !offer.reward ? "no-reward" : "",
            /\b(active key|posting key|private key|owner key|master password|seed phrase|import your key|connect your wallet|send (?:your )?(?:hive|hbd)|memo .* to claim)\b/i.test(text) ? "key-phishing" : "",
            /\bhttps?:\/\/(?!(?:peakd\.com|hive\.blog|ecency\.com|inleo\.io|leofinance\.io|3speak\.tv)(?:[/:]|$))[^\s)]+/i.test(text) ? "off-chain-claim" : "",
            (offer.reward?.amount ?? 0) > 1_000_000 ? "impossible-amount" : "",
            rewardHbd > 0 && rewardHbd < 0.02 ? "dust-reward" : "",
        ].filter(Boolean);
        const scam = scamReasons.some(reason => reason !== "no-reward");
        const payoutProb = scamReasons.some(reason => reason === "key-phishing" || reason === "off-chain-claim") ? 0.02
            : Math.min(1, 0.4 + (offer.source.community ? 0.2 : 0) + (offer.reward?.amount !== undefined ? 0.2 : 0) + (offer.deadline ? 0.1 : 0));
        const actionCostHbd = offer.requiredActions.reduce((sum, action) => sum + (costs[action] ?? 0.01), 0);
        const ev = scam ? 0 : payoutProb * rewardHbd - actionCostHbd;
        const permitted = offer.requiredActions.length > 0 && offer.requiredActions.every(action => allow.has(action) && ["vote", "reblog", "follow"].includes(action));
        return Object.freeze({ offer, rewardHbd, actionCostHbd, payoutProb, ev: Number(ev.toFixed(6)), scam,
            scamReasons: Object.freeze(scamReasons), disposition: !scam && permitted && ev > 0 ? "auto" : "nominate" });
    }).sort((left, right) => right.ev - left.ev);
    const moves = offers.map((entry)=>Object.freeze({
            actor: wallet.account,
            action: termForCapability("incentive", entry.disposition),
            target: entry.offer.id,
            value: {
                ev: entry.ev,
                actions: entry.offer.requiredActions
            },
            charge: entry.disposition === "auto" ? "active" : "potential",
            reason: entry.scamReasons.length > 0 ? entry.scamReasons.join(",") : "offer admitted"
        }));
    return Object.freeze({
        account: wallet.account,
        offers: Object.freeze(offers),
        arena: arenaOf({
            name: "incentive",
            game: "bounty arbitration",
            actors: [
                wallet
            ],
            moves,
            at
        })
    });
}
export function planStaking(wallet, state, at = new Date().toISOString()) {
    const tokens = state?.tokens ?? wallet.tokens;
    const rules = wallet.stakeTokens ?? [];
    const actions = [];
    for (const symbol of rules){
        const balance = Number(tokens[symbol] ?? "0");
        if (!Number.isFinite(balance) || balance <= 0) continue;
        const quantity = balance.toFixed(8);
        actions.push(Object.freeze({
            kind: "stake",
            symbol,
            quantity,
            to: wallet.account,
            reason: `Hive Income Staking Plan: stake held ${symbol}`
        }));
        const delegateTo = wallet.delegateTo?.[symbol];
        if (delegateTo) {
            actions.push(Object.freeze({
                kind: "delegate",
                symbol,
                quantity,
                to: delegateTo,
                reason: `Hive Income Staking Plan: delegate staked ${symbol} to ${delegateTo}`
            }));
        }
    }
    const moves = actions.map((action)=>Object.freeze({
            actor: wallet.account,
            action: termForCapability("trading", action.kind),
            target: `${action.symbol}->${action.to}`,
            value: {
                kind: action.kind,
                symbol: action.symbol,
                quantity: action.quantity,
                to: action.to
            },
            charge: "active",
            reason: action.reason
        }));
    return Object.freeze({
        account: wallet.account,
        actions: Object.freeze(actions),
        arena: arenaOf({
            name: "trading",
            game: "staking allocation",
            actors: [
                wallet
            ],
            moves,
            at
        })
    });
}
function utcDay(iso) {
    return iso.slice(0, 10);
}
function draftId(account, topic, at, sourceOfferId = "") {
    const suffix = sourceOfferId === "" ? utcDay(at) : sourceOfferId.replace(/[^A-Za-z0-9._-]+/g, "-");
    return `${account}:${topic}:${suffix}`;
}
export function composeDraft(wallet, summary, at = new Date().toISOString()) {
    return Object.freeze({
        id: draftId(wallet.account, "operations", at),
        account: wallet.account,
        kind: "post",
        topic: "operations",
        title: `${wallet.account} operations note`,
        body: summary,
        tags: Object.freeze([
            "hive",
            "automation",
            "aagaard"
        ]),
        composedAt: at,
        approvedForBroadcast: false
    });
}
export function composeLiquidityDraft(wallet, liquidity, at = new Date().toISOString()) {
    const day = utcDay(at);
    const venueLines = liquidity.venues.slice(0, 12).map((venue)=>`- ${venue.pair} at ${venue.venue}: mid ${venue.midpoint}, spread ${venue.relativeSpreadBps}bps, depth ${venue.bidDepth.toFixed(2)}/${venue.askDepth.toFixed(2)}, imbalance ${(venue.imbalance * 100).toFixed(1)}%${venue.thin ? " (thin)" : ""}`).join("\n");
    const poolLines = liquidity.pools.slice(0, 12).map((pool)=>`- ${pool.pair}: implied ${pool.impliedPrice.toFixed(8)}, TVL proxy ${pool.tvlQuote.toFixed(2)}, fee ${pool.feeBps}bps`).join("\n");
    const corridorLines = liquidity.corridors.slice(0, 8).map((corridor)=>`- ${corridor.symbol}: ${corridor.cheapVenue} -> ${corridor.richVenue}, divergence ${corridor.divergenceBps}bps, net ${corridor.netCorridorBps}bps`).join("\n");
    return Object.freeze({
        id: draftId(wallet.account, "he-liquidity", at),
        account: wallet.account,
        kind: "post",
        topic: "he-liquidity",
        title: `Hive-Engine liquidity report - ${day}`,
        body: [
            `# Hive-Engine liquidity report - ${day}`,
            "",
            "Automated read of liquidity within and between Hive and Hive-Engine venues.",
            "",
            "## Order books",
            venueLines || "_no venues observed_",
            "",
            "## AMM pools",
            poolLines || "_no pools observed_",
            "",
            "## Cross-venue corridors",
            corridorLines || "_no corridors observed_",
            "",
            `Total observed liquidity proxy: ${liquidity.totalDepthProxy.toFixed(2)} quote units.`,
            "",
            "Prepared automatically for human review. Posting remains locked."
        ].join("\n"),
        tags: Object.freeze([
            "hive-engine",
            "liquidity",
            "defi",
            "analysis",
            "hive"
        ]),
        composedAt: at,
        approvedForBroadcast: false
    });
}
export function composeSpectralDraft(wallet, voting, at = new Date().toISOString()) {
    const day = utcDay(at);
    const radar = voting.radar;
    const intelligence = voting.intelligence;
    const sinks = radar.sinks.slice(0, 8).map((sink)=>`- ${sink.key}: deficit ${sink.deficit} in ${sink.cohort}`).join("\n");
    const cartels = intelligence.cartels.tightPairs.slice(0, 8).map((pair)=>`- ${pair.a} / ${pair.b}: overlap ${pair.overlap}`).join("\n");
    const bridges = intelligence.bridges.slice(0, 8).map((bridge)=>`- ${bridge}`).join("\n");
    return Object.freeze({
        id: draftId(wallet.account, "hive-spectral", at),
        account: wallet.account,
        kind: "post",
        topic: "hive-spectral",
        title: `The spectral state of Hive - ${day}`,
        body: [
            `# The spectral state of Hive - ${day}`,
            "",
            "A locked draft from the wallet's curation arena. The reward field is read as a potential over the sampled attention graph.",
            "",
            "## Mispricing field",
            `- Posts sampled: ${radar.posts}`,
            `- Mispricing energy: ${radar.mispricingEnergy}`,
            `- Components: ${radar.components}${radar.durable ? " (fragmented, durable alpha)" : ""}`,
            "",
            "## Spectral decay",
            `- Fiedler value: ${intelligence.spectral.fiedler}`,
            `- Lambda max: ${intelligence.spectral.lambdaMax}`,
            `- Mispricing half-life: ${intelligence.spectral.decayHalfLife}`,
            "",
            "## Capturable sinks",
            sinks || "_no sinks observed_",
            "",
            "## Co-vote cycles",
            `- b1: ${intelligence.cartels.b1}`,
            `- cycle density: ${intelligence.cartels.cycleDensity}`,
            cartels || "_no tight co-vote pairs in the sample_",
            "",
            "## Bridges",
            bridges || "_no bridge posts in the sample_",
            "",
            "Prepared automatically for human review. Posting remains locked."
        ].join("\n"),
        tags: Object.freeze([
            "hive",
            "mathematics",
            "spectral",
            "analysis",
            "curation"
        ]),
        composedAt: at,
        approvedForBroadcast: false
    });
}
export function composeIncentiveDraft(account, offer, at = new Date().toISOString()) {
    const responseKind = offer.requiredActions.includes("post") ? "post" : "reply";
    return Object.freeze({
        id: draftId(account, "incentive-response", at, offer.id),
        account,
        kind: responseKind,
        topic: "incentive-response",
        title: `Draft response to ${offer.source.author}/${offer.source.permlink}`,
        body: [
            `[DRAFT for @${account} - machine-prepared response to @${offer.source.author}'s incentive, pending human review]`,
            "",
            `Source: @${offer.source.author}/${offer.source.permlink}`,
            `Required actions: ${offer.requiredActions.join(", ")}`,
            `Reward: ${offer.reward ? `${offer.reward.amount ?? 1} ${offer.reward.token}` : "unspecified"}`,
            "",
            offer.rawText,
            "",
            "Replace this placeholder with a genuine on-topic response before any human-approved broadcast."
        ].join("\n"),
        tags: Object.freeze([
            "hive",
            "aagaard",
            "draft"
        ]),
        composedAt: at,
        approvedForBroadcast: false,
        sourceOfferId: offer.id
    });
}
/** The prompt for a generator that writes an incentive response: what is answered and the house
 *  rules (genuine, on-topic, no reward-farming, nothing private). */
export function incentivePrompt(account, offer) {
    const reward = offer.reward ? `${offer.reward.amount ?? ""} ${offer.reward.token}`.trim() : "unspecified";
    return [
        `You are drafting a Hive ${offer.requiredActions.includes("post") ? "post" : "comment"} for the account @${account}.`,
        `It responds to an incentive by @${offer.source.author} (${offer.source.permlink}).`,
        `Required actions: ${offer.requiredActions.join(", ")}. Stated reward: ${reward}.`,
        `Announcement: "${offer.rawText}"`,
        "Write a genuine, specific, on-topic response that satisfies the ask without sounding like reward-farming.",
        "Do not fabricate experiences, do not disclose keys or private data, do not over-promise. Keep it concise."
    ].join("\n");
}
/** A locked draft reply to one post. */
export function composeReplyDraft(wallet, parent, body, at = new Date().toISOString()) {
    return Object.freeze({
        id: draftId(wallet.account, "reply", at, `${parent.author}/${parent.permlink}`),
        account: wallet.account,
        kind: "reply",
        topic: "reply",
        title: "",
        body,
        tags: Object.freeze([]),
        parent: Object.freeze({ author: parent.author, permlink: parent.permlink }),
        composedAt: at,
        approvedForBroadcast: false
    });
}
export function composeDailyDrafts(input) {
    const drafts = [
        composeDraft(input.wallet, `Autonomous operations summary for ${input.wallet.account}. Prepared as a locked draft.`, input.at)
    ];
    if (input.wallet.drafts?.includes("liquidity")) drafts.push(composeLiquidityDraft(input.wallet, input.trading.liquidity, input.at));
    if (input.wallet.drafts?.includes("spectral") && input.voting) drafts.push(composeSpectralDraft(input.wallet, input.voting, input.at));
    return Object.freeze(drafts);
}
export function planGaming(wallet, at = new Date().toISOString(), state) {
    const tokenState = state?.tokens ?? Object.freeze({});
    const signatures = [
        {
            game: "Splinterlands",
            tokens: [
                "DEC",
                "SPS",
                "SPSP",
                "VOUCHER"
            ],
            customJsonId: "sm_",
            proposedMove: "claim daily quest / start ranked"
        },
        {
            game: "Rising Star",
            tokens: [
                "STARBITS",
                "STARPRO"
            ],
            customJsonId: "server-session-no-custom-json",
            proposedMove: "manual-only inventory/recovery review while current terms prohibit bots and multiple accounts"
        },
        {
            game: "dCity",
            tokens: [
                "SIM"
            ],
            customJsonId: "dcity",
            proposedMove: "collect daily SIM income"
        },
        {
            game: "Hashkings",
            tokens: [
                "BUDS",
                "SEEDS"
            ],
            customJsonId: "hashkings",
            proposedMove: "water plots / harvest"
        }
    ];
    const games = signatures.flatMap((sig)=>{
        const held = sig.tokens.filter((token)=>Number(tokenState[token] ?? "0") > 0).map((token)=>Object.freeze({
                symbol: token,
                balance: tokenState[token] ?? "0"
            }));
        return held.length === 0 ? [] : [
            Object.freeze({
                game: sig.game,
                heldTokens: Object.freeze(held),
                customJsonId: sig.customJsonId,
                proposedMove: sig.proposedMove,
                approvedForBroadcast: false
            })
        ];
    });
    const moves = games.map((game)=>Object.freeze({
            actor: wallet.account,
            action: termForCapability("gaming", "plan"),
            target: game.game,
            value: {
                customJsonId: game.customJsonId,
                heldTokens: game.heldTokens
            },
            charge: "potential",
            reason: game.proposedMove
        }));
    return Object.freeze({
        account: wallet.account,
        games: Object.freeze(games),
        arena: arenaOf({
            name: "gaming",
            game: "on-chain game routine",
            actors: [
                wallet
            ],
            moves,
            locked: true,
            at
        })
    });
}
export function ensureStore(root) {
    const store = {
        root,
        dataDir: process.env.AAGAARD_DATA_DIR ? path.resolve(process.env.AAGAARD_DATA_DIR) : path.join(root, "data")
    };
    mkdirSync(store.dataDir, {
        recursive: true
    });
    return Object.freeze(store);
}
const FLEET_TICK_CATEGORY = "aagaard.fleet-tick";
const LOCKED_DRAFT_CATEGORY = "aagaard.locked-draft";
const SUBSTRATE_CATEGORY = "aagaard.substrate-snapshot";
const INCENTIVE_CATEGORY = "aagaard.incentive-nomination-event";
// Aagaard's own records, fleet ticks included, are claims in its journal.
function recordsOf(store, category) {
    return claimsOf(store.dataDir, category);
}
async function recordOwned(store, category, recordedAt, record) {
    recordClaim(store.dataDir, category, recordedAt, record);
}
export async function recordFleetTick(store, readout) {
    await recordOwned(store, FLEET_TICK_CATEGORY, readout.ts, readout);
}
export function readLastReadout(store) {
    return readFleetTicks(store, 1).at(-1) ?? null;
}
export function readFleetTicks(store, limit) {
    return [
        ...recordsOf(store, FLEET_TICK_CATEGORY)
    ].sort((left, right)=>left.ts.localeCompare(right.ts)).slice(-limit);
}
export function readLockedDrafts(store, account) {
    const drafts = recordsOf(store, LOCKED_DRAFT_CATEGORY).filter((row)=>isRecord(row) && typeof row["id"] === "string" && typeof row["account"] === "string");
    return Object.freeze(drafts.filter((draft)=>account === undefined || draft.account === account));
}
export async function recordLockedDrafts(store, drafts) {
    if (drafts.length === 0) return Object.freeze([]);
    const prior = new Map(readLockedDrafts(store).map((draft)=>[
            draft.id,
            draft
        ]));
    const recorded = [];
    for (const draft of drafts){
        if (prior.has(draft.id)) continue;
        prior.set(draft.id, draft);
        recorded.push(draft);
    }
    if (recorded.length > 0) {
        await Promise.all(recorded.map((draft)=>recordOwned(store, LOCKED_DRAFT_CATEGORY, draft.composedAt, draft)));
    }
    return Object.freeze(recorded);
}
export async function recordSubstrateSnapshot(store, snapshot) {
    await recordOwned(store, SUBSTRATE_CATEGORY, snapshot.ts, snapshot);
}
export function readSubstrateSnapshots(store, limit) {
    return [
        ...recordsOf(store, SUBSTRATE_CATEGORY)
    ].sort((left, right)=>left.ts.localeCompare(right.ts)).slice(-limit);
}
export function listIncentiveNominations(store) {
    const current = new Map();
    const events = recordsOf(store, INCENTIVE_CATEGORY);
    for (const event of events)current.set(event.record.offerId, event.record);
    return Object.freeze([
        ...current.values()
    ].sort((left, right)=>left.firstSeen.localeCompare(right.firstSeen)));
}
export async function recordIncentiveNominations(store, plan, at = new Date().toISOString()) {
    const prior = new Map(listIncentiveNominations(store).map((record)=>[
            record.offerId,
            record
        ]));
    const recorded = [];
    for (const offer of plan.offers){
        if (offer.disposition !== "nominate" || prior.has(offer.offer.id)) continue;
        const record = Object.freeze({
            offerId: offer.offer.id,
            account: plan.account,
            offer: offer.offer,
            ev: offer.ev,
            scamReasons: offer.scamReasons,
            status: "pending",
            firstSeen: at,
            updated: at
        });
        prior.set(record.offerId, record);
        recorded.push(record);
    }
    if (recorded.length > 0) {
        await Promise.all(recorded.map((record)=>recordOwned(store, INCENTIVE_CATEGORY, at, {
                event: "nominated",
                record
            })));
    }
    return Object.freeze(recorded);
}
export async function dispositionIncentiveNomination(store, offerId, choice, at = new Date().toISOString()) {
    const records = listIncentiveNominations(store);
    const index = records.findIndex((record)=>record.offerId === offerId);
    if (index < 0) return null;
    const existing = records[index];
    const draft = choice === "llm-draft" ? composeIncentiveDraft(existing.account, existing.offer, at) : null;
    const updated = Object.freeze({
        ...existing,
        status: choice === "ignore" ? "ignored" : choice === "manual" ? "manual" : "drafted",
        updated: at,
        ...draft ? {
            draftId: draft.id
        } : {}
    });
    if (draft) await recordLockedDrafts(store, [
        draft
    ]);
    await recordOwned(store, INCENTIVE_CATEGORY, at, {
        event: "dispositioned",
        choice,
        record: updated
    });
    return updated;
}
export function capabilityReport(_config, control) {
    return Object.freeze(ALL_CAPABILITIES.map((entry)=>Object.freeze({
            capability: entry,
            enabled: control.isEnabled(entry),
            locked: isLocked(entry)
        })));
}
function parityClaim(input) {
    return Object.freeze({
        claim: input.claim,
        olderApplication: input.olderApplication,
        replacement: input.replacement,
        status: input.status,
        evidence: Object.freeze([
            ...input.evidence
        ])
    });
}
export function aagaardParityReport(config, control, options = {}) {
    const keyRows = config.wallets.map((wallet)=>walletKeyStatus(config.keyRoot, wallet.account));
    const hasPostingKey = keyRows.some((keys)=>keys.posting);
    const hasActiveKey = keyRows.some((keys)=>keys.active);
    const routeClaims = Object.freeze([
        parityClaim({
            claim: "operator status and liveness",
            olderApplication: "GET /ops, GET /ops/health",
            replacement: "GET /ops, GET /ops/health",
            status: "met",
            evidence: [
                "/ops",
                "/ops/health"
            ]
        }),
        parityClaim({
            claim: "operator lane control",
            olderApplication: "GET /ops/capabilities, POST /ops/capabilities/:cap/:action, POST /ops/arm|disarm|pause|resume|tick",
            replacement: "same guarded route family",
            status: "met",
            evidence: [
                "/ops/capabilities",
                "/ops/arm",
                "/ops/disarm",
                "/ops/pause",
                "/ops/resume",
                "/ops/tick"
            ]
        }),
        parityClaim({
            claim: "historical readouts",
            olderApplication: "GET /ops/last, GET /ops/ticks?limit=N",
            replacement: "same routes plus witnessed arena summaries",
            status: "exceeded",
            evidence: [
                "/ops/last",
                "/ops/ticks",
                "/ops/arenas",
                "/ops/witnesses",
                "/ops/substrate"
            ]
        }),
        parityClaim({
            claim: "per-account alpha, strategy, intelligence, liquidity, and drafts",
            olderApplication: "GET /ops/alpha|intelligence|liquidity|drafts/:account plus strategy routes",
            replacement: "GET /ops/alpha|strategy|intelligence|liquidity|drafts|games/:account",
            status: "exceeded",
            evidence: [
                "/ops/alpha/:account",
                "/ops/strategy/:account",
                "/ops/intelligence/:account",
                "/ops/liquidity/:account",
                "/ops/drafts/:account",
                "/ops/games/:account"
            ]
        }),
        parityClaim({
            claim: "incentive arbitration",
            olderApplication: "GET /ops/incentives, POST /ops/incentives/:offerId/:choice",
            replacement: "same routes with persisted nominations and locked draft records",
            status: "exceeded",
            evidence: [
                "/ops/incentives",
                "/ops/incentives/:offerId/:choice",
                "chain receipts and live observations"
            ]
        }),
        parityClaim({
            claim: "WebUX and public agent read surface",
            olderApplication: "GET /ui, GET /agents/:account/{curation,market,wallet}",
            replacement: "same route family",
            status: "met",
            evidence: [
                "/ui",
                "/agents/:account/curation",
                "/agents/:account/market",
                "/agents/:account/wallet"
            ]
        })
    ]);
    const writeReady = options.hiveWriteConfigured === true && hasPostingKey && hasActiveKey;
    const capabilityClaims = Object.freeze([
        parityClaim({
            claim: "wallets are actors playing games in arenas",
            olderApplication: "wallet fleet lanes",
            replacement: "wallet actors, capability games, arena moves, and witness rows per tick",
            status: "exceeded",
            evidence: [
                "aagaard.wallet-actor",
                "aagaard.wallet-arena",
                "/ops/arenas",
                "/ops/witnesses"
            ]
        }),
        parityClaim({
            claim: "voting, trading, and incentive lanes",
            olderApplication: "operational voting, trading, and incentive arbitration",
            replacement: "runtime-gated lanes with execution receipts",
            status: control.isEnabled("voting") && control.isEnabled("trading") && control.isEnabled("incentive") ? "met" : "open",
            evidence: [
                "capabilityReport",
                "executeVotes",
                "executeTrading",
                "executeIncentives"
            ]
        }),
        parityClaim({
            claim: "posting and gaming stay operator-locked",
            olderApplication: "posting and gaming locked",
            replacement: "locked draft preparation and locked game move proposals",
            status: isLocked("posting") && isLocked("gaming") ? "met" : "open",
            evidence: [
                "/ops/drafts/:account",
                "/ops/games/:account"
            ]
        }),
        parityClaim({
            claim: "raw substrate and durable operator history",
            olderApplication: "append-only data/history substrate",
            replacement: "typed transient fleet ticks, substrate snapshots, nominations, and drafts",
            status: "exceeded",
            evidence: [
                "chain receipts and live provider observations"
            ]
        }),
        parityClaim({
            claim: "Hive live write boundary",
            olderApplication: "wallet signing and broadcast over Hive",
            replacement: "the fleet signer (scripts/hive-broadcast.mjs) with keystore authority checks and tx-id receipts",
            status: writeReady ? "met" : "open",
            evidence: [
                "scripts/hive-broadcast.mjs",
                "keyRoot/<account>/posting.wif",
                "keyRoot/<account>/active.wif",
                "ExecutionReceipt.txId"
            ]
        })
    ]);
    const open = Object.freeze([
        ...control.running ? [] : [
            "control plane is paused"
        ],
        ...control.live ? [] : [
            "fleet is disarmed"
        ],
        ...options.hiveWriteConfigured === true ? [] : [
            "the fleet signer is not configured"
        ],
        ...hasPostingKey ? [] : [
            "no posting key found under keyRoot"
        ],
        ...hasActiveKey ? [] : [
            "no active key found under keyRoot"
        ],
        ...control.isEnabled("voting") ? [] : [
            "voting lane disabled"
        ],
        ...control.isEnabled("trading") ? [] : [
            "trading lane disabled"
        ],
        ...control.isEnabled("incentive") ? [] : [
            "incentive lane disabled"
        ]
    ]);
    return Object.freeze({
        kind: "aagaard.parity-report",
        olderApplication: "lib/emsenn/lib/triage/sites/aagaard.561.group",
        complete: open.length === 0 && [
            ...routeClaims,
            ...capabilityClaims
        ].every((claim)=>claim.status !== "open"),
        routes: routeClaims,
        capabilities: capabilityClaims,
        open
    });
}
export function createControlPlane(config) {
    const enabled = new Set(config.enabled.filter((entry)=>!isLocked(entry)));
    return {
        running: true,
        live: config.live,
        isEnabled (capabilityName) {
            return !isLocked(capabilityName) && enabled.has(capabilityName);
        },
        enable (capabilityName) {
            if (isLocked(capabilityName)) return false;
            enabled.add(capabilityName);
            return true;
        },
        disable (capabilityName) {
            enabled.delete(capabilityName);
        },
        enabledList () {
            return Object.freeze([
                ...enabled
            ]);
        }
    };
}
async function readField(hive, wallet) {
    if (!hive) return Object.freeze([]);
    try {
        return await hive.readCandidateField(wallet);
    } catch  {
        return Object.freeze([]);
    }
}
async function readState(hive, wallet) {
    if (!hive) return null;
    try {
        return await hive.readWalletState(wallet);
    } catch  {
        return null;
    }
}
async function readCurationRewards(hive, wallet) {
    if (!hive?.readCurationRewards) return null;
    try {
        return await hive.readCurationRewards(wallet);
    } catch  {
        return null;
    }
}
async function readMarket(market, wallet, state) {
    if (!market) return null;
    try {
        return await market.readWalletMarket(wallet, state);
    } catch  {
        return null;
    }
}
function unavailableMakerOrderScan(accounts, observedAt, limitation) {
    const requested = Object.freeze([
        ...new Set(accounts.map((account)=>account.toLowerCase()))
    ].sort());
    return Object.freeze({
        kind: "aagaard.maker-order-scan",
        observedAt,
        source: "hive-engine.market.buyBook+sellBook",
        accountsRequested: requested,
        accountsObserved: Object.freeze([]),
        complete: false,
        orders: Object.freeze([]),
        limitations: Object.freeze([
            limitation
        ])
    });
}
async function readFleetMakerOrders(market, accounts, observedAt) {
    if (!market?.readFleetOpenOrders) return unavailableMakerOrderScan(accounts, observedAt, "market boundary supplies no fleet open-order reader");
    try {
        const scan = await market.readFleetOpenOrders(accounts, observedAt);
        const expected = [
            ...new Set(accounts.map((account)=>account.toLowerCase()))
        ].sort();
        const requested = new Set(scan.accountsRequested);
        const observed = new Set(scan.accountsObserved);
        const coversFleet = expected.every((account)=>requested.has(account) && observed.has(account)) && scan.orders.every((order)=>requested.has(order.account));
        if (scan.complete && coversFleet) return scan;
        return Object.freeze({
            ...scan,
            complete: false,
            limitations: Object.freeze([
                ...scan.limitations,
                ...coversFleet ? [] : [
                    "open-order reading does not cover every configured fleet account"
                ]
            ])
        });
    } catch (error) {
        return unavailableMakerOrderScan(accounts, observedAt, `fleet open-order read unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function readInternalMarket(hive) {
    if (!hive?.readInternalMarket) return null;
    try {
        return await hive.readInternalMarket();
    } catch  {
        return null;
    }
}
export function mergeWalletState(wallet, state, market) {
    return Object.freeze({
        account: state?.account ?? wallet.account,
        hive: state?.hive ?? "0.000 HIVE",
        hbd: state?.hbd ?? "0.000 HBD",
        currentMana: state?.currentMana ?? "0",
        maxMana: state?.maxMana ?? "0",
        tokens: Object.freeze({
            ...state?.tokens ?? {},
            ...market?.tokens ?? {}
        })
    });
}
export function walletKeyStatus(keyRoot, account) {
    // The fleet signs unattended, so only plaintext role keys count as usable.
    const status = hiveKeyStatus(account, keyRoot);
    return Object.freeze({
        posting: status.posting === "plaintext",
        active: status.active === "plaintext"
    });
}
const HIVE_WRAP_RESERVE = 1;
const HIVE_WRAP_BUFFER = 1.2;
export function planWrap(wallet, state, tradingPlan, at = new Date().toISOString()) {
    const actions = [];
    if (wallet.tradingLive) {
        const neededSwapHive = tradingPlan.trades.filter((trade)=>trade.funded && trade.pair.startsWith("SWAP.HIVE/")).reduce((sum, trade)=>sum + Number(trade.quantity ?? "0"), 0);
        const heldSwapHive = Number((state?.tokens ?? wallet.tokens)["SWAP.HIVE"] ?? "0");
        const shortfall = neededSwapHive - heldSwapHive;
        if (shortfall > 0) {
            const heldHive = Number.parseFloat(state?.hive ?? "0");
            const available = heldHive - HIVE_WRAP_RESERVE;
            const wrapAmount = Math.min(shortfall * HIVE_WRAP_BUFFER, available);
            if (wrapAmount >= 0.01) {
                actions.push(Object.freeze({
                    kind: "wrap",
                    quantityHive: wrapAmount.toFixed(3),
                    reason: `cover funded buy-side trades needing ${neededSwapHive.toFixed(3)} SWAP.HIVE against ${heldSwapHive.toFixed(3)} held`
                }));
            }
        }
    }
    const moves = actions.map((action)=>Object.freeze({
            actor: wallet.account,
            action: termForCapability("trading", action.kind),
            target: "honey-swap",
            value: {
                quantityHive: action.quantityHive
            },
            charge: "active",
            reason: action.reason
        }));
    return Object.freeze({
        account: wallet.account,
        actions: Object.freeze(actions),
        arena: arenaOf({
            name: "trading",
            game: "HIVE/SWAP.HIVE peg maintenance",
            actors: [
                wallet
            ],
            moves,
            at
        })
    });
}
async function tickWallet(store, control, wallet, posts, fleetWallets, fieldAnalysis, rewardPrice, at, hive, marketBoundary, makerOrderScan, sign, now, automaticArbitrage) {
    const arenas = [];
    let curationSettlements = Object.freeze([]);
    const [chainState, curationScan] = await Promise.all([
        readState(hive, wallet),
        readCurationRewards(hive, wallet)
    ]);
    if (curationScan) curationSettlements = await recordCurationSettlements(store.dataDir, curationScan, at);
    const market = await readMarket(marketBoundary, wallet, chainState);
    const internalMarket = await readInternalMarket(hive);
    const flow = market && marketBoundary?.readTradeFlow ? await marketBoundary.readTradeFlow([
        ...new Set(market.venues.map((venue)=>venue.pair.split("/")[0]).filter((symbol)=>symbol !== undefined && symbol !== "SWAP.HIVE"))
    ]).catch(()=>({})) : {};
    const state = mergeWalletState(wallet, chainState, market);

    // Plan: the planners propose; nothing here signs.
    const plans = {};
    if (control.isEnabled("voting")) {
        plans.voting = planVotes(wallet, posts, at, state, fleetWallets, fieldAnalysis, rewardPrice);
        arenas.push(plans.voting.arena);
    }
    const tradingPlan = planTrades(wallet, at, state, market, internalMarket, flow, makerOrderScan ?? undefined);
    if (control.isEnabled("trading")) {
        plans.trading = tradingPlan;
        arenas.push(tradingPlan.arena);
        const wrapPlan = planWrap(wallet, state, tradingPlan, at);
        if (wrapPlan.actions.length > 0) {
            plans.wrap = wrapPlan;
            arenas.push(wrapPlan.arena);
        }
        const rawPlan = planStaking(wallet, state, at);
        const stakeParams = marketBoundary?.readStakeParams ? await marketBoundary.readStakeParams([
            ...new Set(rawPlan.actions.map((action)=>action.symbol))
        ]).catch(()=>({})) : {};
        const actions = rawPlan.actions.filter((action)=>{
            const params = stakeParams[action.symbol];
            if (!params) return true;
            return action.kind === "stake" ? params.stakingEnabled : params.delegationEnabled;
        });
        if (actions.length > 0) {
            plans.staking = Object.freeze({ ...rawPlan, actions: Object.freeze(actions) });
            arenas.push(plans.staking.arena);
        }
    }
    if (control.isEnabled("incentive")) {
        plans.incentive = planIncentives(wallet, posts, tradingPlan.liquidity, at);
        arenas.push(plans.incentive.arena);
        await recordIncentiveNominations(store, plans.incentive, at);
    }

    // Execute: every planned act is a gated move; ready moves sign once through the fleet signer.
    const armed = {
        voting: control.live && control.isEnabled("voting"),
        trading: control.live && control.isEnabled("trading"),
        incentive: control.live && control.isEnabled("incentive") && control.isEnabled("voting"),
    };
    const nowMs = now();
    const moves = hiveWalletMoves({ wallet, plans, armed });
    const { executions } = await actuateHiveFleetMoves({
        moves, diagnosis: `hive-fleet-tick:${wallet.account}:${at}`, date: at.slice(0, 10), dataDir: store.dataDir, sign,
    });
    const receipts = hiveMoveReceipts(moves, executions);
    // A pool-to-book round trip is deliberately two transactions: only the
    // capital cycle can prove the first before exposing the second.  It used
    // to be a disconnected script, so fleet ticks permanently reported the
    // planned bundle as skipped.  The result now joins this tick's carrier.
    const arbitrage = plans.trading && wallet.lanes.includes("arbitrage") && automaticArbitrage
        ? await automaticArbitrage({ wallet, live: armed.trading })
        : null;
    const arbitrageReceipt = automaticArbitrageReceipt(arbitrage);

    // Knowledge: the readout, predictions, scoreboard, drafts and substrate.
    let voting;
    let curationPredictions = Object.freeze([]);
    if (plans.voting) {
        const plan = plans.voting;
        const execution = laneExecution(receipts, "voting");
        curationPredictions = await recordCurationPredictions(store.dataDir, wallet.account, plan.votes, execution, at);
        voting = {
            currentMana: plan.currentMana,
            maxMana: plan.maxMana,
            votesPlanned: plan.votes.length,
            votesBroadcast: execution.broadcast,
            votesDryRun: execution.dryRun,
            votesSkipped: execution.skipped,
            execution,
            decision: plan.decision,
            refusals: plan.refusals,
            radar: {
                posts: plan.radar.posts,
                mispricingEnergy: plan.radar.mispricingEnergy,
                components: plan.radar.components,
                durable: plan.radar.durable,
                topSinks: plan.radar.sinks.slice(0, 5).map((sink)=>sink.key)
            },
            intelligence: {
                fiedler: plan.intelligence.spectral.fiedler,
                decayHalfLife: plan.intelligence.spectral.decayHalfLife,
                cartelCycles: plan.intelligence.cartels.b1,
                bridges: plan.intelligence.bridges.length,
                topByExpectedAlpha: plan.intelligence.posts.slice(0, 5).map((post)=>`${post.key} E[alpha]=${post.expectedAlpha}`)
            }
        };
    }
    let trading;
    if (plans.trading) {
        const capitalReceipts = Object.freeze([
            ...laneExecution(receipts, "trading", ["trade", "trade-bundle", "lp", "savings"]).receipts,
            ...(arbitrageReceipt ? [arbitrageReceipt] : [])
        ]);
        const confirmed = (action)=>capitalReceipts.filter((receipt)=>receipt.action === action && receipt.economicEffect?.status === "confirmed").length;
        const execution = Object.freeze({
            mode: !armed.trading ? "dry-run" : tradingPlan.liveEligible ? "live" : "not-live",
            tradesExecuted: confirmed("trade") + 2 * confirmed("trade-bundle"),
            bundlesExecuted: confirmed("trade-bundle"),
            lpExecuted: confirmed("lp"),
            savingsExecuted: confirmed("savings") > 0,
            receipts: capitalReceipts
        });
        trading = {
            mode: execution.mode,
            hive: tradingPlan.hive,
            hbd: tradingPlan.hbd,
            tradesPlanned: tradingPlan.trades.length + tradingPlan.bundles.filter((bundle)=>bundle.executable).length * 2,
            tradesExecuted: execution.tradesExecuted,
            bundlesPlanned: tradingPlan.bundles.filter((bundle)=>bundle.executable).length,
            bundlesFunded: tradingPlan.bundles.filter((bundle)=>bundle.funded).length,
            bundlesExecuted: execution.bundlesExecuted,
            lpPlanned: tradingPlan.lp.length,
            lpExecuted: execution.lpExecuted,
            savingsPlanned: tradingPlan.savings !== null,
            savingsExecuted: execution.savingsExecuted,
            execution,
            makerOrderSafety: Object.freeze({
                observedAt: makerOrderScan?.observedAt ?? at,
                complete: makerOrderScan?.complete ?? false,
                fleetOrders: makerOrderScan?.orders.length ?? 0,
                limitations: makerOrderScan?.limitations ?? Object.freeze([
                    "maker-order scan was not run"
                ])
            }),
            allocation: tradingPlan.allocation,
            rigidity: tradingPlan.liquidity.rigidity,
            flow: tradingPlan.liquidity.flow,
            cycleCapacities: tradingPlan.cycleCapacities,
            screening: tradingPlan.liquidity.screening
        };
    }
    const wrap = plans.wrap ? {
        actionsPlanned: plans.wrap.actions.length,
        execution: laneExecution(receipts, "trading", ["wrap", "unwrap"])
    } : undefined;
    const incentive = plans.incentive ? (()=>{
        const execution = laneExecution(receipts, "incentive");
        return {
            offersFound: plans.incentive.offers.length,
            nominated: plans.incentive.offers.filter((offer)=>offer.disposition === "nominate").length,
            autoExecuted: execution.broadcast,
            execution,
            topOffers: plans.incentive.offers.slice(0, 5).map((offer)=>`${offer.offer.source.author}/${offer.offer.source.permlink} EV=${offer.ev}`)
        };
    })() : undefined;
    const staking = plans.staking ? {
        actionsPlanned: plans.staking.actions.length,
        execution: laneExecution(receipts, "trading", ["stake", "delegate"])
    } : undefined;
    await recordScoreboardTick(store.dataDir, wallet.account, state, tradingPlan.liquidity, plans.voting ?? null, tradingPlan, trading?.execution ?? null, voting?.votesBroadcast ?? 0, at, chainState !== null && market !== null && market.availability?.balances !== false && internalMarket !== null);
    const drafts = composeDailyDrafts({
        wallet,
        voting: plans.voting ?? null,
        trading: tradingPlan,
        incentive: plans.incentive ?? null,
        at
    });
    await recordLockedDrafts(store, drafts);
    await recordSubstrateSnapshot(store, Object.freeze({
        kind: "aagaard.substrate-snapshot",
        ts: at,
        account: wallet.account,
        posts: Object.freeze([
            ...posts
        ]),
        activeVotes: Object.freeze(posts.flatMap((post)=>post.votes.map((vote)=>Object.freeze({
                    author: post.author,
                    permlink: post.permlink,
                    voter: vote.voter,
                    rshares: vote.rshares
                })))),
        chainState: state,
        market,
        liquidity: tradingPlan.liquidity
    }));
    arenas.push(arenaOf({
        name: "posting",
        game: "operator-reviewed publication",
        actors: [
            wallet
        ],
        locked: true,
        at,
        moves: [
            Object.freeze({
                actor: wallet.account,
                action: termForCapability("posting", "draft"),
                target: drafts[0]?.title ?? `${wallet.account} operations note`,
                value: {
                    drafts: drafts.map((draft)=>({
                            id: draft.id,
                            title: draft.title,
                            topic: draft.topic,
                            tags: [
                                ...draft.tags
                            ]
                        }))
                },
                charge: "potential",
                reason: "posting lane locked"
            })
        ]
    }));
    const gamingPlan = planGaming(wallet, at, state);
    arenas.push(gamingPlan.arena);
    const curation = await readCurationTelemetry(store.dataDir, wallet.account, curationScan ? "available" : hive?.readCurationRewards ? "unavailable" : "not-run");
    const readout = Object.freeze({
        account: wallet.account,
        curation,
        ...voting ? {
            voting
        } : {},
        ...trading ? {
            trading
        } : {},
        ...incentive ? {
            incentive
        } : {},
        ...staking ? {
            staking
        } : {},
        ...wrap ? {
            wrap
        } : {},
        posting: Object.freeze({
            draftsPrepared: drafts.length,
            locked: true
        }),
        gaming: Object.freeze({
            gamesDetected: gamingPlan.games.length,
            games: Object.freeze(gamingPlan.games.map((game)=>game.game)),
            locked: true
        }),
        arenas: Object.freeze(arenas)
    });
    return Object.freeze({
        readout,
        curationPredictions,
        curationSettlements
    });
}
export function createAagaardRuntime(config, store, options = {}) {
    const control = createControlPlane(config);
    let timer;
    let ticking = false;
    const runtime = {
        config,
        control,
        store,
        get isTicking () {
            return ticking;
        },
        wallet (account) {
            return config.wallets.find((wallet)=>wallet.account === account);
        },
        status () {
            return {
                kind: "aagaard.ops.status",
                name: config.name,
                running: control.running,
                live: control.live,
                ticking,
                cadenceSeconds: config.cadenceSeconds,
                enabled: [
                    ...control.enabledList()
                ],
                reads: {
                    hive: config.hive.enabled,
                    hiveEngine: config.hiveEngine.enabled
                },
                writes: {
                    hive: true
                },
                accounts: config.wallets.map((wallet)=>({
                        account: wallet.account,
                        archetype: wallet.strategy.archetype,
                        feeds: [
                            ...wallet.strategy.feeds
                        ],
                        tradingLive: wallet.tradingLive,
                        keys: {
                            posting: walletKeyStatus(config.keyRoot, wallet.account).posting,
                            active: walletKeyStatus(config.keyRoot, wallet.account).active
                        },
                        tokens: wallet.tokens
                    }))
            };
        },
        async runTick (at = new Date().toISOString()) {
            ticking = true;
            try {
                const fieldBatches = await Promise.all(config.wallets.map((wallet)=>readField(options.hive, wallet)));
                const commonFieldByKey = new Map();
                for (const post of fieldBatches.flat())commonFieldByKey.set(postKey(post), post);
                const commonField = Object.freeze([
                    ...commonFieldByKey.values()
                ].sort((left, right)=>postKey(left).localeCompare(postKey(right))));
                const fieldAnalysis = control.isEnabled("voting") ? analyzeVotingField(commonField, at) : undefined;
                const rewardPrice = control.isEnabled("voting") && options.hive?.readRewardPrice ? await options.hive.readRewardPrice().catch(()=>undefined) : undefined;
                const makerOrderScan = control.isEnabled("trading") ? await readFleetMakerOrders(options.market, config.wallets.map((wallet)=>wallet.account), at) : null;
                if (makerOrderScan) await recordMakerOrderScan(store.dataDir, makerOrderScan);
                const arbitrageAccounts = Object.freeze(config.wallets
                    .filter((wallet) => wallet.tradingLive && wallet.lanes.includes("arbitrage"))
                    .map((wallet) => wallet.account));
                const automaticArbitrage = arbitrageAccounts.length === 0 ? null : async ({ wallet, live }) => operateAutomaticArbitrage({
                    account: wallet.account,
                    admittedAccounts: arbitrageAccounts,
                    fleetAccounts: config.wallets.map((candidate) => candidate.account),
                    executeOne: live,
                    sign: options.sign,
                    dataDir: store.dataDir,
                });
                const walletTicks = await Promise.all(config.wallets.map((wallet)=>tickWallet(store, control, wallet, commonField, config.wallets, fieldAnalysis, rewardPrice, at, options.hive, options.market, makerOrderScan, options.sign, options.now ?? Date.now, automaticArbitrage)));
                const accounts = Object.freeze(walletTicks.map((tick)=>tick.readout));
                const witnesses = accounts.flatMap((account)=>account.arenas.flatMap((arena)=>arena.witnesses));
                const info = witnessLogInformation(witnesses);
                const readout = Object.freeze({
                    kind: "aagaard.fleet-tick",
                    ts: at,
                    running: control.running,
                    live: control.live,
                    enabled: control.enabledList(),
                    accounts,
                    witness: Object.freeze({
                        rows: info.rows,
                        uniqueWitnesses: info.uniqueWitnesses,
                        duplicateWitnesses: info.duplicateWitnesses
                    })
                });
                await recordFleetTick(store, readout);
                return readout;
            } finally{
                ticking = false;
            }
        },
        start (signal) {
            const cadenceMs = config.cadenceSeconds * 1000;
            const loop = async ()=>{
                if (signal.aborted) return;
                if (control.running) {
                    try {
                        await runtime.runTick();
                    } catch  {}
                }
                if (!signal.aborted) timer = setTimeout(()=>{
                    void loop();
                }, cadenceMs);
            };
            signal.addEventListener("abort", ()=>{
                if (timer) clearTimeout(timer);
            }, {
                once: true
            });
            void loop();
        }
    };
    return Object.freeze(runtime);
}
export function fleetWitnessDigest(readout) {
    return canonicalWitnessValue({
        kind: readout.kind,
        ts: readout.ts,
        accounts: readout.accounts.map((account)=>({
                account: account.account,
                arenas: account.arenas.map((arena)=>({
                        name: arena.name,
                        witnesses: arena.witnesses.length
                    }))
            }))
    });
}
// The fleet's accounts, by name, from the strategy config.
export const FLEET_ACCOUNTS = Object.freeze(loadAagaardConfig().wallets.map(({ account }) => account));
