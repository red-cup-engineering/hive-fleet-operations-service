import { createHash } from "node:crypto";

export const FLEET_NFT_INVENTORY_SCHEMA = "aagaard.fleet-nft-inventory.v1" as const;

export interface FleetNftRegistryRow {
  readonly symbol: string;
  readonly name: string;
  readonly issuer: string;
  readonly circulatingSupply: string;
}

export interface FleetNftInstance {
  readonly id: string;
  readonly account: string;
  readonly ownedBy: "u";
  readonly propertiesJson: string;
  readonly lockedTokensJson: string;
  readonly delegatedTo: string | null;
}

export interface FleetNftCollection {
  readonly registry: FleetNftRegistryRow;
  readonly instances: readonly FleetNftInstance[];
}

export type FleetNftProviderObservation = Readonly<{
  provider: string;
  status: "available";
  registry: readonly FleetNftRegistryRow[];
  collections: readonly FleetNftCollection[];
}> | Readonly<{
  provider: string;
  status: "unavailable";
  problem: string;
}>;

const SYMBOL = /^[A-Z0-9.]{1,20}$/u;
const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/u;

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function exactState(observation: Extract<FleetNftProviderObservation, { status: "available" }>) {
  const registry = observation.registry.map((row) => {
    if (!SYMBOL.test(row.symbol) || !ACCOUNT.test(row.issuer) || row.name.trim() === ""
      || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(row.circulatingSupply)) throw new TypeError("NFT registry row is malformed");
    return Object.freeze({ symbol: row.symbol, name: row.name, issuer: row.issuer, circulatingSupply: row.circulatingSupply });
  }).sort((left, right) => left.symbol.localeCompare(right.symbol));
  if (new Set(registry.map((row) => row.symbol)).size !== registry.length) throw new TypeError("NFT registry symbols must be unique");
  const registryBySymbol = new Map(registry.map((row) => [row.symbol, row]));
  const collections = observation.collections.map((collection) => {
    const registered = registryBySymbol.get(collection.registry.symbol);
    if (!registered || JSON.stringify(registered) !== JSON.stringify(collection.registry) || collection.instances.length === 0) {
      throw new TypeError("owned NFT collection is not bound to the registry");
    }
    const instances = collection.instances.map((instance) => {
      if (!/^[1-9][0-9]*$/u.test(instance.id) || !ACCOUNT.test(instance.account) || instance.ownedBy !== "u"
        || (instance.delegatedTo !== null && !ACCOUNT.test(instance.delegatedTo))) throw new TypeError("NFT instance identity is malformed");
      JSON.parse(instance.propertiesJson); JSON.parse(instance.lockedTokensJson);
      return Object.freeze({ ...instance });
    }).sort((left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0);
    if (new Set(instances.map((instance) => instance.id)).size !== instances.length) throw new TypeError("NFT instance ids must be unique within a collection");
    return Object.freeze({ registry: registered, instances: Object.freeze(instances) });
  }).sort((left, right) => left.registry.symbol.localeCompare(right.registry.symbol));
  if (new Set(collections.map((collection) => collection.registry.symbol)).size !== collections.length) {
    throw new TypeError("owned NFT collections must be unique");
  }
  return Object.freeze({ registry: Object.freeze(registry), collections: Object.freeze(collections) });
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Readonly<Record<string, number>> {
  const rows = new Map<string, number>();
  for (const value of values) rows.set(key(value), (rows.get(key(value)) ?? 0) + 1);
  return Object.freeze(Object.fromEntries([...rows.entries()].sort(([left], [right]) => left.localeCompare(right))));
}

export function certifyFleetNftInventory(input: Readonly<{
  observedAt: string;
  fleetAccounts: readonly string[];
  observations: readonly FleetNftProviderObservation[];
}>) {
  const observedAt = new Date(input.observedAt).toISOString();
  const accounts = [...new Set(input.fleetAccounts)].sort();
  if (accounts.length === 0 || accounts.length !== input.fleetAccounts.length || accounts.some((account) => !ACCOUNT.test(account))) {
    throw new TypeError("fleet NFT inventory requires distinct canonical accounts");
  }
  if (input.observations.length < 2 || new Set(input.observations.map((row) => row.provider)).size !== input.observations.length) {
    throw new TypeError("fleet NFT inventory requires distinct provider observations");
  }
  const groups = new Map<string, { state: ReturnType<typeof exactState>; providers: string[] }>();
  const unavailable = [];
  for (const observation of input.observations) {
    if (observation.status === "unavailable") { unavailable.push(Object.freeze({ provider: observation.provider, problem: observation.problem })); continue; }
    const state = exactState(observation);
    for (const collection of state.collections) for (const instance of collection.instances) {
      if (!accounts.includes(instance.account)) throw new TypeError("NFT instance is outside the declared fleet");
    }
    const stateDigest = digest(state);
    const group = groups.get(stateDigest) ?? { state, providers: [] };
    group.providers.push(observation.provider); groups.set(stateDigest, group);
  }
  const availableCount = input.observations.length - unavailable.length;
  const knowledge = groups.size > 1 ? "both" : availableCount >= 2 ? "true" : "neither";
  const base = Object.freeze({ schema: FLEET_NFT_INVENTORY_SCHEMA, observedAt, fleetAccounts: Object.freeze(accounts),
    providerKnowledge: Object.freeze({ value: knowledge,
      providers: Object.freeze([...groups.values()].flatMap((group) => group.providers).sort()),
      stateDigests: Object.freeze([...groups.entries()].map(([stateDigest, group]) => Object.freeze({ stateDigest, providers: Object.freeze(group.providers.sort()) }))),
      unavailable: Object.freeze(unavailable) }), credentialAccess: false, chainMutation: false });
  if (knowledge !== "true") return Object.freeze({ ...base, status: "uncertified" as const, registryCount: null, totalOwnedInstances: null, collections: null,
    refusal: knowledge === "both" ? "provider-state-contested" : "independent-provider-support-insufficient" });
  const state = [...groups.values()][0]!.state;
  const allInstances = state.collections.flatMap((collection) => collection.instances);
  const collections = state.collections.map((collection) => Object.freeze({ symbol: collection.registry.symbol,
    name: collection.registry.name, issuer: collection.registry.issuer, count: collection.instances.length,
    byAccount: countBy(collection.instances, (instance) => instance.account), instanceIds: Object.freeze(collection.instances.map((instance) => instance.id)),
    lockedTokenRows: collection.instances.filter((instance) => instance.lockedTokensJson !== "{}").length }));
  return Object.freeze({ ...base, status: "certified" as const, registryCount: state.registry.length,
    totalOwnedInstances: allInstances.length, ownedCollectionCount: collections.length,
    byAccount: countBy(allInstances, (instance) => instance.account), collections: Object.freeze(collections) });
}
