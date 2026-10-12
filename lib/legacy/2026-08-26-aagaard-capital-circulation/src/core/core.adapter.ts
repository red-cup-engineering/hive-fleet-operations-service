import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

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
import { readVotingIntelligenceOf } from "../analysis/intelligence.mts";
import { readHolonomy, MIN_POOL_TVL_QUOTE, type ArbitrageCycle } from "../analysis/holonomy.mts";
import { recordScoreboardTick } from "./scoreboard.mts";
import { allocateBudget, type AllocationCandidate, type AllocationResult } from "../analysis/allocation.mts";
import { readRigidity, edgesFromPools, type RigidityReading } from "../analysis/rigidity.mts";
import { detailedBalance, type FlowReading, type TradeFill } from "../analysis/flow.mts";
import { catabolicCapacity, type CatabolicCapacity } from "../analysis/capacity.mts";
import { readScreening, edgesForScreening, type ScreeningReading } from "../analysis/screening.mts";
import {
  readCurationTelemetry,
  recordCurationPredictions,
  recordCurationSettlements,
  type CurationPredictionEvent,
  type CurationSettlementEvent,
  type CurationRewardScan,
  type CurationTelemetry,
} from "./curationSettlement.mts";
import {
  candidateFieldDigest,
  curationStrategyIdentity,
  readCurationStrategyArm,
  recordCurationStrategyArm,
  type CurationStrategyArmReading,
  type StrategyArmCandidate,
  type StrategyArmRefusal,
} from "./strategyArms.mts";
import {
  guardFleetSelfCross,
  recordMakerOrderScan,
  type MakerOrderScan,
  type MakerSelfCrossGuard,
} from "./makerOrders.mts";
import {
  buildDervishTrialObservation,
  makeSixWalletRoster,
  nextDervishGlobalStep,
  readDervishScheduleStep,
  recordDervishTrialObservation,
  summarizeDervishTrial,
  type DervishTrialSummary,
} from "./dervishExperiment.mts";
import { sizeExactPoolToBook, type ExactBookLevel } from "../analysis/exactArbitrage.mts";

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
    /** Per-tick sidechain trading input cap, denominated in SWAP.HIVE.
     * Kept distinct from native HIVE: the peg is asynchronous and has a
     * fee, so equal spelling is not an admitted valuation relation. */
    readonly capSwapHiveMilli: number;
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
  /** Author-beneficiary routing (hundredths of a percent, 10000 = 100%).
   *  This changes author distribution, not Hive's separate curator reward. */
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
    readonly decayHalfLife: number | null;
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
  readonly strategyArm: CurationStrategyArmReading;
  readonly votes: readonly VotePlanItem[];
  readonly decision: string;
  readonly arena: WalletArena;
}

export interface VotingFieldAnalysis {
  readonly candidateFieldDigest: string;
  readonly radar: AlphaRadar;
  readonly intelligence: VotingIntelligence;
}

