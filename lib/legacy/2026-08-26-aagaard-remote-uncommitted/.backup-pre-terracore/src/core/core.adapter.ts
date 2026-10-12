import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";

import {
  tm,
  type Tm,
  canonicalWitnessValue,
  witnessCell,
  witnessLogInformation,
  type WitnessRow,
  type WitnessValue,
} from "./witness.mts";

import { readSpectral, type WeightedEdge } from "../analysis/spectral.mts";
import { formanCurvature } from "../analysis/graph.mts";
import { readVotingIntelligenceOf } from "../analysis/intelligence.mts";
import { readHolonomy, MIN_POOL_TVL_QUOTE, type ArbitrageCycle } from "../analysis/holonomy.mts";
import { recordScoreboardTick } from "./scoreboard.mts";
import { allocateBudget, type AllocationCandidate, type AllocationResult } from "../analysis/allocation.mts";
import { readRigidity, edgesFromPools, type RigidityReading } from "../analysis/rigidity.mts";
import { detailedBalance, type FlowReading, type TradeFill } from "../analysis/flow.mts";
import { catabolicCapacity, type CatabolicCapacity } from "../analysis/capacity.mts";
import { readScreening, edgesForScreening, type ScreeningReading } from "../analysis/screening.mts";

export type Capability = "voting" | "trading" | "incentive" | "posting" | "gaming";
export type ExecutionMode = "live" | "dry-run" | "propose-only" | "locked";
export type ArenaCharge = "potential" | "active" | "stable" | "absurd";

export const ALL_CAPABILITIES: readonly Capability[] = Object.freeze(["voting", "trading", "incentive", "posting", "gaming"]);
export const LOCKED_CAPABILITIES: readonly Capability[] = Object.freeze(["posting", "gaming"]);

export interface WalletStrategy {
  readonly archetype: string;
  readonly feeds: readonly string[];
  readonly objective: Readonly<Record<string, number>>;
  readonly conviction: number;
  readonly votingPowerFloorBps: number;
  readonly maxVotesPerTick: number;
}

export interface WalletActor {
  readonly kind: "aagaard.wallet-actor";
  readonly account: string;
  readonly strategy: WalletStrategy;
  readonly tradingLive: boolean;
  readonly risk: {
    readonly capHiveMilli: number;
    readonly capHbdMilli: number;
    readonly minLiquidHbdMilli: number;
    readonly maxVoteWeightBps: number;
  };
  readonly tokens: Readonly<Record<string, string>>;
}

export interface AagaardConfig {
  readonly kind: "aagaard.config";
  readonly name: string;
  readonly live: boolean;
  readonly enabled: readonly Capability[];
  readonly cadenceSeconds: number;
  readonly keyRoot: string;
  readonly hive: {
    readonly enabled: boolean;
    readonly nodes: readonly string[];
    readonly timeoutMs: number;
    readonly perSourceLimit: number;
  };
  readonly hiveEngine: {
    readonly enabled: boolean;
    readonly nodes: readonly string[];
    readonly timeoutMs: number;
    readonly balanceLimit: number;
    readonly marketLimit: number;
    readonly poolLimit: number;
    readonly symbols: readonly string[];
  };
  readonly wallets: readonly WalletActor[];
}

export interface ArenaMove {
  readonly actor: string;
  readonly action: Tm;
  readonly target: string;
  readonly value: WitnessValue;
  readonly charge: ArenaCharge;
  readonly reason: string;
}

export interface WalletArena {
  readonly kind: "aagaard.wallet-arena";
  readonly name: Capability;
  readonly game: string;
  readonly actors: readonly WalletActor[];
  readonly moves: readonly ArenaMove[];
  readonly converged: boolean;
  readonly locked: boolean;
  readonly witnesses: readonly WitnessRow[];
}

export interface PostCandidate {
  readonly author: string;
  readonly permlink: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly pendingPayout: number;
  readonly netRshares: number;
  readonly comments: number;
  readonly ageHours: number;
  /** ISO creation timestamp. Real chain data carries this; it is what the
   *  HF25 curation-window timing read is measured against. */
  readonly created: string;
  /** Beneficiary routing (weights in hundredths of a percent, 10000 = 100%) —
   *  a post can route its payout away from author/curators entirely. */
  readonly beneficiaries: readonly { readonly account: string; readonly weight: number }[];
  readonly votes: readonly { readonly voter: string; readonly rshares: number; readonly time?: string; readonly percent?: number }[];
}

export interface AlphaRadar {
  readonly kind: "aagaard.alpha-radar";
  readonly posts: number;
  readonly mispricingEnergy: number;
  readonly components: number;
  readonly durable: boolean;
  readonly sinks: readonly {
    readonly key: string;
    readonly author: string;
    readonly permlink: string;
    readonly deficit: number;
    readonly cohort: string;
  }[];
}

export interface VotingIntelligence {
  readonly kind: "aagaard.voting-intelligence";
  readonly spectral: {
    readonly fiedler: number;
    readonly lambdaMax: number;
    readonly components: number;
    readonly decayHalfLife: number;
    readonly durable: boolean;
  };
  /** Forman-Ricci curvature of the post<->tag attention graph. Strongly
   *  negative-curvature edges are the structural bridges. */
  readonly curvature: {
    readonly bridges: readonly { readonly a: string; readonly b: string; readonly curvature: number }[];
  };
  readonly cartels: {
    readonly b1: number;
    readonly cycleDensity: number;
    readonly tightPairs: readonly { readonly a: string; readonly b: string; readonly overlap: number }[];
  };
  readonly bridges: readonly string[];
  readonly posts: readonly {
    readonly key: string;
    readonly deficit: number;
    readonly expectedAlpha: number;
    readonly kirchhoffWeightBps: number;
    readonly likelyCartelTrail: boolean;
    readonly bridge: boolean;
    readonly timingScore: number;
    readonly engagement: number;
    /** KL-novelty x focus content fitness (analysis/content). */
    readonly contentFitness: number;
    /** Persistent-homology durability over the reward filtration (analysis/graph). */
    readonly durability: number;
    /** Share of this post's (capped) voters who sit in a detected cartel ring. */
    readonly cartelExposure: number;
    readonly downvotePressure: number;
    readonly frustration: number;
    /** Sheaf layer-disagreement: |normalised payout - normalised endorsement|. */
    readonly layerDisagreement: number;
    /** Bounded discount for the field's own spectral self-correction rate. */
    readonly reflexiveDiscount: number;
  }[];
}

export interface VotePlanItem {
  readonly author: string;
  readonly permlink: string;
  readonly weightBps: number;
  readonly strategyAlpha: number;
  readonly sinkDeficit: number;
  readonly reason: string;
}

export interface VotingPlan {
  readonly account: string;
  readonly currentMana: string;
  readonly maxMana: string;
  readonly radar: AlphaRadar;
  readonly intelligence: VotingIntelligence;
  readonly votes: readonly VotePlanItem[];
  readonly decision: string;
  readonly arena: WalletArena;
}

export interface LiquidityReading {
  readonly kind: "aagaard.liquidity";
  readonly venues: readonly {
    readonly venue: string;
    readonly pair: string;
    readonly midpoint: number;
    readonly bidDepth: number;
    readonly askDepth: number;
    readonly relativeSpreadBps: number;
    readonly imbalance: number;
    readonly thin: boolean;
  }[];
  readonly pools: readonly {
    readonly pair: string;
    readonly impliedPrice: number;
    readonly tvlQuote: number;
    readonly feeBps: number;
  }[];
  readonly corridors: readonly {
    readonly symbol: string;
    readonly cheapVenue: string;
    readonly richVenue: string;
    readonly divergenceBps: number;
    readonly netCorridorBps: number;
  }[];
  readonly totalDepthProxy: number;
  /** Percolation/coordination-cohomology reading of the pool-connectivity
   *  graph (analysis/rigidity.mts) -- whether this account's currently
   *  visible pool structure has real cyclic redundancy (load-bearing) or
   *  is exactly at the spanning-forest threshold (floppy: one pool's
   *  liquidity leaving would fragment a path). Reported for observation;
   *  no trade decision depends on it yet. */
  readonly rigidity: RigidityReading;
  /** Detailed-balance / signed net flux per symbol (analysis/flow.mts),
   *  from realized fills -- reported for observation; no trade decision
   *  depends on its direction yet. */
  readonly flow: readonly FlowReading[];
  /** Debye graph screening reach per token in the pool graph
   *  (analysis/screening.mts) -- how far a shock at that token would
   *  propagate before attenuating out. Reported for observation; no
   *  trade or risk decision depends on it yet. */
  readonly screening: readonly ScreeningReading[];
}

export interface TradingPlan {
  readonly account: string;
  readonly hive: string;
  readonly hbd: string;
  readonly liveEligible: boolean;
  readonly liquidity: LiquidityReading;
  readonly trades: readonly {
    readonly pair: string;
    readonly side: "buy" | "sell";
    readonly amount: number;
    readonly edgeBps: number;
    readonly reason: string;
    /** Whether this tick's budget allocator (analysis/allocation.mts)
     *  selected this candidate within the account's real capital budget --
     *  an unfunded candidate is reported, never executed. */
    readonly funded: boolean;
    /** Real unit-converted broadcast quantity (token units, string per
     *  Hive-Engine convention), computed from live price data when the
     *  trade was funded and its pair prices against SWAP.HIVE; null when
     *  unfunded or unpriceable -- never a placeholder guess. */
    readonly quantity: string | null;
  }[];
  readonly lp: readonly { readonly pool: string; readonly action: "compound" | "rebalance"; readonly value: number }[];
  readonly savings: { readonly amountHbd: number } | null;
  /** Every arbitrage cycle the price graph carries a significant nonzero
   *  holonomy on — not only pairwise corridors, but any N-hop cycle across
   *  venues and pools. See analysis/holonomy.mts. */
  readonly arbitrageCycles: readonly ArbitrageCycle[];
  /** Catabolic capacity bound per cycle above, same order (analysis/
   *  capacity.mts) -- a hard, within-this-snapshot ceiling on further
   *  profitable trades before that cycle's own mispricing mass is used
   *  up. Reported for observation; no trade decision depends on it yet. */
  readonly cycleCapacities: readonly CatabolicCapacity[];
  /** This tick's budget-allocation summary (see analysis/allocation.mts
   *  and the Obsmetrologia financial-methods catalog, section 1) --
   *  reported even when every candidate is funded, so choiceBits is always
   *  visible for observation. */
  readonly allocation: AllocationResult;
  readonly arena: WalletArena;
}

export type IncentiveActionKind = "vote" | "reblog" | "comment" | "post" | "delegate" | "follow";

export interface IncentiveOffer {
  readonly id: string;
  readonly source: { readonly author: string; readonly permlink: string; readonly community?: string };
  readonly requiredActions: readonly IncentiveActionKind[];
  readonly reward: { readonly token: string; readonly amount?: number } | null;
  readonly rawText: string;
}

export interface IncentivePlan {
  readonly account: string;
  readonly offers: readonly {
    readonly offer: IncentiveOffer;
    readonly ev: number;
    readonly scamReasons: readonly string[];
    readonly disposition: "auto" | "nominate";
  }[];
  readonly arena: WalletArena;
}

export interface StakingAction {
  readonly kind: "stake" | "delegate";
  readonly symbol: string;
  readonly quantity: string;
  readonly to: string;
  readonly reason: string;
}

export interface StakingPlan {
  readonly account: string;
  readonly actions: readonly StakingAction[];
  readonly arena: WalletArena;
}

export interface LockedDraft {
  readonly id: string;
  readonly account: string;
  readonly kind: "post" | "reply";
  readonly topic: "operations" | "he-liquidity" | "hive-spectral" | "incentive-response";
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly composedAt: string;
  readonly approvedForBroadcast: false;
  readonly sourceOfferId?: string;
}

export type IncentiveDispositionChoice = "ignore" | "llm-draft" | "manual";
export type IncentiveNominationStatus = "pending" | "ignored" | "manual" | "drafted";

export interface IncentiveNominationRecord {
  readonly offerId: string;
  readonly account: string;
  readonly offer: IncentiveOffer;
  readonly ev: number;
  readonly scamReasons: readonly string[];
  readonly status: IncentiveNominationStatus;
  readonly firstSeen: string;
  readonly updated: string;
  readonly draftId?: string;
}

export interface GamingPlan {
  readonly account: string;
  readonly games: readonly {
    readonly game: string;
    readonly heldTokens: readonly { readonly symbol: string; readonly balance: string }[];
    readonly customJsonId: string;
    readonly proposedMove: string;
    readonly approvedForBroadcast: false;
  }[];
  readonly arena: WalletArena;
}

export interface AccountTickReadout {
  readonly account: string;
  readonly voting?: {
    readonly currentMana: string;
    readonly maxMana: string;
    readonly votesPlanned: number;
    readonly votesBroadcast: number;
    readonly votesDryRun: number;
    readonly votesSkipped: number;
    readonly execution: VotingExecution;
    readonly decision: string;
    readonly radar: Pick<AlphaRadar, "posts" | "mispricingEnergy" | "components" | "durable"> & { readonly topSinks: readonly string[] };
    readonly intelligence: {
      readonly fiedler: number;
      readonly decayHalfLife: number;
      readonly cartelCycles: number;
      readonly bridges: number;
      readonly topByExpectedAlpha: readonly string[];
    };
  };
  readonly trading?: {
    readonly mode: ExecutionMode;
    readonly hive: string;
    readonly hbd: string;
    readonly tradesPlanned: number;
    readonly tradesExecuted: number;
    readonly lpPlanned: number;
    readonly lpExecuted: number;
    readonly savingsPlanned: boolean;
    readonly savingsExecuted: boolean;
    readonly execution: TradingExecution;
    /** This tick's budget-allocation summary (analysis/allocation.mts) --
     *  reported for observation regardless of execution mode. */
    readonly allocation: AllocationResult;
    /** This tick's pool-connectivity rigidity reading (analysis/rigidity.mts)
     *  -- reported for observation; no trade decision depends on it yet. */
    readonly rigidity: RigidityReading;
    /** This tick's detailed-balance flow readings (analysis/flow.mts) --
     *  reported for observation; no trade decision depends on it yet. */
    readonly flow: readonly FlowReading[];
    /** Catabolic capacity bound per detected cycle (analysis/capacity.mts)
     *  -- reported for observation; no trade decision depends on it yet. */
    readonly cycleCapacities: readonly CatabolicCapacity[];
    /** Debye graph screening reach per token (analysis/screening.mts) --
     *  reported for observation; no decision depends on it yet. */
    readonly screening: readonly ScreeningReading[];
  };
  readonly incentive?: {
    readonly offersFound: number;
    readonly nominated: number;
    readonly autoExecuted: number;
    readonly execution: IncentiveExecution;
    readonly topOffers: readonly string[];
  };
  readonly staking?: {
    readonly actionsPlanned: number;
    readonly execution: StakingExecution;
  };
  readonly wrap?: {
    readonly actionsPlanned: number;
    readonly execution: StakingExecution;
  };
  readonly posting: { readonly draftsPrepared: number; readonly locked: true };
  readonly gaming: { readonly gamesDetected: number; readonly games: readonly string[]; readonly locked: true };
  readonly arenas: readonly WalletArena[];
}

