export const GAME_OPPORTUNITY_SCHEMA = "aagaard.game-opportunity-plan.v1";
const BENEFIT_ORDER = Object.freeze({
    "treasury-protection": 4,
    "productive-state": 3,
    "durable-learning": 2,
    "resettable-learning": 1
});
const RISK_ORDER = Object.freeze({
    none: 2,
    bounded: 1
});
function refusal(candidate) {
    if (candidate.evidence === "both") return "evidence-contested";
    if (candidate.evidence !== "true") return "evidence-insufficient";
    if (!candidate.protectedAssetsPreserved) return "protected-asset-invariant-not-proven";
    if (!candidate.independentReceiptAvailable) return "independent-settlement-unavailable";
    if (candidate.capitalRisk === "unknown") return "capital-risk-unknown";
    if (!candidate.executableNow) return "game-transition-not-currently-executable";
    if (candidate.operation !== "none" && candidate.rcDecision !== "ready") {
        return candidate.rcDecision === "uncertified" ? "resource-credit-state-uncertified" : "resource-credit-reserve-not-ready";
    }
    if (candidate.operation === "none" && candidate.rcDecision !== "not-required") return "resource-credit-classification-inconsistent";
    return null;
}
function exactCandidate(candidate) {
    if (!/^[a-z][a-z0-9-]{1,31}$/u.test(candidate.game) || !/^[a-z][a-z0-9-]{1,63}$/u.test(candidate.action)) {
        throw new TypeError("game and action identities must be canonical");
    }
    if (candidate.evidenceSummary.trim() === "") throw new TypeError("game opportunity evidence summary is required");
    if (candidate.nextEligibleAt !== null) new Date(candidate.nextEligibleAt).toISOString();
    if (candidate.treasuryFloor && (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(candidate.treasuryFloor.quantity) || !/^[A-Z0-9.]{1,20}$/u.test(candidate.treasuryFloor.counterSymbol))) throw new TypeError("treasury floor is malformed");
    return Object.freeze({
        ...candidate,
        ...candidate.treasuryFloor ? {
            treasuryFloor: Object.freeze({
                ...candidate.treasuryFloor
            })
        } : {}
    });
}
export function rankGameOpportunities(input) {
    const observedAt = new Date(input.observedAt).toISOString();
    if (input.candidates.length < 1) throw new TypeError("at least one game opportunity is required");
    const candidates = input.candidates.map(exactCandidate);
    if (new Set(candidates.map((candidate)=>`${candidate.game}:${candidate.action}`)).size !== candidates.length) {
        throw new TypeError("game opportunity identities must be unique");
    }
    const ranked = candidates.map((candidate)=>Object.freeze({
            candidate,
            refusal: refusal(candidate)
        })).sort((left, right)=>{
        const leftAdmitted = left.refusal === null ? 1 : 0;
        const rightAdmitted = right.refusal === null ? 1 : 0;
        if (leftAdmitted !== rightAdmitted) return rightAdmitted - leftAdmitted;
        const benefit = BENEFIT_ORDER[right.candidate.benefitClass] - BENEFIT_ORDER[left.candidate.benefitClass];
        if (benefit !== 0) return benefit;
        const leftRisk = left.candidate.capitalRisk === "unknown" ? 0 : RISK_ORDER[left.candidate.capitalRisk];
        const rightRisk = right.candidate.capitalRisk === "unknown" ? 0 : RISK_ORDER[right.candidate.capitalRisk];
        if (leftRisk !== rightRisk) return rightRisk - leftRisk;
        if (left.candidate.operation !== right.candidate.operation) return left.candidate.operation === "none" ? -1 : 1;
        if (left.candidate.credentialRole !== right.candidate.credentialRole) return left.candidate.credentialRole === "none" ? -1 : right.candidate.credentialRole === "none" ? 1 : left.candidate.credentialRole.localeCompare(right.candidate.credentialRole);
        return `${left.candidate.game}:${left.candidate.action}`.localeCompare(`${right.candidate.game}:${right.candidate.action}`);
    });
    const admitted = ranked.find((entry)=>entry.refusal === null)?.candidate ?? null;
    const reconsider = candidates.map((candidate)=>candidate.nextEligibleAt).filter((value)=>value !== null).map((value)=>new Date(value).toISOString()).sort()[0] ?? null;
    return Object.freeze({
        schema: GAME_OPPORTUNITY_SCHEMA,
        observedAt,
        formulae: Object.freeze({
            admission: "A(c)=K_true(c) AND X(c) AND P(c) AND S(c) AND R_known(c) AND (O(c)=none OR RC(c)=ready)",
            dominance: "c1>c2 iff lex(admitted,benefit-class,capital-risk-class,mutation-surface,credential-surface,stable-identity) prefers c1",
            selection: "selected=max_lex({c | A(c)})",
            noScalarization: "SWAP.HIVE, game progress, credentials, and RC are never added into one score"
        }),
        ranked: Object.freeze(ranked.map((entry, index)=>Object.freeze({
                rank: index + 1,
                ...entry.candidate,
                admittedNow: entry.refusal === null,
                refusal: entry.refusal
            }))),
        decision: admitted === null ? "wait" : "execute-one",
        selected: admitted === null ? null : Object.freeze({
            game: admitted.game,
            action: admitted.action
        }),
        earliestReconsiderAt: admitted === null ? reconsider : null,
        authority: Object.freeze({
            maximumActions: 1,
            credentialAccess: false,
            chainMutation: false
        })
    });
}
