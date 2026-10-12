import { claimsOf, recordClaim } from "./journal.mjs";
function record(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
function decimal(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const candidate = String(value).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(candidate)) return null;
    if (!/[1-9]/.test(candidate)) return null;
    return candidate;
}
function instant(value) {
    let millis;
    if (typeof value === "number" && Number.isFinite(value)) millis = value < 10_000_000_000 ? value * 1000 : value;
    else if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const parsed = Number(value);
        millis = parsed < 10_000_000_000 ? parsed * 1000 : parsed;
    } else if (typeof value === "string") millis = Date.parse(value);
    else return null;
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}
export function normalizeMakerOpenOrder(raw, side) {
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
        kind: "aagaard.maker-open-order",
        orderKey: `${account}:${side}:${txId}`,
        account,
        symbol,
        side,
        priceSwapHivePerToken: price,
        remainingQuantity: quantity,
        remainingQuantityUnit: symbol,
        tokensLocked: Object.freeze({
            quantity: locked,
            symbol: side === "buy" ? "SWAP.HIVE" : symbol
        }),
        txId,
        timestamp,
        expiration
    });
}
function decimalParts(value) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
    const [whole = "0", fraction = ""] = value.split(".");
    return [
        BigInt(`${whole}${fraction}`),
        fraction.length
    ];
}
function compareDecimal(left, right) {
    const l = decimalParts(left);
    const r = decimalParts(right);
    if (!l || !r) return null;
    const scale = Math.max(l[1], r[1]);
    const lv = l[0] * 10n ** BigInt(scale - l[1]);
    const rv = r[0] * 10n ** BigInt(scale - r[1]);
    return lv < rv ? -1 : lv > rv ? 1 : 0;
}
export function guardFleetSelfCross(proposed, scan) {
    const normalized = Object.freeze({
        ...proposed,
        account: proposed.account.toLowerCase(),
        symbol: proposed.symbol.toUpperCase()
    });
    if (!scan?.complete) {
        return Object.freeze({
            kind: "aagaard.maker-self-cross-guard",
            admitted: false,
            proposed: normalized,
            observedAt: scan?.observedAt ?? null,
            reason: "fleet-order-reading-unavailable",
            detail: scan ? `fleet reading incomplete: ${scan.limitations.join("; ") || "unspecified coverage gap"}` : "no fleet-wide open-order reading",
            conflictingOrders: Object.freeze([])
        });
    }
    if (!decimal(proposed.priceSwapHivePerToken)) {
        return Object.freeze({
            kind: "aagaard.maker-self-cross-guard",
            admitted: false,
            proposed: normalized,
            observedAt: scan.observedAt,
            reason: "invalid-proposed-price",
            detail: "proposed price is not an exact positive decimal string",
            conflictingOrders: Object.freeze([])
        });
    }
    const opposite = proposed.side === "buy" ? "sell" : "buy";
    const fleetAccounts = new Set(scan.accountsRequested);
    const candidates = scan.orders.filter((order)=>fleetAccounts.has(order.account) && order.symbol === normalized.symbol && order.side === opposite);
    const conflicting = candidates.filter((order)=>{
        const comparison = compareDecimal(proposed.priceSwapHivePerToken, order.priceSwapHivePerToken);
        return comparison !== null && (proposed.side === "buy" ? comparison >= 0 : comparison <= 0);
    });
    if (conflicting.length > 0) {
        return Object.freeze({
            kind: "aagaard.maker-self-cross-guard",
            admitted: false,
            proposed: normalized,
            observedAt: scan.observedAt,
            reason: "fleet-self-cross",
            detail: `${proposed.side} ${normalized.symbol} at ${proposed.priceSwapHivePerToken} would cross ${conflicting.length} fleet-owned ${opposite} order(s)`,
            conflictingOrders: Object.freeze(conflicting)
        });
    }
    return Object.freeze({
        kind: "aagaard.maker-self-cross-guard",
        admitted: true,
        proposed: normalized,
        observedAt: scan.observedAt,
        fleetOrdersChecked: candidates.length
    });
}
const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
const OBSERVATION_CATEGORY = "aagaard.maker-order-observation";
const EPISODE_CATEGORY = "aagaard.maker-order-episode-event";
async function append(dataDir, category, recordedAt, value) { recordClaim(dataDir, category, recordedAt, value); }
function changes(prior, current) {
    return Object.freeze([
        ...prior.priceSwapHivePerToken === current.priceSwapHivePerToken ? [] : [
            "price"
        ],
        ...prior.remainingQuantity === current.remainingQuantity ? [] : [
            "remaining-quantity"
        ],
        ...prior.tokensLocked.quantity === current.tokensLocked.quantity && prior.tokensLocked.symbol === current.tokensLocked.symbol ? [] : [
            "tokens-locked"
        ],
        ...prior.expiration === current.expiration ? [] : [
            "expiration"
        ]
    ]);
}
function event(input) {
    return Object.freeze({
        kind: "aagaard.maker-order-episode-event",
        eventId: `${input.at}:${input.orderKey}:${input.state}`,
        ...input,
        economicOutcome: "unknown",
        realizedPnlSwapHive: null,
        hbdValuation: null
    });
}
export async function readMakerOrderEpisodeEvents(dataDir) {
    return claimsOf(dataDir, EPISODE_CATEGORY);
}
export async function readMakerOrderScans(dataDir, limit) {
    const scans = claimsOf(dataDir, OBSERVATION_CATEGORY);
    return Object.freeze(limit === undefined ? scans : scans.slice(-limit));
}
export function foldMakerOrderEpisodes(events) {
    const episodes = new Map();
    for (const row of [
        ...events
    ].sort((left, right)=>left.at.localeCompare(right.at) || left.eventId.localeCompare(right.eventId))){
        const prior = episodes.get(row.orderKey);
        episodes.set(row.orderKey, Object.freeze({
            kind: "aagaard.maker-order-episode",
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
            economicOutcome: "unknown",
            realizedPnlSwapHive: null,
            hbdValuation: null
        }));
    }
    return Object.freeze([
        ...episodes.values()
    ].sort((left, right)=>left.orderKey.localeCompare(right.orderKey)));
}
export async function readMakerOrderEpisodes(dataDir) {
    return foldMakerOrderEpisodes(await readMakerOrderEpisodeEvents(dataDir));
}
export async function recordMakerOrderScan(dataDir, scan) {
    const existing = await readMakerOrderEpisodeEvents(dataDir);
    const existingIds = new Set(existing.map((row)=>row.eventId));
    const priorEpisodes = new Map(foldMakerOrderEpisodes(existing).map((row)=>[
            row.orderKey,
            row
        ]));
    const current = new Map(scan.orders.map((order)=>[
            order.orderKey,
            order
        ]));
    const emitted = [];
    for (const order of scan.orders){
        const prior = priorEpisodes.get(order.orderKey)?.latestOrder ?? null;
        const changedFields = prior ? changes(prior, order) : Object.freeze([]);
        const state = changedFields.length > 0 ? "changed-or-partial" : "observed-open";
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
            changedFields
        }));
    }
    if (scan.complete) {
        const requestedAccounts = new Set(scan.accountsRequested);
        for (const prior of priorEpisodes.values()){
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
                changedFields: Object.freeze([])
            }));
        }
    }
    await append(dataDir, OBSERVATION_CATEGORY, scan.observedAt, scan);
    const novel = emitted.filter((row)=>!existingIds.has(row.eventId));
    await Promise.all(novel.map((row)=>append(dataDir, EPISODE_CATEGORY, row.at, row)));
    return Object.freeze(novel);
}
