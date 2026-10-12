import { readSettlementRecords, recordSettlementRecord } from "@emsenn/rwil-rdf-services/client";

/** A fleet-owned order that was observed in Hive-Engine's live market
 * contract tables. Prices are SWAP.HIVE per token. `remainingQuantity` is
 * always in `symbol`; a bid locks SWAP.HIVE while an ask locks the token.
 * Decimal strings are retained so the custody observation does not lose
 * precision through JavaScript numbers. */
export interface MakerOpenOrder {
  readonly kind: "aagaard.maker-open-order";
  readonly orderKey: string;
  readonly account: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly priceSwapHivePerToken: string;
  readonly remainingQuantity: string;
  readonly remainingQuantityUnit: string;
  readonly tokensLocked: {
    readonly quantity: string;
    readonly symbol: string;
  };
  readonly txId: string;
  readonly timestamp: string;
  readonly expiration: string;
}

export interface MakerOrderScan {
  readonly kind: "aagaard.maker-order-scan";
  readonly observedAt: string;
  readonly source: "hive-engine.market.buyBook+sellBook";
  readonly accountsRequested: readonly string[];
  /** An account is observed only when both its buyBook and sellBook reads
   * succeeded and neither result hit the configured row limit. */
  readonly accountsObserved: readonly string[];
  readonly complete: boolean;
  readonly orders: readonly MakerOpenOrder[];
  readonly limitations: readonly string[];
}

export type MakerOrderEpisodeState = "observed-open" | "changed-or-partial" | "disappeared-unknown";

export interface MakerOrderEpisodeEvent {
  readonly kind: "aagaard.maker-order-episode-event";
  readonly eventId: string;
  readonly orderKey: string;
  readonly account: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly state: MakerOrderEpisodeState;
  readonly at: string;
  readonly observationSource: MakerOrderScan["source"];
  readonly current: MakerOpenOrder | null;
  readonly prior: MakerOpenOrder | null;
  readonly changedFields: readonly ("price" | "remaining-quantity" | "tokens-locked" | "expiration")[];
  /** An order's disappearance from the open table has several lawful causes.
   * Until transaction/event evidence identifies one, no fill, cancellation,
   * expiration, proceeds, or profit is asserted. */
  readonly economicOutcome: "unknown";
  readonly realizedPnlSwapHive: null;
  readonly hbdValuation: null;
}

export interface MakerOrderEpisode {
  readonly kind: "aagaard.maker-order-episode";
  readonly orderKey: string;
  readonly account: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly state: MakerOrderEpisodeState;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly disappearedAt: string | null;
  readonly observationCount: number;
  readonly changeCount: number;
  readonly latestOrder: MakerOpenOrder | null;
  readonly economicOutcome: "unknown";
  readonly realizedPnlSwapHive: null;
  readonly hbdValuation: null;
}

export interface ProposedMakerOrder {
  readonly account: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly priceSwapHivePerToken: string;
}

export type MakerSelfCrossGuard = Readonly<{
  kind: "aagaard.maker-self-cross-guard";
  admitted: true;
  proposed: ProposedMakerOrder;
  observedAt: string;
  fleetOrdersChecked: number;
}> | Readonly<{
  kind: "aagaard.maker-self-cross-guard";
  admitted: false;
  proposed: ProposedMakerOrder;
  observedAt: string | null;
  reason: "fleet-order-reading-unavailable" | "invalid-proposed-price" | "fleet-self-cross";
  detail: string;
  conflictingOrders: readonly MakerOpenOrder[];
}>;

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function decimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const candidate = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate)) return null;
  if (!/[1-9]/.test(candidate)) return null;
  return candidate;
}

function instant(value: unknown): string | null {
  let millis: number;
  if (typeof value === "number" && Number.isFinite(value)) millis = value < 10_000_000_000 ? value * 1000 : value;
  else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    millis = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  } else if (typeof value === "string") millis = Date.parse(value);
  else return null;
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

/** Normalize one row from market.buyBook or market.sellBook. Malformed rows
 * are refused rather than repaired with guessed units or times. */
export function normalizeMakerOpenOrder(raw: unknown, side: "buy" | "sell"): MakerOpenOrder | null {
  const row = record(raw);
  const account = typeof row["account"] === "string" ? row["account"].trim().toLowerCase() : "";
  const symbol = typeof row["symbol"] === "string" ? row["symbol"].trim().toUpperCase() : "";
  const txId = typeof row["txId"] === "string" ? row["txId"].trim() : "";
  const price = decimal(row["price"]);
  const quantity = decimal(row["quantity"]);
  const timestamp = instant(row["timestamp"]);
  const expiration = instant(row["expiration"]);
  const locked = side === "buy" ? decimal(row["tokensLocked"]) : quantity;
  if (account === "" || symbol === "" || txId === "" || !price || !quantity || !timestamp || !expiration || !locked) return null;
  return Object.freeze({
    kind: "aagaard.maker-open-order" as const,
    orderKey: `${account}:${side}:${txId}`,
    account,
    symbol,
    side,
    priceSwapHivePerToken: price,
    remainingQuantity: quantity,
    remainingQuantityUnit: symbol,
    tokensLocked: Object.freeze({ quantity: locked, symbol: side === "buy" ? "SWAP.HIVE" : symbol }),
    txId,
    timestamp,
    expiration,
  });
}

