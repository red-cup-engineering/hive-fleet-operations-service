import { createHash } from "node:crypto";
import { claimsOf, recordClaim } from "./journal.mjs";
export const MARKET_CYCLE_SCHEMA = "aagaard.market-cycle.v1";
export const MARKET_CYCLE_CATEGORY = "aagaard.market-cycle-event";
const FLEET = Object.freeze([
    "emsenn0",
    "essiebee",
    "help-fund",
    "marshian",
    "michael561",
    "sigmund-vexler"
]);
function record(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
    return value;
}
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function exactDigest(source, label) {
    if (source.value !== "true") throw new TypeError(`${label} is not independently known`);
    const groups = rows(source.stateDigests, `${label} state digests`);
    if (groups.length !== 1) throw new TypeError(`${label} does not have one exact state`);
    const group = record(groups[0], `${label} state digest`);
    const stateDigest = String(group.stateDigest ?? "");
    const providers = rows(group.providers, `${label} providers`).map(String).sort();
    if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length) {
        throw new TypeError(`${label} lacks exact independent support`);
    }
    return Object.freeze({
        stateDigest,
        providers: Object.freeze(providers)
    });
}
function units8(value, label) {
    const text = String(value ?? "");
    const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(text);
    if (!match) throw new TypeError(`${label} is not an exact SWAP.HIVE amount`);
    const [whole, fraction = ""] = text.split(".");
    return BigInt(`${whole}${fraction.padEnd(8, "0")}`);
}
function format8(value) {
    const digits = value.toString().padStart(9, "0");
    return `${digits.slice(0, -8)}.${digits.slice(-8)}`;
}
function safe(value) {
    return JSON.parse(JSON.stringify(value));
}
export function marketCycleEvent(input) {
    const global = input.global;
    const triangle = input.triangle;
    const poolCycle = input.poolCycle;
    const shadow = input.shadow;
    if (global.schema !== "aagaard.global-arbitrage-scan.v1" || global.status !== "certified" || global.admittedCount !== 0 || global.executionAdmissible !== false || global.credentialAccess !== false || global.chainMutation !== false) {
        throw new TypeError("global market scan is not a certified refusal");
    }
    const globalExact = exactDigest(record(global.providerKnowledge, "global provider knowledge"), "global scan");
    const universe = record(global.universe, "global universe");
    const policy = record(global.policy, "global policy");
    const opportunities = rows(global.opportunities, "global opportunities").map((row)=>record(row, "global opportunity"));
    const near = opportunities.find((row)=>record(row.exact, "global exact quote").admitted === true && row.policyAdmitted === false);
    if (!near) throw new TypeError("global refusal lacks an exact policy near miss");
    const quote = record(record(near.exact, "near-miss exact quote").quote, "near-miss quote");
    const required = units8(policy.minimumProfitSwapHive, "required profit");
    const worst = units8(quote.worstCaseProfitSwapHive, "worst-case profit");
    if (worst >= required) throw new TypeError("near miss does not actually miss the policy floor");
    if (triangle.schema !== "aagaard.exact-triangle-assay.v1" || triangle.status !== "certified" || record(triangle.result, "triangle result").admitted !== false || triangle.executionAdmissible !== false || triangle.credentialAccess !== false || triangle.chainMutation !== false) throw new TypeError("triangle is not a certified refusal");
    const triangleExact = exactDigest(record(triangle.providerKnowledge, "triangle provider knowledge"), "triangle assay");
    const assay = record(poolCycle.assay, "pool-cycle assay");
    if (poolCycle.kind !== "aagaard.exact-pool-cycle-opportunity" || poolCycle.decision !== "refuse" || poolCycle.executionAdmissible !== false || poolCycle.credentialAccess !== false || poolCycle.chainMutation !== false || assay.status !== "certified" || record(assay.result, "pool-cycle result").admitted !== false) {
        throw new TypeError("pool cycle is not a certified refusal");
    }
    const poolExact = exactDigest(record(assay.providerKnowledge, "pool-cycle provider knowledge"), "pool-cycle assay");
    const maker = record(shadow.makerOrderScan, "fleet maker-order scan");
    const accounts = rows(shadow.accounts, "fleet accounts").map((row)=>record(row, "fleet account"));
    if (shadow.kind !== "aagaard.market-shadow-scan" || shadow.chainMutation !== false || shadow.credentialAccess !== false || maker.complete !== true || maker.orderCount !== 0 || shadow.candidateCount !== 0 || rows(shadow.executableCandidates, "fleet executable candidates").length !== 0 || accounts.length !== FLEET.length) {
        throw new TypeError("fleet shadow scan is incomplete or exposes an action");
    }
    const accountRows = accounts.map((account)=>{
        if (account.status !== "observed" || typeof account.tradingLive !== "boolean") throw new TypeError("fleet account market state is unavailable");
        return Object.freeze({
            account: String(account.account),
            swapHiveBalance: format8(units8(account.swapHiveBalance, "fleet SWAP.HIVE balance")),
            tradingLive: account.tradingLive
        });
    }).sort((left, right)=>left.account.localeCompare(right.account));
    if (JSON.stringify(accountRows.map((account)=>account.account)) !== JSON.stringify([
        ...FLEET
    ].sort()) || JSON.stringify(rows(maker.accountsObserved, "maker accounts").map(String).sort()) !== JSON.stringify([
        ...FLEET
    ].sort())) {
        throw new TypeError("fleet market or order coverage is not exact");
    }
    const total = accountRows.reduce((sum, account)=>sum + units8(account.swapHiveBalance, "fleet SWAP.HIVE balance"), 0n);
    const globalAt = new Date(String(global.observedAt)).toISOString();
    const triangleAt = new Date(String(triangle.observedAt)).toISOString();
    const poolAt = new Date(String(poolCycle.observedAt)).toISOString();
    const shadowAt = new Date(String(shadow.observedAt)).toISOString();
    const eventId = `urn:aagaard:market-cycle:${createHash("sha256").update(JSON.stringify([
        globalExact.stateDigest,
        triangleExact.stateDigest,
        poolExact.stateDigest,
        shadowAt,
        accountRows,
        maker.orderCount
    ])).digest("base64url")}`;
    return Object.freeze({
        marketCycleSchema: MARKET_CYCLE_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 34,
            angle: "market-arbitrage",
            nextAngle: "curation-attention"
        }),
        observations: Object.freeze({
            global: Object.freeze({
                observedAt: globalAt,
                stateDigest: globalExact.stateDigest,
                providers: globalExact.providers,
                poolCount: Number(universe.swapHivePoolCount),
                metricCount: Number(universe.metricCount),
                shortlistedRoutes: Number(universe.shortlistedRouteCount),
                admittedRoutes: 0
            }),
            triangle: Object.freeze({
                observedAt: triangleAt,
                stateDigest: triangleExact.stateDigest,
                providers: triangleExact.providers,
                refusal: String(triangle.refusal)
            }),
            poolCycle: Object.freeze({
                observedAt: poolAt,
                stateDigest: poolExact.stateDigest,
                providers: poolExact.providers,
                refusal: String(poolCycle.refusal)
            }),
            fleet: Object.freeze({
                observedAt: shadowAt,
                accounts: Object.freeze(accountRows),
                observedSwapHiveTotal: format8(total),
                openOrders: 0,
                executableCandidates: 0
            })
        }),
        nearMiss: Object.freeze({
            symbol: String(near.symbol),
            expectedProfitSwapHive: format8(units8(quote.expectedProfitSwapHive, "expected profit")),
            worstCaseProfitSwapHive: format8(worst),
            requiredProfitSwapHive: format8(required),
            worstCaseShortfallSwapHive: format8(required - worst),
            policyAdmitted: false
        }),
        decision: "refuse-all-no-policy-admitted-action",
        tradeBroadcast: false,
        capitalMoved: "0.00000000 SWAP.HIVE",
        realizedProfit: "0.00000000 SWAP.HIVE",
        credentialAccess: false,
        chainMutation: false,
        receipts: Object.freeze(safe({
            global,
            triangle,
            poolCycle,
            shadow
        }))
    });
}
export async function recordMarketCycle(dataDir, input) {
    const event = marketCycleEvent(input);
    const prior = claimsOf(dataDir, MARKET_CYCLE_CATEGORY).find((row)=>row.eventId === event.eventId);
    if (prior) return prior;
    recordClaim(dataDir, MARKET_CYCLE_CATEGORY, event.recordedAt, event);
    return event;
}
export async function readMarketCycles(dataDir) {
    return Object.freeze(claimsOf(dataDir, MARKET_CYCLE_CATEGORY));
}
