export interface HoloZingPendingRewards {
  readonly account: string;
  readonly observedAt: string;
  readonly delegation: string;
  readonly stakeZing: string;
  readonly holdingRewards: string;
  readonly total: string;
  readonly alphaVialIds: readonly number[];
}

export interface HoloZingZingBalance {
  readonly liquid: string;
  readonly staked: string;
}

export interface HoloZingClaimPlan {
  readonly kind: "ready" | "refuse";
  readonly reason: string;
  readonly minimumClaimZing?: string;
}

export interface HoloZingStakeEvent {
  readonly transactionId: string;
  readonly blockNumber: number;
  readonly quantity: string;
  readonly memo: string;
}

export type HoloZingClaimReconciliation =
  | { readonly confirmed: true; readonly claimedZing: string }
  | { readonly confirmed: false; readonly reason: string };

const ACCOUNT = /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const PRECISION = 3;

function scale(): bigint { return 10n ** BigInt(PRECISION); }

export function holozingDecimalUnits(value: string): bigint {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`HoloZing value '${value}' is not a canonical unsigned decimal`);
  const fraction = match[1] ?? "";
  if (fraction.length > PRECISION) throw new Error(`HoloZing value '${value}' exceeds precision ${PRECISION}`);
  const whole = value.split(".")[0] ?? "0";
  return BigInt(whole) * scale() + BigInt((fraction + "0".repeat(PRECISION)).slice(0, PRECISION) || "0");
}

export function holozingFormatUnits(value: bigint): string {
  if (value < 0n) throw new Error("HoloZing amount cannot be negative");
  return `${value / scale()}.${(value % scale()).toString().padStart(PRECISION, "0")}`;
}

function exactReward(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a decimal string`);
  return holozingFormatUnits(holozingDecimalUnits(value));
}

export function parseHoloZingPendingRewards(
  account: string,
  observedAt: string,
  value: unknown,
  alphaVialIds: readonly number[],
): HoloZingPendingRewards {
  if (!ACCOUNT.test(account)) throw new Error("invalid HoloZing Hive account");
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error("invalid HoloZing observation timestamp");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pending rewards must be an object");
  if (!Array.isArray(alphaVialIds) || alphaVialIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Alpha Vial identifiers must be positive safe integers");
  }
  if (new Set(alphaVialIds).size !== alphaVialIds.length) throw new Error("Alpha Vial identifiers must be unique");
  const record = value as Record<string, unknown>;
  const delegation = exactReward(record["delegation"], "delegation");
  const stakeZing = exactReward(record["stakeZing"], "stakeZing");
  const holdingRewards = exactReward(record["holdingRewards"], "holdingRewards");
  const total = holozingFormatUnits(
    holozingDecimalUnits(delegation) + holozingDecimalUnits(stakeZing) + holozingDecimalUnits(holdingRewards),
  );
  return Object.freeze({
    account,
    observedAt,
    delegation,
    stakeZing,
    holdingRewards,
    total,
    alphaVialIds: Object.freeze([...alphaVialIds].sort((left, right) => left - right)),
  });
}

export function planHoloZingRewardClaim(
  pending: HoloZingPendingRewards,
  minimumClaimZing = "1.000",
): HoloZingClaimPlan {
  try {
    const minimum = holozingDecimalUnits(minimumClaimZing);
    if (minimum <= 0n) throw new Error("minimum claim must be positive");
    const total = holozingDecimalUnits(pending.total);
    if (total < minimum) {
      return Object.freeze({
        kind: "refuse",
        reason: `pending reward ${pending.total} ZING is below policy minimum ${holozingFormatUnits(minimum)} ZING`,
      });
    }
    return Object.freeze({
      kind: "ready",
      reason: "claim converts server-pending rewards into on-chain staked ZING without opening or transferring an Alpha Vial",
      minimumClaimZing: pending.total,
    });
  } catch (error) {
    return Object.freeze({ kind: "refuse", reason: `invalid HoloZing claim evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}

export function reconcileHoloZingRewardClaim(
  beforePending: HoloZingPendingRewards,
  afterPending: HoloZingPendingRewards,
  beforeBalance: HoloZingZingBalance,
  afterBalance: HoloZingZingBalance,
  events: readonly HoloZingStakeEvent[],
): HoloZingClaimReconciliation {
  try {
    if (beforePending.account !== afterPending.account) throw new Error("pending observations name different accounts");
    if (events.length === 0) throw new Error("no exact on-chain ZING stake event was observed");
    const minimum = holozingDecimalUnits(beforePending.total);
    const eventUnits = events.reduce((sum, event) => sum + holozingDecimalUnits(event.quantity), 0n);
    if (eventUnits < minimum) throw new Error("confirmed stake events are below the freshly planned reward amount");
    const beforeStake = holozingDecimalUnits(beforeBalance.staked);
    const afterStake = holozingDecimalUnits(afterBalance.staked);
    if (afterStake - beforeStake !== eventUnits) throw new Error("staked ZING balance delta does not equal the exact claim events");
    if (holozingDecimalUnits(afterBalance.liquid) !== holozingDecimalUnits(beforeBalance.liquid)) {
      throw new Error("liquid ZING changed during a stake-only reward claim");
    }
    if (holozingDecimalUnits(afterPending.total) >= holozingDecimalUnits(beforePending.total)) {
      throw new Error("pending rewards did not decrease after the claim");
    }
    return Object.freeze({ confirmed: true, claimedZing: holozingFormatUnits(eventUnits) });
  } catch (error) {
    return Object.freeze({ confirmed: false, reason: error instanceof Error ? error.message : String(error) });
  }
}
