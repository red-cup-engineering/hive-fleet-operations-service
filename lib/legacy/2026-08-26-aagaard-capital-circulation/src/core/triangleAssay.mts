import { createHash } from "node:crypto";

import type { ExactBookLevel } from "../analysis/exactArbitrage.mts";
import { sizeExactTriangle, type ExactInputPoolEvidence } from "../analysis/exactTriangle.mts";

export const TRIANGLE_ASSAY_SCHEMA = "aagaard.exact-triangle-assay.v1" as const;

export interface TriangleMarketState {
  readonly account: string;
  readonly initialBalance: string;
  readonly initialPrecision: number;
  readonly capInitialMilli: number;
  readonly firstPool: ExactInputPoolEvidence;
  readonly secondPool: ExactInputPoolEvidence;
  readonly finalTokenPrecision: number;
  readonly bids: readonly ExactBookLevel[];
  readonly bidBookComplete: boolean;
  readonly bidBookOrdered: boolean;
  readonly perPoolSlippageBps: number;
}

export type TriangleProviderObservation = Readonly<{ provider: string; status: "available"; state: TriangleMarketState }>
  | Readonly<{ provider: string; status: "unavailable"; problem: string }>;

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/** FOUR-valued provider certification. One witness is insufficient, exact
 * disagreement is a contradiction, and neither condition is silently turned
 * into a tradable market state. */
export function certifyExactTriangleAssay(input: Readonly<{
  observedAt: string;
  observations: readonly TriangleProviderObservation[];
}>) {
  const observedAt = new Date(input.observedAt).toISOString();
  if (input.observations.length < 2 || new Set(input.observations.map((row) => row.provider)).size !== input.observations.length) {
    throw new TypeError("triangle assay requires distinct provider observations");
  }
  const groups = new Map<string, { state: TriangleMarketState; providers: string[] }>();
  const unavailable: { provider: string; problem: string }[] = [];
  for (const observation of input.observations) {
    if (observation.status === "unavailable") { unavailable.push({ provider: observation.provider, problem: observation.problem }); continue; }
    const stateDigest = digest(observation.state);
    const group = groups.get(stateDigest) ?? { state: observation.state, providers: [] };
    group.providers.push(observation.provider); groups.set(stateDigest, group);
  }
  const availableCount = input.observations.length - unavailable.length;
  const knowledge = groups.size > 1 ? "both" : availableCount >= 2 ? "true" : "neither";
  const providerKnowledge = Object.freeze({ value: knowledge,
    stateDigests: Object.freeze([...groups.entries()].map(([stateDigest, group]) => Object.freeze({ stateDigest, providers: Object.freeze([...group.providers].sort()) }))),
    unavailable: Object.freeze(unavailable) });
  const base = Object.freeze({ schema: TRIANGLE_ASSAY_SCHEMA, observedAt, providerKnowledge,
    credentialAccess: false, chainMutation: false, executionAdmissible: false });
  if (knowledge !== "true") return Object.freeze({ ...base, status: "uncertified" as const, route: null, result: null,
    refusal: knowledge === "both" ? "provider-state-contested" : "independent-provider-support-insufficient" });
  const group = [...groups.values()][0]!;
  const state = group.state;
  const result = sizeExactTriangle(state);
  return Object.freeze({ ...base, status: "certified" as const,
    route: Object.freeze([state.firstPool.inputSymbol, state.firstPool.outputSymbol, state.secondPool.outputSymbol, state.firstPool.inputSymbol]),
    account: state.account, certifyingProviders: Object.freeze([...group.providers].sort()), result,
    refusal: result.admitted ? null : result.reason });
}
