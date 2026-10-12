import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const WORKER_BEE_POOL_DISTRIBUTION_SCHEMA = "aagaard.workerbee-pool-distribution.v1" as const;
export const WORKER_BEE_POOL_DISTRIBUTION_CATEGORY = "aagaard.workerbee-pool-distribution-event" as const;
export const WORKER_BEE_POOL_ACCOUNT = "ph1102" as const;
export const WORKER_BEE_POOL_BENEFICIARY = "michael561" as const;

const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface WorkerBeePoolTransferCandidate {
  readonly sourceId: string;
  readonly historyIndex: number;
  readonly hiveBlock: number;
  readonly actionIndex: number;
  readonly timestamp: string;
  readonly transactionId: string;
  readonly from: typeof WORKER_BEE_POOL_ACCOUNT;
  readonly to: typeof WORKER_BEE_POOL_BENEFICIARY;
  readonly symbol: string;
  readonly quantity: string;
  readonly memo: string;
}

export interface WorkerBeePoolDistribution extends WorkerBeePoolTransferCandidate {
  readonly status: "settled";
  readonly hiveEngineBlock: number;
  readonly confirmationProviders: readonly string[];
}

export interface WorkerBeePoolDistributionEvent {
  readonly workerBeePoolDistributionSchema: typeof WORKER_BEE_POOL_DISTRIBUTION_SCHEMA;
  readonly eventId: string;
  readonly recordedAt: string;
  readonly distribution: WorkerBeePoolDistribution;
  readonly valuation: { readonly swapHive: null; readonly reason: "distribution-asset-not-independently-valued" };
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("pool transfer timestamp is malformed");
  const milliseconds = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  if (!Number.isFinite(milliseconds)) throw new TypeError("pool transfer timestamp is malformed");
  return new Date(milliseconds).toISOString();
}

function canonicalQuantity(value: unknown): string {
  const quantity = String(value ?? "");
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(quantity);
  if (!match || BigInt(match[1]!) === 0n && !/[1-9]/u.test(match[2] ?? "")) {
    throw new TypeError("pool transfer quantity is malformed or zero");
  }
  return quantity;
}

function canonicalSymbol(value: unknown): string {
  const symbol = String(value ?? "");
  if (!/^[A-Z][A-Z0-9.]{0,9}$/u.test(symbol)) throw new TypeError("pool transfer symbol is malformed");
  return symbol;
}

/** Extract exact ph1102 -> michael561 Hive Engine transfer intentions. A
 * foreign action in the same custom_json suppresses the entire carrier so a
 * broad batch can never be mistaken for the narrow yield receipt. */
export function workerBeePoolTransfersFromHistoryRow(
  row: unknown,
  delegatedAt: string,
): readonly WorkerBeePoolTransferCandidate[] {
  const pair = Array.isArray(row) ? row : [];
  const historyIndex = Number(pair[0]);
  const value = pair[1] as Record<string, unknown> | undefined;
  const operation = (value?.["op"] ?? value?.["operation"]) as unknown;
  if (!Array.isArray(operation) || operation[0] !== "custom_json") return Object.freeze([]);
  const envelope = operation[1] as Record<string, unknown> | undefined;
  if (envelope?.["id"] !== "ssc-mainnet-hive"
    || JSON.stringify(envelope["required_auths"]) !== JSON.stringify([WORKER_BEE_POOL_ACCOUNT])
    || JSON.stringify(envelope["required_posting_auths"]) !== JSON.stringify([])) return Object.freeze([]);
  let decoded: unknown;
  try { decoded = JSON.parse(String(envelope["json"] ?? "")); } catch { return Object.freeze([]); }
  const actions = Array.isArray(decoded) ? decoded : [decoded];
  if (actions.length === 0 || actions.some((action) => {
    const candidate = action as Record<string, unknown> | null;
    return candidate?.["contractName"] !== "tokens" || candidate?.["contractAction"] !== "transfer";
  })) return Object.freeze([]);
  const timestamp = canonicalTimestamp(value?.["timestamp"]);
  const delegatedMs = Date.parse(delegatedAt);
  if (!Number.isFinite(delegatedMs)) throw new TypeError("delegation timestamp is malformed");
  if (Date.parse(timestamp) < delegatedMs) return Object.freeze([]);
  const transactionId = String(value?.["trx_id"] ?? "");
  const hiveBlock = Number(value?.["block"]);
  if (!Number.isSafeInteger(historyIndex) || historyIndex < 0 || !Number.isSafeInteger(hiveBlock) || hiveBlock <= 0
    || !/^[0-9a-f]{40}$/u.test(transactionId)) throw new TypeError("pool transfer Hive identity is malformed");

  const transfers = actions.flatMap((action, actionIndex) => {
    const payload = (action as Record<string, unknown>)["contractPayload"] as Record<string, unknown> | undefined;
    if (payload?.["to"] !== WORKER_BEE_POOL_BENEFICIARY) return [];
    const symbol = canonicalSymbol(payload["symbol"]);
    const quantity = canonicalQuantity(payload["quantity"]);
    const memo = String(payload["memo"] ?? "");
    return [Object.freeze({
      sourceId: `hive:${transactionId}:${actionIndex}`,
      historyIndex, hiveBlock, actionIndex, timestamp, transactionId,
      from: WORKER_BEE_POOL_ACCOUNT, to: WORKER_BEE_POOL_BENEFICIARY,
      symbol, quantity, memo,
    })];
  });
  return Object.freeze(transfers);
}