export interface FleetTickReadout {
  readonly kind: "aagaard.fleet-tick";
  readonly ts: string;
  readonly running: boolean;
  readonly live: boolean;
  readonly enabled: readonly Capability[];
  readonly accounts: readonly AccountTickReadout[];
  readonly witness: {
    readonly rows: number;
    readonly uniqueWitnesses: number;
    readonly duplicateWitnesses: number;
  };
}

export interface StateStore {
  readonly root: string;
  readonly logDir: string;
  readonly stateDir: string;
  readonly recordDir: string;
  readonly contentDir: string;
  readonly scoreboardDir: string;
}

export interface WalletChainState {
  readonly account: string;
  readonly hive: string;
  readonly hbd: string;
  readonly currentMana: string;
  readonly maxMana: string;
  readonly tokens: Readonly<Record<string, string>>;
}

export interface InternalMarketReading {
  readonly midpoint: number;
  readonly bidDepth: number;
  readonly askDepth: number;
  readonly relativeSpreadBps: number;
}

export interface HiveReadBoundary {
  readCandidateField(wallet: WalletActor): Promise<readonly PostCandidate[]>;
  readWalletState(wallet: WalletActor): Promise<WalletChainState | null>;
  readInternalMarket?(): Promise<InternalMarketReading | null>;
}

export interface WalletMarketState {
  readonly tokens: Readonly<Record<string, string>>;
  readonly venues: LiquidityReading["venues"];
  readonly pools: LiquidityReading["pools"];
  /** Each token's own on-chain decimal precision (Hive-Engine's tokens
   *  table) -- needed to round a computed trade quantity to a string the
   *  market contract will actually accept. Sending more decimal places
   *  than a token's defined precision is rejected outright ("invalid
   *  params"), verified on a real broadcast (SIM, precision 3, rejected
   *  when sized to 8 decimals). Absent, never guessed, when unfetched. */
  readonly precision: Readonly<Record<string, number>>;
}

export interface TokenStakeParams {
  readonly stakingEnabled: boolean;
  readonly delegationEnabled: boolean;
}

export interface MarketReadBoundary {
  readWalletMarket(wallet: WalletActor, state?: WalletChainState | null): Promise<WalletMarketState | null>;
  readStakeParams?(symbols: readonly string[]): Promise<Readonly<Record<string, TokenStakeParams>>>;
  /** Real realized-fill detailed-balance reading per symbol (see
   *  analysis/flow.mts) -- observation only, no trade decision depends on
   *  it yet. */
  readTradeFlow?(symbols: readonly string[]): Promise<Readonly<Record<string, FlowReading>>>;
}

export interface WalletKeyStatus {
  readonly posting: boolean;
  readonly active: boolean;
}

export type ExecutionStatus = "broadcast" | "dry-run" | "propose-only" | "skipped" | "error";

export interface ExecutionReceipt {
  readonly lane: "voting" | "trading" | "incentive";
  readonly action: string;
  readonly target: string;
  readonly status: ExecutionStatus;
  readonly role: "posting" | "active";
  readonly txId?: string;
  readonly error?: string;
}

export interface VotingExecution {
  readonly broadcast: number;
  readonly dryRun: number;
  readonly skipped: number;
  readonly errors: number;
  readonly receipts: readonly ExecutionReceipt[];
}

export interface TradingExecution {
  readonly mode: ExecutionMode;
  readonly tradesExecuted: number;
  readonly lpExecuted: number;
  readonly savingsExecuted: boolean;
  readonly receipts: readonly ExecutionReceipt[];
}

export interface IncentiveExecution {
  readonly broadcast: number;
  readonly dryRun: number;
  readonly skipped: number;
  readonly errors: number;
  readonly receipts: readonly ExecutionReceipt[];
}

export interface StakingExecution {
  readonly broadcast: number;
  readonly dryRun: number;
  readonly skipped: number;
  readonly errors: number;
  readonly receipts: readonly ExecutionReceipt[];
}

export interface HiveWriteBoundary {
  vote(wallet: WalletActor, vote: VotePlanItem): Promise<{ readonly id: string }>;
  trade?(wallet: WalletActor, trade: TradingPlan["trades"][number]): Promise<{ readonly id: string }>;
  liquidity?(wallet: WalletActor, entry: TradingPlan["lp"][number]): Promise<{ readonly id: string }>;
  savings?(wallet: WalletActor, entry: NonNullable<TradingPlan["savings"]>): Promise<{ readonly id: string }>;
  incentive?(wallet: WalletActor, offer: IncentiveOffer, action: Exclude<IncentiveActionKind, "comment" | "post" | "delegate">): Promise<{ readonly id: string }>;
  stake?(wallet: WalletActor, action: StakingAction): Promise<{ readonly id: string }>;
  /** Native HIVE<->SWAP.HIVE peg move (see hiveEngineOps.mjs's wrapHive/
   *  unwrapHive) -- "wrap" is a plain Hive transfer to honey-swap, "unwrap"
   *  is a hivepegged.withdraw custom_json; both real, verified operations. */
  wrap?(wallet: WalletActor, action: WrapAction): Promise<{ readonly id: string }>;
}

export interface WrapAction {
  readonly kind: "wrap" | "unwrap";
  readonly quantityHive: string;
  readonly reason: string;
}

export interface TickSubstrateSnapshot {
  readonly kind: "aagaard.substrate-snapshot";
  readonly ts: string;
  readonly account: string;
  readonly posts: readonly PostCandidate[];
  readonly activeVotes: readonly {
    readonly author: string;
    readonly permlink: string;
    readonly voter: string;
    readonly rshares: number;
  }[];
  readonly chainState: WalletChainState;
  readonly market: WalletMarketState | null;
  readonly liquidity: LiquidityReading;
}

const DEFAULT_OBJECTIVES: Readonly<Record<string, Readonly<Record<string, number>>>> = Object.freeze({
  "alpha-hunter": Object.freeze({ underrecognition: 1.8, communityFit: 0.5, conversation: 0.5, durability: 1.2, bridge: 1.2, quality: 1.0, cartelAversion: 1.4 }),
  "patron-steward": Object.freeze({ underrecognition: 1.0, communityFit: 1.6, conversation: 1.1, durability: 1.2, bridge: 0.6, quality: 1.3, cartelAversion: 1.0 }),
  curator: Object.freeze({ underrecognition: 1.0, communityFit: 1.0, conversation: 1.0, durability: 1.0, bridge: 1.0, quality: 1.0, cartelAversion: 1.0 }),
  gardener: Object.freeze({ underrecognition: 0.9, communityFit: 1.7, conversation: 1.4, durability: 1.0, bridge: 0.5, quality: 1.1, cartelAversion: 0.8 }),
  scout: Object.freeze({ underrecognition: 1.4, communityFit: 0.8, conversation: 1.0, durability: 0.8, bridge: 1.8, quality: 1.0, cartelAversion: 1.0 }),
  archivist: Object.freeze({ underrecognition: 0.8, communityFit: 1.0, conversation: 0.7, durability: 1.9, bridge: 0.7, quality: 1.5, cartelAversion: 1.2 }),
});

const DEFAULT_ACCOUNTS = Object.freeze([
  { account: "emsenn0", archetype: "curator", feeds: ["following", "trending"] },
  { account: "essiebee", archetype: "gardener", feeds: ["gaming", "hive-140217"], tokens: { STARBITS: "1000" } },
  { account: "sigmund-vexler", archetype: "alpha-hunter", feeds: ["trending"], tradingLive: true, tokens: { DEC: "12.5", SPS: "3.2" } },
  { account: "marshian", archetype: "scout", feeds: ["art", "writing", "photography"] },
  { account: "michael561", archetype: "archivist", feeds: ["following", "blog:emsenn0"] },
  { account: "help-fund", archetype: "patron-steward", feeds: ["hive-167922", "finance", "dev"], tokens: { SIM: "50" } },
] as const);

function hoursAgoIso(hours: number, at: string): string {
  return new Date(Date.parse(at) - hours * 3_600_000).toISOString();
}

// Anchored to real wall-clock at module load, not a fixed historical instant,
// so the mock field always reads as fresh (matching its static ageHours
// labels) regardless of when the process actually starts.
const MOCK_NOW = new Date().toISOString();

