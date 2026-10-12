#!/usr/bin/env node
// Complete, read-only Hive Engine NFT inventory for the six-wallet fleet.
// Each provider is serialized independently; a certificate is emitted only
// when at least two providers agree on the registry and every owned instance.

import { pathToFileURL } from "node:url";

import { certifyFleetNftInventory } from "../src/core/fleetNftInventory.mjs";
import { EngineClient } from "@red-cup-engineering/hive-blockchain-client-service/engine.mjs";
import { FLEET_ACCOUNTS } from "../src/core/core.adapter.mjs";

const PROVIDERS = Object.freeze([
  "https://api.hive-engine.com/rpc",
  "https://api2.hive-engine.com/rpc",
  "https://herpc.dtools.dev",
  "https://herpc.liotes.com",
  "https://api.primersion.com",
]);
const FLEET = FLEET_ACCOUNTS;

function fail(message) { throw new Error(`fleet-nft-inventory: ${message}`); }

export function parseOptions(argv) {
  if (argv.length !== 0) fail(`unknown argument ${argv[0]}`);
  return Object.freeze({});
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

async function allRows(rpc, table, query) {
  const rows = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = await rpc.find("nft", table, query, { limit: 1_000, offset: offset });
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

async function observeProvider(provider) {
  const rpc = new EngineClient({ nodes: [provider], timeout: 20_000, serial: true });
  try {
    const rawRegistry = await allRows(rpc, "nfts", {});
    const registry = rawRegistry.map((row) => Object.freeze({ symbol: String(row.symbol ?? ""), name: String(row.name ?? ""),
      issuer: String(row.issuer ?? ""), circulatingSupply: String(row.circulatingSupply ?? "0") }))
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
    const collections = (await Promise.all(registry.map(async (entry) => {
      const rows = await allRows(rpc, `${entry.symbol}instances`, { account: { $in: FLEET }, ownedBy: "u" });
      if (rows.length === 0) return null;
      const instances = rows.map((row) => Object.freeze({ id: String(row._id ?? ""), account: String(row.account ?? ""), ownedBy: String(row.ownedBy ?? ""),
        propertiesJson: JSON.stringify(stable(row.properties ?? {})), lockedTokensJson: JSON.stringify(stable(row.lockedTokens ?? {})),
        delegatedTo: typeof row.delegatedTo === "string" && row.delegatedTo !== "" ? row.delegatedTo : null }));
      return Object.freeze({ registry: entry, instances: Object.freeze(instances) });
    }))).filter((entry) => entry !== null);
    return Object.freeze({ provider, status: "available", registry: Object.freeze(registry), collections: Object.freeze(collections) });
  } catch (error) {
    return Object.freeze({ provider, status: "unavailable", problem: error instanceof Error ? error.message : String(error) });
  }
}

export async function observe() {
  const observedAt = new Date().toISOString();
  const observations = await Promise.all(PROVIDERS.map(observeProvider));
  return certifyFleetNftInventory({ observedAt, fleetAccounts: FLEET, observations });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.stdout.write(`${JSON.stringify(await observe(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
