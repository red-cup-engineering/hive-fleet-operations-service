import { claimsOf, recordClaim } from "./journal.mjs";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { isNiUri, niUriDigest } from "@red-cup-engineering/uri-services-section/ni-uri";
export const MARKET_ASSAY_SCHEMA = "aagaard.market-assay-settlement.v1";
export const MARKET_ASSAY_CATEGORY = "aagaard.market-assay-event";
function certifiedDigest(knowledge, label) {
    if (knowledge.stateDigests.length !== 1) throw new TypeError(`${label} must contain exactly one certified state digest`);
    const row = knowledge.stateDigests[0];
    if (!isNiUri(row.stateDigest) || new Set(row.providers).size < 2) {
        throw new TypeError(`${label} lacks independent exact-state support`);
    }
    return row;
}
function senSafe(value) {
    return JSON.parse(JSON.stringify(value));
}
export function marketAssaySettlementEvent(input) {
    if (input.global.status !== "certified" || input.global.providerKnowledge.value !== "true" || input.global.admittedCount !== 0 || input.global.credentialAccess !== false || input.global.chainMutation !== false || input.global.executionAdmissible !== false) {
        throw new TypeError("global scan is not a certified non-mutating refusal");
    }
    if (input.poolCycle.assay.status !== "certified" || input.poolCycle.assay.providerKnowledge.value !== "true" || input.poolCycle.decision !== "refuse" || input.poolCycle.credentialAccess !== false || input.poolCycle.chainMutation !== false || input.poolCycle.executionAdmissible !== false) {
        throw new TypeError("pool-cycle assay is not a certified non-mutating refusal");
    }
    if (input.fleetOrders.complete !== true || input.fleetOrders.orderCount !== 0 || input.fleetOrders.candidateCount !== 0 || !Number.isSafeInteger(input.fleetOrders.accountCount) || input.fleetOrders.accountCount < 1) {
        throw new TypeError("fleet-order evidence is incomplete or exposes a candidate");
    }
    const global = certifiedDigest(input.global.providerKnowledge, "global scan");
    const poolCycle = certifiedDigest(input.poolCycle.assay.providerKnowledge, "pool-cycle assay");
    const globalAt = new Date(input.global.observedAt).toISOString();
    const poolAt = new Date(input.poolCycle.observedAt).toISOString();
    const fleetAt = new Date(input.fleetOrders.observedAt).toISOString();
    const digest = niUriDigest(semanticId([
        globalAt,
        global.stateDigest,
        fleetAt,
        input.fleetOrders.accountCount,
        poolAt,
        poolCycle.stateDigest
    ]));
    return Object.freeze({
        marketAssaySchema: MARKET_ASSAY_SCHEMA,
        eventId: `urn:aagaard:market-assay:${digest}`,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 29,
            angle: "market-arbitrage"
        }),
        observations: Object.freeze({
            global: Object.freeze({
                observedAt: globalAt,
                stateDigest: global.stateDigest,
                certifyingProviders: Object.freeze([
                    ...global.providers
                ].sort()),
                admittedCount: 0,
                refusal: input.global.refusal
            }),
            fleetOrders: Object.freeze({
                observedAt: fleetAt,
                complete: true,
                accountCount: input.fleetOrders.accountCount,
                orderCount: 0,
                candidateCount: 0
            }),
            poolCycle: Object.freeze({
                observedAt: poolAt,
                stateDigest: poolCycle.stateDigest,
                certifyingProviders: Object.freeze([
                    ...poolCycle.providers
                ].sort()),
                decision: "refuse",
                refusal: input.poolCycle.refusal
            })
        }),
        tradeBroadcast: false,
        credentialAccess: false,
        chainMutation: false,
        capitalMoved: "0.00000000 SWAP.HIVE",
        realizedProfit: "0.00000000 SWAP.HIVE",
        receipts: Object.freeze({
            global: senSafe(input.global),
            poolCycle: senSafe(input.poolCycle)
        })
    });
}
export async function recordMarketAssaySettlement(dataDir, input) {
    const event = marketAssaySettlementEvent(input);
    recordClaim(dataDir, MARKET_ASSAY_CATEGORY, event.recordedAt ?? event.observedAt ?? new Date().toISOString(), event);
    return event;
}
export async function readMarketAssaySettlements(dataDir) {
    return claimsOf(dataDir, MARKET_ASSAY_CATEGORY);
}