function decimalParts(value: string): readonly [bigint, number] | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  return [BigInt(`${whole}${fraction}`), fraction.length] as const;
}

function compareDecimal(left: string, right: string): number | null {
  const l = decimalParts(left);
  const r = decimalParts(right);
  if (!l || !r) return null;
  const scale = Math.max(l[1], r[1]);
  const lv = l[0] * 10n ** BigInt(scale - l[1]);
  const rv = r[0] * 10n ** BigInt(scale - r[1]);
  return lv < rv ? -1 : lv > rv ? 1 : 0;
}

/** Pure fleet-wide crossing refusal. Hive-Engine's current market.js matches
 * every price-compatible order and does not exclude the same account (or a
 * second account controlled by this fleet), so equality is a crossing too. */
export function guardFleetSelfCross(proposed: ProposedMakerOrder, scan: MakerOrderScan | null | undefined): MakerSelfCrossGuard {
  const normalized = Object.freeze({ ...proposed, account: proposed.account.toLowerCase(), symbol: proposed.symbol.toUpperCase() });
  if (!scan?.complete) {
    return Object.freeze({
      kind: "aagaard.maker-self-cross-guard" as const,
      admitted: false as const,
      proposed: normalized,
      observedAt: scan?.observedAt ?? null,
      reason: "fleet-order-reading-unavailable" as const,
      detail: scan ? `fleet reading incomplete: ${scan.limitations.join("; ") || "unspecified coverage gap"}` : "no fleet-wide open-order reading",
      conflictingOrders: Object.freeze([]),
    });
  }
  if (!decimal(proposed.priceSwapHivePerToken)) {
    return Object.freeze({
      kind: "aagaard.maker-self-cross-guard" as const,
      admitted: false as const,
      proposed: normalized,
      observedAt: scan.observedAt,
      reason: "invalid-proposed-price" as const,
      detail: "proposed price is not an exact positive decimal string",
      conflictingOrders: Object.freeze([]),
    });
  }
  const opposite = proposed.side === "buy" ? "sell" : "buy";
  const fleetAccounts = new Set(scan.accountsRequested);
  const candidates = scan.orders.filter((order) => fleetAccounts.has(order.account) && order.symbol === normalized.symbol && order.side === opposite);
  const conflicting = candidates.filter((order) => {
    const comparison = compareDecimal(proposed.priceSwapHivePerToken, order.priceSwapHivePerToken);
    return comparison !== null && (proposed.side === "buy" ? comparison >= 0 : comparison <= 0);
  });
  if (conflicting.length > 0) {
    return Object.freeze({
      kind: "aagaard.maker-self-cross-guard" as const,
      admitted: false as const,
      proposed: normalized,
      observedAt: scan.observedAt,
      reason: "fleet-self-cross" as const,
      detail: `${proposed.side} ${normalized.symbol} at ${proposed.priceSwapHivePerToken} would cross ${conflicting.length} fleet-owned ${opposite} order(s)`,
      conflictingOrders: Object.freeze(conflicting),
    });
  }
  return Object.freeze({
    kind: "aagaard.maker-self-cross-guard" as const,
    admitted: true as const,
    proposed: normalized,
    observedAt: scan.observedAt,
    fleetOrdersChecked: candidates.length,
  });
}

const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
const OBSERVATION_CATEGORY = "aagaard.maker-order-observation";
const EPISODE_CATEGORY = "aagaard.maker-order-episode-event";

function rwilAgent(): string {
  const agent = process.env["RWIL_RDF_AGENT"];
  if (!agent) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  return agent;
}

async function append(dataDir: string, category: string, recordedAt: string, value: unknown): Promise<void> {
  await recordSettlementRecord({
    agentUrl: rwilAgent(),
    root: dataDir,
    nodeId: "aagaard",
    settlement: AAGAARD_SETTLEMENT,
    actor: AAGAARD_ACTOR,
    category,
    recordedAt,
    record: value,
  });
}

function changes(prior: MakerOpenOrder, current: MakerOpenOrder): MakerOrderEpisodeEvent["changedFields"] {
  return Object.freeze([
    ...(prior.priceSwapHivePerToken === current.priceSwapHivePerToken ? [] : ["price" as const]),
    ...(prior.remainingQuantity === current.remainingQuantity ? [] : ["remaining-quantity" as const]),
    ...(prior.tokensLocked.quantity === current.tokensLocked.quantity && prior.tokensLocked.symbol === current.tokensLocked.symbol ? [] : ["tokens-locked" as const]),
    ...(prior.expiration === current.expiration ? [] : ["expiration" as const]),
  ]);
}

