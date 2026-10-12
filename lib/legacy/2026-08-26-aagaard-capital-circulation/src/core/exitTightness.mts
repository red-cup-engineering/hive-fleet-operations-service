import { createHash } from "node:crypto";

export const EXIT_TIGHTNESS_SCHEMA = "aagaard.hive-engine-exit-tightness.v1" as const;

export type FourKnowledge = "true" | "false" | "both" | "neither";

export interface ExitBidLevel {
  readonly price: string;
  readonly quantity: string;
  readonly orderId: string;
}

export interface ExitPositionState {
  readonly symbol: string;
  readonly precision: number;
  readonly liquid: string;
  readonly stake: string;
  readonly delegationsOut: string;
  readonly pendingUnstake: string;
  readonly pendingUndelegations: string;
  readonly stakingEnabled: boolean;
  readonly delegationEnabled: boolean;
  readonly unstakingCooldownDays: number | null;
  readonly undelegationCooldownDays: number | null;
  readonly releaseTransactions: number | null;
  readonly bidBookComplete: boolean;
  readonly bids: readonly ExitBidLevel[];
}

export type ExitProviderObservation = Readonly<{
  provider: string;
  observedAt: string;
  status: "available";
  state: ExitPositionState;
}> | Readonly<{
  provider: string;
  observedAt: string;
  status: "unavailable";
  problem: string;
}>;

function decimalUnits(value: string, precision: number, label: string): bigint {
  if (!Number.isInteger(precision) || precision < 0 || precision > 12) throw new TypeError(`${label} precision is out of range`);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u.exec(value);
  if (!match || (match[2]?.length ?? 0) > precision) throw new TypeError(`${label} is not a canonical nonnegative decimal`);
  return BigInt(match[1]!) * 10n ** BigInt(precision) + BigInt((match[2] ?? "").padEnd(precision, "0"));
}

function decimalText(value: bigint, precision: number): string {
  const scale = 10n ** BigInt(precision);
  if (precision === 0) return String(value);
  return `${value / scale}.${(value % scale).toString().padStart(precision, "0")}`;
}

