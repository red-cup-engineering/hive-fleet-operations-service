import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const ASSET_YIELD_SCHEMA = "aagaard.asset-yield.v1" as const;
export const ASSET_YIELD_CATEGORY = "aagaard.asset-yield-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface AssetYieldEvent {
  readonly assetYieldSchema: typeof ASSET_YIELD_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly symbol: string;
  readonly transactionId: string;
  readonly status: string;
  readonly receipt: Readonly<Record<string, unknown>>;
}

async function eventsOf(dataDir: string): Promise<readonly AssetYieldEvent[]> {
  return (await querySettlementRecords(ASSET_YIELD_CATEGORY)) as readonly AssetYieldEvent[];
}

export async function recordAssetYield(
  dataDir: string,
  receipt: Readonly<Record<string, unknown>>,
  recordedAt = new Date().toISOString(),
): Promise<AssetYieldEvent> {
  if (receipt.kind !== "aagaard.asset-yield-receipt") throw new TypeError("not an asset yield receipt");
  const account = String(receipt.account ?? "");
  const symbol = String(receipt.symbol ?? "");
  const transactionId = String(receipt.transactionId ?? "");
  const status = String(receipt.status ?? "");
  if (account !== "michael561" || symbol !== "WORKERBEE"
    || !/^[0-9a-f]{40}$/.test(transactionId)
    || !["yield-delegation-confirmed", "settlement-pending"].includes(status)) {
    throw new TypeError("asset yield receipt identity or status is not recordable");
  }
  const eventId = `urn:aagaard:asset-yield:${createHash("sha256").update(JSON.stringify([transactionId, status])).digest("base64url")}`;
  const prior = (await eventsOf(dataDir)).find((event) => event.eventId === eventId);
  if (prior) return prior;
  const event: AssetYieldEvent = Object.freeze({ assetYieldSchema: ASSET_YIELD_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(), account, symbol, transactionId, status,
    receipt: Object.freeze({ ...receipt }) });
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: ASSET_YIELD_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readAssetYields(dataDir: string, account?: string): Promise<readonly AssetYieldEvent[]> {
  return Object.freeze((await eventsOf(dataDir)).filter((event) => account === undefined || event.account === account));
}
