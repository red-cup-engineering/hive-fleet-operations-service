import { attestProviders } from "./providerAttestation.mjs";
export const FLEET_NFT_INVENTORY_SCHEMA = "aagaard.fleet-nft-inventory.v1";
const SYMBOL = /^[A-Z0-9.]{1,20}$/u;
const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/u;
function exactState(observation) {
    const registry = observation.registry.map((row)=>{
        if (!SYMBOL.test(row.symbol) || !ACCOUNT.test(row.issuer) || row.name.trim() === "" || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(row.circulatingSupply)) throw new TypeError("NFT registry row is malformed");
        return Object.freeze({
            symbol: row.symbol,
            name: row.name,
            issuer: row.issuer,
            circulatingSupply: row.circulatingSupply
        });
    }).sort((left, right)=>left.symbol.localeCompare(right.symbol));
    if (new Set(registry.map((row)=>row.symbol)).size !== registry.length) throw new TypeError("NFT registry symbols must be unique");
    const registryBySymbol = new Map(registry.map((row)=>[
            row.symbol,
            row
        ]));
    const collections = observation.collections.map((collection)=>{
        const registered = registryBySymbol.get(collection.registry.symbol);
        if (!registered || JSON.stringify(registered) !== JSON.stringify(collection.registry) || collection.instances.length === 0) {
            throw new TypeError("owned NFT collection is not bound to the registry");
        }
        const instances = collection.instances.map((instance)=>{
            if (!/^[1-9][0-9]*$/u.test(instance.id) || !ACCOUNT.test(instance.account) || instance.ownedBy !== "u" || instance.delegatedTo !== null && !ACCOUNT.test(instance.delegatedTo)) throw new TypeError("NFT instance identity is malformed");
            JSON.parse(instance.propertiesJson);
            JSON.parse(instance.lockedTokensJson);
            return Object.freeze({
                ...instance
            });
        }).sort((left, right)=>BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0);
        if (new Set(instances.map((instance)=>instance.id)).size !== instances.length) throw new TypeError("NFT instance ids must be unique within a collection");
        return Object.freeze({
            registry: registered,
            instances: Object.freeze(instances)
        });
    }).sort((left, right)=>left.registry.symbol.localeCompare(right.registry.symbol));
    if (new Set(collections.map((collection)=>collection.registry.symbol)).size !== collections.length) {
        throw new TypeError("owned NFT collections must be unique");
    }
    return Object.freeze({
        registry: Object.freeze(registry),
        collections: Object.freeze(collections)
    });
}
function countBy(values, key) {
    const rows = new Map();
    for (const value of values)rows.set(key(value), (rows.get(key(value)) ?? 0) + 1);
    return Object.freeze(Object.fromEntries([
        ...rows.entries()
    ].sort(([left], [right])=>left.localeCompare(right))));
}
export function certifyFleetNftInventory(input) {
    const observedAt = new Date(input.observedAt).toISOString();
    const accounts = [
        ...new Set(input.fleetAccounts)
    ].sort();
    if (accounts.length === 0 || accounts.length !== input.fleetAccounts.length || accounts.some((account)=>!ACCOUNT.test(account))) {
        throw new TypeError("fleet NFT inventory requires distinct canonical accounts");
    }
    if (input.observations.length < 2 || new Set(input.observations.map((row)=>row.provider)).size !== input.observations.length) {
        throw new TypeError("fleet NFT inventory requires distinct provider observations");
    }
    const attested = attestProviders(input.observations, (observation)=>{
        const state = exactState(observation);
        for (const collection of state.collections)for (const instance of collection.instances){
            if (!accounts.includes(instance.account)) throw new TypeError("NFT instance is outside the declared fleet");
        }
        return state;
    });
    const { groups, unavailable } = attested;
    const knowledge = attested.value;
    const base = Object.freeze({
        schema: FLEET_NFT_INVENTORY_SCHEMA,
        observedAt,
        fleetAccounts: Object.freeze(accounts),
        providerKnowledge: Object.freeze({
            value: knowledge,
            providers: Object.freeze([
                ...groups.values()
            ].flatMap((group)=>group.providers).sort()),
            stateDigests: Object.freeze([
                ...groups.entries()
            ].map(([stateDigest, group])=>Object.freeze({
                    stateDigest,
                    providers: Object.freeze(group.providers.sort())
                }))),
            unavailable: Object.freeze(unavailable)
        }),
        credentialAccess: false,
        chainMutation: false
    });
    if (knowledge !== "true") return Object.freeze({
        ...base,
        status: "uncertified",
        registryCount: null,
        totalOwnedInstances: null,
        collections: null,
        refusal: attested.refusal
    });
    const state = [
        ...groups.values()
    ][0].state;
    const allInstances = state.collections.flatMap((collection)=>collection.instances);
    const collections = state.collections.map((collection)=>Object.freeze({
            symbol: collection.registry.symbol,
            name: collection.registry.name,
            issuer: collection.registry.issuer,
            count: collection.instances.length,
            byAccount: countBy(collection.instances, (instance)=>instance.account),
            instanceIds: Object.freeze(collection.instances.map((instance)=>instance.id)),
            lockedTokenRows: collection.instances.filter((instance)=>instance.lockedTokensJson !== "{}").length
        }));
    return Object.freeze({
        ...base,
        status: "certified",
        registryCount: state.registry.length,
        totalOwnedInstances: allInstances.length,
        ownedCollectionCount: collections.length,
        byAccount: countBy(allInstances, (instance)=>instance.account),
        collections: Object.freeze(collections)
    });
}