export const DEFAULT_POSTS: readonly PostCandidate[] = Object.freeze([
  {
    author: "alice",
    permlink: "community-market-notes",
    title: "Community market notes",
    body: "A well sourced look at HIVE/HBD routing. Reblog and comment to earn 5 PIZZA.",
    tags: Object.freeze(["finance", "hive-167922", "hive"]),
    pendingPayout: 1.25,
    netRshares: 9000,
    comments: 12,
    ageHours: 8,
    created: hoursAgoIso(8, MOCK_NOW),
    beneficiaries: Object.freeze([]),
    votes: Object.freeze([
      { voter: "curator-a", rshares: 4000, time: hoursAgoIso(6, MOCK_NOW), percent: 10000 },
      { voter: "curator-b", rshares: 5000, time: hoursAgoIso(3, MOCK_NOW), percent: 10000 },
    ]),
  },
  {
    author: "bob",
    permlink: "splinterlands-week",
    title: "Splinterlands week",
    body: "Gaming field report and tournament notes.",
    tags: Object.freeze(["gaming", "hive-140217", "hive"]),
    pendingPayout: 6.5,
    netRshares: 5200,
    comments: 4,
    ageHours: 26,
    created: hoursAgoIso(26, MOCK_NOW),
    beneficiaries: Object.freeze([{ account: "splinterlands-fund", weight: 1000 }]),
    // Evenly-spaced, dense train — the diffraction read's canonical bot signature.
    votes: Object.freeze([
      { voter: "train-a", rshares: 2000, time: hoursAgoIso(25.0, MOCK_NOW), percent: 10000 },
      { voter: "train-b", rshares: 2000, time: hoursAgoIso(24.9, MOCK_NOW), percent: 10000 },
      { voter: "train-c", rshares: 2000, time: hoursAgoIso(24.8, MOCK_NOW), percent: 10000 },
      { voter: "train-d", rshares: 2000, time: hoursAgoIso(24.7, MOCK_NOW), percent: 10000 },
      { voter: "train-e", rshares: 2000, time: hoursAgoIso(24.6, MOCK_NOW), percent: 10000 },
      { voter: "train-f", rshares: 2000, time: hoursAgoIso(24.5, MOCK_NOW), percent: 10000 },
      { voter: "train-g", rshares: 2000, time: hoursAgoIso(24.4, MOCK_NOW), percent: 10000 },
      { voter: "train-h", rshares: 2000, time: hoursAgoIso(24.3, MOCK_NOW), percent: 10000 },
    ]),
  },
  {
    author: "carol",
    permlink: "public-interest-dev",
    title: "Public interest development",
    body: "A durable technical writeup with code, citations, and open questions.",
    tags: Object.freeze(["dev", "stemgeeks", "hive"]),
    pendingPayout: 0.4,
    netRshares: 18000,
    comments: 18,
    ageHours: 14,
    created: hoursAgoIso(14, MOCK_NOW),
    beneficiaries: Object.freeze([]),
    votes: Object.freeze([
      { voter: "researcher", rshares: 12000, time: hoursAgoIso(11, MOCK_NOW), percent: 10000 },
      { voter: "builder", rshares: 6000, time: hoursAgoIso(4, MOCK_NOW), percent: 10000 },
    ]),
  },
  {
    author: "dana",
    permlink: "photography-bridge",
    title: "Photography bridge",
    body: "A cross-community photo essay connecting art and local history.",
    tags: Object.freeze(["photography", "art", "history", "hive"]),
    pendingPayout: 0.85,
    netRshares: 8400,
    comments: 9,
    ageHours: 10,
    created: hoursAgoIso(10, MOCK_NOW),
    beneficiaries: Object.freeze([]),
    votes: Object.freeze([{ voter: "artist", rshares: 8400, time: hoursAgoIso(7, MOCK_NOW), percent: 10000 }]),
  },
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(value) ? Object.freeze(value.filter((entry): entry is string => typeof entry === "string")) : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function expandHome(value: string, env: NodeJS.ProcessEnv): string {
  return value === "~" || value.startsWith("~/")
    ? path.join(env["HOME"] ?? process.cwd(), value.slice(2))
    : value;
}

function readJsonFile(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function capability(value: string): value is Capability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}

function enabledCapabilities(raw: unknown): readonly Capability[] {
  const values: readonly Capability[] = Array.isArray(raw)
    ? raw.filter((entry): entry is Capability => typeof entry === "string" && capability(entry))
    : ["voting", "trading", "incentive"];
  return Object.freeze(values.filter((entry) => !LOCKED_CAPABILITIES.includes(entry)));
}

function strategyFor(archetype: string, feeds: readonly string[], overlay: Record<string, unknown>): WalletStrategy {
  const objectiveRaw = isRecord(overlay["objective"]) ? overlay["objective"] : {};
  const baseObjective = DEFAULT_OBJECTIVES[archetype] ?? DEFAULT_OBJECTIVES["curator"]!;
  const objective = Object.freeze(Object.fromEntries(
    Object.entries(baseObjective).map(([key, value]) => [key, numberOr(objectiveRaw[key], value)]),
  ));
  return Object.freeze({
    archetype,
    feeds: Object.freeze([...feeds]),
    objective,
    conviction: numberOr(overlay["conviction"], archetype === "alpha-hunter" ? 1.35 : 1.15),
    votingPowerFloorBps: numberOr(overlay["votingPowerFloorBps"], archetype === "alpha-hunter" ? 6500 : 8000),
    maxVotesPerTick: Math.max(1, Math.floor(numberOr(overlay["maxVotesPerTick"], 1))),
  });
}

function walletFrom(raw: unknown): WalletActor | null {
  if (!isRecord(raw) || typeof raw["account"] !== "string") return null;
  const account = raw["account"];
  const archetype = typeof raw["archetype"] === "string" ? raw["archetype"] : "curator";
  const feeds = strings(raw["feeds"], ["trending"]);
  const tokens = isRecord(raw["tokens"]) ? Object.freeze(Object.fromEntries(
    Object.entries(raw["tokens"]).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )) : Object.freeze({});
  return Object.freeze({
    kind: "aagaard.wallet-actor" as const,
    account,
    strategy: strategyFor(archetype, feeds, raw),
    tradingLive: raw["tradingLive"] === true,
    risk: Object.freeze({
      capHiveMilli: numberOr(raw["capHiveMilli"], raw["tradingLive"] === true ? 5000 : 1000),
      capHbdMilli: numberOr(raw["capHbdMilli"], raw["tradingLive"] === true ? 5000 : 1000),
      minLiquidHbdMilli: numberOr(raw["minLiquidHbdMilli"], raw["tradingLive"] === true ? 500 : 1000),
      maxVoteWeightBps: numberOr(raw["maxVoteWeightBps"], raw["tradingLive"] === true ? 10000 : 5000),
    }),
    tokens,
  });
}

function hiveConfig(raw: Record<string, unknown>): AagaardConfig["hive"] {
  const hive = isRecord(raw["hive"]) ? raw["hive"] : {};
  const nodes = strings(hive["nodes"], [
    "https://api.hive.blog",
    "https://api.deathwing.me",
    "https://rpc.mahdiyari.info",
  ]);
  return Object.freeze({
    enabled: hive["enabled"] !== false,
    nodes,
    timeoutMs: Math.max(1000, Math.floor(numberOr(hive["timeoutMs"], 6000))),
    perSourceLimit: Math.max(1, Math.min(100, Math.floor(numberOr(hive["perSourceLimit"], 20)))),
  });
}

function hiveEngineConfig(raw: Record<string, unknown>): AagaardConfig["hiveEngine"] {
  const hiveEngine = isRecord(raw["hiveEngine"]) ? raw["hiveEngine"] : {};
  const nodes = strings(hiveEngine["nodes"], [
    "https://api.hive-engine.com/rpc/contracts",
    "https://herpc.dtools.dev/contracts",
  ]);
  return Object.freeze({
    enabled: hiveEngine["enabled"] !== false,
    nodes,
    timeoutMs: Math.max(1000, Math.floor(numberOr(hiveEngine["timeoutMs"], 6000))),
    balanceLimit: Math.max(1, Math.min(1000, Math.floor(numberOr(hiveEngine["balanceLimit"], 500)))),
    marketLimit: Math.max(1, Math.min(200, Math.floor(numberOr(hiveEngine["marketLimit"], 50)))),
    poolLimit: Math.max(1, Math.min(1000, Math.floor(numberOr(hiveEngine["poolLimit"], 500)))),
    symbols: strings(hiveEngine["symbols"], ["DEC", "SPS", "STARBITS", "SIM", "BUDS", "PIZZA"]),
  });
}

export function loadAagaardConfig(options: { readonly configPath?: string; readonly env?: NodeJS.ProcessEnv } = {}): AagaardConfig {
  const env = options.env ?? process.env;
  let raw: Record<string, unknown> = {};
  if (options.configPath && existsSync(options.configPath)) {
    const parsed = readJsonFile(options.configPath);
    if (isRecord(parsed)) raw = parsed;
  }
  const accountRows = Array.isArray(raw["accounts"]) ? raw["accounts"] : DEFAULT_ACCOUNTS;
  const wallets = Object.freeze(accountRows.map(walletFrom).filter((entry): entry is WalletActor => entry !== null));
  return Object.freeze({
    kind: "aagaard.config" as const,
    name: typeof raw["name"] === "string" ? raw["name"] : "aagaard",
    live: env["AAGAARD_LIVE"] === "1" || raw["live"] === true,
    enabled: enabledCapabilities(raw["enabled"]),
    cadenceSeconds: Math.max(60, Math.floor(numberOr(raw["cadenceSeconds"], 900))),
    keyRoot: expandHome(env["AAGAARD_KEY_ROOT"] ?? (typeof raw["keyRoot"] === "string" ? raw["keyRoot"] : "~/.config/blockchain/hive"), env),
    hive: hiveConfig(raw),
    hiveEngine: hiveEngineConfig(raw),
    wallets,
  });
}

export function isLocked(capabilityName: Capability): boolean {
  return LOCKED_CAPABILITIES.includes(capabilityName);
}

export function termForCapability(name: Capability, verb: string): Tm {
  return tm.pair(tm.mark(`aagaard.${name}`), tm.mark(verb));
}

function witnessMove(arena: Capability, move: ArenaMove, at: string): WitnessRow {
  return witnessCell(
    `wallet/${move.actor}`,
    move.action as unknown as WitnessValue,
    { arena, target: move.target, charge: move.charge, reason: move.reason, value: move.value },
    at,
  );
}

export function arenaOf(input: {
  readonly name: Capability;
  readonly game: string;
  readonly actors: readonly WalletActor[];
  readonly moves: readonly ArenaMove[];
  readonly locked?: boolean;
  readonly at?: string;
}): WalletArena {
  const at = input.at ?? new Date().toISOString();
  const witnesses = input.moves.map((move) => witnessMove(input.name, move, at));
  return Object.freeze({
    kind: "aagaard.wallet-arena" as const,
    name: input.name,
    game: input.game,
    actors: Object.freeze([...input.actors]),
    moves: Object.freeze([...input.moves]),
    converged: input.moves.some((move) => move.charge === "stable" || move.charge === "active"),
    locked: input.locked ?? isLocked(input.name),
    witnesses: Object.freeze(witnesses),
  });
}

function postKey(post: PostCandidate): string {
  return `${post.author}/${post.permlink}`;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Build the post<->tag attention graph shared by the radar and the spectral
 *  read: one node per post, one node per tag, an edge per (post,tag)
 *  incidence. */
function attentionGraph(posts: readonly PostCandidate[]): { nodes: Set<string>; edges: WeightedEdge[]; adjacency: Map<string, Set<string>> } {
  const nodes = new Set<string>();
  const edges: WeightedEdge[] = [];
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };
  for (const post of posts) {
    const pk = `p:${postKey(post)}`;
    nodes.add(pk);
    for (const tag of post.tags) {
      const tk = `t:${tag}`;
      nodes.add(tk);
      edges.push({ a: pk, b: tk, w: 1 });
      link(pk, tk);
    }
  }
  return { nodes, edges, adjacency };
}

// The exact max-alpha functionals over the post<->tag attention graph:
// mispricing energy E(r) = sum_{i~j} w_ij (r_i - r_j)^2 (zero iff every post
// sits at its neighbourhood mean: fully priced, no edge); capturable sinks
// are posts priced BELOW their tag-cohort (the negative harmonic deviation,
// deepest deficit first); components (read off the real graph Laplacian's
// zero-eigenvalue multiplicity, not a proxy) says how fragmented the field
// is — a fractured field corrects slowly, so the edge it hides is durable.
export function readAlphaRadar(posts: readonly PostCandidate[] = DEFAULT_POSTS): AlphaRadar {
  const tagAgg = new Map<string, { sum: number; n: number }>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const entry = tagAgg.get(tag) ?? { sum: 0, n: 0 };
      tagAgg.set(tag, { sum: entry.sum + Math.min(64, Math.max(0, post.pendingPayout)), n: entry.n + 1 });
    }
  }
  const tagScore = new Map<string, number>();
  for (const [tag, { sum, n }] of tagAgg) tagScore.set(tag, n > 0 ? sum / n : 0);

  let energy = 0;
  const sinks: AlphaRadar["sinks"][number][] = [];
  for (const post of posts) {
    const score = Math.min(64, Math.max(0, post.pendingPayout));
    let dev = 0;
    for (const tag of post.tags) {
      const diff = score - (tagScore.get(tag) ?? 0);
      energy += diff * diff;
      dev += diff;
    }
    if (dev < 0) {
      sinks.push(Object.freeze({
        key: postKey(post),
        author: post.author,
        permlink: post.permlink,
        deficit: Number((-dev).toFixed(3)),
        cohort: post.tags[0] ?? "untagged",
      }));
    }
  }
  sinks.sort((left, right) => right.deficit - left.deficit);

  const { nodes, edges } = attentionGraph(posts);
  const components = readSpectral(nodes, edges).components;
  return Object.freeze({
    kind: "aagaard.alpha-radar" as const,
    posts: posts.length,
    mispricingEnergy: Number(energy.toFixed(3)),
    components: Math.max(1, components),
    durable: components > 1,
    sinks: Object.freeze(sinks),
  });
}

export function readVotingIntelligence(posts: readonly PostCandidate[] = DEFAULT_POSTS, radar: AlphaRadar = readAlphaRadar(posts), at?: string): VotingIntelligence {
  const sinkDeficits = new Map(radar.sinks.map((sink) => [sink.key, sink.deficit] as const));
  const composite = readVotingIntelligenceOf(posts, sinkDeficits, at !== undefined ? Date.parse(at) : undefined);
  const { adjacency } = attentionGraph(posts);
  const curvature = formanCurvature(adjacency);
  return Object.freeze({
    kind: "aagaard.voting-intelligence" as const,
    spectral: Object.freeze({
      fiedler: composite.spectral.fiedler,
      lambdaMax: composite.spectral.lambdaMax,
      components: composite.spectral.components,
      decayHalfLife: composite.spectral.decayHalfLife,
      durable: composite.spectral.durable,
    }),
    curvature: Object.freeze({ bridges: curvature.bridges }),
    cartels: Object.freeze({
      b1: composite.cartels.cycle.b1,
      cycleDensity: composite.cartels.cycle.cycleDensity,
      tightPairs: Object.freeze(composite.cartels.tightPairs.map((pair) => Object.freeze({ a: pair.a, b: pair.b, overlap: pair.coVotes }))),
    }),
    bridges: composite.bridges,
    posts: composite.posts,
  });
}

function clamp01(x: number): number {
  return !Number.isFinite(x) ? 0 : x < 0 ? 0 : x > 1 ? 1 : x;
}

// Deficits are unbounded magnitudes; squash to (0,1) so underrecognition is a
// comparable multiplier rather than swamping the product.
function normDeficit(deficit: number): number {
  const d = Math.max(0, deficit);
  return d / (1 + d);
}

// The character's score for one already-valued candidate: the composite
// expectedAlpha re-weighted by this wallet's objective. Every term is a
// bounded multiplier, so the substrate stays authoritative and the wallet
// only tilts the ballot toward what it values — the same wallet-type
// re-weighting sigmund-vexler's predecessor used, ported onto the richer
// composite (content fitness, durability, cartel exposure) now computed
// in-app rather than approximated.
function strategyScore(post: VotingIntelligence["posts"][number], wallet: WalletActor, candidate: PostCandidate): number {
  const o = wallet.strategy.objective;
  const inEmphasis = candidate.tags.some((tag) => wallet.strategy.feeds.includes(tag) || wallet.strategy.feeds.includes(`community:${tag}`));
  const base = Math.max(post.expectedAlpha, 1e-9);
  const m =
    (1 + (o["underrecognition"] ?? 1) * normDeficit(post.deficit)) *
    (1 + (o["quality"] ?? 1) * clamp01(post.contentFitness)) *
    (1 + (o["conversation"] ?? 1) * clamp01(post.engagement)) *
    (1 + (o["durability"] ?? 1) * clamp01(post.durability)) *
    (post.bridge ? 1 + (o["bridge"] ?? 1) : 1) *
    (inEmphasis ? 1 + (o["communityFit"] ?? 1) : 1) *
    Math.max(0, 1 - (o["cartelAversion"] ?? 1) * clamp01(post.cartelExposure));
  return base * m;
}

export function planVotes(wallet: WalletActor, posts: readonly PostCandidate[] = DEFAULT_POSTS, at = new Date().toISOString(), state?: WalletChainState | null): VotingPlan {
  const radar = readAlphaRadar(posts);
  const intelligence = readVotingIntelligence(posts, radar, at);
  const byKey = new Map(posts.map((post) => [postKey(post), post] as const));
  const scored = intelligence.posts
    .map((post) => ({ post, candidate: byKey.get(post.key), score: byKey.get(post.key) ? strategyScore(post, wallet, byKey.get(post.key)!) : 0 }))
    .filter((entry): entry is { post: VotingIntelligence["posts"][number]; candidate: PostCandidate; score: number } => entry.candidate !== undefined)
    .sort((left, right) => right.score - left.score);
  const currentMana = state?.currentMana ?? (wallet.account === "sigmund-vexler" ? "9200" : "8400");
  const maxMana = state?.maxMana ?? "10000";
  const votingPowerBps = Math.max(0, Math.min(10000, Math.floor((Number(currentMana) / Math.max(1, Number(maxMana))) * 10000)));
  const bar = average(scored.map((entry) => entry.score)) * wallet.strategy.conviction;
  const votes: VotePlanItem[] = [];
  let waitReason = "";
  if (votingPowerBps < wallet.strategy.votingPowerFloorBps) {
    waitReason = `power ${votingPowerBps} below floor ${wallet.strategy.votingPowerFloorBps}`;
  } else if (scored.length === 0) {
    waitReason = "no candidate field";
  } else {
    for (const entry of scored) {
      if (votes.length >= wallet.strategy.maxVotesPerTick) break;
      if (entry.score < bar || entry.post.likelyCartelTrail) continue;
      votes.push(Object.freeze({
        author: entry.candidate.author,
        permlink: entry.candidate.permlink,
        weightBps: Math.min(wallet.risk.maxVoteWeightBps, Math.max(100, entry.post.kirchhoffWeightBps)),
        strategyAlpha: Number(entry.score.toFixed(3)),
        sinkDeficit: entry.post.deficit,
        reason: `${wallet.strategy.archetype} conviction ${entry.score.toFixed(2)} >= ${bar.toFixed(2)}`,
      }));
    }
    if (votes.length === 0) waitReason = `best ${scored[0]?.score.toFixed(2) ?? "0"} below conviction bar ${bar.toFixed(2)}`;
  }
  const moves = votes.length > 0
    ? votes.map((vote) => Object.freeze({
        actor: wallet.account,
        action: termForCapability("voting", "cast"),
        target: `${vote.author}/${vote.permlink}`,
        value: { weightBps: vote.weightBps, strategyAlpha: vote.strategyAlpha },
        charge: "active" as const,
        reason: vote.reason,
      }))
    : [Object.freeze({
        actor: wallet.account,
        action: termForCapability("voting", "wait"),
        target: "mana",
        value: { votingPowerBps },
        charge: "potential" as const,
        reason: waitReason,
      })];
  return Object.freeze({
    account: wallet.account,
    currentMana,
    maxMana,
    radar,
    intelligence,
    votes: Object.freeze(votes),
    decision: votes.length > 0 ? `${wallet.strategy.archetype} casts ${votes.length} vote(s)` : `${wallet.strategy.archetype} waits: ${waitReason}`,
    arena: arenaOf({ name: "voting", game: "curation reward allocation", actors: [wallet], moves, at }),
  });
}

