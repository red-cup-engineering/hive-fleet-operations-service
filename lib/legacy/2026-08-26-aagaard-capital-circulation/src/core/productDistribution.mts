// Finite, exact product-distribution choice. Resource credits are expendable
// operating capacity, but a marketing act still fails closed unless a named
// account has both meaningful audience and a conservative live RC reserve.

import { planRcReserve, RC_RESERVE_SAFETY_MULTIPLE } from "./rcReserve.mts";
import { EXIT_TIGHTNESS_PILOT_ACCOUNT, EXIT_TIGHTNESS_PILOT_PERMLINK, EXIT_TIGHTNESS_PILOT_TARGET } from "./exitTightnessPilotPost.mjs";

export const PRODUCT_REBLOG_RC_SAFETY_MULTIPLE = RC_RESERVE_SAFETY_MULTIPLE;
export const PRODUCT_REBLOG_MINIMUM_FOLLOWERS = 10;
export const PRODUCT_REBLOG_ACCOUNT = "michael561" as const;

export interface ProductDistributionCandidate {
  readonly account: string;
  readonly followers: number;
  readonly currentRc: string;
  readonly maximumRc: string;
  readonly alreadyReblogged: boolean;
}

const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/u;

export function productPilotReblogOperation() {
  return Object.freeze(["custom_json", Object.freeze({
    id: "follow",
    required_auths: Object.freeze([]),
    required_posting_auths: Object.freeze([PRODUCT_REBLOG_ACCOUNT]),
    json: JSON.stringify(["reblog", Object.freeze({ account: PRODUCT_REBLOG_ACCOUNT,
      author: EXIT_TIGHTNESS_PILOT_ACCOUNT, permlink: EXIT_TIGHTNESS_PILOT_PERMLINK })]),
  })] as const);
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

/** Lowest signing law for the one exact product distribution act. */
export function assertExactProductPilotReblog(input: Readonly<{
  account: string;
  role: string;
  lane: string;
  target: string;
  fields: unknown;
}>): true {
  const expected = productPilotReblogOperation()[1];
  const fields = input.fields as Record<string, unknown> | null;
  const admitted = input.account === PRODUCT_REBLOG_ACCOUNT && input.role === "posting"
    && input.lane === "product-distribution" && input.target === EXIT_TIGHTNESS_PILOT_TARGET
    && exactKeys(fields, ["id", "required_auths", "required_posting_auths", "json"])
    && fields?.["id"] === expected.id && fields?.["json"] === expected.json
    && JSON.stringify(fields?.["required_auths"]) === JSON.stringify(expected.required_auths)
    && JSON.stringify(fields?.["required_posting_auths"]) === JSON.stringify(expected.required_posting_auths);
  if (!admitted) throw new Error("product distribution requires the one exact michael561 reblog of the reviewed offer");
  return true;
}

function positiveInteger(value: string, label: string): bigint {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new TypeError(`${label} must be a positive integer string`);
  return BigInt(value);
}

function iso(value: string): { text: string; milliseconds: number } {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new TypeError("product distribution observation time is malformed");
  return { text: new Date(milliseconds).toISOString(), milliseconds };
}

export function planProductReblog(input: Readonly<{
  observedAt: string;
  author: string;
  averageCustomJsonRc: string;
  candidates: readonly ProductDistributionCandidate[];
}>) {
  const observed = iso(input.observedAt);
  if (!ACCOUNT.test(input.author)) throw new TypeError("product author is not canonical");
  const average = positiveInteger(input.averageCustomJsonRc, "average custom-JSON RC");
  const required = average * PRODUCT_REBLOG_RC_SAFETY_MULTIPLE;
  if (input.candidates.length === 0) throw new TypeError("product distribution needs candidate accounts");
  if (new Set(input.candidates.map((candidate) => candidate.account)).size !== input.candidates.length) {
    throw new TypeError("product distribution candidate accounts must be unique");
  }
  const assessed = input.candidates.map((candidate) => {
    if (!ACCOUNT.test(candidate.account) || !Number.isSafeInteger(candidate.followers) || candidate.followers < 0) {
      throw new TypeError("product distribution candidate identity is malformed");
    }
    const current = positiveInteger(candidate.currentRc, "current RC");
    const maximum = positiveInteger(candidate.maximumRc, "maximum RC");
    if (current > maximum) throw new TypeError("current RC cannot exceed maximum RC");
    const meaningfulAudience = candidate.followers >= PRODUCT_REBLOG_MINIMUM_FOLLOWERS;
    const authorSelfReblog = candidate.account === input.author;
    const eligibleNow = meaningfulAudience && !authorSelfReblog && !candidate.alreadyReblogged && current >= required;
    const rc = planRcReserve({ observedAt: observed.text, currentRc: current.toString(), maximumRc: maximum.toString(),
      averageOperationRc: average.toString(), operation: "custom_json_operation" });
    const eligibleAt = meaningfulAudience && !authorSelfReblog && !candidate.alreadyReblogged ? rc.eligibleAt : null;
    return Object.freeze({ ...candidate, meaningfulAudience, authorSelfReblog, requiredRc: required.toString(),
      rcReserveSatisfied: current >= required, eligibleNow, eligibleAt });
  }).sort((left, right) => right.followers - left.followers || left.account.localeCompare(right.account));
  const ready = assessed.find((candidate) => candidate.eligibleNow) ?? null;
  const future = assessed.filter((candidate) => candidate.eligibleAt !== null)
    .sort((left, right) => String(left.eligibleAt).localeCompare(String(right.eligibleAt)) || right.followers - left.followers)[0] ?? null;
  const decision = ready !== null ? "reblog-one-exact-product-offer" : future !== null ? "wait-for-rc-regeneration" : "no-qualified-distribution-account";
  return Object.freeze({
    kind: "aagaard.product-reblog-plan" as const,
    observedAt: observed.text,
    formulae: Object.freeze({
      requiredRc: "R_required=2*R_average(custom_json)",
      regeneration: "t=ceil((R_required-R_current)*432000/R_max)",
    }),
    policy: Object.freeze({ safetyMultiple: Number(PRODUCT_REBLOG_RC_SAFETY_MULTIPLE),
      minimumFollowers: PRODUCT_REBLOG_MINIMUM_FOLLOWERS, requiredRc: required.toString() }),
    decision,
    selectedAccount: ready?.account ?? future?.account ?? null,
    eligibleAt: ready !== null ? observed.text : future?.eligibleAt ?? null,
    candidates: Object.freeze(assessed),
    credentialAccess: false,
    chainMutation: false,
  });
}
