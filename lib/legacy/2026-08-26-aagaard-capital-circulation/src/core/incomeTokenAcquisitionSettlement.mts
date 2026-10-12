import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const INCOME_TOKEN_ACQUISITION_SCHEMA = "aagaard.income-token-acquisition.v1" as const;
export const INCOME_TOKEN_ACQUISITION_CATEGORY = "aagaard.income-token-acquisition-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface IncomeTokenAcquisitionEvent {
  readonly incomeTokenAcquisitionSchema: typeof INCOME_TOKEN_ACQUISITION_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly account: "michael561";
  readonly symbol: "EDSI";
  readonly transactionId: string;
  readonly status: "acquired-confirmed" | "settlement-pending";
  readonly acquiredQuantity: string | null;
  readonly spentSwapHive: string | null;
  readonly futureIncomeSettlement: "unproven-until-native-hive-distribution";
  readonly realizedIncome: null;
  readonly receipt: Readonly<Record<string, unknown>>;
}

function object(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function providers(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((entry) => object(entry, label)); const names = rows.map((entry) => String(entry.node ?? entry.provider ?? ""));
  if (names.length < 2 || new Set(names).size !== names.length || names.some((name) => !name.startsWith("https://"))) throw new TypeError(`${label} lacks independent witnesses`);
  return Object.freeze(names);
}

export function incomeTokenAcquisitionEvent(receipt: Readonly<Record<string, unknown>>, recordedAt = new Date().toISOString()): IncomeTokenAcquisitionEvent {
  if (receipt.kind !== "aagaard.income-token-acquisition-receipt" || receipt.account !== "michael561" || receipt.symbol !== "EDSI") {
    throw new TypeError("not the admitted income-token acquisition receipt");
  }
  const status = String(receipt.status ?? "");
  if (status !== "acquired-confirmed" && status !== "settlement-pending") throw new TypeError("income-token acquisition status is not recordable");
  const transactionId = String(receipt.transactionId ?? "");
  if (!/^[0-9a-f]{40}$/u.test(transactionId) || receipt.retryAllowed !== false) throw new TypeError("income-token transaction identity is malformed");
  const plan = object(receipt.plan, "acquisition plan"); const quote = object(plan.quote, "acquisition quote");
  if (plan.admitted !== true || quote.symbol !== "EDSI" || quote.quantity !== "1.000" || quote.limitPriceSwapHive !== "1.01555000"
    || quote.executionAdmissible !== false) throw new TypeError("acquisition receipt does not bind the reviewed pilot");
  if (status === "acquired-confirmed") {
    providers(receipt.hive, "Hive confirmations");
    const hive = receipt.hive as readonly Readonly<Record<string, unknown>>[];
    const blocks = hive.map((row) => Number(row.block));
    if (blocks.some((block) => !Number.isSafeInteger(block) || block <= 0) || new Set(blocks).size !== 1) throw new TypeError("Hive confirmations disagree on one block");
  } else if (receipt.hive !== undefined) {
    throw new TypeError("pending acquisition cannot carry partial or invented Hive confirmation evidence");
  }
  let acquiredQuantity: string | null = null; let spentSwapHive: string | null = null;
  if (status === "acquired-confirmed") {
    providers(receipt.engine, "Hive Engine confirmations"); providers(receipt.after, "effect confirmations");
    const engine = receipt.engine as readonly Readonly<Record<string, unknown>>[];
    const engineBlocks = engine.map((row) => Number(row.block));
    if (engine.some((row) => row.transactionId !== transactionId) || engineBlocks.some((block) => !Number.isSafeInteger(block) || block <= 0)
      || new Set(engineBlocks).size !== 1 || new Set(engine.map((row) => JSON.stringify(row.logs))).size !== 1) {
      throw new TypeError("Hive Engine confirmations disagree on the acquisition execution");
    }
    acquiredQuantity = String(receipt.acquiredQuantity ?? ""); spentSwapHive = String(receipt.spentSwapHive ?? "");
    if (acquiredQuantity !== "1.000" || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(spentSwapHive)
      || BigInt(spentSwapHive.replace(".", "")) <= 0n || BigInt(spentSwapHive.replace(".", "")) > 101_555_000n) {
      throw new TypeError("confirmed acquisition economics exceed the pilot");
    }
    const before = object(receipt.before, "pre-acquisition state");
    if (before.tokenBalance !== "0.000" || before.swapHiveBalance !== "71.69561429" || before.existingFleetQuantity !== "89.568") {
      throw new TypeError("confirmed acquisition is not bound to the reviewed pre-state");
    }
    const after = receipt.after as readonly Readonly<Record<string, unknown>>[];
    const effectIdentities = after.map((row) => JSON.stringify([row.tokenBalance, row.swapHiveBalance, row.matchingOpenOrders]));
    if (new Set(effectIdentities).size !== 1 || after.some((row) => row.tokenBalance !== "1.000"
      || !/^(?:0|[1-9][0-9]*)\.[0-9]{8}$/u.test(String(row.swapHiveBalance ?? ""))
      || !Array.isArray(row.matchingOpenOrders) || row.matchingOpenOrders.length !== 0)
      || BigInt(String(after[0]!.swapHiveBalance).replace(".", ""))
        + BigInt(spentSwapHive.replace(".", "")) !== 7_169_561_429n) {
      throw new TypeError("confirmed acquisition effects do not satisfy the reviewed balance equation");
    }
  }
  const eventId = `urn:aagaard:income-token-acquisition:${createHash("sha256").update(JSON.stringify([transactionId, status])).digest("base64url")}`;
  return Object.freeze({ incomeTokenAcquisitionSchema: INCOME_TOKEN_ACQUISITION_SCHEMA, eventId,
    recordedAt: new Date(recordedAt).toISOString(), account: "michael561" as const, symbol: "EDSI" as const,
    transactionId, status, acquiredQuantity, spentSwapHive,
    futureIncomeSettlement: "unproven-until-native-hive-distribution" as const, realizedIncome: null,
    receipt: JSON.parse(JSON.stringify(receipt)) as Readonly<Record<string, unknown>> });
}

export async function recordIncomeTokenAcquisition(dataDir: string, receipt: Readonly<Record<string, unknown>>, recordedAt?: string) {
  const event = incomeTokenAcquisitionEvent(receipt, recordedAt);
  const prior = ((await querySettlementRecords(INCOME_TOKEN_ACQUISITION_CATEGORY)) as readonly IncomeTokenAcquisitionEvent[])
    .find((candidate) => candidate.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: INCOME_TOKEN_ACQUISITION_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readIncomeTokenAcquisitions(dataDir: string): Promise<readonly IncomeTokenAcquisitionEvent[]> {
  return Object.freeze((await querySettlementRecords(INCOME_TOKEN_ACQUISITION_CATEGORY)) as readonly IncomeTokenAcquisitionEvent[]);
}
