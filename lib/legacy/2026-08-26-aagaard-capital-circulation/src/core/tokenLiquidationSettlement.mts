import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const TOKEN_LIQUIDATION_SCHEMA = "aagaard.token-liquidation.v1" as const;
export const TOKEN_LIQUIDATION_CATEGORY = "aagaard.token-liquidation-event" as const;

const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface TokenLiquidationEvent {
  readonly tokenLiquidationSchema: typeof TOKEN_LIQUIDATION_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: string;
  readonly symbol: string;
  readonly transactionId: string;
  readonly status: string;
  readonly receipt: Readonly<Record<string, unknown>>;
}

async function eventsOf(dataDir: string): Promise<readonly TokenLiquidationEvent[]> {
  return (await querySettlementRecords(TOKEN_LIQUIDATION_CATEGORY)) as readonly TokenLiquidationEvent[];
}

export async function recordTokenLiquidation(
  dataDir: string,
  receipt: Readonly<Record<string, unknown>>,
  recordedAt = new Date().toISOString(),
): Promise<TokenLiquidationEvent> {
  if (receipt.kind !== "aagaard.token-liquidation-receipt") throw new TypeError("not a token liquidation receipt");
  const account = String(receipt.account ?? "");
  const symbol = String(receipt.symbol ?? "");
  const transactionId = String(receipt.transactionId ?? "");
  const status = String(receipt.status ?? "");
  if (!/^[a-z][a-z0-9.-]{2,15}$/.test(account) || !/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)
    || !/^[0-9a-f]{40}$/.test(transactionId) || !["liquidated-confirmed", "settlement-pending"].includes(status)) {
    throw new TypeError("token liquidation receipt identity or status is not recordable");
  }
  const eventId = `urn:aagaard:token-liquidation:${createHash("sha256").update(JSON.stringify([transactionId, status])).digest("base64url")}`;
  const prior = (await eventsOf(dataDir)).find((event) => event.eventId === eventId);
  if (prior) return prior;
  const event: TokenLiquidationEvent = Object.freeze({
    tokenLiquidationSchema: TOKEN_LIQUIDATION_SCHEMA,
    eventId,
    recordedAt: new Date(recordedAt).toISOString(),
    account,
    symbol,
    transactionId,
    status,
    receipt: Object.freeze({ ...receipt }),
  });
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: TOKEN_LIQUIDATION_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readTokenLiquidations(dataDir: string, account?: string): Promise<readonly TokenLiquidationEvent[]> {
  return Object.freeze((await eventsOf(dataDir)).filter((event) => account === undefined || event.account === account));
}