export function readLiquidity(wallet: WalletActor, state?: WalletChainState | null, market?: WalletMarketState | null, internalMarket?: InternalMarketReading | null, flow: Readonly<Record<string, FlowReading>> = {}): LiquidityReading {
  const tokenState = state?.tokens ?? wallet.tokens;
  // Real internal HIVE/HBD market when available (condenser_api.get_ticker
  // + get_order_book); a hardcoded placeholder otherwise, retained only so a
  // caller with no network access still gets a shaped reading rather than a
  // missing venue -- this placeholder is NOT a real price and previously
  // masqueraded as one, producing double-digit-percent "corridors" against
  // real Hive-Engine quotes that were really just this mock being wrong.
  const real = internalMarket && internalMarket.midpoint > 0 ? internalMarket : null;
  const internalVenue = Object.freeze(real
    ? { venue: "internal", pair: "HIVE/HBD", midpoint: real.midpoint, bidDepth: real.bidDepth, askDepth: real.askDepth, relativeSpreadBps: real.relativeSpreadBps, imbalance: real.bidDepth + real.askDepth > 0 ? (real.bidDepth - real.askDepth) / (real.bidDepth + real.askDepth) : 0, thin: real.bidDepth + real.askDepth < 1000 }
    // No real reading available (offline/test): a shaped, clearly-mock
    // stand-in, exactly as fallbackEngineVenue below stands in for
    // Hive-Engine when that read is unavailable too -- never used when a
    // real reading exists.
    : { venue: "internal", pair: "HIVE/HBD", midpoint: wallet.tradingLive ? 0.31 : 0.3, bidDepth: 1200, askDepth: 980, relativeSpreadBps: 42, imbalance: 0.101, thin: false });
  // A stand-in ONLY for when no real Hive-Engine venue data was fetched at
  // all (offline/test): a shaped, clearly-mock DEC/SWAP.HIVE-scale quote so
  // the pool-corridor loop below still has something to compare against.
  // There is deliberately no "SWAP.HIVE/HBD" fallback here: no such market
  // exists on Hive-Engine (SWAP.HIVE is the numeraire other tokens are
  // priced in, not something quoted against HBD there), so a prior version
  // of this function fell back to a hardcoded 0.322 "engine HIVE" price and
  // compared it against the real internal price -- manufacturing an
  // apparent ~500%+ divergence out of two prices, only one of which was
  // ever real.
  const fallbackVenue = Object.freeze({ venue: "hive-engine", pair: "DEC/SWAP.HIVE", midpoint: 0.00086, bidDepth: 410, askDepth: 360, relativeSpreadBps: 88, imbalance: 0.065, thin: false });
  const venues = Object.freeze([
    internalVenue,
    ...(market?.venues.length ? market.venues : [fallbackVenue]),
  ]);
  const pools = Object.freeze(market?.pools.length ? [...market.pools] : [
    { pair: "DEC:SWAP.HIVE", impliedPrice: 0.0008, tvlQuote: tokenState["DEC"] ? 6400 : 1200, feeBps: 25 },
    { pair: "SIM:SWAP.HIVE", impliedPrice: 0.0002, tvlQuote: tokenState["SIM"] ? 2100 : 700, feeBps: 25 },
  ]);
  const corridorRows: LiquidityReading["corridors"][number][] = [];
  // A one-sided venue (bidDepth or askDepth exactly 0) has no real depth on
  // the side any corridor trade would need to fill -- comparing its
  // "midpoint" against another quote reads a gap that isn't there to trade.
  const twoSided = (v: { readonly bidDepth: number; readonly askDepth: number }): boolean => v.bidDepth > 0 && v.askDepth > 0;
  for (const pool of pools) {
    // A pool's impliedPrice is quote-per-base, in whatever two tokens its
    // OWN pair names (hiveEngine.adapter.ts: impliedPrice = quoteQuantity /
    // baseQuantity) -- it is only comparable to a "<symbol>/SWAP.HIVE"
    // venue quote when SWAP.HIVE is actually one side of THIS pool. A pool
    // like "DEC:VOID" has no SWAP.HIVE side at all; comparing its
    // DEC-priced-in-VOID rate against a DEC/SWAP.HIVE venue's
    // DEC-priced-in-SWAP.HIVE rate is not a liquidity gap, it is two
    // different currencies read as if they were the same one -- which is
    // exactly what produced a spurious ~19,000,000% "corridor" here before
    // this check existed.
    const [base, quote] = pool.pair.split(":");
    if (!base || !quote) continue;
    let symbol: string;
    let poolPriceInHive: number;
    if (quote === "SWAP.HIVE") {
      symbol = base;
      poolPriceInHive = pool.impliedPrice;
    } else if (base === "SWAP.HIVE") {
      symbol = quote;
      poolPriceInHive = pool.impliedPrice > 0 ? 1 / pool.impliedPrice : 0;
    } else {
      continue;
    }
    const venue = venues.find((entry) => entry.pair === `${symbol}/SWAP.HIVE`);
    if (!venue || venue.midpoint <= 0 || poolPriceInHive <= 0) continue;
    if (!twoSided(venue) || pool.tvlQuote < MIN_POOL_TVL_QUOTE) continue;
    const cheap = poolPriceInHive < venue.midpoint ? { venue: `pool:${pool.pair}`, price: poolPriceInHive, feeBps: pool.feeBps } : { venue: venue.venue, price: venue.midpoint, feeBps: 0 };
    const rich = poolPriceInHive < venue.midpoint ? { venue: venue.venue, price: venue.midpoint, feeBps: 0 } : { venue: `pool:${pool.pair}`, price: poolPriceInHive, feeBps: pool.feeBps };
    const divergenceBps = Math.round(((rich.price - cheap.price) / cheap.price) * 10000);
    if (divergenceBps > 0) corridorRows.push(Object.freeze({ symbol, cheapVenue: cheap.venue, richVenue: rich.venue, divergenceBps, netCorridorBps: divergenceBps - cheap.feeBps - rich.feeBps }));
  }
  const corridors = Object.freeze(corridorRows.sort((left, right) => right.netCorridorBps - left.netCorridorBps));
  return Object.freeze({
    kind: "aagaard.liquidity" as const,
    venues,
    pools,
    corridors,
    totalDepthProxy: venues.reduce((sum, venue) => sum + venue.bidDepth + venue.askDepth, 0) + pools.reduce((sum, pool) => sum + pool.tvlQuote, 0),
    rigidity: readRigidity(edgesFromPools(pools)),
    flow: Object.freeze(Object.values(flow)),
    screening: (() => {
      const screeningEdges = edgesForScreening(pools);
      const tokens = [...new Set(screeningEdges.flatMap((edge) => [edge.a, edge.b]))];
      return Object.freeze(tokens.map((token) => readScreening(token, screeningEdges)));
    })(),
  });
}

// Orient a detected cycle onto its profitable direction: a negative holonomy
// means the reverse traversal is the one that profits. Forward and reverse
// edges share the same venue label (see edgesFromLiquidity), so the venues
// list reverses in lockstep with the path.
function profitableDirection(cycle: ArbitrageCycle): ArbitrageCycle {
  if (cycle.holonomyBps >= 0) return cycle;
  // Traversing a cycle in reverse negates its log-holonomy sum.
  return Object.freeze({
    ...cycle,
    path: Object.freeze([...cycle.path].reverse()),
    venues: Object.freeze([...cycle.venues].reverse()),
    holonomyBps: -cycle.holonomyBps,
  });
}

// Decompose one arbitrage cycle into its per-hop trade intents, in its
// profitable direction. Each hop converts one asset into the next; "side" is
// a broadcast-boundary label (see hiveWrite.adapter.ts's generic intent
// operation), not a claim that every hop is a literal HIVE/HBD buy or sell.
type RawTrade = { readonly pair: string; readonly side: "buy" | "sell"; readonly amount: number; readonly edgeBps: number; readonly reason: string };

function tradesFromCycle(cycle: ArbitrageCycle, wallet: WalletActor): readonly RawTrade[] {
  const oriented = profitableDirection(cycle);
  const amount = Math.min(wallet.risk.capHbdMilli / 1000, 5);
  const edgeBps = Math.abs(oriented.netHolonomyBps);
  const trades: RawTrade[] = [];
  for (let i = 0; i < oriented.path.length - 1; i++) {
    trades.push(Object.freeze({
      pair: `${oriented.path[i]}/${oriented.path[i + 1]}`,
      side: "sell" as const,
      amount,
      edgeBps,
      reason: `holonomy leg ${i + 1}/${oriented.path.length - 1} of ${oriented.path.join("->")} via ${oriented.venues[i] ?? "?"}`,
    }));
  }
  return Object.freeze(trades);
}

// Convert a trade's HBD-equivalent budget allocation into the real token
// quantity hiveEngineOps.marketBuy/marketSell expects, using this tick's
// own live price data -- replacing the fixed MICRO_QUANTITY placeholder
// that previously ignored trade.amount entirely. Returns null (never a
// guessed quantity) when the trade's pair doesn't price against SWAP.HIVE
// or the needed price is unavailable; hiveWrite.adapter.ts's tradeOperation
// refuses to broadcast a null quantity rather than substituting one.
// `pair` follows the "give-up/acquire" convention tradesFromCycle already
// documents ("each hop converts one asset into the next"): `from` is what
// the trade gives up, `to` is what it acquires. hiveWrite.adapter.ts's
// tradeOperation routes on this same convention (to===SWAP.HIVE -> sell
// `from`; from===SWAP.HIVE -> buy `to`), so a caller building a "buy the
// cheap token" trade must give it as pair "SWAP.HIVE/{symbol}", never
// "{symbol}/SWAP.HIVE" -- the latter was a real, since-fixed bug: it
// broadcast a genuine marketSell of the token help-fund's own strategy
// meant to acquire, and failed with "overdrawn balance" against its real
// (near-zero) held balance of that token rather than silently doing the
// wrong thing.
function sizeTradeQuantity(trade: { readonly pair: string; readonly amount: number }, liquidity: LiquidityReading, precision: Readonly<Record<string, number>>): string | null {
  const [from, to] = trade.pair.split("/");
  if (to === "SWAP.HIVE" && from) {
    // Selling `from` for SWAP.HIVE: quantity is units of `from`, rounded
    // to `from`'s own on-chain precision.
    const price = tokenValueHbd(from, liquidity);
    const decimals = precision[from];
    if (!(price > 0) || decimals === undefined) return null;
    return (trade.amount / price).toFixed(decimals);
  }
  if (from === "SWAP.HIVE" && to) {
    // Buying `to` by spending SWAP.HIVE: marketBuy's quantity parameter is
    // SWAP.HIVE spent, rounded to SWAP.HIVE's own precision, not `to`'s.
    const hivePrice = tokenValueHbd("HIVE", liquidity);
    const decimals = precision["SWAP.HIVE"];
    if (!(hivePrice > 0) || decimals === undefined) return null;
    return (trade.amount / hivePrice).toFixed(decimals);
  }
  return null;
}

// The smallest liquidity depth along a cycle's own hops is the real
// binding constraint on how much of its divergence is capturable at all
// -- the venue/pool that would exhaust first. tvlQuote and bidDepth+
// askDepth are treated as a roughly-comparable quote-scale figure here,
// the same convention holonomy.mts's own MIN_POOL_TVL_QUOTE filter
// already relies on (a flat threshold applied uniformly regardless of
// which token is actually on the quote side) -- an approximation, not a
// fully token-converted figure, disclosed as such rather than presented
// as exact.
function cycleDepthHbd(cycle: ArbitrageCycle, liquidity: LiquidityReading): number {
  const hivePrice = liquidity.venues[0]?.midpoint ?? 0;
  if (!(hivePrice > 0)) return 0;
  const depths = cycle.venues.map((label) => {
    if (label.startsWith("pool:")) {
      const pair = label.slice("pool:".length);
      return liquidity.pools.find((pool) => pool.pair === pair)?.tvlQuote ?? 0;
    }
    const venue = liquidity.venues.find((entry) => entry.venue === label);
    return venue ? venue.bidDepth + venue.askDepth : 0;
  }).filter((depth) => depth > 0);
  if (depths.length === 0) return 0;
  return Math.min(...depths) * hivePrice;
}