function exactState(state: ExitPositionState): ExitPositionState {
  if (!/^[A-Z0-9.]{1,20}$/u.test(state.symbol) || state.symbol === "SWAP.HIVE") throw new TypeError("symbol must be one Hive Engine token other than SWAP.HIVE");
  const precision = state.precision;
  const canonical = (value: string, label: string) => decimalText(decimalUnits(value, precision, label), precision);
  const bids = state.bids.map((bid) => Object.freeze({
    price: decimalText(decimalUnits(bid.price, 8, "bid price"), 8),
    quantity: canonical(bid.quantity, "bid quantity"),
    orderId: String(bid.orderId),
  })).sort((left, right) => {
    const priceDelta = decimalUnits(right.price, 8, "bid price") - decimalUnits(left.price, 8, "bid price");
    return priceDelta === 0n ? left.orderId.localeCompare(right.orderId) : priceDelta > 0n ? 1 : -1;
  });
  if (new Set(bids.map((bid) => bid.orderId)).size !== bids.length) throw new TypeError("bid order identities must be unique");
  const cooldown = (value: number | null, label: string) => {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError(`${label} must be null or a nonnegative integer`);
    return value;
  };
  return Object.freeze({
    symbol: state.symbol,
    precision,
    liquid: canonical(state.liquid, "liquid balance"),
    stake: canonical(state.stake, "stake balance"),
    delegationsOut: canonical(state.delegationsOut, "delegations-out balance"),
    pendingUnstake: canonical(state.pendingUnstake, "pending-unstake balance"),
    pendingUndelegations: canonical(state.pendingUndelegations, "pending-undelegation balance"),
    stakingEnabled: state.stakingEnabled === true,
    delegationEnabled: state.delegationEnabled === true,
    unstakingCooldownDays: cooldown(state.unstakingCooldownDays, "unstaking cooldown"),
    undelegationCooldownDays: cooldown(state.undelegationCooldownDays, "undelegation cooldown"),
    releaseTransactions: cooldown(state.releaseTransactions, "release transaction count"),
    bidBookComplete: state.bidBookComplete === true,
    bids: Object.freeze(bids),
  });
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function knowledgeOf(observations: readonly ExitProviderObservation[]) {
  const available = observations.filter((entry): entry is Extract<ExitProviderObservation, { status: "available" }> => entry.status === "available");
  const groups = new Map<string, { state: ExitPositionState; providers: string[] }>();
  for (const observation of available) {
    const state = exactState(observation.state);
    const stateDigest = digest(state);
    const group = groups.get(stateDigest) ?? { state, providers: [] };
    group.providers.push(observation.provider);
    groups.set(stateDigest, group);
  }
  const unavailable = observations.filter((entry) => entry.status === "unavailable").map((entry) => Object.freeze({ provider: entry.provider, problem: entry.problem }));
  const state: FourKnowledge = groups.size > 1 ? "both" : available.length >= 2 ? "true" : "neither";
  return Object.freeze({
    value: state,
    meaning: state === "true" ? "at-least-two-declared-providers-support-one-exact-state-without-contradiction"
      : state === "both" ? "declared-providers-support-incompatible-exact-states"
      : "fewer-than-two-providers-supply-an-exact-state",
    supportWitnessCount: groups.size === 1 ? available.length : Math.max(0, ...[...groups.values()].map((group) => group.providers.length)),
    contradictionWitnessCount: groups.size > 1 ? available.length : 0,
    unavailable: Object.freeze(unavailable),
    stateDigests: Object.freeze([...groups.entries()].map(([stateDigest, group]) => Object.freeze({ stateDigest, providers: Object.freeze(group.providers.sort()) }))),
    agreedState: state === "true" ? [...groups.values()][0]!.state : null,
  });
}

function integrateBidDepth(requested: bigint, precision: number, bids: readonly ExitBidLevel[]) {
  const scale = 10n ** BigInt(precision);
  let uncovered = requested;
  let proceeds = 0n;
  let floorPrice: string | null = null;
  let levelsConsumed = 0;
  for (const bid of bids) {
    if (uncovered === 0n) break;
    const available = decimalUnits(bid.quantity, precision, "bid quantity");
    const taken = available < uncovered ? available : uncovered;
    if (taken === 0n) continue;
    proceeds += taken * decimalUnits(bid.price, 8, "bid price") / scale;
    uncovered -= taken;
    floorPrice = bid.price;
    levelsConsumed += 1;
  }
  const covered = requested - uncovered;
  const topPrice = bids[0]?.price ?? null;
  const topQuoteMark = topPrice === null ? 0n : requested * decimalUnits(topPrice, 8, "top bid price") / scale;
  const markGap = topQuoteMark > proceeds ? topQuoteMark - proceeds : 0n;
  return Object.freeze({ covered, uncovered, proceeds, floorPrice, levelsConsumed, topPrice, topQuoteMark, markGap });
}

export function certifyHiveEngineExit(input: Readonly<{
  account: string;
  requestedQuantity: string;
  observations: readonly ExitProviderObservation[];
}>) {
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(input.account)) throw new TypeError("account is not a canonical Hive account name");
  if (input.observations.length < 2 || new Set(input.observations.map((entry) => entry.provider)).size !== input.observations.length) {
    throw new TypeError("exit tightness requires at least two distinct declared providers");
  }
  const knowledge = knowledgeOf(input.observations);
  const base = Object.freeze({
    schema: EXIT_TIGHTNESS_SCHEMA,
    account: input.account,
    providerKnowledge: Object.freeze({ ...knowledge, agreedState: undefined }),
    formulas: Object.freeze({
      grossDepthProceeds: "E(q,B)=sum_i min(max(q-sum_{j<i} q_j,0),q_i)*p_i",
      coverage: "C(q,B)=min(q,sum_i q_i)/q",
      topQuoteMarkGap: "G(q,B)=q*p_1-E(q,B)",
      knowledge: "FOUR: true=independent agreement; both=positive and contradictory witnesses; neither=insufficient witnesses; false is reserved for a separately supplied claim contradicted by all witnesses",
    }),
    interpretationLimits: Object.freeze([
      "gross-SWAP.HIVE-order-book-proceeds-before-bridge-or-external-fees",
      "displayed-depth-is-not-future-fill-or-price-persistence",
      "SWAP.HIVE-is-not-assumed-equal-to-native-HIVE-HBD-or-USD",
      "utility-and-cooldown-terms-are-not-an-investment-recommendation",
    ]),
    credentialAccess: false,
    chainMutation: false,
  });
  if (knowledge.value !== "true" || knowledge.agreedState === null) {
    return Object.freeze({ ...base, status: "uncertified" as const, symbol: null, requestedQuantity: input.requestedQuantity,
      refusal: knowledge.value === "both" ? "provider-state-contested" : "independent-provider-support-insufficient", valuation: null });
  }
  const state = knowledge.agreedState;
  const requested = decimalUnits(input.requestedQuantity, state.precision, "requested quantity");
  const liquid = decimalUnits(state.liquid, state.precision, "liquid balance");
  if (requested === 0n) return Object.freeze({ ...base, status: "uncertified" as const, symbol: state.symbol,
    requestedQuantity: decimalText(requested, state.precision), refusal: "requested-quantity-is-zero", valuation: null });
  if (requested > liquid) return Object.freeze({ ...base, status: "uncertified" as const, symbol: state.symbol,
    requestedQuantity: decimalText(requested, state.precision), refusal: "requested-quantity-exceeds-immediately-sellable-liquid-balance", valuation: null });
  if (!state.bidBookComplete) return Object.freeze({ ...base, status: "uncertified" as const, symbol: state.symbol,
    requestedQuantity: decimalText(requested, state.precision), refusal: "bid-book-page-not-exhausted", valuation: null });
  const depth = integrateBidDepth(requested, state.precision, state.bids);
  const coverageBps = Number(depth.covered * 10_000n / requested);
  const vwap = depth.covered === 0n ? null : decimalText(depth.proceeds * (10n ** BigInt(state.precision)) / depth.covered, 8);
  const markGapBps = depth.topQuoteMark === 0n ? null : Number(depth.markGap * 10_000n / depth.topQuoteMark);
  return Object.freeze({
    ...base,
    status: "certified" as const,
    symbol: state.symbol,
    requestedQuantity: decimalText(requested, state.precision),
    stateDigest: digest(state),
    position: Object.freeze({ liquid: state.liquid, stake: state.stake, delegationsOut: state.delegationsOut,
      pendingUnstake: state.pendingUnstake, pendingUndelegations: state.pendingUndelegations,
      immediatelySellableQuantity: state.liquid }),
    utility: Object.freeze({ stakingEnabled: state.stakingEnabled, delegationEnabled: state.delegationEnabled,
      unstakingCooldownDays: state.unstakingCooldownDays, undelegationCooldownDays: state.undelegationCooldownDays,
      releaseTransactions: state.releaseTransactions }),
    valuation: Object.freeze({
      counterSymbol: "SWAP.HIVE" as const,
      completeExit: depth.uncovered === 0n,
      grossDepthProceeds: decimalText(depth.proceeds, 8),
      coveredQuantity: decimalText(depth.covered, state.precision),
      uncoveredQuantity: decimalText(depth.uncovered, state.precision),
      coverageBps,
      levelsConsumed: depth.levelsConsumed,
      bestBid: depth.topPrice,
      floorBid: depth.floorPrice,
      volumeWeightedAverageBid: vwap,
      topQuoteMark: decimalText(depth.topQuoteMark, 8),
      topQuoteMarkGap: decimalText(depth.markGap, 8),
      topQuoteMarkGapBps: markGapBps,
    }),
  });
}

