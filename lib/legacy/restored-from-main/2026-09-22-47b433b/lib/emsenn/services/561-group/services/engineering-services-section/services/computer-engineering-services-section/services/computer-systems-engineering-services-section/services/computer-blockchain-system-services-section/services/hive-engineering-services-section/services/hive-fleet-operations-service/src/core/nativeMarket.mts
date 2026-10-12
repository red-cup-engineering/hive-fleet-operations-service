export interface NativeMarketLevel {
  readonly priceHbdPerHive: number;
  readonly hiveQuantity: number;
  readonly hbdQuantity: number;
}

export interface NativeMarketBucket {
  readonly openedAt: string;
  readonly seconds: number;
  readonly closeHbd: number;
  readonly closeHive: number;
  readonly volumeHive: number;
  readonly volumeHbd: number;
}

export interface NativeOpenOrder {
  readonly orderId: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly amountToSell: string;
  readonly minToReceive: string;
  readonly side: "buy-hive" | "sell-hive";
}

export interface NativeOrderEvent {
  readonly sourceId: string;
  readonly operation: "limit_order_create" | "limit_order_create2" | "limit_order_cancel" | "fill_order";
  readonly timestamp: string;
  readonly transactionId: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface NativeMarketObservation {
  readonly kind: "aagaard.native-market-observation";
  readonly account: string;
  readonly observedAt: string;
  readonly windowMinutes: number;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly spread: number;
  readonly spreadBps: number;
  readonly bids: readonly NativeMarketLevel[];
  readonly asks: readonly NativeMarketLevel[];
  readonly history: readonly NativeMarketBucket[];
  readonly vwapHbdPerHive: number | null;
  readonly hiveBalance: string;
  readonly hbdBalance: string;
  readonly openOrders: readonly NativeOpenOrder[];
  /** Chain-derived order history replaces the relic's local account_orders
   * table. It survives process and database loss and does not mistake an
   * attempted local write for a settled chain event. */
  readonly orderEvents: readonly NativeOrderEvent[];
  readonly complete: boolean;
  readonly limitations: readonly string[];
}

export interface NativeMarketPolicy {
  readonly minimumSpreadHbd: string;
  readonly sellIncrementHbd: string;
  readonly minimumGrossProceedsHbd: string;
  readonly maximumOpenOrders: number;
  readonly maximumHive: string;
  readonly maximumHbd: string;
  readonly orderLifetimeSeconds: number;
}

export interface NativeLimitOrderIntent {
  readonly kind: "aagaard.native-limit-order";
  readonly account: string;
  readonly orderId: number;
  readonly side: "buy-hive" | "sell-hive";
  readonly quantityHive: string;
  readonly priceHbdPerHive: string;
  readonly fillOrKill: boolean;
  readonly expiresAt: string;
}

export interface NativeMarketPlan {
  readonly kind: "aagaard.native-market-plan";
  readonly account: string;
  readonly observedAt: string;
  readonly admitted: boolean;
  readonly reason: string;
  readonly vwapHbdPerHive: number | null;
  readonly buy: NativeLimitOrderIntent | null;
  /** This leg is contingent on chain evidence that the buy filled. It must
   * never be broadcast merely because the buy transaction was submitted. */
  readonly contingentSell: NativeLimitOrderIntent | null;
  readonly expectedGrossProceedsHbd: string;
}

export const DEFAULT_NATIVE_MARKET_POLICY: NativeMarketPolicy = Object.freeze({
  minimumSpreadHbd: "0.001",
  sellIncrementHbd: "0.001",
  minimumGrossProceedsHbd: "0.001",
  maximumOpenOrders: 10,
  maximumHive: "1.000",
  maximumHbd: "1.000",
  orderLifetimeSeconds: 300,
});

function units3(value: string): bigint | null {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{3})$/.exec(value);
  return match ? BigInt(`${match[1]}${match[2]}`) : null;
}

function assetUnits(value: string, symbol: "HIVE" | "HBD"): bigint | null {
  const match = new RegExp(`^(0|[1-9][0-9]*)\\.([0-9]{3}) ${symbol}$`).exec(value);
  return match ? BigInt(`${match[1]}${match[2]}`) : null;
}

function decimal3(value: bigint): string {
  const whole = value / 1000n;
  return `${whole}.${(value % 1000n).toString().padStart(3, "0")}`;
}

function isoWithoutMilliseconds(value: number): string {
  return new Date(value).toISOString().replace(/\.000Z$/, "Z");
}

