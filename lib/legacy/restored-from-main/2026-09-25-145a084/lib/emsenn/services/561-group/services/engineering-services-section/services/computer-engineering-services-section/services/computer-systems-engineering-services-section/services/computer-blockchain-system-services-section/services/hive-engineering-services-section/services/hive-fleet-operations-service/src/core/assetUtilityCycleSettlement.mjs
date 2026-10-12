import { createHash } from "node:crypto";
import { assertPlainObject as record } from "./objectGuards.mjs";
export const ASSET_UTILITY_CYCLE_SCHEMA = "aagaard.asset-utility-cycle.v1";
export const ASSET_UTILITY_CYCLE_CATEGORY = "aagaard.asset-utility-cycle-event";
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
function rows(value, label) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
export function assetUtilityCycleEvent(input) {
    const audit = input.audit;
    if (audit.kind !== "aagaard.income-token-audit" || audit.mode !== "record-verified-distributions" || audit.credentialAccess !== false || audit.chainMutation !== false) throw new TypeError("cycle requires a read-only recorded income-token audit");
    const position = record(audit.position, "BRO position");
    const sourceAgreement = record(position.sourceAgreement, "BRO source agreement");
    const realized = record(position.realized, "BRO realized income");
    const latest = record(realized.latest, "BRO latest income");
    const projection = record(position.projection, "BRO projection");
    if (position.account !== "emsenn0" || position.symbol !== "BRO" || position.payer !== "brodivs" || sourceAgreement.distributionCount !== 2 || rows(sourceAgreement.providers, "BRO Hive providers").length < 2 || realized.scanTotal !== "0.006 HIVE" || realized.yearToDate !== "0.000 HIVE" || latest.timestamp !== "2025-10-18T10:17:21.000Z" || latest.reportedHolding !== "2.02059643" || projection.annualizedNativeHive !== "0.156000 HIVE" || projection.status !== "historical-run-rate-not-guaranteed" || position.decision !== "manual-review") throw new TypeError("BRO position does not prove the exact stale-income refusal");
    const exit = record(position.exit, "BRO exit");
    const knowledge = record(exit.providerKnowledge, "BRO exit knowledge");
    const digestRows = rows(knowledge.stateDigests, "BRO exit state digests");
    if (exit.status !== "certified" || exit.symbol !== "BRO" || exit.requestedQuantity !== "2.02059643" || knowledge.value !== "true" || digestRows.length !== 1) throw new TypeError("BRO exit is not independently certified");
    const digestRow = record(digestRows[0], "BRO exit digest");
    const stateDigest = String(digestRow.stateDigest ?? "");
    const providers = rows(digestRow.providers, "BRO exit providers").map(String).sort();
    const valuation = record(exit.valuation, "BRO exit valuation");
    if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2 || new Set(providers).size !== providers.length || valuation.completeExit !== true || valuation.grossDepthProceeds !== "0.00060617") throw new TypeError("BRO exit exact evidence is malformed");
    const distributions = [
        ...input.distributions
    ].sort((left, right)=>left.source.historyIndex - right.source.historyIndex);
    if (distributions.length !== 2 || distributions.some((event)=>event.source.account !== "emsenn0" || event.source.symbol !== "BRO" || event.source.payer !== "brodivs" || event.realization.asset !== "HIVE") || JSON.stringify(distributions.map((event)=>event.source.historyIndex)) !== JSON.stringify([
        219288,
        219529
    ])) {
        throw new TypeError("cycle requires the two exact durable BRO distribution events");
    }
    const eventIds = Object.freeze(distributions.map((event)=>event.eventId));
    const residue = input.procurementResidue.trim();
    if (residue !== "an A2A SEN operation must carry exactly one application/sen+cbor raw part") throw new TypeError("procurement residue is not exact");
    const eventId = `urn:aagaard:asset-utility-cycle:${createHash("sha256").update(JSON.stringify([
        stateDigest,
        eventIds
    ])).digest("base64url")}`;
    return Object.freeze({
        assetUtilityCycleSchema: ASSET_UTILITY_CYCLE_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 36,
            angle: "asset-utility-yield",
            nextAngle: "product-revenue"
        }),
        position: Object.freeze({
            account: "emsenn0",
            symbol: "BRO",
            payer: "brodivs",
            quantity: "2.02059643",
            settledDistributionEventIds: eventIds,
            settledDistributionCount: 2,
            observedNativeHive: "0.006 HIVE",
            latestDistributionAt: "2025-10-18T10:17:21.000Z",
            historicalAnnualizedNativeHive: "0.156000 HIVE",
            currentYieldClaim: false,
            exitStateDigest: stateDigest,
            exitProviders: Object.freeze(providers),
            completeDisplayedExitSwapHive: "0.00060617"
        }),
        decision: "preserve-bro-and-require-manual-review-of-stale-income",
        capitalMoved: "0.00000000 SWAP.HIVE",
        realizedCycleIncome: "0.000 HIVE",
        credentialAccess: false,
        chainMutation: false,
        priorArt: Object.freeze([
            Object.freeze({
                source: "src/core/incomeTokenSettlement.mts",
                adopted: "Recognize income only from exact beneficiary-bound native-HIVE transfers."
            }),
            Object.freeze({
                source: "scripts/income-token-audit.mjs",
                adopted: "Require multi-provider history agreement and an exact payer per admitted symbol."
            }),
            Object.freeze({
                source: "src/core/exitTightness.mts",
                adopted: "Carry complete displayed exit depth beside utility without treating it as realized profit."
            })
        ]),
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue
        })
    });
}
export async function recordAssetUtilityCycle(_dataDir, input) {
    return assetUtilityCycleEvent(input);
}
export async function readAssetUtilityCycles(_dataDir) {
    throw new Error("asset-utility reports are retired");
}
