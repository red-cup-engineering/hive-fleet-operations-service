import { createHash } from "node:crypto";

import { sizeExactPoolCycle, type ExactPoolCycleInput } from "../analysis/exactPoolCycle.mts";

export const POOL_CYCLE_ASSAY_SCHEMA = "aagaard.pool-cycle-assay.v1" as const;

export type PoolCycleProviderObservation = Readonly<{ provider: string; status: "available"; state: ExactPoolCycleInput }>
  | Readonly<{ provider: string; status: "unavailable"; problem: string }>;

function digest(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }

export function certifyPoolCycleAssay(input: Readonly<{ observedAt: string; account: string; initialSymbol: string; observations: readonly PoolCycleProviderObservation[] }>) {
  const observedAt = new Date(input.observedAt).toISOString();
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(input.account) || !/^[A-Z0-9.]{1,20}$/u.test(input.initialSymbol)) throw new TypeError("pool-cycle actor or initial token is malformed");
  if (input.observations.length < 2 || new Set(input.observations.map((row) => row.provider)).size !== input.observations.length) throw new TypeError("pool-cycle assay requires distinct providers");
  const groups = new Map<string, { state: ExactPoolCycleInput; providers: string[] }>(); const unavailable: { provider: string; problem: string }[] = [];
  for (const observation of input.observations) {
    if (observation.status === "unavailable") { unavailable.push({ provider: observation.provider, problem: observation.problem }); continue; }
    const stateDigest = digest(observation.state); const group = groups.get(stateDigest) ?? { state: observation.state, providers: [] };
    group.providers.push(observation.provider); groups.set(stateDigest, group);
  }
  const available = input.observations.length - unavailable.length;
  const knowledge = groups.size > 1 ? "both" as const : available >= 2 ? "true" as const : "neither" as const;
  const base = Object.freeze({ schema: POOL_CYCLE_ASSAY_SCHEMA, observedAt, account: input.account, initialSymbol: input.initialSymbol,
    providerKnowledge: Object.freeze({ value: knowledge, stateDigests: Object.freeze([...groups.entries()].map(([stateDigest, group]) => Object.freeze({ stateDigest, providers: Object.freeze([...group.providers].sort()) }))), unavailable: Object.freeze(unavailable) }),
    credentialAccess: false, chainMutation: false, executionAdmissible: false });
  if (knowledge !== "true") return Object.freeze({ ...base, status: "uncertified" as const, result: null,
    refusal: knowledge === "both" ? "provider-state-contested" : "independent-provider-support-insufficient" });
  const group = [...groups.values()][0]!; const result = sizeExactPoolCycle(group.state);
  return Object.freeze({ ...base, status: "certified" as const, certifyingProviders: Object.freeze([...group.providers].sort()), result,
    refusal: !result.admitted ? result.reason : result.quote.policyRefusal });
}
