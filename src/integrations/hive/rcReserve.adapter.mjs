import { RpcClient } from "@red-cup-engineering/hive-blockchain-client-service/rpc.mjs";
import { planRcReserve } from "../../core/rcReserve.mjs";
import { attestProviders } from "../../core/providerAttestation.mjs";
export const RC_RESERVE_OBSERVATION_SCHEMA = "aagaard.rc-reserve-observation.v1";
function exactState(account, accountsResult, statsResult) {
    const accounts = accountsResult;
    const stats = statsResult;
    const rows = accounts?.rc_accounts;
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.account !== account) throw new TypeError("RC account evidence is malformed");
    const row = rows[0];
    const manabar = row.rc_manabar;
    const maximumRc = String(row.max_rc ?? "");
    const current = String(manabar?.current_mana ?? "");
    const updatedAt = Number(manabar?.last_update_time);
    const average = String(stats?.avg_cost_rc ?? "");
    if (!/^[1-9][0-9]*$/u.test(maximumRc) || !/^-?[0-9]+$/u.test(current) || !Number.isSafeInteger(updatedAt) || updatedAt < 0 || !/^[1-9][0-9]*$/u.test(average)) {
        throw new TypeError("RC operation evidence is malformed");
    }
    return Object.freeze({
        maximumRc,
        manabarCurrent: current,
        manabarUpdatedAt: updatedAt,
        averageOperationRc: average
    });
}
export async function observeRcReserve(options) {
    if (!/^[a-z][a-z0-9.-]{2,15}$/u.test(options.account)) throw new TypeError("RC account is not canonical");
    if (!/^[a-z][a-z0-9_]*_operation$/u.test(options.operation)) throw new TypeError("RC operation identity is malformed");
    const observedAt = new Date(options.observedAt ?? Date.now()).toISOString();
    const observedUnix = Math.floor(Date.parse(observedAt) / 1_000);
    const nodes = options.nodes ?? Object.freeze([
        "https://api.hive.blog",
        "https://api.openhive.network",
        "https://api.deathwing.me"
    ]);
    if (nodes.length < 2 || new Set(nodes).size !== nodes.length || nodes.some((node)=>!/^https:\/\//u.test(node))) {
        throw new TypeError("RC observation requires at least two distinct HTTPS providers");
    }
    const fetchImpl = options.fetchImpl ?? fetch;
    const observations = await Promise.all(nodes.map(async (node)=>{
        try {
            const [accounts, stats] = await Promise.all([
                new RpcClient({ nodes: [node], timeout: 10000, fetch: fetchImpl }).call("rc_api.find_rc_accounts", {
                    accounts: [
                        options.account
                    ]
                }),
                new RpcClient({ nodes: [node], timeout: 10000, fetch: fetchImpl }).call("rc_api.get_rc_operation_stats", {
                    operation: options.operation
                })
            ]);
            return Object.freeze({
                provider: node,
                status: "available",
                state: exactState(options.account, accounts, stats)
            });
        } catch (error) {
            return Object.freeze({
                provider: node,
                status: "unavailable",
                problem: error instanceof Error ? error.message : String(error)
            });
        }
    }));
    const attested = attestProviders(observations);
    const { groups, unavailable } = attested;
    const knowledge = attested.value;
    const providerKnowledge = Object.freeze({
        value: knowledge,
        stateDigests: Object.freeze([
            ...groups.entries()
        ].map(([stateDigest, group])=>Object.freeze({
                stateDigest,
                providers: Object.freeze([
                    ...group.providers
                ].sort())
            }))),
        unavailable: Object.freeze(unavailable)
    });
    const base = Object.freeze({
        schema: RC_RESERVE_OBSERVATION_SCHEMA,
        account: options.account,
        operation: options.operation,
        observedAt,
        providerKnowledge,
        credentialAccess: false,
        chainMutation: false
    });
    if (knowledge !== "true") return Object.freeze({
        ...base,
        status: "uncertified",
        plan: null,
        refusal: attested.refusal
    });
    const state = [
        ...groups.values()
    ][0].state;
    const maximum = BigInt(state.maximumRc);
    const elapsed = BigInt(Math.max(0, observedUnix - state.manabarUpdatedAt));
    const regenerated = BigInt(state.manabarCurrent) + elapsed * maximum / 432_000n;
    const current = regenerated > maximum ? maximum : regenerated < 1n ? 1n : regenerated;
    const plan = planRcReserve({
        observedAt,
        currentRc: current.toString(),
        maximumRc: state.maximumRc,
        averageOperationRc: state.averageOperationRc,
        operation: options.operation
    });
    return Object.freeze({
        ...base,
        status: "certified",
        plan,
        certifyingProviders: Object.freeze([
            ...groups.values()
        ][0].providers.sort()),
        refusal: null
    });
}
