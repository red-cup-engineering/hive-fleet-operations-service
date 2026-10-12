import { decimalUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { sizeExactPoolToBook } from "../analysis/exactArbitrage.mjs";
import { attestProviders } from "./providerAttestation.mjs";
export const GLOBAL_ARBITRAGE_SCAN_SCHEMA = "aagaard.global-arbitrage-scan.v1";
export const DISCOVERY_EDGE_BPS = 70;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;
function fraction(value) {
    const match = DECIMAL.exec(value);
    if (!match) throw new Error(`'${value}' is not a canonical decimal`);
    const digits = match[1]?.length ?? 0;
    return [
        BigInt(value.replace(".", "")),
        10n ** BigInt(digits)
    ];
}
function poolRoute(pool) {
    const [base, quote] = pool.pair.split(":");
    if (!base || !quote || base === quote) return null;
    if (base === "SWAP.HIVE") return Object.freeze({
        symbol: quote,
        reserveIn: pool.baseQuantity,
        reserveOut: pool.quoteQuantity
    });
    if (quote === "SWAP.HIVE") return Object.freeze({
        symbol: base,
        reserveIn: pool.quoteQuantity,
        reserveOut: pool.baseQuantity
    });
    return null;
}
export function discoverPoolToBookRoutes(state) {
    const metrics = new Map(state.metrics.map((row)=>[
            row.symbol,
            row.highestBid
        ]));
    const routes = [];
    for (const pool of state.pools){
        const route = poolRoute(pool);
        if (!route) continue;
        const bidText = metrics.get(route.symbol);
        if (!bidText) continue;
        const [bidN, bidD] = fraction(bidText);
        const [inN, inD] = fraction(route.reserveIn);
        const [outN, outD] = fraction(route.reserveOut);
        if (bidN <= 0n || inN <= 0n || outN <= 0n) continue;
        const grossNumerator = bidN * outN * inD;
        const grossDenominator = bidD * outD * inN;
        if (grossNumerator * 10_000n <= grossDenominator * BigInt(10_000 + DISCOVERY_EDGE_BPS)) continue;
        const edge = Number(grossNumerator * 10_000n / grossDenominator - 10_000n);
        routes.push(Object.freeze({
            pool,
            symbol: route.symbol,
            grossSpotEdgeBpsFloor: edge
        }));
    }
    routes.sort((left, right)=>right.grossSpotEdgeBpsFloor - left.grossSpotEdgeBpsFloor || left.symbol.localeCompare(right.symbol));
    return Object.freeze(routes);
}
function crossingFleetBid(limit, prices, precision) {
    const limitUnits = decimalUnits(limit, precision);
    return prices.some((price)=>decimalUnits(price, precision) >= limitUnits);
}
export function certifyGlobalArbitrageScan(input) {
    const observedAt = new Date(input.observedAt).toISOString();
    if (input.observations.length < 2 || new Set(input.observations.map((row)=>row.provider)).size !== input.observations.length) {
        throw new TypeError("global arbitrage scan requires distinct providers");
    }
    const attested = attestProviders(input.observations);
    const { groups, unavailable } = attested;
    const knowledge = attested.value;
    const providerKnowledge = Object.freeze({
        value: knowledge,
        stateDigests: Object.freeze([
            ...groups.entries()
        ].map(([stateDigest, group])=>Object.freeze({
                stateDigest,
                providers: Object.freeze([
                    ...group.providers
                ].sort())
            }))),
        unavailable: Object.freeze(unavailable)
    });
    const base = Object.freeze({
        schema: GLOBAL_ARBITRAGE_SCAN_SCHEMA,
        observedAt,
        providerKnowledge,
        credentialAccess: false,
        chainMutation: false,
        executionAdmissible: false
    });
    if (knowledge !== "true") return Object.freeze({
        ...base,
        status: "uncertified",
        universe: null,
        opportunities: null,
        refusal: attested.refusal
    });
    const group = [
        ...groups.values()
    ][0];
    const state = group.state;
    const capSwapHiveMilli = input.capSwapHiveMilli ?? 1_000;
    const slippageBps = input.slippageBps ?? 50;
    const minimumProfit = input.minimumProfitSwapHive ?? "0.00100000";
    const minimumEdgeBps = input.minimumEdgeBps ?? 50;
    const minimumProfitUnits = decimalUnits(minimumProfit, state.swapHivePrecision);
    const books = new Map(state.books.map((book)=>[
            book.symbol,
            book
        ]));
    const routes = discoverPoolToBookRoutes(state);
    const opportunities = routes.map((route)=>{
        const oriented = poolRoute(route.pool);
        const book = books.get(route.symbol);
        const tokenPrecision = state.tokenPrecision[route.symbol];
        if (!book || tokenPrecision === undefined) return Object.freeze({
            symbol: route.symbol,
            pool: route.pool.pair,
            grossSpotEdgeBpsFloor: route.grossSpotEdgeBpsFloor,
            exact: Object.freeze({
                admitted: false,
                reason: "complete book or token precision unavailable"
            }),
            policyAdmitted: false,
            policyRefusal: "exact evidence unavailable"
        });
        const exact = sizeExactPoolToBook({
            tokenPrecision,
            swapHivePrecision: state.swapHivePrecision,
            reserveInSwapHive: oriented.reserveIn,
            reserveOutToken: oriented.reserveOut,
            balanceSwapHive: state.swapHiveBalance,
            capSwapHiveMilli,
            poolFeeBps: route.pool.feeBps,
            slippageBps,
            bids: book.bids,
            bidBookComplete: book.complete,
            bidBookOrdered: book.ordered
        });
        if (!exact.admitted) return Object.freeze({
            symbol: route.symbol,
            pool: route.pool.pair,
            grossSpotEdgeBpsFloor: route.grossSpotEdgeBpsFloor,
            exact,
            policyAdmitted: false,
            policyRefusal: exact.reason
        });
        const profit = decimalUnits(exact.quote.worstCaseProfitSwapHive, state.swapHivePrecision);
        const selfCross = crossingFleetBid(exact.quote.limitSellPriceSwapHive, book.fleetBidPrices, state.swapHivePrecision);
        const policyRefusal = selfCross ? "final sell would cross a fleet-owned bid" : profit < minimumProfitUnits ? `worst-case full-fill profit is below ${minimumProfit} SWAP.HIVE` : exact.quote.edgeBps < minimumEdgeBps ? `worst-case edge is below ${minimumEdgeBps} bps` : null;
        return Object.freeze({
            symbol: route.symbol,
            pool: route.pool.pair,
            grossSpotEdgeBpsFloor: route.grossSpotEdgeBpsFloor,
            exact,
            fleetSelfCross: selfCross,
            policyAdmitted: policyRefusal === null,
            policyRefusal
        });
    });
    opportunities.sort((left, right)=>{
        const lp = left.exact.admitted ? decimalUnits(left.exact.quote.worstCaseProfitSwapHive, state.swapHivePrecision) : -1n;
        const rp = right.exact.admitted ? decimalUnits(right.exact.quote.worstCaseProfitSwapHive, state.swapHivePrecision) : -1n;
        return lp > rp ? -1 : lp < rp ? 1 : left.symbol.localeCompare(right.symbol);
    });
    return Object.freeze({
        ...base,
        status: "certified",
        account: state.account,
        certifyingProviders: Object.freeze([
            ...group.providers
        ].sort()),
        universe: Object.freeze({
            swapHivePoolCount: state.pools.length,
            metricCount: state.metrics.length,
            discoveryEdgeBps: DISCOVERY_EDGE_BPS,
            shortlistedRouteCount: routes.length,
            completeBookCount: state.books.filter((book)=>book.complete && book.ordered).length
        }),
        policy: Object.freeze({
            capSwapHiveMilli,
            slippageBps,
            minimumProfitSwapHive: minimumProfit,
            minimumEdgeBps
        }),
        opportunities: Object.freeze(opportunities),
        admittedCount: opportunities.filter((row)=>row.policyAdmitted).length,
        refusal: opportunities.some((row)=>row.policyAdmitted) ? null : "no full-universe route clears exact execution economics and policy"
    });
}
