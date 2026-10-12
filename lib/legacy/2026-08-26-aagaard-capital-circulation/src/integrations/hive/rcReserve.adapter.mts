import { createHash } from "node:crypto";

import { planRcReserve } from "../../core/rcReserve.mts";

export const RC_RESERVE_OBSERVATION_SCHEMA = "aagaard.rc-reserve-observation.v1" as const;

export interface RcReserveObserverOptions {
  readonly account: string;
  readonly operation: string;
  readonly observedAt?: string;
  readonly nodes?: readonly string[];
  readonly fetchImpl?: typeof fetch;
}

interface RcState {
  readonly maximumRc: string;
  readonly manabarCurrent: string;
  readonly manabarUpdatedAt: number;
  readonly averageOperationRc: string;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function rpc(fetchImpl: typeof fetch, node: string, method: string, params: unknown): Promise<unknown> {
  const response = await fetchImpl(node, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json() as { readonly result?: unknown; readonly error?: unknown };
  if (!response.ok || body.error !== undefined) throw new Error(`${method} unavailable`);
  return body.result;
}

function exactState(account: string, accountsResult: unknown, statsResult: unknown): RcState {
  const accounts = accountsResult as { readonly rc_accounts?: readonly Record<string, unknown>[] };
  const stats = statsResult as { readonly avg_cost_rc?: unknown };
  const rows = accounts?.rc_accounts;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.account !== account) throw new TypeError("RC account evidence is malformed");
  const row = rows[0];
  const manabar = row.rc_manabar as Record<string, unknown> | undefined;
  const maximumRc = String(row.max_rc ?? "");
  const current = String(manabar?.current_mana ?? "");
  const updatedAt = Number(manabar?.last_update_time);
  const average = String(stats?.avg_cost_rc ?? "");
  if (!/^[1-9][0-9]*$/u.test(maximumRc) || !/^-?[0-9]+$/u.test(current)
    || !Number.isSafeInteger(updatedAt) || updatedAt < 0 || !/^[1-9][0-9]*$/u.test(average)) {
    throw new TypeError("RC operation evidence is malformed");
  }
  return Object.freeze({ maximumRc, manabarCurrent: current, manabarUpdatedAt: updatedAt, averageOperationRc: average });
}

/** Independently observes the exact RC manabar and operation cost before any
 * credential is opened. FOUR both/neither states produce no executable plan. */
export async function observeRcReserve(options: RcReserveObserverOptions) {
  if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(options.account)) throw new TypeError("RC account is not canonical");
  if (!/^[a-z][a-z0-9_]*_operation$/u.test(options.operation)) throw new TypeError("RC operation identity is malformed");
  const observedAt = new Date(options.observedAt ?? Date.now()).toISOString();
  const observedUnix = Math.floor(Date.parse(observedAt) / 1_000);
  const nodes = options.nodes ?? Object.freeze(["https://api.hive.blog", "https://api.openhive.network", "https://api.deathwing.me"]);
  if (nodes.length < 2 || new Set(nodes).size !== nodes.length || nodes.some((node) => !/^https:\/\//u.test(node))) {
    throw new TypeError("RC observation requires at least two distinct HTTPS providers");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const observations = await Promise.all(nodes.map(async (node) => {
    try {
      const [accounts, stats] = await Promise.all([
        rpc(fetchImpl, node, "rc_api.find_rc_accounts", { accounts: [options.account] }),
        rpc(fetchImpl, node, "rc_api.get_rc_operation_stats", { operation: options.operation }),
      ]);
      return Object.freeze({ provider: node, status: "available" as const, state: exactState(options.account, accounts, stats) });
    } catch (error) {
      return Object.freeze({ provider: node, status: "unavailable" as const, problem: error instanceof Error ? error.message : String(error) });
    }
  }));
  const groups = new Map<string, { state: RcState; providers: string[] }>();
  const unavailable: { provider: string; problem: string }[] = [];
  for (const observation of observations) {
    if (observation.status === "unavailable") { unavailable.push({ provider: observation.provider, problem: observation.problem }); continue; }
    const stateDigest = digest(observation.state);
    const group = groups.get(stateDigest) ?? { state: observation.state, providers: [] };
    group.providers.push(observation.provider); groups.set(stateDigest, group);
  }
  const availableCount = observations.length - unavailable.length;
  const knowledge = groups.size > 1 ? "both" as const : availableCount >= 2 ? "true" as const : "neither" as const;
  const providerKnowledge = Object.freeze({ value: knowledge,
    stateDigests: Object.freeze([...groups.entries()].map(([stateDigest, group]) => Object.freeze({ stateDigest, providers: Object.freeze([...group.providers].sort()) }))),
    unavailable: Object.freeze(unavailable) });
  const base = Object.freeze({ schema: RC_RESERVE_OBSERVATION_SCHEMA, account: options.account, operation: options.operation,
    observedAt, providerKnowledge, credentialAccess: false, chainMutation: false });
  if (knowledge !== "true") return Object.freeze({ ...base, status: "uncertified" as const, plan: null,
    refusal: knowledge === "both" ? "provider-state-contested" : "independent-provider-support-insufficient" });
  const state = [...groups.values()][0]!.state;
  const maximum = BigInt(state.maximumRc);
  const elapsed = BigInt(Math.max(0, observedUnix - state.manabarUpdatedAt));
  const regenerated = BigInt(state.manabarCurrent) + elapsed * maximum / 432_000n;
  const current = regenerated > maximum ? maximum : regenerated < 1n ? 1n : regenerated;
  const plan = planRcReserve({ observedAt, currentRc: current.toString(), maximumRc: state.maximumRc,
    averageOperationRc: state.averageOperationRc, operation: options.operation });
  return Object.freeze({ ...base, status: "certified" as const, plan,
    certifyingProviders: Object.freeze([...groups.values()][0]!.providers.sort()), refusal: null });
}