export interface WorkerBeeEngineObservation {
  readonly provider: string;
  readonly result: unknown;
}

function confirmedEngineEffect(candidate: WorkerBeePoolTransferCandidate, result: unknown) {
  const rows = Array.isArray(result) ? result : [result];
  const expectedId = rows.length === 1 ? candidate.transactionId : `${candidate.transactionId}-${candidate.actionIndex}`;
  const row = rows.find((entry) => String((entry as Record<string, unknown> | null)?.["transactionId"] ?? "") === expectedId) as Record<string, unknown> | undefined;
  if (!row || row["sender"] !== candidate.from || row["contract"] !== "tokens" || row["action"] !== "transfer"
    || Number(row["refHiveBlockNumber"]) !== candidate.hiveBlock) return null;
  let payload: Record<string, unknown>;
  let logs: Record<string, unknown>;
  try {
    payload = (typeof row["payload"] === "string" ? JSON.parse(row["payload"]) : row["payload"]) as Record<string, unknown>;
    logs = (typeof row["logs"] === "string" ? JSON.parse(row["logs"]) : row["logs"]) as Record<string, unknown>;
  } catch { return null; }
  if (payload?.["to"] !== candidate.to || payload?.["symbol"] !== candidate.symbol
    || payload?.["quantity"] !== candidate.quantity || String(payload?.["memo"] ?? "") !== candidate.memo
    || payload?.["isSignedWithActiveKey"] !== true) return null;
  if (Array.isArray(logs?.["errors"]) && logs["errors"].length > 0) return null;
  const events = Array.isArray(logs?.["events"]) ? logs["events"] : [];
  const exact = events.filter((event) => {
    const typed = event as Record<string, unknown>;
    const data = typed["data"] as Record<string, unknown> | undefined;
    return typed["contract"] === "tokens" && typed["event"] === "transfer"
      && JSON.stringify(data) === JSON.stringify({ from: candidate.from, to: candidate.to, symbol: candidate.symbol, quantity: candidate.quantity });
  });
  const block = Number(row["blockNumber"]);
  if (events.length !== 1 || exact.length !== 1 || !Number.isSafeInteger(block) || block <= 0) return null;
  return Object.freeze({ block, identity: JSON.stringify({ payload, event: exact[0] }) });
}

/** A transfer becomes realized pool yield only when two independent Hive
 * Engine blockchain providers expose the exact executed effect. */
export function reconcileWorkerBeePoolDistribution(
  candidate: WorkerBeePoolTransferCandidate,
  observations: readonly WorkerBeeEngineObservation[],
): WorkerBeePoolDistribution {
  const confirmations = observations.flatMap((observation) => {
    const effect = confirmedEngineEffect(candidate, observation.result);
    return effect ? [{ provider: observation.provider, ...effect }] : [];
  });
  if (confirmations.length < 2) throw new Error("fewer than two Hive Engine providers confirm the exact pool distribution");
  if (new Set(confirmations.map((entry) => `${entry.block}:${entry.identity}`)).size !== 1) {
    throw new Error("Hive Engine providers contradict the pool distribution effect");
  }
  return Object.freeze({ ...candidate, status: "settled" as const, hiveEngineBlock: confirmations[0]!.block,
    confirmationProviders: Object.freeze(confirmations.map((entry) => entry.provider).sort()) });
}

async function eventsOf(dataDir: string): Promise<readonly WorkerBeePoolDistributionEvent[]> {
  return (await querySettlementRecords(WORKER_BEE_POOL_DISTRIBUTION_CATEGORY)) as readonly WorkerBeePoolDistributionEvent[];
}

export async function recordWorkerBeePoolDistributions(
  dataDir: string,
  distributions: readonly WorkerBeePoolDistribution[],
  recordedAt = new Date().toISOString(),
): Promise<readonly WorkerBeePoolDistributionEvent[]> {
  const at = new Date(recordedAt).toISOString();
  const existing = new Set((await eventsOf(dataDir)).map((event) => event.distribution.sourceId));
  const appended: WorkerBeePoolDistributionEvent[] = [];
  for (const distribution of distributions) {
    if (distribution.status !== "settled" || distribution.from !== WORKER_BEE_POOL_ACCOUNT
      || distribution.to !== WORKER_BEE_POOL_BENEFICIARY || existing.has(distribution.sourceId)) continue;
    const eventId = `urn:aagaard:workerbee-pool-distribution:${createHash("sha256").update(distribution.sourceId).digest("base64url")}`;
    const event = Object.freeze({ workerBeePoolDistributionSchema: WORKER_BEE_POOL_DISTRIBUTION_SCHEMA,
      eventId, recordedAt: at, distribution,
      valuation: Object.freeze({ swapHive: null, reason: "distribution-asset-not-independently-valued" as const }) });
    const agentUrl = process.env["RWIL_RDF_AGENT"];
    if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
    await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
      actor: ACTOR, category: WORKER_BEE_POOL_DISTRIBUTION_CATEGORY, recordedAt: at, record: event });
    existing.add(distribution.sourceId); appended.push(event);
  }
  return Object.freeze(appended);
}

export async function readWorkerBeePoolDistributions(dataDir: string): Promise<readonly WorkerBeePoolDistributionEvent[]> {
  return Object.freeze(await eventsOf(dataDir));
}
