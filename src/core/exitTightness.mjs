import { decimalUnits, formatUnits, rationalUnits } from "@red-cup-engineering/computer-data-engineering-services-section/number/decimal-string";
import { gradedFromParts, gradedValue } from "@red-cup-engineering/computer-data-engineering-services-section/number/graded";
import { parseEngineOrderBook } from "@red-cup-engineering/hive-blockchain-client-service/market.mjs";
import { marketSellWalk } from "@red-cup-engineering/gaming/market";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { attestProviders } from "./providerAttestation.mjs";
export const EXIT_TIGHTNESS_SCHEMA = "aagaard.hive-engine-exit-tightness.v1";
function exactState(state) {
    if (!/^[A-Z0-9.]{1,20}$/u.test(state.symbol) || state.symbol === "SWAP.HIVE") throw new TypeError("symbol must be one Hive Engine token other than SWAP.HIVE");
    const precision = state.precision;
    const canonical = (value)=>formatUnits(decimalUnits(value, precision), precision);
    const bids = state.bids.map((bid)=>Object.freeze({
            price: formatUnits(decimalUnits(bid.price, 8), 8),
            quantity: canonical(bid.quantity, "bid quantity"),
            orderId: String(bid.orderId)
        })).sort((left, right)=>{
        const priceDelta = decimalUnits(right.price, 8) - decimalUnits(left.price, 8);
        return priceDelta === 0n ? left.orderId.localeCompare(right.orderId) : priceDelta > 0n ? 1 : -1;
    });
    if (new Set(bids.map((bid)=>bid.orderId)).size !== bids.length) throw new TypeError("bid order identities must be unique");
    const cooldown = (value, label)=>{
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
        bids: Object.freeze(bids)
    });
}
function knowledgeOf(observations) {
    const attested = attestProviders(observations, (observation)=>exactState(observation.state));
    return Object.freeze({
        value: attested.value,
        meaning: MEANING[attested.value],
        tally: attested.tally,
        unavailable: attested.unavailable,
        stateDigests: Object.freeze([
            ...attested.groups.entries()
        ].map(([stateDigest, group])=>Object.freeze({
                stateDigest,
                providers: Object.freeze(group.providers.sort())
            }))),
        agreedState: attested.agreedState,
        refusal: attested.refusal
    });
}
const MEANING = Object.freeze({
    true: "a-second-declared-provider-corroborates-one-exact-state-and-none-attests-another",
    false: "declared-providers-attest-only-incompatible-exact-states",
    both: "a-corroborated-exact-state-is-contradicted-by-another-declared-provider",
    neither: "fewer-than-two-declared-providers-supply-an-exact-state"
});
function integrateBidDepth(requested, precision, bids) {
    const scale = 10n ** BigInt(precision);
    const walked = marketSellWalk(parseEngineOrderBook(bids, [], "TOKEN"), gradedFromParts(requested, scale, "TOKEN"));
    const units8 = (value)=>rationalUnits(gradedValue(value), 8, { rounding: "toward-zero" });
    const uncovered = rationalUnits(gradedValue(walked.shortfall), precision, { rounding: "toward-zero" });
    const proceeds = units8(walked.cost);
    const topPrice = bids[0]?.price ?? null;
    const topQuoteMark = topPrice === null ? 0n : requested * decimalUnits(topPrice, 8) / scale;
    return Object.freeze({
        covered: requested - uncovered,
        uncovered,
        proceeds,
        floorPrice: walked.worst ? formatUnits(units8(walked.worst), 8) : null,
        levelsConsumed: walked.levels,
        topPrice,
        topQuoteMark,
        markGap: topQuoteMark > proceeds ? topQuoteMark - proceeds : 0n
    });
}
export function certifyHiveEngineExit(input) {
    if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(input.account)) throw new TypeError("account is not a canonical Hive account name");
    if (input.observations.length < 2 || new Set(input.observations.map((entry)=>entry.provider)).size !== input.observations.length) {
        throw new TypeError("exit tightness requires at least two distinct declared providers");
    }
    const knowledge = knowledgeOf(input.observations);
    const base = Object.freeze({
        schema: EXIT_TIGHTNESS_SCHEMA,
        account: input.account,
        providerKnowledge: Object.freeze({
            ...knowledge,
            agreedState: undefined,
            refusal: undefined
        }),
        formulas: Object.freeze({
            grossDepthProceeds: "E(q,B)=sum_i min(max(q-sum_{j<i} q_j,0),q_i)*p_i",
            coverage: "C(q,B)=min(q,sum_i q_i)/q",
            topQuoteMarkGap: "G(q,B)=q*p_1-E(q,B)",
            knowledge: "FOUR (truth) of the attestation record: corroborations=sum_s(n_s-1), contradictions=max(0,|S|-1) over attested exact states S with n_s providers each; true=corroborated uncontradicted; false=contradicted uncorroborated; both=corroborated and contradicted; neither=neither"
        }),
        interpretationLimits: Object.freeze([
            "gross-SWAP.HIVE-order-book-proceeds-before-bridge-or-external-fees",
            "displayed-depth-is-not-future-fill-or-price-persistence",
            "SWAP.HIVE-is-not-assumed-equal-to-native-HIVE-HBD-or-USD",
            "utility-and-cooldown-terms-are-not-an-investment-recommendation"
        ]),
        credentialAccess: false,
        chainMutation: false
    });
    if (knowledge.value !== "true" || knowledge.agreedState === null) {
        return Object.freeze({
            ...base,
            status: "uncertified",
            symbol: null,
            requestedQuantity: input.requestedQuantity,
            refusal: knowledge.refusal,
            valuation: null
        });
    }
    const state = knowledge.agreedState;
    const requested = decimalUnits(input.requestedQuantity, state.precision);
    const liquid = decimalUnits(state.liquid, state.precision);
    if (requested === 0n) return Object.freeze({
        ...base,
        status: "uncertified",
        symbol: state.symbol,
        requestedQuantity: formatUnits(requested, state.precision),
        refusal: "requested-quantity-is-zero",
        valuation: null
    });
    if (requested > liquid) return Object.freeze({
        ...base,
        status: "uncertified",
        symbol: state.symbol,
        requestedQuantity: formatUnits(requested, state.precision),
        refusal: "requested-quantity-exceeds-immediately-sellable-liquid-balance",
        valuation: null
    });
    if (!state.bidBookComplete) return Object.freeze({
        ...base,
        status: "uncertified",
        symbol: state.symbol,
        requestedQuantity: formatUnits(requested, state.precision),
        refusal: "bid-book-page-not-exhausted",
        valuation: null
    });
    const depth = integrateBidDepth(requested, state.precision, state.bids);
    const coverageBps = Number(depth.covered * 10_000n / requested);
    const vwap = depth.covered === 0n ? null : formatUnits(depth.proceeds * 10n ** BigInt(state.precision) / depth.covered, 8);
    const markGapBps = depth.topQuoteMark === 0n ? null : Number(depth.markGap * 10_000n / depth.topQuoteMark);
    return Object.freeze({
        ...base,
        status: "certified",
        symbol: state.symbol,
        requestedQuantity: formatUnits(requested, state.precision),
        stateDigest: semanticId(state),
        position: Object.freeze({
            liquid: state.liquid,
            stake: state.stake,
            delegationsOut: state.delegationsOut,
            pendingUnstake: state.pendingUnstake,
            pendingUndelegations: state.pendingUndelegations,
            immediatelySellableQuantity: state.liquid
        }),
        utility: Object.freeze({
            stakingEnabled: state.stakingEnabled,
            delegationEnabled: state.delegationEnabled,
            unstakingCooldownDays: state.unstakingCooldownDays,
            undelegationCooldownDays: state.undelegationCooldownDays,
            releaseTransactions: state.releaseTransactions
        }),
        valuation: Object.freeze({
            counterSymbol: "SWAP.HIVE",
            completeExit: depth.uncovered === 0n,
            grossDepthProceeds: formatUnits(depth.proceeds, 8),
            coveredQuantity: formatUnits(depth.covered, state.precision),
            uncoveredQuantity: formatUnits(depth.uncovered, state.precision),
            coverageBps,
            levelsConsumed: depth.levelsConsumed,
            bestBid: depth.topPrice,
            floorBid: depth.floorPrice,
            volumeWeightedAverageBid: vwap,
            topQuoteMark: formatUnits(depth.topQuoteMark, 8),
            topQuoteMarkGap: formatUnits(depth.markGap, 8),
            topQuoteMarkGapBps: markGapBps
        })
    });
}