export interface LiquidityReading {
  readonly kind: "aagaard.liquidity";
  readonly venues: readonly {
    readonly venue: string;
    readonly pair: string;
    readonly midpoint: number;
    /** Executable top-of-book prices, kept separate from midpoint so a
     * round trip is never sized against a price that no order offers. */
    readonly bestBid?: number;
    readonly bestAsk?: number;
    readonly bestBidQuantity?: number;
    readonly bestAskQuantity?: number;
    readonly bidDepth: number;
    readonly askDepth: number;
    readonly relativeSpreadBps: number;
    readonly imbalance: number;
    readonly thin: boolean;
    /** Lossless, contract-ordered evidence for executable sizing. Display
     * numbers above are never sufficient authority for a live bundle. */
    readonly exactBook?: {
      readonly observedAt: string;
      readonly bids: readonly ExactBookLevel[];
      readonly asks: readonly ExactBookLevel[];
      readonly bidComplete: boolean;
      readonly askComplete: boolean;
      readonly bidOrdered: boolean;
      readonly askOrdered: boolean;
    };
  }[];
  readonly pools: readonly {
    readonly pair: string;
    readonly impliedPrice: number;
    /** Live reserves are required for constant-product sizing.  Optional
     * only for shaped/offline readings that cannot lawfully be executed. */
    readonly baseQuantity?: number;
    readonly quoteQuantity?: number;
    readonly baseQuantityExact?: string;
    readonly quoteQuantityExact?: string;
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

/** One capital decision and one broadcast envelope for a complete
 * inventory-neutral opportunity. Hive Engine executes the two inner
 * contract calls sequentially (not with database rollback), so the AMM
 * input is capped and the exit is a limit sell: the residual failure mode
 * is a bounded token position/resting order, never an unbounded market
 * sale or an independently funded leg. */
export interface TradingBundle {
  readonly id: string;
  readonly kind: "pool-to-orderbook-round-trip" | "orderbook-to-pool-round-trip";
  readonly symbol: string;
  readonly pool: string;
  readonly quantity: string;
  readonly expectedInputSwapHive: string;
  readonly maxInputSwapHive: string;
  readonly limitBuyPriceSwapHive: string;
  readonly limitSellPriceSwapHive: string;
  readonly minimumProceedsSwapHive: string;
  readonly expectedProfitSwapHive: string;
  readonly worstCaseProfitSwapHive: string;
  readonly edgeBps: number;
  readonly capitalSwapHive: number;
  readonly executable: boolean;
  readonly funded: boolean;
  readonly refusalReason: string | null;
  /** Oldest market evidence used to form this bundle. Live execution refuses
   * it after a short inclusion-risk window. */
  readonly marketObservedAt: string | null;
  /** Fleet-wide resting-order safety for this bundle's order-book leg.
   * Absent is valid for offline analysis, but never for live execution. */
  readonly selfCrossGuard?: MakerSelfCrossGuard;
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
  /** Complete opportunities. The allocator funds these objects, never
   * their legs, and executeTrading invokes exactly one write-boundary call
   * per funded bundle. */
  readonly bundles: readonly TradingBundle[];
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
  readonly allocationUnit: "SWAP.HIVE";
  readonly arena: WalletArena;
}

export interface EnterpriseTradingAuthorization {
  readonly kind: "agrodao.hive-enterprise-execution-authorization.v1";
  readonly issuer: "urn:ame:sigmund-hive-arbitrage-enterprise" | "urn:ame:help-hive-liquidity-enterprise";
  readonly consumer: "urn:ame:aagaard";
  readonly account: string;
  readonly lane: "arbitrage" | "liquidity";
  readonly actions: readonly ("trade" | "trade-bundle" | "lp")[];
  readonly decisionId: string;
  readonly observationId: string;
  readonly planDigest: string;
  readonly validFrom: string;
  readonly expiresAt: string;
  readonly releaseId?: string;
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
  readonly curation: CurationTelemetry;
  readonly voting?: {
    readonly currentMana: string;
    readonly maxMana: string;
    readonly votesPlanned: number;
    readonly votesBroadcast: number;
    readonly votesDryRun: number;
    readonly votesSkipped: number;
    readonly execution: VotingExecution;
    readonly decision: string;
    readonly strategyArm: {
      readonly candidateFieldDigest: string;
      readonly strategyId: string;
      readonly archetype: string;
      readonly objectiveDigest: string;
      readonly exact: boolean;
      readonly alternativeCount: number | null;
      readonly choiceBits: number | null;
      readonly deterministicAccountPhase: number | null;
      readonly selected: readonly string[];
    };
    readonly radar: Pick<AlphaRadar, "posts" | "mispricingEnergy" | "components" | "durable"> & { readonly topSinks: readonly string[] };
    readonly intelligence: {
      readonly fiedler: number;
      readonly decayHalfLife: number | null;
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
    readonly bundlesPlanned: number;
    readonly bundlesFunded: number;
    readonly bundlesExecuted: number;
    readonly lpPlanned: number;
    readonly lpExecuted: number;
    readonly savingsPlanned: boolean;
    readonly savingsExecuted: boolean;
    readonly execution: TradingExecution;
    readonly makerOrderSafety: {
      readonly observedAt: string;
      readonly complete: boolean;
      readonly fleetOrders: number;
      readonly limitations: readonly string[];
    };
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
  /** Null unless the configured roster is exactly six distinct accounts. */
  readonly dervish: DervishTrialSummary | null;
  readonly witness: {
    readonly rows: number;
    readonly uniqueWitnesses: number;
    readonly duplicateWitnesses: number;
  };
}

export interface StateStore {
  readonly root: string;
  readonly dataDir: string;
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
  readonly bestBid?: number;
  readonly bestAsk?: number;
  readonly bestBidQuantityHive?: number;
  readonly bestAskQuantityHive?: number;
  readonly bids?: readonly { readonly priceHbdPerHive: number; readonly hiveQuantity: number; readonly hbdQuantity: number }[];
  readonly asks?: readonly { readonly priceHbdPerHive: number; readonly hiveQuantity: number; readonly hbdQuantity: number }[];
  readonly bidDepth: number;
  readonly askDepth: number;
  readonly relativeSpreadBps: number;
}

export interface HiveReadBoundary {
  readCandidateField(wallet: WalletActor): Promise<readonly PostCandidate[]>;
  readWalletState(wallet: WalletActor): Promise<WalletChainState | null>;
  readCurationRewards?(wallet: WalletActor): Promise<CurationRewardScan>;
  readInternalMarket?(): Promise<InternalMarketReading | null>;
}

export interface WalletMarketState {
  readonly observedAt?: string;
  readonly tokens: Readonly<Record<string, string>>;
  readonly venues: LiquidityReading["venues"];
  readonly pools: LiquidityReading["pools"];
  readonly availability?: {
    readonly balances: boolean;
    readonly pools: boolean;
    readonly precision: boolean;
    readonly booksRequested: number;
    readonly booksObserved: number;
  };
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
  /** One bounded but complete-for-the-requested-fleet observation of both
   * market order tables. Live order-book legs fail closed without it. */
  readFleetOpenOrders?(accounts: readonly string[], observedAt?: string): Promise<MakerOrderScan>;
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

export type EconomicEffectStatus = "confirmed" | "partial" | "unverified" | "not-recognized";

/** Evidence supplied by the owning write boundary after an outer-chain
 * broadcast. A transaction id alone is deliberately not economic-effect
 * evidence: Hive can accept a custom_json whose target contract never
 * recognizes or applies it. */
export interface EconomicEffectEvidence {
  readonly status: EconomicEffectStatus;
  readonly source: string;
  readonly reference?: string;
  readonly contract?: string;
  readonly action?: string;
  readonly confirmedLegs?: number;
  readonly expectedLegs?: number;
  readonly realizedInputSwapHive?: number;
  readonly realizedProceedsSwapHive?: number;
  readonly realizedPnlSwapHive?: number;
}

export interface HiveWriteResult {
  readonly id: string;
  readonly economicEffect?: EconomicEffectEvidence;
}

export interface ExecutionReceipt {
  readonly lane: "voting" | "trading" | "incentive";
  readonly action: string;
  readonly target: string;
  readonly status: ExecutionStatus;
  readonly role: "posting" | "active";
  readonly txId?: string;
  readonly economicEffect?: EconomicEffectEvidence;
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
  readonly bundlesExecuted: number;
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
  vote(wallet: WalletActor, vote: VotePlanItem): Promise<HiveWriteResult>;
  trade?(wallet: WalletActor, trade: TradingPlan["trades"][number]): Promise<HiveWriteResult>;
  tradeBundle?(wallet: WalletActor, bundle: TradingBundle): Promise<HiveWriteResult>;
  liquidity?(wallet: WalletActor, entry: TradingPlan["lp"][number]): Promise<HiveWriteResult>;
  savings?(wallet: WalletActor, entry: NonNullable<TradingPlan["savings"]>): Promise<HiveWriteResult>;
  incentive?(wallet: WalletActor, offer: IncentiveOffer, action: Exclude<IncentiveActionKind, "comment" | "post" | "delegate">): Promise<HiveWriteResult>;
  stake?(wallet: WalletActor, action: StakingAction): Promise<HiveWriteResult>;
  /** Native HIVE<->SWAP.HIVE peg move (see hiveEngineOps.mjs's wrapHive/
   *  unwrapHive) -- "wrap" is a plain Hive transfer to honey-swap, "unwrap"
   *  is a hivepegged.withdraw custom_json; both real, verified operations. */
  wrap?(wallet: WalletActor, action: WrapAction): Promise<HiveWriteResult>;
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
  { account: "essiebee", archetype: "gardener", feeds: ["gaming", "hive-140217"] },
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
      capSwapHiveMilli: numberOr(raw["capSwapHiveMilli"], numberOr(raw["capHiveMilli"], raw["tradingLive"] === true ? 5000 : 1000)),
      capHbdMilli: numberOr(raw["capHbdMilli"], raw["tradingLive"] === true ? 5000 : 1000),
      minLiquidHbdMilli: numberOr(raw["minLiquidHbdMilli"], raw["tradingLive"] === true ? 500 : 1000),
      // Curation authority is independent of trading admission.  The
      // one-vote signing boundary admits at most 50%, so configuration may
      // only make that limit stricter; it must never produce an impossible
      // or broader proposal merely because sidechain trading is enabled.
      maxVoteWeightBps: Math.max(100, Math.min(5000, Math.floor(numberOr(raw["maxVoteWeightBps"], 5000)))),
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
type AlphaRadarSignal = Readonly<Pick<AlphaRadar, "posts" | "mispricingEnergy" | "sinks">>;

function readAlphaRadarSignal(posts: readonly PostCandidate[]): AlphaRadarSignal {
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

  return Object.freeze({
    posts: posts.length,
    mispricingEnergy: Number(energy.toFixed(3)),
    sinks: Object.freeze(sinks),
  });
}

function alphaRadarFromSignal(signal: AlphaRadarSignal, components: number): AlphaRadar {
  return Object.freeze({
    kind: "aagaard.alpha-radar" as const,
    ...signal,
    components: Math.max(1, components),
    durable: components > 1,
  });
}

export function readAlphaRadar(posts: readonly PostCandidate[] = DEFAULT_POSTS): AlphaRadar {
  const signal = readAlphaRadarSignal(posts);
  const { nodes, edges } = attentionGraph(posts);
  return alphaRadarFromSignal(signal, readSpectral(nodes, edges).components);
}

export function readVotingIntelligence(posts: readonly PostCandidate[] = DEFAULT_POSTS, radar?: AlphaRadar, at?: string): VotingIntelligence {
  const signal = radar ?? readAlphaRadarSignal(posts);
  const sinkDeficits = new Map(signal.sinks.map((sink) => [sink.key, sink.deficit] as const));
  const composite = readVotingIntelligenceOf(posts, sinkDeficits, at !== undefined ? Date.parse(at) : undefined);
  return Object.freeze({
    kind: "aagaard.voting-intelligence" as const,
    spectral: Object.freeze({
      fiedler: composite.spectral.fiedler,
      lambdaMax: composite.spectral.lambdaMax,
      components: composite.spectral.components,
      decayHalfLife: composite.spectral.decayHalfLife,
      durable: composite.spectral.durable,
    }),
    curvature: Object.freeze({ bridges: composite.curvature.bridges }),
    cartels: Object.freeze({
      b1: composite.cartels.cycle.b1,
      cycleDensity: composite.cartels.cycle.cycleDensity,
      tightPairs: Object.freeze(composite.cartels.tightPairs.map((pair) => Object.freeze({ a: pair.a, b: pair.b, overlap: pair.coVotes }))),
    }),
    bridges: composite.bridges,
    posts: composite.posts,
  });
}

export function analyzeVotingField(posts: readonly PostCandidate[] = DEFAULT_POSTS, at = new Date().toISOString()): VotingFieldAnalysis {
  const signal = readAlphaRadarSignal(posts);
  const intelligence = readVotingIntelligence(posts, alphaRadarFromSignal(signal, 1), at);
  const radar = alphaRadarFromSignal(signal, intelligence.spectral.components);
  return Object.freeze({
    candidateFieldDigest: candidateFieldDigest(posts),
    radar,
    intelligence,
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

// Hive currently budgets fifty full-weight votes over one complete voting
// manabar regeneration: a 100% vote consumes 1/50 of the remaining mana.
// Work in dimensionless basis points and round down so admission never
// overstates the mana that will remain after the operation.
export function projectedVotingPowerAfterVoteBps(votingPowerBps: number, weightBps: number): number {
  if (!Number.isFinite(votingPowerBps) || !Number.isFinite(weightBps)) return 0;
  const current = Math.max(0, Math.min(10_000, Math.floor(votingPowerBps)));
  const weight = Math.max(0, Math.min(10_000, Math.floor(Math.abs(weightBps))));
  return Math.floor(current * (500_000 - weight) / 500_000);
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

export function planVotes(
  wallet: WalletActor,
  posts: readonly PostCandidate[] = DEFAULT_POSTS,
  at = new Date().toISOString(),
  state?: WalletChainState | null,
  fleetWallets: readonly WalletActor[] = [wallet],
  fieldAnalysis?: VotingFieldAnalysis,
): VotingPlan {
  const expectedFieldDigest = candidateFieldDigest(posts);
  if (fieldAnalysis && fieldAnalysis.candidateFieldDigest !== expectedFieldDigest) {
    throw new Error("voting field analysis does not match the candidate field");
  }
  const analysis = fieldAnalysis ?? analyzeVotingField(posts, at);
  const radar = analysis.radar;
  const intelligence = analysis.intelligence;
  const byKey = new Map(posts.map((post) => [postKey(post), post] as const));
  const scored = intelligence.posts
    .map((post) => ({ post, candidate: byKey.get(post.key), score: byKey.get(post.key) ? strategyScore(post, wallet, byKey.get(post.key)!) : 0 }))
    .filter((entry): entry is { post: VotingIntelligence["posts"][number]; candidate: PostCandidate; score: number } => entry.candidate !== undefined)
    .sort((left, right) => right.score - left.score);
  const currentMana = state?.currentMana ?? (wallet.account === "sigmund-vexler" ? "9200" : "8400");
  const maxMana = state?.maxMana ?? "10000";
  const currentManaNumber = Number(currentMana);
  const maxManaNumber = Number(maxMana);
  const votingPowerBps = Number.isFinite(currentManaNumber) && currentManaNumber >= 0 && Number.isFinite(maxManaNumber) && maxManaNumber > 0
    ? Math.max(0, Math.min(10000, Math.floor((currentManaNumber / maxManaNumber) * 10000)))
    : 0;
  const bar = average(scored.map((entry) => entry.score)) * wallet.strategy.conviction;
  const armCandidates: readonly StrategyArmCandidate[] = Object.freeze(scored.map((entry) => {
    const refusals: StrategyArmRefusal[] = [];
    const weightBps = Math.min(wallet.risk.maxVoteWeightBps, Math.max(100, entry.post.kirchhoffWeightBps));
    if (votingPowerBps < wallet.strategy.votingPowerFloorBps) refusals.push("mana-below-floor");
    if (projectedVotingPowerAfterVoteBps(votingPowerBps, weightBps) < wallet.strategy.votingPowerFloorBps) {
      refusals.push("post-vote-mana-below-floor");
    }
    if (!(entry.score > 0) || !Number.isFinite(entry.score)) refusals.push("non-positive-or-non-finite-signal");
    if (entry.score < bar) refusals.push("below-conviction");
    if (entry.post.likelyCartelTrail) refusals.push("likely-cartel-trail");
    if (entry.candidate.votes.some((vote) => vote.voter === wallet.account)) refusals.push("already-voted");
    return Object.freeze({
      key: entry.post.key,
      signal: entry.score,
      weightBps,
      refusals: Object.freeze(refusals),
    });
  }));
  const strategyId = curationStrategyIdentity(wallet).id;
  const phaseAccounts = fleetWallets
    .filter((peer) => curationStrategyIdentity(peer).id === strategyId)
    .map((peer) => peer.account);
  const strategyArm = readCurationStrategyArm({ wallet, posts, candidates: armCandidates, votingPowerBps, at, fleetAccounts: phaseAccounts });
  const scoredByKey = new Map(scored.map((entry) => [entry.post.key, entry] as const));
  const votes: VotePlanItem[] = strategyArm.selected.flatMap((key) => {
    const entry = scoredByKey.get(key);
    if (!entry) return [];
    return [Object.freeze({
      author: entry.candidate.author,
      permlink: entry.candidate.permlink,
      weightBps: Math.min(wallet.risk.maxVoteWeightBps, Math.max(100, entry.post.kirchhoffWeightBps)),
      strategyAlpha: Number(entry.score.toFixed(3)),
      sinkDeficit: entry.post.deficit,
      reason: `${wallet.strategy.archetype} admitted near-optimal signal ${entry.score.toFixed(2)} >= ${bar.toFixed(2)}`,
    })];
  });
  let waitReason = "";
  if (votingPowerBps < wallet.strategy.votingPowerFloorBps) {
    waitReason = `power ${votingPowerBps} below floor ${wallet.strategy.votingPowerFloorBps}`;
  } else if (scored.length === 0) {
    waitReason = "no candidate field";
  } else if (votes.length === 0) waitReason = `no candidate passed conviction and cartel gates; best signal ${scored[0]?.score.toFixed(2) ?? "0"}, bar ${bar.toFixed(2)}`;
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
    strategyArm,
    votes: Object.freeze(votes),
    decision: votes.length > 0 ? `${wallet.strategy.archetype} casts ${votes.length} vote(s)` : `${wallet.strategy.archetype} waits: ${waitReason}`,
    arena: arenaOf({ name: "voting", game: "curation reward allocation", actors: [wallet], moves, at }),
  });
}

export function readLiquidity(wallet: WalletActor, state?: WalletChainState | null, market?: WalletMarketState | null, internalMarket?: InternalMarketReading | null, flow: Readonly<Record<string, FlowReading>> = {}, allowSynthetic = true): LiquidityReading {
  const tokenState = state?.tokens ?? wallet.tokens;
  // Real internal HIVE/HBD market when available (condenser_api.get_ticker
  // + get_order_book); a hardcoded placeholder otherwise, retained only so a
  // caller with no network access still gets a shaped reading rather than a
  // missing venue -- this placeholder is NOT a real price and previously
  // masqueraded as one, producing double-digit-percent "corridors" against
  // real Hive-Engine quotes that were really just this mock being wrong.
  const real = internalMarket && internalMarket.midpoint > 0 ? internalMarket : null;
  const internalVenue = real ? Object.freeze({
        venue: "internal",
        pair: "HIVE/HBD",
        midpoint: real.midpoint,
        ...(real.bestBid !== undefined ? { bestBid: real.bestBid } : {}),
        ...(real.bestAsk !== undefined ? { bestAsk: real.bestAsk } : {}),
        ...(real.bestBidQuantityHive !== undefined ? { bestBidQuantity: real.bestBidQuantityHive } : {}),
        ...(real.bestAskQuantityHive !== undefined ? { bestAskQuantity: real.bestAskQuantityHive } : {}),
        bidDepth: real.bidDepth,
        askDepth: real.askDepth,
        relativeSpreadBps: real.relativeSpreadBps,
        imbalance: real.bidDepth + real.askDepth > 0 ? (real.bidDepth - real.askDepth) / (real.bidDepth + real.askDepth) : 0,
        thin: real.bidDepth + real.askDepth < 1000,
      }
    // No real reading available (offline/test): a shaped, clearly-mock
    // stand-in, exactly as fallbackEngineVenue below stands in for
    // Hive-Engine when that read is unavailable too -- never used when a
    // real reading exists.
  ) : allowSynthetic ? Object.freeze({ venue: "internal", pair: "HIVE/HBD", midpoint: wallet.tradingLive ? 0.31 : 0.3, bidDepth: 1200, askDepth: 980, relativeSpreadBps: 42, imbalance: 0.101, thin: false }) : null;
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
    ...(internalVenue ? [internalVenue] : []),
    ...(market?.venues.length ? market.venues : allowSynthetic ? [fallbackVenue] : []),
  ]);
  const pools = Object.freeze(market?.pools.length ? [...market.pools] : allowSynthetic ? [
    { pair: "DEC:SWAP.HIVE", impliedPrice: 0.0008, tvlQuote: tokenState["DEC"] ? 6400 : 1200, feeBps: 25 },
    { pair: "SIM:SWAP.HIVE", impliedPrice: 0.0002, tvlQuote: tokenState["SIM"] ? 2100 : 700, feeBps: 25 },
  ] : []);
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

const BUNDLE_SLIPPAGE_BPS = 50;

function refusedBundle(symbol: string, pool: string, edgeBps: number, reason: string): TradingBundle {
  return Object.freeze({
    id: `pool-book:${pool}:${symbol}`,
    kind: "pool-to-orderbook-round-trip" as const,
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
    marketObservedAt: null,
  });
}

/** Size the currently supported complete route from actual balance, pool
 * reserves, token precision, and top bid. The official marketpools
 * contract computes exact-output input as reserveIn*out/(reserveOut-out),
 * rounds input up and output down; this mirrors those semantics. */
function sizePoolToBookBundle(
  corridor: LiquidityReading["corridors"][number],
  liquidity: LiquidityReading,
  wallet: WalletActor,
  state: WalletChainState | null | undefined,
  precision: Readonly<Record<string, number>>,
  marketObservedAt?: string,
): TradingBundle {
  const poolLabel = corridor.cheapVenue.startsWith("pool:") ? corridor.cheapVenue.slice("pool:".length) : "";
  if (poolLabel === "" || corridor.richVenue.startsWith("pool:")) {
    return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "only pool-buy/orderbook-sell round trips are admitted");
  }
  const pool = liquidity.pools.find((entry) => entry.pair === poolLabel);
  const venue = liquidity.venues.find((entry) => entry.pair === `${corridor.symbol}/SWAP.HIVE` && entry.venue === corridor.richVenue);
  const tokenDecimals = precision[corridor.symbol];
  const hiveDecimals = precision["SWAP.HIVE"];
  if (!pool || !(pool.baseQuantity! > 0) || !(pool.quoteQuantity! > 0)
    || typeof pool.baseQuantityExact !== "string" || typeof pool.quoteQuantityExact !== "string") {
    return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "live pool reserves unavailable");
  }
  if (!venue || !venue.exactBook) {
    return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "lossless ordered bid-book evidence unavailable");
  }
  if (tokenDecimals === undefined || hiveDecimals === undefined || tokenDecimals < 0 || hiveDecimals < 0) {
    return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, "on-chain precision unavailable");
  }
  const [base, quote] = poolLabel.split(":");
  let reserveIn: string;
  let reserveOut: string;
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
    bidBookOrdered: venue.exactBook.bidOrdered,
  });
  if (!exact.admitted) return refusedBundle(corridor.symbol, poolLabel, corridor.netCorridorBps, exact.reason);
  const q = exact.quote;
  return Object.freeze({
    id: `pool-book:${poolLabel}:${corridor.symbol}`,
    kind: "pool-to-orderbook-round-trip" as const,
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
    marketObservedAt: marketObservedAt ?? venue.exactBook.observedAt,
  });
}

function sizeBookToPoolBundle(
  corridor: LiquidityReading["corridors"][number],
): TradingBundle {
  // A limit buy may fill only partially. Because Hive-Engine executes the
  // following pool swap regardless, an account's pre-existing token balance
  // could fund that second leg and leave the buy resting as additional risk.
  // This direction cannot be made contingent in one custom_json and is not an
  // admitted live bundle.
  return refusedBundle(corridor.symbol, corridor.richVenue.replace(/^pool:/, ""), corridor.netCorridorBps, "order-book acquisition cannot condition the pool exit on a complete first-leg fill");
}

function sizeCorridorBundle(
  corridor: LiquidityReading["corridors"][number],
  liquidity: LiquidityReading,
  wallet: WalletActor,
  state: WalletChainState | null | undefined,
  precision: Readonly<Record<string, number>>,
  marketObservedAt?: string,
): TradingBundle {
  return corridor.cheapVenue.startsWith("pool:")
    ? sizePoolToBookBundle(corridor, liquidity, wallet, state, precision, marketObservedAt)
    : sizeBookToPoolBundle(corridor);
}

function applyMakerSelfCrossGuard(bundle: TradingBundle, account: string, scan: MakerOrderScan): TradingBundle {
  if (!bundle.executable) return bundle;
  const side = bundle.kind === "pool-to-orderbook-round-trip" ? "sell" as const : "buy" as const;
  const priceSwapHivePerToken = side === "sell" ? bundle.limitSellPriceSwapHive : bundle.limitBuyPriceSwapHive;
  const selfCrossGuard = guardFleetSelfCross({ account, symbol: bundle.symbol, side, priceSwapHivePerToken }, scan);
  if (selfCrossGuard.admitted) return Object.freeze({ ...bundle, selfCrossGuard });
  // Coverage failure does not erase the observed market opportunity or its
  // counterfactual allocation. It does make live execution ineligible; the
  // armed execution gate below enforces that independently. A known conflict
  // or invalid limit is intrinsic to this proposed leg and is removed before
  // the allocator sees it.
  if (selfCrossGuard.reason === "fleet-order-reading-unavailable") return Object.freeze({ ...bundle, selfCrossGuard });
  return Object.freeze({
    ...bundle,
    executable: false,
    funded: false,
    refusalReason: `maker self-cross safety refusal: ${selfCrossGuard.detail}`,
    selfCrossGuard,
  });
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
function cycleDepthProxy(cycle: ArbitrageCycle, liquidity: LiquidityReading): number {
  const depths = cycle.venues.map((label) => {
    if (label.startsWith("pool:")) {
      const pair = label.slice("pool:".length);
      return liquidity.pools.find((pool) => pool.pair === pair)?.tvlQuote ?? 0;
    }
    const venue = liquidity.venues.find((entry) => entry.venue === label);
    return venue ? venue.bidDepth + venue.askDepth : 0;
  }).filter((depth) => depth > 0);
  if (depths.length === 0) return 0;
  return Math.min(...depths);
}

export function planTrades(wallet: WalletActor, at = new Date().toISOString(), state?: WalletChainState | null, market?: WalletMarketState | null, internalMarket?: InternalMarketReading | null, flow: Readonly<Record<string, FlowReading>> = {}, allowSynthetic = true, makerOrderScan?: MakerOrderScan): TradingPlan {
  const liquidity = readLiquidity(wallet, state, market, internalMarket, flow, allowSynthetic);
  // A sanity ceiling, not just a floor: this fleet has twice now found a
  // "real" divergence in the tens-of-thousands-of-percent range that
  // turned out to be a data-quality artifact (a one-sided venue, then a
  // pool compared in the wrong currency), not real market volatility.
  // Anything claiming more than 50% in a single tick is far more likely to
  // be a third such artifact than genuinely capturable edge, so it is
  // dropped rather than sized and traded.
  const MAX_SANE_EDGE_BPS = 5000;
  // Holonomy remains the opportunity detector, but an N-hop observation is
  // not an execution plan. No individual cycle leg is emitted or funded.
  const arbitrageCycles = readHolonomy(liquidity, { minNetHolonomyBps: 50, limit: 5 });
  const tickBudgetSwapHive = wallet.risk.capSwapHiveMilli / 1000;
  const cycleCapacities = Object.freeze(arbitrageCycles.map((cycle) => catabolicCapacity(cycle.netHolonomyBps, cycleDepthProxy(cycle, liquidity), tickBudgetSwapHive)));
  const sizedBundles = liquidity.corridors
    .filter((corridor) => corridor.netCorridorBps > 100 && corridor.netCorridorBps <= MAX_SANE_EDGE_BPS)
    .map((corridor) => sizeCorridorBundle(corridor, liquidity, wallet, state, market?.precision ?? {}, market?.observedAt));
  // A supplied scan means this plan can be considered for live execution:
  // each order-book leg is checked before it becomes an allocator candidate.
  // An omitted scan leaves a useful offline analysis plan, but executeTrading
  // independently refuses it if a caller later tries to arm it.
  const draftBundles = Object.freeze(makerOrderScan
    ? sizedBundles.map((bundle) => applyMakerSelfCrossGuard(bundle, wallet.account, makerOrderScan))
    : sizedBundles);
  // The allocator sees one candidate per complete round trip. Its cost and
  // benefit are bounded capital and worst-case bundle profit in SWAP.HIVE,
  // not the same cycle edge copied onto each leg and not a guessed HBD mark.
  const candidates: AllocationCandidate[] = draftBundles
    .filter((bundle) => bundle.executable)
    .map((bundle) => Object.freeze({
      id: bundle.id,
      cost: bundle.capitalSwapHive,
      benefit: Number(bundle.worstCaseProfitSwapHive),
    }));
  const allocation = allocateBudget(candidates, tickBudgetSwapHive);
  const fundedIds = new Set(allocation.funded);
  const bundles = Object.freeze(draftBundles.map((bundle) => Object.freeze({ ...bundle, funded: bundle.executable && fundedIds.has(bundle.id) })));
  // Standalone trade intents are intentionally empty: every detected
  // arbitrage path must graduate into a complete bundle before execution.
  const trades = Object.freeze([]) as TradingPlan["trades"];
  // Pool TVL alone does not prove this account owns an LP position, and an
  // account name does not prove a fixed savings amount is available. Keep
  // these lanes empty until position/balance-specific planners exist.
  const lp = Object.freeze([]) as TradingPlan["lp"];
  const savings = null;
  const moves = [
    ...bundles.map((bundle) => Object.freeze({
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
        selfCrossRefusal: bundle.selfCrossGuard && !bundle.selfCrossGuard.admitted ? bundle.selfCrossGuard.reason : null,
      },
      charge: bundle.funded ? "active" as const : "potential" as const,
      reason: bundle.refusalReason ?? `bounded ${bundle.pool} -> order-book round trip`,
    })),
  ];
  return Object.freeze({
    account: wallet.account,
    hive: state?.hive ?? (wallet.account === "sigmund-vexler" ? "12.000 HIVE" : "1.000 HIVE"),
    hbd: state?.hbd ?? (wallet.account === "help-fund" ? "8.000 HBD" : "1.000 HBD"),
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
  if (symbol === "HIVE") return liquidity.venues.find((venue) => venue.pair === "HIVE/HBD")?.midpoint ?? 0;
  if (symbol === "SWAP.HIVE") return 0;
  const hivePrice = liquidity.venues.find((venue) => venue.pair === "HIVE/HBD")?.midpoint ?? 0;
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
  // Configured token hints are strategy inputs, not custody evidence. Game
  // detection therefore requires one explicit observed/merged chain state;
  // a missing read yields no game proposal instead of reviving seed data.
  const tokenState: Readonly<Record<string, string>> = state?.tokens ?? Object.freeze({});
  const signatures = [
    { game: "Splinterlands", tokens: ["DEC", "SPS", "SPSP", "VOUCHER"], customJsonId: "sm_", proposedMove: "claim daily quest / start ranked" },
    { game: "Rising Star", tokens: ["STARBITS", "STARPRO"], customJsonId: "server-session-no-custom-json", proposedMove: "manual-only inventory/recovery review while current terms prohibit bots and multiple accounts" },
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
    dataDir: path.join(root, "data"),
  };
  mkdirSync(store.dataDir, { recursive: true });
  return Object.freeze(store);
}

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
const FLEET_TICK_CATEGORY = "aagaard.fleet-tick";
const LOCKED_DRAFT_CATEGORY = "aagaard.locked-draft";
const SUBSTRATE_CATEGORY = "aagaard.substrate-snapshot";
const INCENTIVE_CATEGORY = "aagaard.incentive-nomination-event";

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

async function recordsOf<T>(store: StateStore, category: string): readonly T[] {
  return await querySettlementRecords(category) as readonly T[];
}

async function recordOwned(store: StateStore, category: string, recordedAt: string, record: unknown): Promise<void> {
  await recordSettlementRecord({
    agentUrl: rwilAgent(),
    root: store.dataDir,
    nodeId: "aagaard",
    settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR,
    category,
    recordedAt,
    record,
  });
}

export async function recordFleetTick(store: StateStore, readout: FleetTickReadout): Promise<void> {
  await recordOwned(store, FLEET_TICK_CATEGORY, readout.ts, readout);
}

export function readLastReadout(store: StateStore): FleetTickReadout | null {
  return readFleetTicks(store, 1).at(-1) ?? null;
}

export function readFleetTicks(store: StateStore, limit: number): readonly FleetTickReadout[] {
  return [...recordsOf<FleetTickReadout>(store, FLEET_TICK_CATEGORY)].sort((left, right) => left.ts.localeCompare(right.ts)).slice(-limit);
}

export function readLockedDrafts(store: StateStore, account?: string): readonly LockedDraft[] {
  const drafts = recordsOf<LockedDraft>(store, LOCKED_DRAFT_CATEGORY)
    .filter((row) => isRecord(row) && typeof row["id"] === "string" && typeof row["account"] === "string");
  return Object.freeze(drafts.filter((draft) => account === undefined || draft.account === account));
}

export async function recordLockedDrafts(store: StateStore, drafts: readonly LockedDraft[]): Promise<readonly LockedDraft[]> {
  if (drafts.length === 0) return Object.freeze([]);
  const prior = new Map(readLockedDrafts(store).map((draft) => [draft.id, draft] as const));
  const recorded: LockedDraft[] = [];
  for (const draft of drafts) {
    if (prior.has(draft.id)) continue;
    prior.set(draft.id, draft);
    recorded.push(draft);
  }
  if (recorded.length > 0) {
    await Promise.all(recorded.map((draft) => recordOwned(store, LOCKED_DRAFT_CATEGORY, draft.composedAt, draft)));
  }
  return Object.freeze(recorded);
}

export async function recordSubstrateSnapshot(store: StateStore, snapshot: TickSubstrateSnapshot): Promise<void> {
  await recordOwned(store, SUBSTRATE_CATEGORY, snapshot.ts, snapshot);
}

export function readSubstrateSnapshots(store: StateStore, limit: number): readonly TickSubstrateSnapshot[] {
  return [...recordsOf<TickSubstrateSnapshot>(store, SUBSTRATE_CATEGORY)].sort((left, right) => left.ts.localeCompare(right.ts)).slice(-limit);
}

export function listIncentiveNominations(store: StateStore): readonly IncentiveNominationRecord[] {
  const current = new Map<string, IncentiveNominationRecord>();
  const events = recordsOf<{ readonly event: "nominated" | "dispositioned"; readonly record: IncentiveNominationRecord }>(store, INCENTIVE_CATEGORY);
  for (const event of events) current.set(event.record.offerId, event.record);
  return Object.freeze([...current.values()].sort((left, right) => left.firstSeen.localeCompare(right.firstSeen)));
}

export async function recordIncentiveNominations(store: StateStore, plan: IncentivePlan, at = new Date().toISOString()): Promise<readonly IncentiveNominationRecord[]> {
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
    await Promise.all(recorded.map((record) => recordOwned(store, INCENTIVE_CATEGORY, at, { event: "nominated", record })));
  }
  return Object.freeze(recorded);
}

export async function dispositionIncentiveNomination(store: StateStore, offerId: string, choice: IncentiveDispositionChoice, at = new Date().toISOString()): Promise<IncentiveNominationRecord | null> {
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
  if (draft) await recordLockedDrafts(store, [draft]);
  await recordOwned(store, INCENTIVE_CATEGORY, at, { event: "dispositioned", choice, record: updated });
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
      evidence: ["/ops/incentives", "/ops/incentives/:offerId/:choice", "data/rmn", "data/rwil"],
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
      replacement: "typed RMN fleet ticks, substrate snapshots, nominations, drafts, and RWIL/RDF projections",
      status: "exceeded",
      evidence: ["data/rmn", "data/rwil", "@lenticule-science/rwil-rdf-projection-service"],
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

export type TradingAuthorizationProvider = (
  wallet: WalletActor,
  plan: TradingPlan,
  nowMs: number,
) => EnterpriseTradingAuthorization | undefined | Promise<EnterpriseTradingAuthorization | undefined>;

async function readField(hive: HiveReadBoundary | undefined, wallet: WalletActor, allowSynthetic: boolean): Promise<readonly PostCandidate[]> {
  if (!hive) return allowSynthetic ? DEFAULT_POSTS : Object.freeze([]);
  try {
    return await hive.readCandidateField(wallet);
  } catch {
    return Object.freeze([]);
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

async function readCurationRewards(hive: HiveReadBoundary | undefined, wallet: WalletActor): Promise<CurationRewardScan | null> {
  if (!hive?.readCurationRewards) return null;
  try {
    return await hive.readCurationRewards(wallet);
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

function unavailableMakerOrderScan(accounts: readonly string[], observedAt: string, limitation: string): MakerOrderScan {
  const requested = Object.freeze([...new Set(accounts.map((account) => account.toLowerCase()))].sort());
  return Object.freeze({
    kind: "aagaard.maker-order-scan" as const,
    observedAt,
    source: "hive-engine.market.buyBook+sellBook" as const,
    accountsRequested: requested,
    accountsObserved: Object.freeze([]),
    complete: false,
    orders: Object.freeze([]),
    limitations: Object.freeze([limitation]),
  });
}

async function readFleetMakerOrders(market: MarketReadBoundary | undefined, accounts: readonly string[], observedAt: string): Promise<MakerOrderScan> {
  if (!market?.readFleetOpenOrders) return unavailableMakerOrderScan(accounts, observedAt, "market boundary supplies no fleet open-order reader");
  try {
    const scan = await market.readFleetOpenOrders(accounts, observedAt);
    const expected = [...new Set(accounts.map((account) => account.toLowerCase()))].sort();
    const requested = new Set(scan.accountsRequested);
    const observed = new Set(scan.accountsObserved);
    const coversFleet = expected.every((account) => requested.has(account) && observed.has(account))
      && scan.orders.every((order) => requested.has(order.account));
    if (scan.complete && coversFleet) return scan;
    return Object.freeze({
      ...scan,
      complete: false,
      limitations: Object.freeze([
        ...scan.limitations,
        ...(coversFleet ? [] : ["open-order reading does not cover every configured fleet account"]),
      ]),
    });
  } catch (error) {
    return unavailableMakerOrderScan(accounts, observedAt, `fleet open-order read unavailable: ${error instanceof Error ? error.message : String(error)}`);
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

export function mergeWalletState(wallet: WalletActor, state: WalletChainState | null, market: WalletMarketState | null, allowSynthetic = true): WalletChainState {
  return Object.freeze({
    account: state?.account ?? wallet.account,
    hive: state?.hive ?? (allowSynthetic ? (wallet.account === "sigmund-vexler" ? "12.000 HIVE" : "1.000 HIVE") : "0.000 HIVE"),
    hbd: state?.hbd ?? (allowSynthetic ? (wallet.account === "help-fund" ? "8.000 HBD" : "1.000 HBD") : "0.000 HBD"),
    currentMana: state?.currentMana ?? (allowSynthetic ? (wallet.account === "sigmund-vexler" ? "9200" : "8400") : "0"),
    maxMana: state?.maxMana ?? (allowSynthetic ? "10000" : "0"),
    tokens: Object.freeze({ ...(allowSynthetic ? wallet.tokens : {}), ...(state?.tokens ?? {}), ...(market?.tokens ?? {}) }),
  });
}

export function walletKeyStatus(keyRoot: string, account: string): WalletKeyStatus {
  return Object.freeze({
    posting: existsSync(path.join(keyRoot, account, "posting.wif")),
    active: existsSync(path.join(keyRoot, account, "active.wif")),
  });
}

function receipt(input: Omit<ExecutionReceipt, "txId" | "economicEffect" | "error"> & { readonly txId?: string; readonly economicEffect?: EconomicEffectEvidence; readonly error?: string }): ExecutionReceipt {
  return Object.freeze({
    lane: input.lane,
    action: input.action,
    target: input.target,
    status: input.status,
    role: input.role,
    ...(input.txId ? { txId: input.txId } : {}),
    ...(input.economicEffect ? { economicEffect: Object.freeze({ ...input.economicEffect }) } : {}),
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

function canonicalAuthorizationValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorizationValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalAuthorizationValue(record[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("enterprise plan digest cannot encode undefined");
  return encoded;
}

/** Digest only the active-capital portion of a plan. Observational readings
 * cannot change what an AGRODAO authorization permits, while any funded leg,
 * quantity, bound, LP move, or savings move changes the digest. */
export function enterpriseTradingPlanDigest(plan: TradingPlan): string {
  const authorizedPlan = {
    account: plan.account,
    trades: plan.trades.filter((entry) => entry.funded),
    bundles: plan.bundles.filter((entry) => entry.funded),
    lp: plan.lp,
    savings: plan.savings,
  };
  return `sha256:${createHash("sha256").update(canonicalAuthorizationValue(authorizedPlan)).digest("hex")}`;
}

function enterpriseAuthorizationRefusal(
  wallet: WalletActor,
  plan: TradingPlan,
  action: "trade" | "trade-bundle" | "lp" | "savings",
  authorization: EnterpriseTradingAuthorization | undefined,
  nowMs: number,
): string | null {
  if (!authorization) return "no AGRODAO enterprise execution authorization; direct Aagaard/CEO capital operation retired";
  if (authorization.kind !== "agrodao.hive-enterprise-execution-authorization.v1" || authorization.consumer !== "urn:ame:aagaard") {
    return "authorization is not the AGRODAO-to-Aagaard execution contract";
  }
  if (authorization.account !== wallet.account || plan.account !== wallet.account) return "authorization account does not match the wallet plan";
  if (!/^sha256:[0-9a-f]{64}$/u.test(authorization.decisionId)
      || !/^(?:urn:|ni:\/\/\/sha-256;)/u.test(authorization.observationId)) {
    return "authorization is not bound to a capital decision and inventory observation";
  }
  const validFrom = Date.parse(authorization.validFrom);
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(validFrom) || !Number.isFinite(expiresAt) || validFrom > nowMs || expiresAt <= nowMs
      || expiresAt - validFrom > 5 * 60_000) {
    return "enterprise execution authorization is absent, future-dated, expired, or longer than five minutes";
  }
  if (authorization.planDigest !== enterpriseTradingPlanDigest(plan)) return "authorization plan digest does not match the exact active-capital plan";

  if (authorization.issuer === "urn:ame:sigmund-hive-arbitrage-enterprise" && authorization.lane === "arbitrage") {
    if (action !== "trade" && action !== "trade-bundle") return "Sigmund arbitrage authorization cannot provide liquidity or move savings";
  } else if (wallet.account === "help-fund") {
    if (authorization.issuer !== "urn:ame:help-hive-liquidity-enterprise" || authorization.lane !== "liquidity") {
      return "help-fund pool work requires the HELP liquidity enterprise";
    }
    if (action !== "lp") return "HELP liquidity authorization cannot trade or move savings";
    if (!authorization.releaseId || !/^sha256:[0-9a-f]{64}$/u.test(authorization.releaseId)) {
      return "HELP liquidity authorization has no exact Sigmund surplus release";
    }
  } else return `authorization issuer and lane do not commission capital work for account '${wallet.account}'`;
  if (!authorization.actions.includes(action as "trade" | "trade-bundle" | "lp")) return `authorization does not admit action '${action}'`;
  return null;
}

export async function executeTrading(
  wallet: WalletActor,
  plan: TradingPlan,
  armed: boolean,
  keys: WalletKeyStatus,
  writer?: HiveWriteBoundary,
  nowMs = Date.now(),
  authorization?: EnterpriseTradingAuthorization,
): Promise<TradingExecution> {
  const receipts: ExecutionReceipt[] = [];
  const mode: ExecutionMode = !armed ? "dry-run" : plan.liveEligible && keys.active && writer && authorization ? "live" : "propose-only";
  let tradesExecuted = 0;
  let bundlesExecuted = 0;
  let lpExecuted = 0;
  let savingsExecuted = false;

  async function recordActive(action: string, target: string, call: (() => Promise<HiveWriteResult>) | undefined): Promise<void> {
    if (!armed) {
      receipts.push(receipt({ lane: "trading", action, target, status: "dry-run", role: "active" }));
      return;
    }
    const authorizationError = enterpriseAuthorizationRefusal(wallet, plan, action as "trade" | "trade-bundle" | "lp" | "savings", authorization, nowMs);
    if (authorizationError) {
      receipts.push(receipt({ lane: "trading", action, target, status: "propose-only", role: "active", error: authorizationError }));
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
      const economicEffect = result.economicEffect ?? Object.freeze({
        status: "unverified" as const,
        source: "outer-chain-broadcast-only",
        reference: result.id,
      });
      receipts.push(receipt({ lane: "trading", action, target, status: "broadcast", role: "active", txId: result.id, economicEffect }));
      if (economicEffect.status === "confirmed") {
        if (action === "trade") tradesExecuted += 1;
        if (action === "trade-bundle") {
          bundlesExecuted += 1;
          tradesExecuted += 2;
        }
        if (action === "lp") lpExecuted += 1;
        if (action === "savings") savingsExecuted = true;
      }
    } catch (error) {
      receipts.push(receipt({ lane: "trading", action, target, status: "error", role: "active", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  for (const bundle of plan.bundles) {
    if (!bundle.executable) {
      receipts.push(receipt({ lane: "trading", action: "trade-bundle", target: bundle.id, status: "skipped", role: "active", error: bundle.refusalReason ?? "bundle is not executable" }));
      continue;
    }
    if (!bundle.funded) {
      receipts.push(receipt({ lane: "trading", action: "trade-bundle", target: bundle.id, status: "skipped", role: "active", error: "not selected by this tick's bundle allocator" }));
      continue;
    }
    if (armed) {
      const observedMs = bundle.marketObservedAt === null ? Number.NaN : Date.parse(bundle.marketObservedAt);
      const ageMs = nowMs - observedMs;
      if (!Number.isFinite(observedMs) || ageMs < 0 || ageMs > 30_000) {
        receipts.push(receipt({
          lane: "trading",
          action: "trade-bundle",
          target: bundle.id,
          status: "skipped",
          role: "active",
          error: "market evidence is absent, future-dated, or older than 30 seconds",
        }));
        continue;
      }
    }
    const selfCrossGuard = bundle.selfCrossGuard;
    if (armed && plan.liveEligible && selfCrossGuard?.admitted !== true) {
      receipts.push(receipt({
        lane: "trading",
        action: "trade-bundle",
        target: bundle.id,
        status: "skipped",
        role: "active",
        error: selfCrossGuard && !selfCrossGuard.admitted
          ? `maker self-cross safety refusal: ${selfCrossGuard.detail}`
          : "maker self-cross safety refusal: no admitted fleet-wide open-order reading",
      }));
      continue;
    }
    if (armed && plan.liveEligible) {
      const orderScanMs = Date.parse(selfCrossGuard!.observedAt!);
      const orderScanAgeMs = nowMs - orderScanMs;
      if (!Number.isFinite(orderScanMs) || orderScanAgeMs < 0 || orderScanAgeMs > 30_000) {
        receipts.push(receipt({
          lane: "trading",
          action: "trade-bundle",
          target: bundle.id,
          status: "skipped",
          role: "active",
          error: "fleet open-order evidence is future-dated or older than 30 seconds",
        }));
        continue;
      }
    }
    await recordActive("trade-bundle", bundle.id, writer?.tradeBundle ? () => writer.tradeBundle!(wallet, bundle) : undefined);
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

  return Object.freeze({ mode, tradesExecuted, bundlesExecuted, lpExecuted, savingsExecuted, receipts: Object.freeze(receipts) });
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

interface WalletTickResult {
  readonly readout: AccountTickReadout;
  readonly curationPredictions: readonly CurationPredictionEvent[];
  readonly curationSettlements: readonly CurationSettlementEvent[];
}

async function tickWallet(
  store: StateStore,
  control: ControlPlane,
  wallet: WalletActor,
  posts: readonly PostCandidate[],
  fleetWallets: readonly WalletActor[],
  fieldAnalysis: VotingFieldAnalysis | undefined,
  at: string,
  hive: HiveReadBoundary | undefined,
  marketBoundary: MarketReadBoundary | undefined,
  makerOrderScan: MakerOrderScan | null,
  keyRoot: string,
  writer: HiveWriteBoundary | undefined,
  allowSynthetic: boolean,
  now: () => number,
  authorizeTrading: TradingAuthorizationProvider | undefined,
): Promise<WalletTickResult> {
  const arenas: WalletArena[] = [];
  let voting: AccountTickReadout["voting"] | undefined;
  let trading: AccountTickReadout["trading"] | undefined;
  let incentive: AccountTickReadout["incentive"] | undefined;
  let curationPredictions: readonly CurationPredictionEvent[] = Object.freeze([]);
  let curationSettlements: readonly CurationSettlementEvent[] = Object.freeze([]);
  let votingPlan: VotingPlan | null = null;
  let incentivePlan: IncentivePlan | null = null;
  const [chainState, curationScan] = await Promise.all([
    readState(hive, wallet),
    readCurationRewards(hive, wallet),
  ]);
  if (curationScan) curationSettlements = await recordCurationSettlements(store.dataDir, curationScan, at);
  const market = await readMarket(marketBoundary, wallet, chainState);
  const internalMarket = await readInternalMarket(hive);
  const flow = market && marketBoundary?.readTradeFlow
    ? await marketBoundary.readTradeFlow([...new Set(market.venues.map((venue) => venue.pair.split("/")[0]).filter((symbol): symbol is string => symbol !== undefined && symbol !== "SWAP.HIVE"))]).catch(() => ({}))
    : {};
  const state = mergeWalletState(wallet, chainState, market, allowSynthetic);
  const keys = walletKeyStatus(keyRoot, wallet.account);

  if (control.isEnabled("voting")) {
    const plan = planVotes(wallet, posts, at, state, fleetWallets, fieldAnalysis);
    votingPlan = plan;
    await recordCurationStrategyArm(store.dataDir, plan.strategyArm);
    arenas.push(plan.arena);
    const execution = await executeVotes(wallet, plan, control.live && control.isEnabled("voting"), keys, writer);
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
      strategyArm: Object.freeze({
        candidateFieldDigest: plan.strategyArm.candidateField.digest,
        strategyId: plan.strategyArm.strategy.id,
        archetype: plan.strategyArm.strategy.archetype,
        objectiveDigest: plan.strategyArm.strategy.objectiveDigest,
        exact: plan.strategyArm.exploration.exact,
        alternativeCount: plan.strategyArm.exploration.alternativeCount,
        choiceBits: plan.strategyArm.exploration.choiceBits,
        deterministicAccountPhase: plan.strategyArm.exploration.deterministicAccountPhase,
        selected: plan.strategyArm.selected,
      }),
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

  const tradingPlan = planTrades(wallet, at, state, market, internalMarket, flow, allowSynthetic, makerOrderScan ?? undefined);
  if (control.isEnabled("trading")) {
    arenas.push(tradingPlan.arena);
    const executionNow = now();
    const authorization = authorizeTrading ? await authorizeTrading(wallet, tradingPlan, executionNow) : undefined;
    const execution = await executeTrading(wallet, tradingPlan, control.live && control.isEnabled("trading"), keys, writer, executionNow, authorization);
    trading = {
      mode: execution.mode,
      hive: tradingPlan.hive,
      hbd: tradingPlan.hbd,
      tradesPlanned: tradingPlan.trades.length + tradingPlan.bundles.filter((bundle) => bundle.executable).length * 2,
      tradesExecuted: execution.tradesExecuted,
      bundlesPlanned: tradingPlan.bundles.filter((bundle) => bundle.executable).length,
      bundlesFunded: tradingPlan.bundles.filter((bundle) => bundle.funded).length,
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
        limitations: makerOrderScan?.limitations ?? Object.freeze(["maker-order scan was not run"]),
      }),
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
    await recordIncentiveNominations(store, plan, at);
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

  await recordScoreboardTick(
    store.dataDir,
    wallet.account,
    state,
    tradingPlan.liquidity,
    votingPlan,
    tradingPlan,
    trading?.execution ?? null,
    voting?.votesBroadcast ?? 0,
    at,
    chainState !== null && market !== null && market.availability?.balances !== false && internalMarket !== null,
  );

  const drafts = composeDailyDrafts({ wallet, voting: votingPlan, trading: tradingPlan, incentive: incentivePlan, at });
  await recordLockedDrafts(store, drafts);
  await recordSubstrateSnapshot(store, Object.freeze({
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
  const curation = readCurationTelemetry(store.dataDir, wallet.account, curationScan ? "available" : hive?.readCurationRewards ? "unavailable" : "not-run");

  const readout: AccountTickReadout = Object.freeze({
    account: wallet.account,
    curation,
    ...(voting ? { voting } : {}),
    ...(trading ? { trading } : {}),
    ...(incentive ? { incentive } : {}),
    ...(staking ? { staking } : {}),
    ...(wrap ? { wrap } : {}),
    posting: Object.freeze({ draftsPrepared: drafts.length, locked: true as const }),
    gaming: Object.freeze({ gamesDetected: gamingPlan.games.length, games: Object.freeze(gamingPlan.games.map((game) => game.game)), locked: true as const }),
    arenas: Object.freeze(arenas),
  });
  return Object.freeze({ readout, curationPredictions, curationSettlements });
}

export function createAagaardRuntime(config: AagaardConfig, store: StateStore, options: { readonly hive?: HiveReadBoundary; readonly market?: MarketReadBoundary; readonly writer?: HiveWriteBoundary; readonly authorizeTrading?: TradingAuthorizationProvider; readonly allowSynthetic?: boolean; readonly now?: () => number } = {}): AagaardRuntime {
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
        const allowSynthetic = options.allowSynthetic === true
          || (options.hive === undefined && options.market === undefined && options.writer === undefined);
        // A tick's curation experiment uses one union of every configured
        // wallet's admitted feed reads.  Feed membership remains a strategy
        // emphasis, while every arm is now comparable against the same exact
        // candidate-field digest.
        const fieldBatches = await Promise.all(config.wallets.map((wallet) => readField(options.hive, wallet, allowSynthetic)));
        const commonFieldByKey = new Map<string, PostCandidate>();
        for (const post of fieldBatches.flat()) commonFieldByKey.set(postKey(post), post);
        const commonField = Object.freeze([...commonFieldByKey.values()].sort((left, right) => postKey(left).localeCompare(postKey(right))));
        const fieldAnalysis = control.isEnabled("voting") ? analyzeVotingField(commonField, at) : undefined;
        const makerOrderScan = control.isEnabled("trading")
          ? await readFleetMakerOrders(options.market, config.wallets.map((wallet) => wallet.account), at)
          : null;
        if (makerOrderScan) await recordMakerOrderScan(store.dataDir, makerOrderScan);
        const walletTicks = await Promise.all(config.wallets.map((wallet) => tickWallet(
          store,
          control,
          wallet,
          commonField,
          config.wallets,
          fieldAnalysis,
          at,
          options.hive,
          options.market,
          makerOrderScan,
          config.keyRoot,
          options.writer,
          allowSynthetic,
          options.now ?? Date.now,
          options.authorizeTrading,
        )));
        const accounts = Object.freeze(walletTicks.map((tick) => tick.readout));
        let dervish: DervishTrialSummary | null = null;
        let dervishRoster: ReturnType<typeof makeSixWalletRoster> | null = null;
        try {
          dervishRoster = makeSixWalletRoster(config.wallets.map((wallet) => wallet.account));
        } catch (error) {
          if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
        }
        if (dervishRoster) {
          const coordinate = readDervishScheduleStep(nextDervishGlobalStep(store.dataDir), dervishRoster);
          const selected = walletTicks.find((tick) => tick.readout.account === coordinate.account);
          if (selected) {
            const observation = buildDervishTrialObservation({
              coordinate,
              observedAt: at,
              votingReceipts: selected.readout.voting?.execution.receipts ?? Object.freeze([]),
              curationPredictions: selected.curationPredictions,
              curationSettlements: selected.curationSettlements,
              tradingReceipts: selected.readout.trading?.execution.receipts ?? Object.freeze([]),
            });
            await recordDervishTrialObservation(store.dataDir, observation);
            dervish = summarizeDervishTrial(observation);
          }
        }
        const witnesses = accounts.flatMap((account) => account.arenas.flatMap((arena) => arena.witnesses));
        const info = witnessLogInformation(witnesses);
        const readout = Object.freeze({
          kind: "aagaard.fleet-tick" as const,
          ts: at,
          running: control.running,
          live: control.live,
          enabled: control.enabledList(),
          accounts,
          dervish,
          witness: Object.freeze({
            rows: info.rows,
            uniqueWitnesses: info.uniqueWitnesses,
            duplicateWitnesses: info.duplicateWitnesses,
          }),
        });
        await recordFleetTick(store, readout);
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
    dervish: readout.dervish === null ? null : {
      trialId: readout.dervish.trialId,
      globalStep: readout.dervish.globalStep,
      cycle: readout.dervish.cycle,
      boundaryStep: readout.dervish.boundaryStep,
      site: readout.dervish.site,
      lens: readout.dervish.lens,
      phase: readout.dervish.phase,
      account: readout.dervish.account,
    },
    accounts: readout.accounts.map((account) => ({
      account: account.account,
      arenas: account.arenas.map((arena) => ({ name: arena.name, witnesses: arena.witnesses.length })),
    })),
  });
}
