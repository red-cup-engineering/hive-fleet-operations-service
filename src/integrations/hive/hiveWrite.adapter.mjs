import { engineCustomJson, market, poolRatioDeposit, pools, tokens, peg } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { nativeCancelOrderOperation, nativeLimitOrderOperation } from "../../core/nativeMarket.mjs";
function request(input) {
    return Object.freeze({ kind: "aagaard.hive-write", ...input });
}
function voteOperation(account, vote) {
    return Object.freeze([
        "vote",
        Object.freeze({
            voter: account,
            author: vote.author,
            permlink: vote.permlink,
            weight: vote.weightBps
        })
    ]);
}
function tradeOperation(account, trade) {
    const [from, to] = trade.pair.split("/");
    if (trade.quantity === null) throw new Error(`trade pair '${trade.pair}' has no real computed quantity -- not funded or not priceable, refusing rather than guessing a size`);
    if (to === "SWAP.HIVE" && from) return engineCustomJson(account, market.marketSell({ symbol: from, quantity: trade.quantity }));
    if (from === "SWAP.HIVE" && to) return engineCustomJson(account, market.marketBuy({ symbol: to, quantity: trade.quantity }));
    throw new Error(`trade pair '${trade.pair}' involves neither side as SWAP.HIVE -- not executable as a single real market operation`);
}
// An LP deposit at the pool's reserve ratio: entry carries the pool pair, its reserves, the
// balances on hand and the pool precision.
function liquidityOperation(account, entry) {
    const deposit = poolRatioDeposit(entry);
    if (!deposit) throw new Error(`LP deposit for '${entry.pool}' rounds to nothing at the pool's reserve ratio`);
    return engineCustomJson(account, pools.addLiquidity({ tokenPair: entry.pool, ...deposit }));
}
/** The HBD above a liquid floor (in thousandths), as the savings entry that deposits it; null when
 * nothing is above the floor. */
export function hbdSavingsDeposit(hbd, minLiquidHbdMilli) {
    const match = /^([0-9]+\.[0-9]{3}) HBD$/.exec(String(hbd ?? ""));
    if (!match) return null;
    const excess = decimalUnits(match[1], 3) - BigInt(Math.round(minLiquidHbdMilli));
    return excess > 0n ? Object.freeze({ amountHbd: `${formatUnits(excess, 3)} HBD` }) : null;
}
function savingsOperation(account, entry) {
    return Object.freeze([
        "transfer_to_savings",
        Object.freeze({
            from: account,
            to: account,
            amount: entry.amountHbd,
            memo: "Aagaard HBD savings move"
        })
    ]);
}
function incentiveOperation(account, offer, action) {
    if (action === "vote") return voteOperation(account, {
        author: offer.source.author,
        permlink: offer.source.permlink,
        weightBps: 10000,
        sinkDeficit: 0,
        reason: "incentive vote"
    });
    if (action === "reblog") {
        return Object.freeze([
            "custom_json",
            Object.freeze({
                id: "follow",
                required_auths: [],
                required_posting_auths: [
                    account
                ],
                json: JSON.stringify([
                    "reblog",
                    {
                        account,
                        author: offer.source.author,
                        permlink: offer.source.permlink
                    }
                ])
            })
        ]);
    }
    return Object.freeze([
        "custom_json",
        Object.freeze({
            id: "follow",
            required_auths: [],
            required_posting_auths: [
                account
            ],
            json: JSON.stringify([
                "follow",
                {
                    follower: account,
                    following: offer.source.author,
                    what: [
                        "blog"
                    ]
                }
            ])
        })
    ]);
}
function stakeOperation(account, action) {
    if (action.kind === "stake") return engineCustomJson(account, tokens.stake({ symbol: action.symbol, quantity: action.quantity, to: action.to ?? account }));
    return engineCustomJson(account, tokens.delegate({ symbol: action.symbol, quantity: action.quantity, to: action.to }));
}
function wrapOperation(account, action) {
    if (action.kind === "wrap") return peg.wrap({ account, quantity: action.quantityHive });
    return engineCustomJson(account, peg.unwrap({ quantity: action.quantityHive }));
}
/** Each fleet act as the signer request that performs it. A builder throws when the act has no
 * real operation yet (an unsized LP position, a trade with no computed quantity). */
export const hiveWriteRequest = Object.freeze({
    vote: (wallet, vote) => request({ account: wallet.account, role: "posting", lane: "voting",
        target: `${vote.author}/${vote.permlink}`, operation: voteOperation(wallet.account, vote) }),
    trade: (wallet, trade) => request({ account: wallet.account, role: "active", lane: "trading",
        target: trade.pair, operation: tradeOperation(wallet.account, trade) }),
    liquidity: (wallet, entry) => request({ account: wallet.account, role: "active", lane: "trading",
        target: entry.pool, operation: liquidityOperation(wallet.account, entry) }),
    savings: (wallet, entry) => request({ account: wallet.account, role: "active", lane: "trading",
        target: "HBD savings", operation: savingsOperation(wallet.account, entry) }),
    incentive: (wallet, offer, action) => request({ account: wallet.account, role: "posting", lane: "incentive",
        target: offer.id, operation: incentiveOperation(wallet.account, offer, action) }),
    stake: (wallet, action) => request({ account: wallet.account, role: "active", lane: "trading",
        target: `${action.symbol}->${action.to}`, operation: stakeOperation(wallet.account, action) }),
    wrap: (wallet, action) => request({ account: wallet.account, role: "active", lane: "trading",
        target: `${action.kind}:${action.quantityHive}`, operation: wrapOperation(wallet.account, action) }),
    nativeLimitOrder: (wallet, intent) => {
        if (intent.account !== wallet.account) throw new TypeError("native order account does not match wallet actor");
        return request({ account: wallet.account, role: "active", lane: "native-market",
            target: `order:${intent.orderId}`, operation: nativeLimitOrderOperation(intent) });
    },
    nativeCancelOrder: (wallet, orderId) => request({ account: wallet.account, role: "active", lane: "native-market",
        target: `order:${orderId}`, operation: nativeCancelOrderOperation(wallet.account, orderId) }),
});
