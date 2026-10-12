import { holozingDecimalUnits } from "@red-cup-engineering/holozing-services-section";
import { holozingFormatUnits } from "@red-cup-engineering/holozing-services-section";
const ACCOUNT = /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const PRECISION = 3;
function scale() {
    return 10n ** BigInt(PRECISION);
}
function exactReward(value, field) {
    if (typeof value !== "string") throw new Error(`${field} must be a decimal string`);
    return holozingFormatUnits(holozingDecimalUnits(value));
}
export function parseHoloZingPendingRewards(account, observedAt, value, alphaVialIds) {
    if (!ACCOUNT.test(account)) throw new Error("invalid HoloZing Hive account");
    if (!Number.isFinite(Date.parse(observedAt))) throw new Error("invalid HoloZing observation timestamp");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("pending rewards must be an object");
    if (!Array.isArray(alphaVialIds) || alphaVialIds.some((id)=>!Number.isSafeInteger(id) || id <= 0)) {
        throw new Error("Alpha Vial identifiers must be positive safe integers");
    }
    if (new Set(alphaVialIds).size !== alphaVialIds.length) throw new Error("Alpha Vial identifiers must be unique");
    const record = value;
    const delegation = exactReward(record["delegation"], "delegation");
    const stakeZing = exactReward(record["stakeZing"], "stakeZing");
    const holdingRewards = exactReward(record["holdingRewards"], "holdingRewards");
    const total = holozingFormatUnits(holozingDecimalUnits(delegation) + holozingDecimalUnits(stakeZing) + holozingDecimalUnits(holdingRewards));
    return Object.freeze({
        account,
        observedAt,
        delegation,
        stakeZing,
        holdingRewards,
        total,
        alphaVialIds: Object.freeze([
            ...alphaVialIds
        ].sort((left, right)=>left - right))
    });
}
export function planHoloZingRewardClaim(pending, minimumClaimZing = "1.000") {
    try {
        const minimum = holozingDecimalUnits(minimumClaimZing);
        if (minimum <= 0n) throw new Error("minimum claim must be positive");
        const total = holozingDecimalUnits(pending.total);
        if (total < minimum) {
            return Object.freeze({
                kind: "refuse",
                reason: `pending reward ${pending.total} ZING is below policy minimum ${holozingFormatUnits(minimum)} ZING`
            });
        }
        return Object.freeze({
            kind: "ready",
            reason: "claim converts server-pending rewards into on-chain staked ZING without opening or transferring an Alpha Vial",
            minimumClaimZing: pending.total
        });
    } catch (error) {
        return Object.freeze({
            kind: "refuse",
            reason: `invalid HoloZing claim evidence: ${error instanceof Error ? error.message : String(error)}`
        });
    }
}
export function reconcileHoloZingRewardClaim(beforePending, afterPending, beforeBalance, afterBalance, events) {
    try {
        if (beforePending.account !== afterPending.account) throw new Error("pending observations name different accounts");
        if (events.length === 0) throw new Error("no exact on-chain ZING stake event was observed");
        const minimum = holozingDecimalUnits(beforePending.total);
        const eventUnits = events.reduce((sum, event)=>sum + holozingDecimalUnits(event.quantity), 0n);
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
        return Object.freeze({
            confirmed: true,
            claimedZing: holozingFormatUnits(eventUnits)
        });
    } catch (error) {
        return Object.freeze({
            confirmed: false,
            reason: error instanceof Error ? error.message : String(error)
        });
    }
}