export function nativeMarketVwap(history: readonly NativeMarketBucket[]): number | null {
  let weighted = 0;
  let volume = 0;
  for (const bucket of history) {
    if (!(bucket.closeHive > 0) || !(bucket.closeHbd > 0) || !(bucket.volumeHive > 0)) continue;
    weighted += (bucket.closeHbd / bucket.closeHive) * bucket.volumeHive;
    volume += bucket.volumeHive;
  }
  return volume > 0 ? weighted / volume : null;
}

function refusal(observation: NativeMarketObservation, reason: string): NativeMarketPlan {
  return Object.freeze({
    kind: "aagaard.native-market-plan" as const,
    account: observation.account,
    observedAt: observation.observedAt,
    admitted: false,
    reason,
    vwapHbdPerHive: observation.vwapHbdPerHive,
    buy: null,
    contingentSell: null,
    expectedGrossProceedsHbd: "0.000",
  });
}

/** Plan the relic's ask-at-or-below-VWAP / one-tick maker exit, with the
 * missing safety laws made explicit: complete reads, bounded exposure, exact
 * Hive precision, visible ask depth, open-order cap, and a sell contingent on
 * observed fill rather than mere submission. */
export function planNativeMarketCycle(
  observation: NativeMarketObservation,
  policy: NativeMarketPolicy = DEFAULT_NATIVE_MARKET_POLICY,
  nowMs = Date.parse(observation.observedAt),
): NativeMarketPlan {
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
  const quantity = [maxHive, capitalBound, visibleAsk, affordable].reduce((left, right) => left < right ? left : right);
  if (quantity < minimumQuantity || quantity <= 0n) return refusal(observation, "balance, depth, or exposure cap cannot fund the minimum gross proceeds");
  const occupied = new Set(observation.openOrders.map((order) => order.orderId));
  let orderBase = Math.floor(nowMs / 1000) >>> 0;
  while (occupied.has(orderBase) || occupied.has((orderBase + 1) >>> 0)) orderBase = (orderBase + 2) >>> 0;
  const expiresAt = isoWithoutMilliseconds(nowMs + policy.orderLifetimeSeconds * 1000);
  const quantityText = decimal3(quantity);
  const buy = Object.freeze({
    kind: "aagaard.native-limit-order" as const,
    account: observation.account,
    orderId: orderBase,
    side: "buy-hive" as const,
    quantityHive: quantityText,
    priceHbdPerHive: decimal3(ask),
    fillOrKill: true,
    expiresAt,
  });
  const contingentSell = Object.freeze({
    kind: "aagaard.native-limit-order" as const,
    account: observation.account,
    orderId: (orderBase + 1) >>> 0,
    side: "sell-hive" as const,
    quantityHive: quantityText,
    priceHbdPerHive: decimal3(sellPrice),
    fillOrKill: false,
    expiresAt,
  });
  return Object.freeze({
    kind: "aagaard.native-market-plan" as const,
    account: observation.account,
    observedAt: observation.observedAt,
    admitted: true,
    reason: "fill-or-kill acquisition admitted; maker exit awaits observed fill",
    vwapHbdPerHive: observation.vwapHbdPerHive,
    buy,
    contingentSell,
    expectedGrossProceedsHbd: decimal3(quantity * increment / 1000n),
  });
}

export function nativeLimitOrderOperation(intent: NativeLimitOrderIntent): readonly ["limit_order_create", Readonly<Record<string, unknown>>] {
  const quantity = units3(intent.quantityHive);
  const price = units3(intent.priceHbdPerHive);
  if (quantity === null || price === null || quantity <= 0n || price <= 0n) throw new TypeError("native order requires positive canonical three-decimal quantity and price");
  const hbd = quantity * price / 1000n;
  if (hbd <= 0n) throw new TypeError("native order value rounds below Hive precision");
  return Object.freeze(["limit_order_create", Object.freeze({
    owner: intent.account,
    orderid: intent.orderId,
    amount_to_sell: intent.side === "buy-hive" ? `${decimal3(hbd)} HBD` : `${intent.quantityHive} HIVE`,
    min_to_receive: intent.side === "buy-hive" ? `${intent.quantityHive} HIVE` : `${decimal3(hbd)} HBD`,
    fill_or_kill: intent.fillOrKill,
    expiration: intent.expiresAt,
  })]);
}

export function nativeCancelOrderOperation(account: string, orderId: number): readonly ["limit_order_cancel", Readonly<Record<string, unknown>>] {
  if (!Number.isSafeInteger(orderId) || orderId < 0 || orderId > 0xffffffff) throw new TypeError("native order id must be uint32");
  return Object.freeze(["limit_order_cancel", Object.freeze({ owner: account, orderid: orderId })]);
}