function event(input: Omit<MakerOrderEpisodeEvent, "kind" | "eventId" | "economicOutcome" | "realizedPnlSwapHive" | "hbdValuation">): MakerOrderEpisodeEvent {
  return Object.freeze({
    kind: "aagaard.maker-order-episode-event" as const,
    eventId: `${input.at}:${input.orderKey}:${input.state}`,
    ...input,
    economicOutcome: "unknown" as const,
    realizedPnlSwapHive: null,
    hbdValuation: null,
  });
}

export function readMakerOrderEpisodeEvents(dataDir: string): readonly MakerOrderEpisodeEvent[] {
  return Object.freeze((readSettlementRecords(dataDir, EPISODE_CATEGORY) as readonly MakerOrderEpisodeEvent[])
    .filter((row) => row?.kind === "aagaard.maker-order-episode-event")
    .sort((left, right) => left.at.localeCompare(right.at) || left.eventId.localeCompare(right.eventId)));
}

export function readMakerOrderScans(dataDir: string, limit?: number): readonly MakerOrderScan[] {
  const rows = (readSettlementRecords(dataDir, OBSERVATION_CATEGORY) as readonly MakerOrderScan[])
    .filter((row) => row?.kind === "aagaard.maker-order-scan")
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  return Object.freeze(limit === undefined ? rows : rows.slice(-Math.max(0, Math.floor(limit))));
}

export function foldMakerOrderEpisodes(events: readonly MakerOrderEpisodeEvent[]): readonly MakerOrderEpisode[] {
  const episodes = new Map<string, MakerOrderEpisode>();
  for (const row of [...events].sort((left, right) => left.at.localeCompare(right.at) || left.eventId.localeCompare(right.eventId))) {
    const prior = episodes.get(row.orderKey);
    episodes.set(row.orderKey, Object.freeze({
      kind: "aagaard.maker-order-episode" as const,
      orderKey: row.orderKey,
      account: row.account,
      symbol: row.symbol,
      side: row.side,
      state: row.state,
      firstObservedAt: prior?.firstObservedAt ?? row.at,
      lastObservedAt: row.at,
      disappearedAt: row.state === "disappeared-unknown" ? row.at : null,
      observationCount: (prior?.observationCount ?? 0) + (row.current ? 1 : 0),
      changeCount: (prior?.changeCount ?? 0) + (row.state === "changed-or-partial" ? 1 : 0),
      latestOrder: row.current,
      economicOutcome: "unknown" as const,
      realizedPnlSwapHive: null,
      hbdValuation: null,
    }));
  }
  return Object.freeze([...episodes.values()].sort((left, right) => left.orderKey.localeCompare(right.orderKey)));
}

export function readMakerOrderEpisodes(dataDir: string): readonly MakerOrderEpisode[] {
  return foldMakerOrderEpisodes(readMakerOrderEpisodeEvents(dataDir));
}

/** Append one raw fleet observation and the episode events it warrants.
 * Disappearance events are only emitted for a complete fleet reading. */
export async function recordMakerOrderScan(dataDir: string, scan: MakerOrderScan): Promise<readonly MakerOrderEpisodeEvent[]> {
  const existing = readMakerOrderEpisodeEvents(dataDir);
  const existingIds = new Set(existing.map((row) => row.eventId));
  const priorEpisodes = new Map(foldMakerOrderEpisodes(existing).map((row) => [row.orderKey, row] as const));
  const current = new Map(scan.orders.map((order) => [order.orderKey, order] as const));
  const emitted: MakerOrderEpisodeEvent[] = [];

  for (const order of scan.orders) {
    const prior = priorEpisodes.get(order.orderKey)?.latestOrder ?? null;
    const changedFields = prior ? changes(prior, order) : Object.freeze([]);
    const state: MakerOrderEpisodeState = changedFields.length > 0 ? "changed-or-partial" : "observed-open";
    emitted.push(event({
      orderKey: order.orderKey,
      account: order.account,
      symbol: order.symbol,
      side: order.side,
      state,
      at: scan.observedAt,
      observationSource: scan.source,
      current: order,
      prior,
      changedFields,
    }));
  }
  if (scan.complete) {
    const requestedAccounts = new Set(scan.accountsRequested);
    for (const prior of priorEpisodes.values()) {
      if (!requestedAccounts.has(prior.account) || prior.state === "disappeared-unknown" || current.has(prior.orderKey) || !prior.latestOrder) continue;
      emitted.push(event({
        orderKey: prior.orderKey,
        account: prior.account,
        symbol: prior.symbol,
        side: prior.side,
        state: "disappeared-unknown",
        at: scan.observedAt,
        observationSource: scan.source,
        current: null,
        prior: prior.latestOrder,
        changedFields: Object.freeze([]),
      }));
    }
  }

  await append(dataDir, OBSERVATION_CATEGORY, scan.observedAt, scan);
  const novel = emitted.filter((row) => !existingIds.has(row.eventId));
  await Promise.all(novel.map((row) => append(dataDir, EPISODE_CATEGORY, row.at, row)));
  return Object.freeze(novel);
}