export function planTrades(wallet: WalletActor, at = new Date().toISOString(), state?: WalletChainState | null, market?: WalletMarketState | null, internalMarket?: InternalMarketReading | null, flow: Readonly<Record<string, FlowReading>> = {}): TradingPlan {
  const liquidity = readLiquidity(wallet, state, market, internalMarket, flow);
  // A sanity ceiling, not just a floor: this fleet has twice now found a
  // "real" divergence in the tens-of-thousands-of-percent range that
  // turned out to be a data-quality artifact (a one-sided venue, then a
  // pool compared in the wrong currency), not real market volatility.
  // Anything claiming more than 50% in a single tick is far more likely to
  // be a third such artifact than genuinely capturable edge, so it is
  // dropped rather than sized and traded.
  const MAX_SANE_EDGE_BPS = 5000;
  const corridorTrades = liquidity.corridors
    .filter((corridor) => corridor.netCorridorBps > 100 && corridor.netCorridorBps <= MAX_SANE_EDGE_BPS)
    .map((corridor) => Object.freeze({
      // A corridor is a single-symbol divergence between two venues (e.g. a
      // pool price vs. an order-book price for the SAME token) -- it was
      // previously mislabeled as a hardcoded "HIVE/HBD" pair regardless of
      // which token the divergence was actually about. "buy" at the cheap
      // venue is the directional leg this single trade actually represents;
      // the other leg (selling at the rich venue, or the pool-side of a
      // pool-vs-orderbook gap) is not executed by this single action.
      //
      // pair is "give-up/acquire" (see sizeTradeQuantity/tradeOperation):
      // buying the cheap symbol means giving up SWAP.HIVE to acquire it,
      // i.e. "SWAP.HIVE/{symbol}", not "{symbol}/SWAP.HIVE" -- the reverse
      // literally sold the token this trade meant to buy, verified as a
      // real, since-fixed broadcast failure (help-fund's WOO trade).
      pair: `SWAP.HIVE/${corridor.symbol}`,
      side: "buy" as const,
      amount: Math.min(wallet.risk.capHbdMilli / 1000, 5),
      edgeBps: corridor.netCorridorBps,
      reason: `${corridor.cheapVenue}->${corridor.richVenue} executable corridor`,
    }));
  // The corridor check only ever sees a 2-venue divergence on the SAME pair.
  // The holonomy read generalises to every N-hop cycle the graph carries —
  // e.g. HIVE -> DEC -> SWAP.HIVE -> HIVE — which the pairwise check cannot
  // see at all. Only 3-node-or-larger cycles are added here; length-2
  // cycles duplicate what the corridor check already proposes.
  const arbitrageCycles = readHolonomy(liquidity, { minNetHolonomyBps: 50, limit: 5 });
  const tickBudgetHbd = wallet.risk.capHbdMilli / 1000;
  const cycleCapacities = Object.freeze(arbitrageCycles.map((cycle) => catabolicCapacity(cycle.netHolonomyBps, cycleDepthHbd(cycle, liquidity), tickBudgetHbd)));
  const cycleTrades = arbitrageCycles
    .filter((cycle) => cycle.path.length > 3 && Math.abs(cycle.netHolonomyBps) <= MAX_SANE_EDGE_BPS)
    .flatMap((cycle) => tradesFromCycle(cycle, wallet));
  const rawTrades = Object.freeze([...corridorTrades, ...cycleTrades]);
  // Rank every candidate trade this tick by real expected-value density
  // and fund the best under one real, aggregate per-tick capital budget --
  // replacing the old rule (every candidate above the edge floor gets
  // attempted, each separately capped) with a proper allocation across the
  // whole tick. See analysis/allocation.mts and the Obsmetrologia
  // financial-methods catalog, section 1.
  const candidates: AllocationCandidate[] = rawTrades.map((trade, index) => Object.freeze({
    id: String(index),
    cost: trade.amount,
    benefit: trade.amount * (trade.edgeBps / 10000),
  }));
  const allocation = allocateBudget(candidates, tickBudgetHbd);
  const fundedIds = new Set(allocation.funded);
  const trades = Object.freeze(rawTrades.map((trade, index) => {
    const funded = fundedIds.has(String(index));
    return Object.freeze({ ...trade, funded, quantity: funded ? sizeTradeQuantity(trade, liquidity, market?.precision ?? {}) : null });
  }));
  const lp = liquidity.pools.filter((pool) => pool.tvlQuote > 2000).map((pool) => Object.freeze({ pool: pool.pair, action: "compound" as const, value: pool.tvlQuote * 0.001 }));
  const savings = wallet.account === "help-fund" ? { amountHbd: 2 } : null;
  const moves = [
    ...trades.map((trade) => Object.freeze({ actor: wallet.account, action: termForCapability("trading", trade.side), target: trade.pair, value: trade, charge: "active" as const, reason: trade.reason })),
    ...lp.map((entry) => Object.freeze({ actor: wallet.account, action: termForCapability("trading", "lp"), target: entry.pool, value: entry, charge: "potential" as const, reason: "liquidity position maintenance" })),
  ];
  return Object.freeze({
    account: wallet.account,
    hive: state?.hive ?? (wallet.account === "sigmund-vexler" ? "12.000 HIVE" : "1.000 HIVE"),
    hbd: state?.hbd ?? (wallet.account === "help-fund" ? "8.000 HBD" : "1.000 HBD"),
    liveEligible: wallet.tradingLive,
    liquidity,
    trades,
    lp: Object.freeze(lp),
    savings,
    arbitrageCycles,
    cycleCapacities,
    allocation,
    arena: arenaOf({ name: "trading", game: "cross-venue capital allocation", actors: [wallet], moves, at }),
  });
}

const REWARD_RE = /\b(?:win|get|earn|receive|reward|paid)\b[^.\n]{0,80}?(\d+(?:[.,]\d+)?)?\s*([A-Z][A-Z0-9._-]{1,14})\b/i;
const ACTIONS: readonly { readonly kind: IncentiveActionKind; readonly re: RegExp }[] = Object.freeze([
  { kind: "comment", re: /\b(comment|reply|tell us|share your)\b/i },
  { kind: "reblog", re: /\b(reblog|resteem|re-?blog)\b/i },
  { kind: "vote", re: /\b(upvote|up-?vote|vote for)\b/i },
  { kind: "follow", re: /\bfollow\b/i },
  { kind: "delegate", re: /\bdelegate|delegation\b/i },
  { kind: "post", re: /\b(make a post|write a post|submit a post)\b/i },
]);

export function ingestOffers(posts: readonly PostCandidate[] = DEFAULT_POSTS): readonly IncentiveOffer[] {
  const offers: IncentiveOffer[] = [];
  for (const post of posts) {
    const text = `${post.title}. ${post.body}`;
    const actions = ACTIONS.filter((entry) => entry.re.test(text)).map((entry) => entry.kind);
    const rewardMatch = REWARD_RE.exec(text);
    if (actions.length === 0 || rewardMatch === null) continue;
    const amount = rewardMatch[1] === undefined ? undefined : Number(rewardMatch[1].replace(",", "."));
    const reward = Number.isFinite(amount)
      ? Object.freeze({ token: rewardMatch[2]!.toUpperCase(), amount: amount as number })
      : Object.freeze({ token: rewardMatch[2]!.toUpperCase() });
    offers.push(Object.freeze({
      id: `hive.offer.${post.author}/${post.permlink}`,
      source: Object.freeze({ author: post.author, permlink: post.permlink, ...(post.tags.find((tag) => tag.startsWith("hive-")) ? { community: post.tags.find((tag) => tag.startsWith("hive-"))! } : {}) }),
      requiredActions: Object.freeze(actions),
      reward,
      rawText: text.slice(0, 280),
    }));
  }
  return Object.freeze(offers);
}

function tokenValueHbd(symbol: string, liquidity: LiquidityReading): number {
  if (symbol === "HBD") return 1;
  if (symbol === "HIVE" || symbol === "SWAP.HIVE") return liquidity.venues[0]?.midpoint ?? 0;
  const hivePrice = liquidity.venues[0]?.midpoint ?? 0;
  if (!(hivePrice > 0)) return 0;
  // A pool's tokenPair can list either token first (verified: real
  // marketpools data has been seen both as "SYMBOL:SWAP.HIVE" and
  // "SWAP.HIVE:SYMBOL") -- checking only the "SYMBOL:" prefix silently
  // missed the second orientation, which previously let a real, funded
  // trade (michael561's SIM/SWAP.HIVE corridor) reach execution with no
  // priceable quantity and get refused rather than sized.
  const asBase = liquidity.pools.find((entry) => entry.pair.startsWith(`${symbol}:`));
  if (asBase) return asBase.impliedPrice * hivePrice;
  const asQuote = liquidity.pools.find((entry) => entry.pair.endsWith(`:${symbol}`));
  if (asQuote && asQuote.impliedPrice > 0) return (1 / asQuote.impliedPrice) * hivePrice;
  return 0;
}

export function planIncentives(wallet: WalletActor, posts: readonly PostCandidate[] = DEFAULT_POSTS, liquidity: LiquidityReading = readLiquidity(wallet), at = new Date().toISOString()): IncentivePlan {
  const offers = ingestOffers(posts).map((offer) => {
    const value = offer.reward ? (offer.reward.amount ?? 1) * tokenValueHbd(offer.reward.token, liquidity) : 0;
    const scamReasons = [
      offer.rawText.match(/\b(private key|owner key|seed phrase|master password)\b/i) ? "requests-secret" : "",
      offer.requiredActions.includes("delegate") && value < 1 ? "low-value-delegation" : "",
      offer.requiredActions.includes("post") ? "posting-lane-locked" : "",
    ].filter((entry) => entry !== "");
    const postingNeeded = offer.requiredActions.some((action) => action === "comment" || action === "post");
    return Object.freeze({
      offer,
      ev: Number(value.toFixed(6)),
      scamReasons: Object.freeze(scamReasons),
      disposition: scamReasons.length === 0 && !postingNeeded && value > 0 ? "auto" as const : "nominate" as const,
    });
  }).sort((left, right) => right.ev - left.ev);
  const moves = offers.map((entry) => Object.freeze({
    actor: wallet.account,
    action: termForCapability("incentive", entry.disposition),
    target: entry.offer.id,
    value: { ev: entry.ev, actions: entry.offer.requiredActions },
    charge: entry.disposition === "auto" ? "active" as const : "potential" as const,
    reason: entry.scamReasons.length > 0 ? entry.scamReasons.join(",") : "offer admitted",
  }));
  return Object.freeze({
    account: wallet.account,
    offers: Object.freeze(offers),
    arena: arenaOf({ name: "incentive", game: "bounty arbitration", actors: [wallet], moves, at }),
  });
}

// michael561's own documented allocation plan (Hive Income Staking Plan):
// "Other tokens, like VYB, POB, CTP, MUSIC, and WAIV, follow similar
// patterns... My approach will remain consistent: stake them and delegate
// when possible" -- plus LEO and CENT explicitly, and the game/utility
// tokens POSH, PXL, GAMER ("compound my ... distributions"). ALIVE is
// singled out for delegation specifically: "stake my ALIVE tokens and
// delegate them to the aliveandthriving account."
const MICHAEL561_STAKE_TOKENS = Object.freeze(["LEO", "ALIVE", "CENT", "VYB", "POB", "CTP", "MUSIC", "WAIV", "POSH", "PXL", "GAMER"]);
const MICHAEL561_DELEGATE: Readonly<Record<string, string>> = Object.freeze({ ALIVE: "aliveandthriving" });

// Documented, per-account plans this office can actually derive from a
// held balance alone (no swap/conversion pipeline required). Every other
// wallet gets an empty plan -- this is deliberately account-specific, not
// a generic "stake everything" default, because the rule is michael561's
// own stated plan, not a universal policy.
function stakingRules(account: string): readonly string[] {
  if (account === "michael561") return MICHAEL561_STAKE_TOKENS;
  return Object.freeze([]);
}

