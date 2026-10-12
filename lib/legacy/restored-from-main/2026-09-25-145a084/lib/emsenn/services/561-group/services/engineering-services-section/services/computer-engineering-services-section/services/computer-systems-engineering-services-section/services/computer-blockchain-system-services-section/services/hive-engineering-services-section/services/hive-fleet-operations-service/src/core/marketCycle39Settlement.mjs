import { createHash } from "node:crypto";
import { claimsOf, recordClaim } from "./journal.mjs";
export const MARKET_CYCLE_39_SCHEMA = "aagaard.market-cycle-39.v1";
export const MARKET_CYCLE_39_CATEGORY = "aagaard.market-cycle-39-event";
const PRIOR_ID = "urn:aagaard:market-cycle:teJqqsmX9Dr1P0IuLkT6T_APxBXa6cUFaPBgaKhpges";
const PROCUREMENT_RESIDUE = "an A2A SEN operation must carry exactly one application/sen+cbor raw part";
const FLEET = Object.freeze([
    "emsenn0",
    "essiebee",
    "help-fund",
    "marshian",
    "michael561",
    "sigmund-vexler"
]);
function units8(value, label) {
    const text = String(value ?? "");
    const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(text);
    if (!match) throw new TypeError(`${label} must be an exact SWAP.HIVE amount`);
    const [whole, fraction = ""] = text.split(".");
    return BigInt(`${whole}${fraction.padEnd(8, "0")}`);
}
function format8(value) {
    const digits = value.toString().padStart(9, "0");
    return `${digits.slice(0, -8)}.${digits.slice(-8)}`;
}
function validateAssessment(event, label) {
    if (event.marketCycleSchema !== "aagaard.market-cycle.v1" || event.decision !== "refuse-all-no-policy-admitted-action" || event.tradeBroadcast !== false || event.credentialAccess !== false || event.chainMutation !== false || event.observations.fleet.openOrders !== 0 || event.observations.fleet.executableCandidates !== 0) {
        throw new TypeError(`${label} is not a complete no-action market assessment`);
    }
    if (!/^sha256:[0-9a-f]{64}$/u.test(event.observations.global.stateDigest)) {
        throw new TypeError(`${label} lacks an exact global state digest`);
    }
    const near = event.nearMiss;
    if (near.symbol !== "GLD" || near.expectedProfitSwapHive !== "0.00525665" || near.worstCaseProfitSwapHive !== "0.00028161" || near.requiredProfitSwapHive !== "0.00100000" || near.worstCaseShortfallSwapHive !== "0.00071839" || near.policyAdmitted !== false) {
        throw new TypeError(`${label} does not expose the exact persistent GLD near miss`);
    }
    const fleetBalances = event.observations.fleet.accounts.map((account)=>Object.freeze({
            account: account.account,
            swapHiveBalance: format8(units8(account.swapHiveBalance, `${label} ${account.account} balance`)),
            tradingLive: account.tradingLive
        })).sort((left, right)=>left.account.localeCompare(right.account));
    if (JSON.stringify(fleetBalances.map((account)=>account.account)) !== JSON.stringify([
        ...FLEET
    ].sort())) {
        throw new TypeError(`${label} does not bind the exact fleet`);
    }
    return Object.freeze({
        eventId: event.eventId,
        observedAt: new Date(event.observations.global.observedAt).toISOString(),
        globalStateDigest: event.observations.global.stateDigest,
        fleetObservedAt: new Date(event.observations.fleet.observedAt).toISOString(),
        observedSwapHiveTotal: format8(units8(event.observations.fleet.observedSwapHiveTotal, `${label} fleet total`)),
        fleetBalances: Object.freeze(fleetBalances),
        openOrders: 0,
        executableCandidates: 0
    });
}
export function marketCycle39Event(input) {
    if (input.prior.eventId !== PRIOR_ID) throw new TypeError("cycle 39 requires the exact durable cycle 34 assessment");
    if (input.current.eventId === input.prior.eventId) throw new TypeError("cycle 39 requires a fresh assessment");
    const prior = validateAssessment(input.prior, "prior assessment");
    const current = validateAssessment(input.current, "current assessment");
    if (Date.parse(current.observedAt) <= Date.parse(prior.observedAt)) throw new TypeError("current assessment is not later than prior assessment");
    if (prior.observedSwapHiveTotal !== current.observedSwapHiveTotal || JSON.stringify(prior.fleetBalances) !== JSON.stringify(current.fleetBalances)) {
        throw new TypeError("fleet balances changed between assessments");
    }
    const expected = units8("0.00525665", "expected profit");
    const worst = units8("0.00028161", "worst-case profit");
    const required = units8("0.00100000", "required profit");
    const haircut = format8(expected - worst);
    const shortfall = format8(required - worst);
    if (haircut !== "0.00497504" || shortfall !== "0.00071839") throw new TypeError("near-miss arithmetic is inconsistent");
    const residue = input.procurementResidue.trim();
    if (residue !== PROCUREMENT_RESIDUE) throw new TypeError("procurement residue is not exact");
    const assessments = Object.freeze([
        prior,
        current
    ]);
    const eventId = `urn:aagaard:market-cycle-39:${createHash("sha256").update(JSON.stringify(assessments)).digest("base64url")}`;
    return Object.freeze({
        marketCycle39Schema: MARKET_CYCLE_39_SCHEMA,
        eventId,
        recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(),
        cycle: Object.freeze({
            globalStep: 39,
            angle: "market-arbitrage",
            nextAngle: "curation-attention"
        }),
        assessments,
        persistentNearMiss: Object.freeze({
            symbol: "GLD",
            sampleCount: 2,
            expectedProfitSwapHive: "0.00525665",
            worstCaseProfitSwapHive: "0.00028161",
            requiredProfitSwapHive: "0.00100000",
            expectedToWorstCaseHaircutSwapHive: "0.00497504",
            worstCaseShortfallSwapHive: "0.00071839",
            conclusion: "gross-spread-is-not-execution-safe-edge"
        }),
        fleetBalancesUnchanged: true,
        decision: "refuse-all-no-policy-admitted-action",
        tradeBroadcast: false,
        capitalMoved: "0.00000000 SWAP.HIVE",
        realizedProfit: "0.00000000 SWAP.HIVE",
        credentialAccess: false,
        chainMutation: false,
        procurement: Object.freeze({
            status: "no-candidate-accepted",
            residue: PROCUREMENT_RESIDUE
        })
    });
}
export async function recordMarketCycle39(dataDir, input) {
    const event = marketCycle39Event(input);
    const prior = claimsOf(dataDir, MARKET_CYCLE_39_CATEGORY).find((candidate)=>candidate.eventId === event.eventId);
    if (prior) return prior;
    recordClaim(dataDir, MARKET_CYCLE_39_CATEGORY, event.recordedAt, event);
    return event;
}
export async function readMarketCycle39(dataDir) {
    return Object.freeze(claimsOf(dataDir, MARKET_CYCLE_39_CATEGORY));
}
