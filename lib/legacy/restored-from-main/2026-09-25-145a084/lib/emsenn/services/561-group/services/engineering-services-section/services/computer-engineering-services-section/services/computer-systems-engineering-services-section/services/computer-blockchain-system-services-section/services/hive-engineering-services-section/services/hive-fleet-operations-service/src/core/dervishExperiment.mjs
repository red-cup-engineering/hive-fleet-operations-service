import { claimsOf, recordClaim } from "./journal.mjs";
import { createHash } from "node:crypto";
export const DERVISH_EXPERIMENT_SCHEMA = "aagaard.dervish-experiment.v1";
export const DERVISH_EXPERIMENT_CATEGORY = "aagaard.dervish-coupled-trial-observation";
export const DERVISH_PERIOD_STEPS = 30;
const AAGAARD_SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const AAGAARD_ACTOR = "urn:ame:aagaard";
export const DERVISH_FORMAL_BASIS = Object.freeze({
    carrier: "Obsmetrologia.QuantumContextuality.DisclinationLink.link_frame_injective/link_frame_surjective",
    finiteCrtSchedule: "theorem-grounded",
    fleetApplication: "experimental-carrier",
    quasicrystalCircuitInterpretation: "hypothesis-not-proved"
});
export const DERVISH_LENSES = Object.freeze([
    Object.freeze({
        id: "reward-route-settlement",
        family: "reward route and settlement",
        sourceModules: Object.freeze([
            "analysis/reward",
            "core/curationSettlement"
        ])
    }),
    Object.freeze({
        id: "temporal-timing",
        family: "temporal timing",
        sourceModules: Object.freeze([
            "analysis/timing"
        ])
    }),
    Object.freeze({
        id: "spectral-field",
        family: "spectral field",
        sourceModules: Object.freeze([
            "analysis/spectral"
        ])
    }),
    Object.freeze({
        id: "social-topology-cartel-bridge",
        family: "social topology, cartel, and bridge",
        sourceModules: Object.freeze([
            "analysis/graph",
            "analysis/rigidity"
        ])
    }),
    Object.freeze({
        id: "market-liquidity-flow",
        family: "market liquidity and flow",
        sourceModules: Object.freeze([
            "analysis/capacity",
            "analysis/flow",
            "analysis/holonomy"
        ])
    })
]);
function finiteIndex(value, modulus, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a non-negative safe integer`);
    }
    return value % modulus;
}
export function makeSixWalletRoster(accounts) {
    if (accounts.length !== 6) throw new RangeError("a dervish roster must contain exactly six accounts");
    const normalized = accounts.map((account)=>account.trim());
    if (normalized.some((account)=>account.length === 0)) throw new TypeError("dervish roster accounts must be non-empty");
    if (new Set(normalized).size !== 6) throw new TypeError("dervish roster accounts must be distinct");
    return Object.freeze(normalized);
}
export function readDervishScheduleStep(globalStep, roster) {
    const boundaryStep = finiteIndex(globalStep, DERVISH_PERIOD_STEPS, "globalStep");
    const site = finiteIndex(boundaryStep, 5, "boundaryStep");
    const phase = finiteIndex(boundaryStep, 6, "boundaryStep");
    return Object.freeze({
        dervishExperimentSchema: DERVISH_EXPERIMENT_SCHEMA,
        globalStep,
        cycle: Math.floor(globalStep / DERVISH_PERIOD_STEPS),
        boundaryStep,
        site,
        lens: DERVISH_LENSES[site],
        phase,
        account: roster[phase],
        formalBasis: DERVISH_FORMAL_BASIS
    });
}
export function dervishBoundaryStepForPair(site, phase) {
    const admittedSite = finiteIndex(site, 5, "site");
    const admittedPhase = finiteIndex(phase, 6, "phase");
    if (admittedSite !== site) throw new RangeError("site must be in [0, 4]");
    if (admittedPhase !== phase) throw new RangeError("phase must be in [0, 5]");
    return (6 * admittedSite + 25 * admittedPhase) % DERVISH_PERIOD_STEPS;
}
function isTrialObservation(value) {
    if (value === null || typeof value !== "object") return false;
    const record = value;
    if (record["dervishExperimentSchema"] !== DERVISH_EXPERIMENT_SCHEMA || record["kind"] !== "aagaard.dervish-coupled-trial-observation") return false;
    const coordinate = record["coordinate"];
    return coordinate !== null && typeof coordinate === "object" && Number.isSafeInteger(coordinate["globalStep"]);
}
const DERVISH_TRIAL_CATEGORY = "aagaard.dervish-coupled-trial-observation";
export async function readDervishTrialObservations(dataDir) {
    return Object.freeze(claimsOf(dataDir, DERVISH_TRIAL_CATEGORY).filter(isTrialObservation));
}
export async function nextDervishGlobalStep(dataDir) {
    const prior = await readDervishTrialObservations(dataDir);
    return prior.reduce((latest, observation)=>Math.max(latest, observation.coordinate.globalStep), -1) + 1;
}
export async function recordDervishTrialObservation(dataDir, observation) {
    if (!isTrialObservation(observation)) throw new TypeError("not a Dervish coupled-trial observation");
    recordClaim(dataDir, DERVISH_TRIAL_CATEGORY, observation.observedAt ?? observation.at ?? new Date().toISOString(), observation);
}
function targetOf(key) {
    const separator = key.indexOf("/");
    return Object.freeze({
        key,
        author: separator > 0 ? key.slice(0, separator) : null,
        permlink: separator > 0 && separator < key.length - 1 ? key.slice(separator + 1) : null
    });
}
function voteObservation(account, receipt, predictions) {
    const target = targetOf(receipt.target);
    if (receipt.status !== "broadcast") {
        return Object.freeze({
            target,
            execution: Object.freeze({
                status: receipt.status,
                actualVoteCast: false,
                transactionId: null
            }),
            curationSettlement: Object.freeze({
                status: "not-applicable",
                predictionId: null,
                settlementSourceId: null,
                rewardVests: null
            })
        });
    }
    if (typeof receipt.txId !== "string" || receipt.txId.length === 0) {
        return Object.freeze({
            target,
            execution: Object.freeze({
                status: "broadcast-unverified",
                actualVoteCast: false,
                transactionId: null
            }),
            curationSettlement: Object.freeze({
                status: "broadcast-without-prediction-link",
                predictionId: null,
                settlementSourceId: null,
                rewardVests: null
            })
        });
    }
    const prediction = predictions.find((event)=>event.account === account && event.author === target.author && event.permlink === target.permlink && event.vote.txId === receipt.txId);
    return Object.freeze({
        target,
        execution: Object.freeze({
            status: "broadcast",
            actualVoteCast: true,
            transactionId: receipt.txId
        }),
        curationSettlement: prediction ? Object.freeze({
            status: "pending",
            predictionId: prediction.predictionId,
            settlementSourceId: null,
            rewardVests: null
        }) : Object.freeze({
            status: "broadcast-without-prediction-link",
            predictionId: null,
            settlementSourceId: null,
            rewardVests: null
        })
    });
}
function marketReceiptReference(receipt) {
    const effect = receipt.economicEffect;
    if (!effect) return null;
    return `${effect.source}#${effect.reference ?? receipt.target}`;
}
function marketExecution(receipts) {
    if (receipts.length === 0) {
        return Object.freeze({
            status: "not-run",
            realizedPnlSwapHive: null,
            economicEffectReferences: Object.freeze([])
        });
    }
    const references = Object.freeze(receipts.flatMap((receipt)=>{
        const reference = marketReceiptReference(receipt);
        return reference ? [
            reference
        ] : [];
    }));
    const broadcasts = receipts.filter((receipt)=>receipt.status === "broadcast");
    const hasError = receipts.some((receipt)=>receipt.status === "error");
    const provenRoundTrips = broadcasts.filter((receipt)=>receipt.action === "trade-bundle" && receipt.economicEffect?.status === "confirmed" && receipt.economicEffect.expectedLegs === 2 && receipt.economicEffect.confirmedLegs === 2 && typeof receipt.economicEffect.realizedPnlSwapHive === "number" && Number.isFinite(receipt.economicEffect.realizedPnlSwapHive));
    if (!hasError && broadcasts.length > 0 && provenRoundTrips.length === broadcasts.length) {
        return Object.freeze({
            status: "confirmed-complete-round-trip",
            realizedPnlSwapHive: Number(provenRoundTrips.reduce((sum, receipt)=>sum + receipt.economicEffect.realizedPnlSwapHive, 0).toFixed(8)),
            economicEffectReferences: references
        });
    }
    const status = hasError ? "error" : broadcasts.length > 0 ? "confirmation-incomplete" : receipts.some((receipt)=>receipt.status === "dry-run") ? "dry-run" : receipts.every((receipt)=>receipt.status === "skipped" || receipt.status === "propose-only") ? "refused" : "confirmation-incomplete";
    return Object.freeze({
        status,
        realizedPnlSwapHive: null,
        economicEffectReferences: references
    });
}
export function buildDervishTrialObservation(input) {
    const votes = Object.freeze(input.votingReceipts.filter((receipt)=>receipt.lane === "voting" && receipt.action === "vote").map((receipt)=>voteObservation(input.coordinate.account, receipt, input.curationPredictions)));
    const settlements = Object.freeze((input.curationSettlements ?? []).map((event)=>event.matchedPredictionId ? Object.freeze({
            status: "matched",
            predictionId: event.matchedPredictionId,
            settlementSourceId: event.source.sourceId,
            rewardVests: event.source.reward
        }) : Object.freeze({
            status: "observed-without-local-vote-link",
            predictionId: null,
            settlementSourceId: event.source.sourceId,
            rewardVests: event.source.reward
        })));
    const marketReceipts = Object.freeze(input.tradingReceipts.filter((receipt)=>receipt.lane === "trading"));
    const identity = JSON.stringify([
        input.coordinate.globalStep,
        input.observedAt,
        input.coordinate.account,
        votes.map((vote)=>[
                vote.target.key,
                vote.execution.status,
                vote.execution.transactionId,
                vote.curationSettlement.status,
                vote.curationSettlement.predictionId
            ]),
        settlements.map((settlement)=>[
                settlement.status,
                settlement.predictionId,
                settlement.settlementSourceId,
                settlement.rewardVests?.amount ?? null
            ]),
        marketReceipts.map((receipt)=>[
                receipt.action,
                receipt.target,
                receipt.status,
                receipt.txId ?? null,
                receipt.economicEffect ?? null
            ])
    ]);
    return Object.freeze({
        dervishExperimentSchema: DERVISH_EXPERIMENT_SCHEMA,
        kind: "aagaard.dervish-coupled-trial-observation",
        trialId: `urn:aagaard:dervish-trial:${createHash("sha256").update(identity).digest("base64url")}`,
        observedAt: input.observedAt,
        coordinate: input.coordinate,
        attention: Object.freeze({
            votes,
            settlements
        }),
        market: Object.freeze({
            targets: Object.freeze(marketReceipts.map((receipt)=>receipt.target)),
            execution: marketExecution(marketReceipts)
        }),
        claims: Object.freeze({
            realizedPnlHbd: null,
            causalEffect: null,
            causalStatus: "not-identified",
            quasicrystalCircuitStatus: "hypothesis-not-proved"
        })
    });
}
export function summarizeDervishTrial(observation) {
    return Object.freeze({
        trialId: observation.trialId,
        globalStep: observation.coordinate.globalStep,
        cycle: observation.coordinate.cycle,
        boundaryStep: observation.coordinate.boundaryStep,
        site: observation.coordinate.site,
        lens: observation.coordinate.lens.id,
        phase: observation.coordinate.phase,
        account: observation.coordinate.account
    });
}