export function planStaking(wallet: WalletActor, state?: WalletChainState | null, at = new Date().toISOString()): StakingPlan {
  const tokens = state?.tokens ?? wallet.tokens;
  const rules = stakingRules(wallet.account);
  const actions: StakingAction[] = [];
  for (const symbol of rules) {
    const balance = Number(tokens[symbol] ?? "0");
    if (!Number.isFinite(balance) || balance <= 0) continue;
    const quantity = balance.toFixed(8);
    actions.push(Object.freeze({
      kind: "stake" as const,
      symbol,
      quantity,
      to: wallet.account,
      reason: `Hive Income Staking Plan: stake held ${symbol}`,
    }));
    const delegateTo = MICHAEL561_DELEGATE[symbol];
    if (delegateTo) {
      actions.push(Object.freeze({
        kind: "delegate" as const,
        symbol,
        quantity,
        to: delegateTo,
        reason: `Hive Income Staking Plan: delegate staked ${symbol} to ${delegateTo}`,
      }));
    }
  }
  const moves = actions.map((action) => Object.freeze({
    actor: wallet.account,
    action: termForCapability("trading", action.kind),
    target: `${action.symbol}->${action.to}`,
    value: { kind: action.kind, symbol: action.symbol, quantity: action.quantity, to: action.to },
    charge: "active" as const,
    reason: action.reason,
  }));
  return Object.freeze({
    account: wallet.account,
    actions: Object.freeze(actions),
    arena: arenaOf({ name: "trading", game: "staking allocation", actors: [wallet], moves, at }),
  });
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function draftId(account: string, topic: LockedDraft["topic"], at: string, sourceOfferId = ""): string {
  const suffix = sourceOfferId === "" ? utcDay(at) : sourceOfferId.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${account}:${topic}:${suffix}`;
}

export function composeDraft(wallet: WalletActor, summary: string, at = new Date().toISOString()): LockedDraft {
  return Object.freeze({
    id: draftId(wallet.account, "operations", at),
    account: wallet.account,
    kind: "post" as const,
    topic: "operations" as const,
    title: `${wallet.account} operations note`,
    body: summary,
    tags: Object.freeze(["hive", "automation", "aagaard"]),
    composedAt: at,
    approvedForBroadcast: false as const,
  });
}

export function composeLiquidityDraft(wallet: WalletActor, liquidity: LiquidityReading, at = new Date().toISOString()): LockedDraft {
  const day = utcDay(at);
  const venueLines = liquidity.venues
    .slice(0, 12)
    .map((venue) => `- ${venue.pair} at ${venue.venue}: mid ${venue.midpoint}, spread ${venue.relativeSpreadBps}bps, depth ${venue.bidDepth.toFixed(2)}/${venue.askDepth.toFixed(2)}, imbalance ${(venue.imbalance * 100).toFixed(1)}%${venue.thin ? " (thin)" : ""}`)
    .join("\n");
  const poolLines = liquidity.pools
    .slice(0, 12)
    .map((pool) => `- ${pool.pair}: implied ${pool.impliedPrice.toFixed(8)}, TVL proxy ${pool.tvlQuote.toFixed(2)}, fee ${pool.feeBps}bps`)
    .join("\n");
  const corridorLines = liquidity.corridors
    .slice(0, 8)
    .map((corridor) => `- ${corridor.symbol}: ${corridor.cheapVenue} -> ${corridor.richVenue}, divergence ${corridor.divergenceBps}bps, net ${corridor.netCorridorBps}bps`)
    .join("\n");
  return Object.freeze({
    id: draftId(wallet.account, "he-liquidity", at),
    account: wallet.account,
    kind: "post" as const,
    topic: "he-liquidity" as const,
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
      "Prepared automatically for human review. Posting remains locked.",
    ].join("\n"),
    tags: Object.freeze(["hive-engine", "liquidity", "defi", "analysis", "hive"]),
    composedAt: at,
    approvedForBroadcast: false as const,
  });
}

export function composeSpectralDraft(wallet: WalletActor, voting: VotingPlan, at = new Date().toISOString()): LockedDraft {
  const day = utcDay(at);
  const radar = voting.radar;
  const intelligence = voting.intelligence;
  const sinks = radar.sinks.slice(0, 8).map((sink) => `- ${sink.key}: deficit ${sink.deficit} in ${sink.cohort}`).join("\n");
  const cartels = intelligence.cartels.tightPairs.slice(0, 8).map((pair) => `- ${pair.a} / ${pair.b}: overlap ${pair.overlap}`).join("\n");
  const bridges = intelligence.bridges.slice(0, 8).map((bridge) => `- ${bridge}`).join("\n");
  return Object.freeze({
    id: draftId(wallet.account, "hive-spectral", at),
    account: wallet.account,
    kind: "post" as const,
    topic: "hive-spectral" as const,
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
      "Prepared automatically for human review. Posting remains locked.",
    ].join("\n"),
    tags: Object.freeze(["hive", "mathematics", "spectral", "analysis", "curation"]),
    composedAt: at,
    approvedForBroadcast: false as const,
  });
}

export function composeIncentiveDraft(account: string, offer: IncentiveOffer, at = new Date().toISOString()): LockedDraft {
  const responseKind = offer.requiredActions.includes("post") ? "post" : "reply";
  return Object.freeze({
    id: draftId(account, "incentive-response", at, offer.id),
    account,
    kind: responseKind,
    topic: "incentive-response" as const,
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
      "Replace this placeholder with a genuine on-topic response before any human-approved broadcast.",
    ].join("\n"),
    tags: Object.freeze(["hive", "aagaard", "draft"]),
    composedAt: at,
    approvedForBroadcast: false as const,
    sourceOfferId: offer.id,
  });
}

export function composeDailyDrafts(input: {
  readonly wallet: WalletActor;
  readonly voting: VotingPlan | null;
  readonly trading: TradingPlan;
  readonly incentive: IncentivePlan | null;
  readonly at: string;
}): readonly LockedDraft[] {
  const drafts: LockedDraft[] = [composeDraft(input.wallet, `Autonomous operations summary for ${input.wallet.account}. Prepared as a locked draft.`, input.at)];
  if (input.wallet.account === "help-fund") drafts.push(composeLiquidityDraft(input.wallet, input.trading.liquidity, input.at));
  if (input.wallet.account === "sigmund-vexler" && input.voting) drafts.push(composeSpectralDraft(input.wallet, input.voting, input.at));
  return Object.freeze(drafts);
}

export function planGaming(wallet: WalletActor, at = new Date().toISOString(), state?: WalletChainState | null): GamingPlan {
  const tokenState = state?.tokens ?? wallet.tokens;
  const signatures = [
    { game: "Splinterlands", tokens: ["DEC", "SPS", "SPSP", "VOUCHER"], customJsonId: "sm_", proposedMove: "claim daily quest / start ranked" },
    { game: "Rising Star", tokens: ["STARBITS", "STAR"], customJsonId: "rising-star", proposedMove: "start best available mission" },
    { game: "dCity", tokens: ["SIM"], customJsonId: "dcity", proposedMove: "collect daily SIM income" },
    { game: "Hashkings", tokens: ["BUDS", "SEEDS"], customJsonId: "hashkings", proposedMove: "water plots / harvest" },
  ] as const;
  const games = signatures.flatMap((sig) => {
    const held = sig.tokens.filter((token) => Number(tokenState[token] ?? "0") > 0).map((token) => Object.freeze({ symbol: token, balance: tokenState[token] ?? "0" }));
    return held.length === 0 ? [] : [Object.freeze({
      game: sig.game,
      heldTokens: Object.freeze(held),
      customJsonId: sig.customJsonId,
      proposedMove: sig.proposedMove,
      approvedForBroadcast: false as const,
    })];
  });
  const moves = games.map((game) => Object.freeze({
    actor: wallet.account,
    action: termForCapability("gaming", "plan"),
    target: game.game,
    value: { customJsonId: game.customJsonId, heldTokens: game.heldTokens },
    charge: "potential" as const,
    reason: game.proposedMove,
  }));
  return Object.freeze({
    account: wallet.account,
    games: Object.freeze(games),
    arena: arenaOf({ name: "gaming", game: "on-chain game routine", actors: [wallet], moves, locked: true, at }),
  });
}

export function ensureStore(root: string): StateStore {
  const store = {
    root,
    logDir: path.join(root, "data", "logs"),
    stateDir: path.join(root, "data", "state"),
    recordDir: path.join(root, "data", "records"),
    contentDir: path.join(root, "content"),
    scoreboardDir: path.join(root, "data", "scoreboard"),
  };
  mkdirSync(store.logDir, { recursive: true });
  mkdirSync(store.stateDir, { recursive: true });
  mkdirSync(store.recordDir, { recursive: true });
  mkdirSync(store.contentDir, { recursive: true });
  mkdirSync(store.scoreboardDir, { recursive: true });
  return Object.freeze(store);
}

function appendJsonl(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(value)}\n`);
}

function appendJsonlRows(file: string, values: readonly unknown[]): void {
  for (const value of values) appendJsonl(file, value);
}

function readJsonl<T>(file: string): readonly T[] {
  if (!existsSync(file)) return Object.freeze([]);
  const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "");
  return Object.freeze(lines.map((line) => JSON.parse(line) as T));
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function recordFleetTick(store: StateStore, readout: FleetTickReadout): void {
  appendJsonl(path.join(store.logDir, "aagaard-fleet-tick.jsonl"), readout);
  writeJson(path.join(store.stateDir, "last-fleet-tick.json"), readout);
  for (const account of readout.accounts) {
    appendJsonlRows(path.join(store.logDir, `${account.account}-arena-witnesses.jsonl`), account.arenas.flatMap((arena) => arena.witnesses));
  }
}

