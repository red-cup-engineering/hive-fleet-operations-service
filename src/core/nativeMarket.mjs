import { decimalUnits, formatUnits } from "@red-cup-engineering/exact-number-data-service/decimal-string";
import { limitOrderCancel, limitOrderCreate } from "@red-cup-engineering/hive-blockchain-client-service/ops.mjs";
export const DEFAULT_NATIVE_MARKET_POLICY = Object.freeze({
    minimumSpreadHbd: "0.001",
    sellIncrementHbd: "0.001",
    minimumGrossProceedsHbd: "0.001",
    maximumOpenOrders: 10,
    maximumHive: "1.000",
    maximumHbd: "1.000",
    orderLifetimeSeconds: 300
});
function units3(value) {
    try { return decimalUnits(value, 3); } catch { return null; }
}
function assetUnits(value, symbol) {
    return typeof value === "string" && value.endsWith(` ${symbol}`) ? units3(value.slice(0, -symbol.length - 1)) : null;
}
const decimal3 = (value)=>formatUnits(value, 3);
function isoWithoutMilliseconds(value) {
    return new Date(value).toISOString().replace(/\.000Z$/, "Z");
}
export function nativeMarketVwap(history) {
    let weighted = 0;
    let volume = 0;
    for (const bucket of history){
        if (!(bucket.closeHive > 0) || !(bucket.closeHbd > 0) || !(bucket.volumeHive > 0)) continue;
        weighted += bucket.closeHbd / bucket.closeHive * bucket.volumeHive;
        volume += bucket.volumeHive;
    }
    return volume > 0 ? weighted / volume : null;
}
function refusal(observation, reason) {
    return Object.freeze({
        kind: "aagaard.native-market-plan",
        account: observation.account,
        observedAt: observation.observedAt,
        admitted: false,
        reason,
        vwapHbdPerHive: observation.vwapHbdPerHive,
        buy: null,
        contingentSell: null,
        expectedGrossProceedsHbd: "0.000"
    });
}
export function planNativeMarketCycle(observation, policy = DEFAULT_NATIVE_MARKET_POLICY, nowMs = Date.parse(observation.observedAt)) {
    if (!observation.complete) return refusal(observation, `observation incomplete: ${observation.limitations.join("; ") || "unspecified gap"}`);
    if (!Number.isFinite(nowMs)) return refusal(observation, "observation time is invalid");
    if (observation.openOrders.length >= policy.maximumOpenOrders) return refusal(observation, "native open-order cap reached");
    if (observation.vwapHbdPerHive === null || !(observation.vwapHbdPerHive > 0)) return refusal(observation, "recent VWAP unavailable");
    if (!(observation.bestAsk > 0) || !(observation.bestBid > 0) || observation.bestAsk > observation.vwapHbdPerHive) {
        return refusal(observation, "best ask is not at or below recent VWAP");
    }
    const minSpread = units3(policy.minimumSpreadHbd);
    const increment = units3(policy.sellIncrementHbd);
    const minGross = units3(policy.minimumGrossProceedsHbd);
    const maxHive = units3(policy.maximumHive);
    const maxHbd = units3(policy.maximumHbd);
    if (minSpread === null || increment === null || minGross === null || maxHive === null || maxHbd === null || increment <= 0n || maxHive <= 0n || maxHbd <= 0n) {
        return refusal(observation, "policy contains a non-canonical three-decimal amount");
    }
    const bid = BigInt(Math.floor(observation.bestBid * 1000));
    const ask = BigInt(Math.ceil(observation.bestAsk * 1000));
    if (ask - bid < minSpread) return refusal(observation, "visible spread is below policy minimum");
    const sellPrice = ask + increment;
    const minimumQuantity = (minGross * 1000n + increment - 1n) / increment;
    const visibleAsk = BigInt(Math.floor((observation.asks[0]?.hiveQuantity ?? 0) * 1000));
    const hiveBalance = assetUnits(observation.hiveBalance, "HIVE");
    const hbdBalance = assetUnits(observation.hbdBalance, "HBD");
    if (hiveBalance === null || hbdBalance === null) return refusal(observation, "wallet balances are not canonical Hive assets");
    const affordable = ask > 0n ? hbdBalance * 1000n / ask : 0n;
    const capitalBound = ask > 0n ? maxHbd * 1000n / ask : 0n;
    const quantity = [
        maxHive,
        capitalBound,
        visibleAsk,
        affordable
    ].reduce((left, right)=>left < right ? left : right);
    if (quantity < minimumQuantity || quantity <= 0n) return refusal(observation, "balance, depth, or exposure cap cannot fund the minimum gross proceeds");
    const occupied = new Set(observation.openOrders.map((order)=>order.orderId));
    let orderBase = Math.floor(nowMs / 1000) >>> 0;
    while(occupied.has(orderBase) || occupied.has(orderBase + 1 >>> 0))orderBase = orderBase + 2 >>> 0;
    const expiresAt = isoWithoutMilliseconds(nowMs + policy.orderLifetimeSeconds * 1000);
    const quantityText = decimal3(quantity);
    const buy = Object.freeze({
        kind: "aagaard.native-limit-order",
        account: observation.account,
        orderId: orderBase,
        side: "buy-hive",
        quantityHive: quantityText,
        priceHbdPerHive: decimal3(ask),
        fillOrKill: true,
        expiresAt
    });
    const contingentSell = Object.freeze({
        kind: "aagaard.native-limit-order",
        account: observation.account,
        orderId: orderBase + 1 >>> 0,
        side: "sell-hive",
        quantityHive: quantityText,
        priceHbdPerHive: decimal3(sellPrice),
        fillOrKill: false,
        expiresAt
    });
    return Object.freeze({
        kind: "aagaard.native-market-plan",
        account: observation.account,
        observedAt: observation.observedAt,
        admitted: true,
        reason: "fill-or-kill acquisition admitted; maker exit awaits observed fill",
        vwapHbdPerHive: observation.vwapHbdPerHive,
        buy,
        contingentSell,
        expectedGrossProceedsHbd: decimal3(quantity * increment / 1000n)
    });
}
export function nativeLimitOrderOperation(intent) {
    const quantity = units3(intent.quantityHive);
    const price = units3(intent.priceHbdPerHive);
    if (quantity === null || price === null || quantity <= 0n || price <= 0n) throw new TypeError("native order requires positive canonical three-decimal quantity and price");
    const hbd = quantity * price / 1000n;
    if (hbd <= 0n) throw new TypeError("native order value rounds below Hive precision");
    return limitOrderCreate({
        owner: intent.account,
        orderid: intent.orderId,
            amount_to_sell: intent.side === "buy-hive" ? `${decimal3(hbd)} HBD` : `${intent.quantityHive} HIVE`,
            min_to_receive: intent.side === "buy-hive" ? `${intent.quantityHive} HIVE` : `${decimal3(hbd)} HBD`,
            fill_or_kill: intent.fillOrKill,
        expiration: intent.expiresAt
    });
}
export function nativeCancelOrderOperation(account, orderId) {
    if (!Number.isSafeInteger(orderId) || orderId < 0 || orderId > 0xffffffff) throw new TypeError("native order id must be uint32");
    return limitOrderCancel({ owner: account, orderid: orderId });
}