export function readLastReadout(store: StateStore): FleetTickReadout | null {
  const file = path.join(store.stateDir, "last-fleet-tick.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as FleetTickReadout : null;
}

export function readFleetTicks(store: StateStore, limit: number): readonly FleetTickReadout[] {
  return readJsonl<FleetTickReadout>(path.join(store.logDir, "aagaard-fleet-tick.jsonl")).slice(-limit);
}

function lockedDraftsPath(store: StateStore): string {
  return path.join(store.recordDir, "locked-drafts.json");
}

function nominationsPath(store: StateStore): string {
  return path.join(store.stateDir, "incentive-nominations.json");
}

export function readLockedDrafts(store: StateStore, account?: string): readonly LockedDraft[] {
  const file = lockedDraftsPath(store);
  if (!existsSync(file)) return Object.freeze([]);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const rows = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  const drafts = rows.filter((row): row is Record<string, unknown> & LockedDraft => typeof row["id"] === "string" && typeof row["account"] === "string");
  return Object.freeze(drafts.filter((draft) => account === undefined || draft.account === account));
}

export function recordLockedDrafts(store: StateStore, drafts: readonly LockedDraft[]): readonly LockedDraft[] {
  if (drafts.length === 0) return Object.freeze([]);
  const prior = new Map(readLockedDrafts(store).map((draft) => [draft.id, draft] as const));
  const recorded: LockedDraft[] = [];
  for (const draft of drafts) {
    if (prior.has(draft.id)) continue;
    prior.set(draft.id, draft);
    recorded.push(draft);
  }
  if (recorded.length > 0) {
    const values = [...prior.values()].sort((left, right) => left.composedAt.localeCompare(right.composedAt));
    writeJson(lockedDraftsPath(store), values);
    appendJsonlRows(path.join(store.logDir, "aagaard-locked-drafts.jsonl"), recorded.map((draft) => ({ event: "drafted", ...draft })));
  }
  return Object.freeze(recorded);
}

export function recordSubstrateSnapshot(store: StateStore, snapshot: TickSubstrateSnapshot): void {
  appendJsonl(path.join(store.logDir, "aagaard-substrate.jsonl"), snapshot);
  appendJsonl(path.join(store.logDir, `${snapshot.account}-substrate.jsonl`), snapshot);
}

export function readSubstrateSnapshots(store: StateStore, limit: number): readonly TickSubstrateSnapshot[] {
  return readJsonl<TickSubstrateSnapshot>(path.join(store.logDir, "aagaard-substrate.jsonl")).slice(-limit);
}

export function listIncentiveNominations(store: StateStore): readonly IncentiveNominationRecord[] {
  const file = nominationsPath(store);
  if (!existsSync(file)) return Object.freeze([]);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const rows = Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  return Object.freeze(rows.filter((row): row is Record<string, unknown> & IncentiveNominationRecord => typeof row["offerId"] === "string" && typeof row["account"] === "string"));
}

function writeIncentiveNominations(store: StateStore, records: readonly IncentiveNominationRecord[]): void {
  writeJson(nominationsPath(store), records);
}

export function recordIncentiveNominations(store: StateStore, plan: IncentivePlan, at = new Date().toISOString()): readonly IncentiveNominationRecord[] {
  const prior = new Map(listIncentiveNominations(store).map((record) => [record.offerId, record] as const));
  const recorded: IncentiveNominationRecord[] = [];
  for (const offer of plan.offers) {
    if (offer.disposition !== "nominate" || prior.has(offer.offer.id)) continue;
    const record = Object.freeze({
      offerId: offer.offer.id,
      account: plan.account,
      offer: offer.offer,
      ev: offer.ev,
      scamReasons: offer.scamReasons,
      status: "pending" as const,
      firstSeen: at,
      updated: at,
    });
    prior.set(record.offerId, record);
    recorded.push(record);
  }
  if (recorded.length > 0) {
    writeIncentiveNominations(store, [...prior.values()]);
    appendJsonlRows(path.join(store.logDir, "aagaard-incentive-nominations.jsonl"), recorded.map((record) => ({ event: "nominated", ...record })));
  }
  return Object.freeze(recorded);
}

export function dispositionIncentiveNomination(store: StateStore, offerId: string, choice: IncentiveDispositionChoice, at = new Date().toISOString()): IncentiveNominationRecord | null {
  const records = listIncentiveNominations(store);
  const index = records.findIndex((record) => record.offerId === offerId);
  if (index < 0) return null;
  const existing = records[index]!;
  const draft = choice === "llm-draft" ? composeIncentiveDraft(existing.account, existing.offer, at) : null;
  const updated = Object.freeze({
    ...existing,
    status: choice === "ignore" ? "ignored" as const : choice === "manual" ? "manual" as const : "drafted" as const,
    updated: at,
    ...(draft ? { draftId: draft.id } : {}),
  });
  const next = [...records];
  next[index] = updated;
  writeIncentiveNominations(store, next);
  if (draft) recordLockedDrafts(store, [draft]);
  appendJsonl(path.join(store.logDir, "aagaard-incentive-nominations.jsonl"), [{ event: "dispositioned", choice, offerId, ts: at, status: updated.status, draftId: draft?.id }]);
  return updated;
}

export function capabilityReport(_config: AagaardConfig, control: { isEnabled(capabilityName: Capability): boolean }): readonly { readonly capability: Capability; readonly enabled: boolean; readonly locked: boolean }[] {
  return Object.freeze(ALL_CAPABILITIES.map((entry) => Object.freeze({ capability: entry, enabled: control.isEnabled(entry), locked: isLocked(entry) })));
}

export type AagaardParityStatus = "met" | "exceeded" | "open";

export interface AagaardParityClaim {
  readonly claim: string;
  readonly olderApplication: string;
  readonly replacement: string;
  readonly status: AagaardParityStatus;
  readonly evidence: readonly string[];
}

export interface AagaardParityReport {
  readonly kind: "aagaard.parity-report";
  readonly olderApplication: "lib/emsenn/lib/triage/sites/aagaard.561.group";
  readonly complete: boolean;
  readonly routes: readonly AagaardParityClaim[];
  readonly capabilities: readonly AagaardParityClaim[];
  readonly open: readonly string[];
}

function parityClaim(input: AagaardParityClaim): AagaardParityClaim {
  return Object.freeze({
    claim: input.claim,
    olderApplication: input.olderApplication,
    replacement: input.replacement,
    status: input.status,
    evidence: Object.freeze([...input.evidence]),
  });
}

export function aagaardParityReport(config: AagaardConfig, control: { readonly running: boolean; readonly live: boolean; isEnabled(capabilityName: Capability): boolean }, options: { readonly hiveWriteConfigured?: boolean } = {}): AagaardParityReport {
  const keyRows = config.wallets.map((wallet) => walletKeyStatus(config.keyRoot, wallet.account));
  const hasPostingKey = keyRows.some((keys) => keys.posting);
  const hasActiveKey = keyRows.some((keys) => keys.active);
  const routeClaims = Object.freeze([
    parityClaim({
      claim: "operator status and liveness",
      olderApplication: "GET /ops, GET /ops/health",
      replacement: "GET /ops, GET /ops/health",
      status: "met",
      evidence: ["/ops", "/ops/health"],
    }),
    parityClaim({
      claim: "operator lane control",
      olderApplication: "GET /ops/capabilities, POST /ops/capabilities/:cap/:action, POST /ops/arm|disarm|pause|resume|tick",
      replacement: "same guarded route family",
      status: "met",
      evidence: ["/ops/capabilities", "/ops/arm", "/ops/disarm", "/ops/pause", "/ops/resume", "/ops/tick"],
    }),
    parityClaim({
      claim: "historical readouts",
      olderApplication: "GET /ops/last, GET /ops/ticks?limit=N",
      replacement: "same routes plus witnessed arena summaries",
      status: "exceeded",
      evidence: ["/ops/last", "/ops/ticks", "/ops/arenas", "/ops/witnesses", "/ops/substrate"],
    }),
    parityClaim({
      claim: "per-account alpha, strategy, intelligence, liquidity, and drafts",
      olderApplication: "GET /ops/alpha|intelligence|liquidity|drafts/:account plus strategy routes",
      replacement: "GET /ops/alpha|strategy|intelligence|liquidity|drafts|games/:account",
      status: "exceeded",
      evidence: ["/ops/alpha/:account", "/ops/strategy/:account", "/ops/intelligence/:account", "/ops/liquidity/:account", "/ops/drafts/:account", "/ops/games/:account"],
    }),
    parityClaim({
      claim: "incentive arbitration",
      olderApplication: "GET /ops/incentives, POST /ops/incentives/:offerId/:choice",
      replacement: "same routes with persisted nominations and locked draft records",
      status: "exceeded",
      evidence: ["/ops/incentives", "/ops/incentives/:offerId/:choice", "data/records/incentive-nominations.json", "data/records/locked-drafts.json"],
    }),
    parityClaim({
      claim: "WebUX and public agent read surface",
      olderApplication: "GET /ui, GET /agents/:account/{curation,market,wallet}",
      replacement: "same route family",
      status: "met",
      evidence: ["/ui", "/agents/:account/curation", "/agents/:account/market", "/agents/:account/wallet"],
    }),
  ]);
  const writeReady = options.hiveWriteConfigured === true && hasPostingKey && hasActiveKey;
  const capabilityClaims = Object.freeze([
    parityClaim({
      claim: "wallets are actors playing games in arenas",
      olderApplication: "wallet fleet lanes",
      replacement: "wallet actors, capability games, arena moves, and witness rows per tick",
      status: "exceeded",
      evidence: ["aagaard.wallet-actor", "aagaard.wallet-arena", "/ops/arenas", "/ops/witnesses"],
    }),
    parityClaim({
      claim: "voting, trading, and incentive lanes",
      olderApplication: "operational voting, trading, and incentive arbitration",
      replacement: "runtime-gated lanes with execution receipts",
      status: control.isEnabled("voting") && control.isEnabled("trading") && control.isEnabled("incentive") ? "met" : "open",
      evidence: ["capabilityReport", "executeVotes", "executeTrading", "executeIncentives"],
    }),
    parityClaim({
      claim: "posting and gaming stay operator-locked",
      olderApplication: "posting and gaming locked",
      replacement: "locked draft preparation and locked game move proposals",
      status: isLocked("posting") && isLocked("gaming") ? "met" : "open",
      evidence: ["/ops/drafts/:account", "/ops/games/:account"],
    }),
    parityClaim({
      claim: "raw substrate and durable operator history",
      olderApplication: "append-only data/history substrate",
      replacement: "data/logs substrate snapshots, fleet ticks, witness logs, nominations, and generated records",
      status: "exceeded",
      evidence: ["data/logs/aagaard-substrate-snapshots.jsonl", "data/logs/aagaard-fleet-ticks.jsonl", "data/records/locked-drafts.json"],
    }),
    parityClaim({
      claim: "Hive live write boundary",
      olderApplication: "wallet signing and broadcast over Hive",
      replacement: "AAGAARD_BROADCAST_COMMAND plus keyRoot role checks and tx-id receipts",
      status: writeReady ? "met" : "open",
      evidence: ["AAGAARD_BROADCAST_COMMAND", "keyRoot/<account>/posting.wif", "keyRoot/<account>/active.wif", "ExecutionReceipt.txId"],
    }),
  ]);
  const open = Object.freeze([
    ...(control.running ? [] : ["control plane is paused"]),
    ...(control.live ? [] : ["fleet is disarmed"]),
    ...(options.hiveWriteConfigured === true ? [] : ["AAGAARD_BROADCAST_COMMAND is not configured"]),
    ...(hasPostingKey ? [] : ["no posting key found under keyRoot"]),
    ...(hasActiveKey ? [] : ["no active key found under keyRoot"]),
    ...(control.isEnabled("voting") ? [] : ["voting lane disabled"]),
    ...(control.isEnabled("trading") ? [] : ["trading lane disabled"]),
    ...(control.isEnabled("incentive") ? [] : ["incentive lane disabled"]),
  ]);
  return Object.freeze({
    kind: "aagaard.parity-report" as const,
    olderApplication: "lib/emsenn/lib/triage/sites/aagaard.561.group" as const,
    complete: open.length === 0 && [...routeClaims, ...capabilityClaims].every((claim) => claim.status !== "open"),
    routes: routeClaims,
    capabilities: capabilityClaims,
    open,
  });
}

export interface ControlPlane {
  running: boolean;
  live: boolean;
  isEnabled(capabilityName: Capability): boolean;
  enable(capabilityName: Capability): boolean;
  disable(capabilityName: Capability): void;
  enabledList(): readonly Capability[];
}

export function createControlPlane(config: AagaardConfig): ControlPlane {
  const enabled = new Set(config.enabled.filter((entry) => !isLocked(entry)));
  return {
    running: true,
    live: config.live,
    isEnabled(capabilityName) {
      return !isLocked(capabilityName) && enabled.has(capabilityName);
    },
    enable(capabilityName) {
      if (isLocked(capabilityName)) return false;
      enabled.add(capabilityName);
      return true;
    },
    disable(capabilityName) {
      enabled.delete(capabilityName);
    },
    enabledList() {
      return Object.freeze([...enabled]);
    },
  };
}

export interface AagaardRuntime {
  readonly config: AagaardConfig;
  readonly control: ControlPlane;
  readonly store: StateStore;
  readonly isTicking: boolean;
  wallet(account: string): WalletActor | undefined;
  status(): WitnessValue;
  runTick(at?: string): Promise<FleetTickReadout>;
  start(signal: AbortSignal): void;
}

async function readField(hive: HiveReadBoundary | undefined, wallet: WalletActor): Promise<readonly PostCandidate[]> {
  if (!hive) return DEFAULT_POSTS;
  try {
    const posts = await hive.readCandidateField(wallet);
    return posts.length > 0 ? posts : DEFAULT_POSTS;
  } catch {
    return DEFAULT_POSTS;
  }
}

async function readState(hive: HiveReadBoundary | undefined, wallet: WalletActor): Promise<WalletChainState | null> {
  if (!hive) return null;
  try {
    return await hive.readWalletState(wallet);
  } catch {
    return null;
  }
}

async function readMarket(market: MarketReadBoundary | undefined, wallet: WalletActor, state: WalletChainState | null): Promise<WalletMarketState | null> {
  if (!market) return null;
  try {
    return await market.readWalletMarket(wallet, state);
  } catch {
    return null;
  }
}

async function readInternalMarket(hive: HiveReadBoundary | undefined): Promise<InternalMarketReading | null> {
  if (!hive?.readInternalMarket) return null;
  try {
    return await hive.readInternalMarket();
  } catch {
    return null;
  }
}

export function mergeWalletState(wallet: WalletActor, state: WalletChainState | null, market: WalletMarketState | null): WalletChainState {
  return Object.freeze({
    account: state?.account ?? wallet.account,
    hive: state?.hive ?? (wallet.account === "sigmund-vexler" ? "12.000 HIVE" : "1.000 HIVE"),
    hbd: state?.hbd ?? (wallet.account === "help-fund" ? "8.000 HBD" : "1.000 HBD"),
    currentMana: state?.currentMana ?? (wallet.account === "sigmund-vexler" ? "9200" : "8400"),
    maxMana: state?.maxMana ?? "10000",
    tokens: Object.freeze({ ...wallet.tokens, ...(state?.tokens ?? {}), ...(market?.tokens ?? {}) }),
  });
}

export function walletKeyStatus(keyRoot: string, account: string): WalletKeyStatus {
  return Object.freeze({
    posting: existsSync(path.join(keyRoot, account, "posting.wif")),
    active: existsSync(path.join(keyRoot, account, "active.wif")),
  });
}

function receipt(input: Omit<ExecutionReceipt, "txId" | "error"> & { readonly txId?: string; readonly error?: string }): ExecutionReceipt {
  return Object.freeze({
    lane: input.lane,
    action: input.action,
    target: input.target,
    status: input.status,
    role: input.role,
    ...(input.txId ? { txId: input.txId } : {}),
    ...(input.error ? { error: input.error } : {}),
  });
}

export async function executeVotes(wallet: WalletActor, plan: VotingPlan, armed: boolean, keys: WalletKeyStatus, writer?: HiveWriteBoundary): Promise<VotingExecution> {
  const receipts: ExecutionReceipt[] = [];
  let broadcast = 0;
  let dryRun = 0;
  let skipped = 0;
  let errors = 0;
  for (const vote of plan.votes) {
    const target = `${vote.author}/${vote.permlink}`;
    if (!armed) {
      dryRun += 1;
      receipts.push(receipt({ lane: "voting", action: "vote", target, status: "dry-run", role: "posting" }));
      continue;
    }
    if (!keys.posting) {
      skipped += 1;
      receipts.push(receipt({ lane: "voting", action: "vote", target, status: "skipped", role: "posting", error: "no posting key" }));
      continue;
    }
    if (!writer) {
      skipped += 1;
      receipts.push(receipt({ lane: "voting", action: "vote", target, status: "skipped", role: "posting", error: "no Hive write boundary" }));
      continue;
    }
    try {
      const result = await writer.vote(wallet, vote);
      broadcast += 1;
      receipts.push(receipt({ lane: "voting", action: "vote", target, status: "broadcast", role: "posting", txId: result.id }));
    } catch (error) {
      errors += 1;
      receipts.push(receipt({ lane: "voting", action: "vote", target, status: "error", role: "posting", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return Object.freeze({ broadcast, dryRun, skipped, errors, receipts: Object.freeze(receipts) });
}

export async function executeTrading(wallet: WalletActor, plan: TradingPlan, armed: boolean, keys: WalletKeyStatus, writer?: HiveWriteBoundary): Promise<TradingExecution> {
  const receipts: ExecutionReceipt[] = [];
  const mode: ExecutionMode = !armed ? "dry-run" : plan.liveEligible && keys.active && writer ? "live" : "propose-only";
  let tradesExecuted = 0;
  let lpExecuted = 0;
  let savingsExecuted = false;

  async function recordActive(action: string, target: string, call: (() => Promise<{ readonly id: string }>) | undefined): Promise<void> {
    if (!armed) {
      receipts.push(receipt({ lane: "trading", action, target, status: "dry-run", role: "active" }));
      return;
    }
    if (!plan.liveEligible) {
      receipts.push(receipt({ lane: "trading", action, target, status: "propose-only", role: "active", error: "account not trading-live" }));
      return;
    }
    if (!keys.active) {
      receipts.push(receipt({ lane: "trading", action, target, status: "propose-only", role: "active", error: "no active key" }));
      return;
    }
    if (!call) {
      receipts.push(receipt({ lane: "trading", action, target, status: "propose-only", role: "active", error: "no Hive write boundary" }));
      return;
    }
    try {
      const result = await call();
      receipts.push(receipt({ lane: "trading", action, target, status: "broadcast", role: "active", txId: result.id }));
      if (action === "trade") tradesExecuted += 1;
      if (action === "lp") lpExecuted += 1;
      if (action === "savings") savingsExecuted = true;
    } catch (error) {
      receipts.push(receipt({ lane: "trading", action, target, status: "error", role: "active", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  for (const trade of plan.trades) {
    if (!trade.funded) {
      receipts.push(receipt({ lane: "trading", action: "trade", target: trade.pair, status: "skipped", role: "active", error: "not selected by this tick's budget allocator" }));
      continue;
    }
    await recordActive("trade", trade.pair, writer?.trade ? () => writer.trade!(wallet, trade) : undefined);
  }
  for (const entry of plan.lp) await recordActive("lp", entry.pool, writer?.liquidity ? () => writer.liquidity!(wallet, entry) : undefined);
  if (plan.savings) await recordActive("savings", "HBD savings", writer?.savings ? () => writer.savings!(wallet, plan.savings!) : undefined);

  return Object.freeze({ mode, tradesExecuted, lpExecuted, savingsExecuted, receipts: Object.freeze(receipts) });
}

export async function executeIncentives(wallet: WalletActor, plan: IncentivePlan, armed: boolean, keys: WalletKeyStatus, writer?: HiveWriteBoundary): Promise<IncentiveExecution> {
  const receipts: ExecutionReceipt[] = [];
  let broadcast = 0;
  let dryRun = 0;
  let skipped = 0;
  let errors = 0;
  for (const row of plan.offers) {
    if (row.disposition !== "auto") continue;
    for (const action of row.offer.requiredActions) {
      const target = row.offer.id;
      if (action === "comment" || action === "post" || action === "delegate") {
        skipped += 1;
        receipts.push(receipt({ lane: "incentive", action, target, status: "skipped", role: action === "delegate" ? "active" : "posting", error: action === "delegate" ? "delegation requires manual review" : "posting lane locked" }));
        continue;
      }
      if (!armed) {
        dryRun += 1;
        receipts.push(receipt({ lane: "incentive", action, target, status: "dry-run", role: "posting" }));
        continue;
      }
      if (!keys.posting) {
        skipped += 1;
        receipts.push(receipt({ lane: "incentive", action, target, status: "skipped", role: "posting", error: "no posting key" }));
        continue;
      }
      if (!writer?.incentive) {
        skipped += 1;
        receipts.push(receipt({ lane: "incentive", action, target, status: "skipped", role: "posting", error: "no Hive write boundary" }));
        continue;
      }
      try {
        const result = await writer.incentive(wallet, row.offer, action);
        broadcast += 1;
        receipts.push(receipt({ lane: "incentive", action, target, status: "broadcast", role: "posting", txId: result.id }));
      } catch (error) {
        errors += 1;
        receipts.push(receipt({ lane: "incentive", action, target, status: "error", role: "posting", error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
  return Object.freeze({ broadcast, dryRun, skipped, errors, receipts: Object.freeze(receipts) });
}

// Every staking/delegate action requires the account's ACTIVE key on-chain
// (Hive-Engine's tokens.js contract asserts isSignedWithActiveKey === true
// for both actions) -- matches the role gate already used for trading.
export async function executeStaking(wallet: WalletActor, plan: StakingPlan, armed: boolean, keys: WalletKeyStatus, writer?: HiveWriteBoundary): Promise<StakingExecution> {
  const receipts: ExecutionReceipt[] = [];
  let broadcast = 0;
  let dryRun = 0;
  let skipped = 0;
  let errors = 0;
  for (const action of plan.actions) {
    const target = `${action.symbol}->${action.to}`;
    if (!armed) {
      dryRun += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "dry-run", role: "active" }));
      continue;
    }
    if (!keys.active) {
      skipped += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "skipped", role: "active", error: "no active key" }));
      continue;
    }
    if (!writer?.stake) {
      skipped += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "skipped", role: "active", error: "no Hive write boundary" }));
      continue;
    }
    try {
      const result = await writer.stake(wallet, action);
      broadcast += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "broadcast", role: "active", txId: result.id }));
    } catch (error) {
      errors += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "error", role: "active", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return Object.freeze({ broadcast, dryRun, skipped, errors, receipts: Object.freeze(receipts) });
}

export interface WrapPlan {
  readonly account: string;
  readonly actions: readonly WrapAction[];
  readonly arena: WalletArena;
}

// A fixed reserve of real HIVE this office never wraps away, so an
// account always keeps enough liquid HIVE for its own on-chain needs
// regardless of what its trading strategy would otherwise convert.
const HIVE_WRAP_RESERVE = 1;
// Wrap a bit more than this tick's exact shortfall: the sidechain needs a
// few seconds to observe the real Hive transfer, so a wrap broadcast this
// tick funds NEXT tick's buy-side trades, not this one -- sizing for a
// buffer means the wrap doesn't need to repeat every single tick once a
// wallet's real SWAP.HIVE balance catches up.
const HIVE_WRAP_BUFFER = 1.2;

// Whether this tick's funded buy-side trades need more SWAP.HIVE than the
// wallet currently holds, and if so, proposes wrapping real HIVE to cover
// it -- see hiveEngineOps.mjs's wrapHive for the verified real mechanism.
// Refuses (proposes nothing) rather than guessing when real HIVE holdings
// don't cover the shortfall plus the reserve.
export function planWrap(wallet: WalletActor, state: WalletChainState | null | undefined, tradingPlan: TradingPlan, at = new Date().toISOString()): WrapPlan {
  const actions: WrapAction[] = [];
  if (wallet.tradingLive) {
    const neededSwapHive = tradingPlan.trades
      .filter((trade) => trade.funded && trade.pair.startsWith("SWAP.HIVE/"))
      .reduce((sum, trade) => sum + Number(trade.quantity ?? "0"), 0);
    const heldSwapHive = Number((state?.tokens ?? wallet.tokens)["SWAP.HIVE"] ?? "0");
    const shortfall = neededSwapHive - heldSwapHive;
    if (shortfall > 0) {
      const heldHive = Number.parseFloat(state?.hive ?? "0");
      const available = heldHive - HIVE_WRAP_RESERVE;
      const wrapAmount = Math.min(shortfall * HIVE_WRAP_BUFFER, available);
      if (wrapAmount >= 0.01) {
        actions.push(Object.freeze({
          kind: "wrap" as const,
          quantityHive: wrapAmount.toFixed(3),
          reason: `cover funded buy-side trades needing ${neededSwapHive.toFixed(3)} SWAP.HIVE against ${heldSwapHive.toFixed(3)} held`,
        }));
      }
    }
  }
  const moves = actions.map((action) => Object.freeze({
    actor: wallet.account,
    action: termForCapability("trading", action.kind),
    target: "honey-swap",
    value: { quantityHive: action.quantityHive },
    charge: "active" as const,
    reason: action.reason,
  }));
  return Object.freeze({
    account: wallet.account,
    actions: Object.freeze(actions),
    arena: arenaOf({ name: "trading", game: "HIVE/SWAP.HIVE peg maintenance", actors: [wallet], moves, at }),
  });
}

export async function executeWrap(wallet: WalletActor, plan: WrapPlan, armed: boolean, keys: WalletKeyStatus, writer?: HiveWriteBoundary): Promise<StakingExecution> {
  const receipts: ExecutionReceipt[] = [];
  let broadcast = 0;
  let dryRun = 0;
  let skipped = 0;
  let errors = 0;
  for (const action of plan.actions) {
    const target = `HIVE<->SWAP.HIVE:${action.quantityHive}`;
    if (!armed) {
      dryRun += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "dry-run", role: "active" }));
      continue;
    }
    if (!keys.active) {
      skipped += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "skipped", role: "active", error: "no active key" }));
      continue;
    }
    if (!writer?.wrap) {
      skipped += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "skipped", role: "active", error: "no Hive write boundary" }));
      continue;
    }
    try {
      const result = await writer.wrap(wallet, action);
      broadcast += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "broadcast", role: "active", txId: result.id }));
    } catch (error) {
      errors += 1;
      receipts.push(receipt({ lane: "trading", action: action.kind, target, status: "error", role: "active", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return Object.freeze({ broadcast, dryRun, skipped, errors, receipts: Object.freeze(receipts) });
}

async function tickWallet(store: StateStore, control: ControlPlane, wallet: WalletActor, at: string, hive: HiveReadBoundary | undefined, marketBoundary: MarketReadBoundary | undefined, keyRoot: string, writer: HiveWriteBoundary | undefined): Promise<AccountTickReadout> {
  const arenas: WalletArena[] = [];
  let voting: AccountTickReadout["voting"] | undefined;
  let trading: AccountTickReadout["trading"] | undefined;
  let incentive: AccountTickReadout["incentive"] | undefined;
  let votingPlan: VotingPlan | null = null;
  let incentivePlan: IncentivePlan | null = null;
  const [posts, chainState] = await Promise.all([readField(hive, wallet), readState(hive, wallet)]);
  const market = await readMarket(marketBoundary, wallet, chainState);
  const internalMarket = await readInternalMarket(hive);
  const flow = market && marketBoundary?.readTradeFlow
    ? await marketBoundary.readTradeFlow([...new Set(market.venues.map((venue) => venue.pair.split("/")[0]).filter((symbol): symbol is string => symbol !== undefined && symbol !== "SWAP.HIVE"))]).catch(() => ({}))
    : {};
  const state = mergeWalletState(wallet, chainState, market);
  const keys = walletKeyStatus(keyRoot, wallet.account);

  if (control.isEnabled("voting")) {
    const plan = planVotes(wallet, posts, at, state);
    votingPlan = plan;
    arenas.push(plan.arena);
    const execution = await executeVotes(wallet, plan, control.live && control.isEnabled("voting"), keys, writer);
    voting = {
      currentMana: plan.currentMana,
      maxMana: plan.maxMana,
      votesPlanned: plan.votes.length,
      votesBroadcast: execution.broadcast,
      votesDryRun: execution.dryRun,
      votesSkipped: execution.skipped,
      execution,
      decision: plan.decision,
      radar: {
        posts: plan.radar.posts,
        mispricingEnergy: plan.radar.mispricingEnergy,
        components: plan.radar.components,
        durable: plan.radar.durable,
        topSinks: plan.radar.sinks.slice(0, 5).map((sink) => sink.key),
      },
      intelligence: {
        fiedler: plan.intelligence.spectral.fiedler,
        decayHalfLife: plan.intelligence.spectral.decayHalfLife,
        cartelCycles: plan.intelligence.cartels.b1,
        bridges: plan.intelligence.bridges.length,
        topByExpectedAlpha: plan.intelligence.posts.slice(0, 5).map((post) => `${post.key} E[alpha]=${post.expectedAlpha}`),
      },
    };
  }

  const tradingPlan = planTrades(wallet, at, state, market, internalMarket, flow);
  if (control.isEnabled("trading")) {
    arenas.push(tradingPlan.arena);
    const execution = await executeTrading(wallet, tradingPlan, control.live && control.isEnabled("trading"), keys, writer);
    trading = {
      mode: execution.mode,
      hive: tradingPlan.hive,
      hbd: tradingPlan.hbd,
      tradesPlanned: tradingPlan.trades.length,
      tradesExecuted: execution.tradesExecuted,
      lpPlanned: tradingPlan.lp.length,
      lpExecuted: execution.lpExecuted,
      savingsPlanned: tradingPlan.savings !== null,
      savingsExecuted: execution.savingsExecuted,
      execution,
      allocation: tradingPlan.allocation,
      rigidity: tradingPlan.liquidity.rigidity,
      flow: tradingPlan.liquidity.flow,
      cycleCapacities: tradingPlan.cycleCapacities,
      screening: tradingPlan.liquidity.screening,
    };
  }

  let wrap: AccountTickReadout["wrap"] | undefined;
  if (control.isEnabled("trading")) {
    const wrapPlan = planWrap(wallet, state, tradingPlan, at);
    if (wrapPlan.actions.length > 0) {
      arenas.push(wrapPlan.arena);
      const execution = await executeWrap(wallet, wrapPlan, control.live && control.isEnabled("trading"), keys, writer);
      wrap = { actionsPlanned: wrapPlan.actions.length, execution };
    }
  }

  if (control.isEnabled("incentive")) {
    const plan = planIncentives(wallet, posts, tradingPlan.liquidity, at);
    incentivePlan = plan;
    arenas.push(plan.arena);
    recordIncentiveNominations(store, plan, at);
    const execution = await executeIncentives(wallet, plan, control.live && control.isEnabled("incentive"), keys, writer);
    incentive = {
      offersFound: plan.offers.length,
      nominated: plan.offers.filter((offer) => offer.disposition === "nominate").length,
      autoExecuted: execution.broadcast,
      execution,
      topOffers: plan.offers.slice(0, 5).map((offer) => `${offer.offer.source.author}/${offer.offer.source.permlink} EV=${offer.ev}`),
    };
  }

  let staking: AccountTickReadout["staking"] | undefined;
  if (control.isEnabled("trading")) {
    const rawPlan = planStaking(wallet, state, at);
    const stakeParams: Readonly<Record<string, TokenStakeParams>> = marketBoundary?.readStakeParams
      ? await marketBoundary.readStakeParams([...new Set(rawPlan.actions.map((action) => action.symbol))]).catch(() => ({}))
      : {};
    // A token whose own contract record refuses staking/delegation
    // (verified live, not assumed) is dropped from the plan rather than
    // broadcast anyway -- see readStakeParams's own comment for why.
    const actions = rawPlan.actions.filter((action) => {
      const params = stakeParams[action.symbol];
      if (!params) return true;
      return action.kind === "stake" ? params.stakingEnabled : params.delegationEnabled;
    });
    const plan = actions.length === rawPlan.actions.length ? rawPlan : Object.freeze({ ...rawPlan, actions: Object.freeze(actions) });
    if (plan.actions.length > 0) {
      arenas.push(plan.arena);
      const execution = await executeStaking(wallet, plan, control.live && control.isEnabled("trading"), keys, writer);
      staking = { actionsPlanned: plan.actions.length, execution };
    }
  }

  recordScoreboardTick(store.scoreboardDir, wallet.account, state, tradingPlan.liquidity, votingPlan, tradingPlan, voting?.votesBroadcast ?? 0, at);

  const drafts = composeDailyDrafts({ wallet, voting: votingPlan, trading: tradingPlan, incentive: incentivePlan, at });
  recordLockedDrafts(store, drafts);
  recordSubstrateSnapshot(store, Object.freeze({
    kind: "aagaard.substrate-snapshot" as const,
    ts: at,
    account: wallet.account,
    posts: Object.freeze([...posts]),
    activeVotes: Object.freeze(posts.flatMap((post) => post.votes.map((vote) => Object.freeze({
      author: post.author,
      permlink: post.permlink,
      voter: vote.voter,
      rshares: vote.rshares,
    })))),
    chainState: state,
    market,
    liquidity: tradingPlan.liquidity,
  }));
  arenas.push(arenaOf({
    name: "posting",
    game: "operator-reviewed publication",
    actors: [wallet],
    locked: true,
    at,
    moves: [Object.freeze({
      actor: wallet.account,
      action: termForCapability("posting", "draft"),
      target: drafts[0]?.title ?? `${wallet.account} operations note`,
      value: { drafts: drafts.map((draft) => ({ id: draft.id, title: draft.title, topic: draft.topic, tags: [...draft.tags] })) },
      charge: "potential" as const,
      reason: "posting lane locked",
    })],
  }));

  const gamingPlan = planGaming(wallet, at, state);
  arenas.push(gamingPlan.arena);

  return Object.freeze({
    account: wallet.account,
    ...(voting ? { voting } : {}),
    ...(trading ? { trading } : {}),
    ...(incentive ? { incentive } : {}),
    ...(staking ? { staking } : {}),
    ...(wrap ? { wrap } : {}),
    posting: Object.freeze({ draftsPrepared: drafts.length, locked: true as const }),
    gaming: Object.freeze({ gamesDetected: gamingPlan.games.length, games: Object.freeze(gamingPlan.games.map((game) => game.game)), locked: true as const }),
    arenas: Object.freeze(arenas),
  });
}

export function createAagaardRuntime(config: AagaardConfig, store: StateStore, options: { readonly hive?: HiveReadBoundary; readonly market?: MarketReadBoundary; readonly writer?: HiveWriteBoundary } = {}): AagaardRuntime {
  const control = createControlPlane(config);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticking = false;
  const runtime: AagaardRuntime = {
    config,
    control,
    store,
    get isTicking() {
      return ticking;
    },
    wallet(account) {
      return config.wallets.find((wallet) => wallet.account === account);
    },
    status() {
      return {
        kind: "aagaard.ops.status",
        name: config.name,
        running: control.running,
        live: control.live,
        ticking,
        cadenceSeconds: config.cadenceSeconds,
        enabled: [...control.enabledList()],
        reads: {
          hive: config.hive.enabled,
          hiveEngine: config.hiveEngine.enabled,
        },
        writes: {
          hive: options.writer !== undefined,
        },
        accounts: config.wallets.map((wallet) => ({
          account: wallet.account,
          archetype: wallet.strategy.archetype,
          feeds: [...wallet.strategy.feeds],
          tradingLive: wallet.tradingLive,
          keys: {
            posting: walletKeyStatus(config.keyRoot, wallet.account).posting,
            active: walletKeyStatus(config.keyRoot, wallet.account).active,
          },
          tokens: wallet.tokens,
        })),
      };
    },
    async runTick(at = new Date().toISOString()) {
      ticking = true;
      try {
        const accounts = await Promise.all(config.wallets.map((wallet) => tickWallet(store, control, wallet, at, options.hive, options.market, config.keyRoot, options.writer)));
        const witnesses = accounts.flatMap((account) => account.arenas.flatMap((arena) => arena.witnesses));
        const info = witnessLogInformation(witnesses);
        const readout = Object.freeze({
          kind: "aagaard.fleet-tick" as const,
          ts: at,
          running: control.running,
          live: control.live,
          enabled: control.enabledList(),
          accounts: Object.freeze(accounts),
          witness: Object.freeze({
            rows: info.rows,
            uniqueWitnesses: info.uniqueWitnesses,
            duplicateWitnesses: info.duplicateWitnesses,
          }),
        });
        recordFleetTick(store, readout);
        return readout;
      } finally {
        ticking = false;
      }
    },
    start(signal) {
      const cadenceMs = config.cadenceSeconds * 1000;
      const loop = async (): Promise<void> => {
        if (signal.aborted) return;
        if (control.running) {
          try {
            await runtime.runTick();
          } catch {
            // The control surface remains available after a failed tick.
          }
        }
        if (!signal.aborted) timer = setTimeout(() => { void loop(); }, cadenceMs);
      };
      signal.addEventListener("abort", () => {
        if (timer) clearTimeout(timer);
      }, { once: true });
      void loop();
    },
  };
  return Object.freeze(runtime);
}

export function fleetWitnessDigest(readout: FleetTickReadout): string {
  return canonicalWitnessValue({
    kind: readout.kind,
    ts: readout.ts,
    accounts: readout.accounts.map((account) => ({
      account: account.account,
      arenas: account.arenas.map((arena) => ({ name: arena.name, witnesses: arena.witnesses.length })),
    })),
  });
}
