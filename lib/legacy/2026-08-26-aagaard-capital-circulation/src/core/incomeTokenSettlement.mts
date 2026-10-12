// Append-only settlement and telemetry for Hive income-token distributions.
// A distribution is realized only when Hive account history contains the
// exact incoming HIVE transfer. The token's displayed SWAP.HIVE exit value is
// carried beside, but never divided into, native-HIVE income.

import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const INCOME_TOKEN_DISTRIBUTION_SCHEMA = "aagaard.income-token-distribution.v1" as const;
export const INCOME_TOKEN_DISTRIBUTION_CATEGORY = "aagaard.income-token-distribution-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";

export interface IncomeTokenDistribution {
  readonly sourceId: string;
  readonly account: string;
  readonly payer: string;
  readonly symbol: string;
  readonly historyIndex: number;
  readonly block: number;
  readonly operationIndex: number;
  readonly transactionId: string;
  readonly timestamp: string;
  readonly amount: string;
  readonly memo: string;
  readonly reportedHolding: string;
}

export interface IncomeTokenDistributionScan {
  readonly kind: "aagaard.income-token-distribution-scan";
  readonly account: string;
  readonly payer: string;
  readonly symbol: string;
  readonly requestedLimit: number;
  readonly oldestHistoryIndex: number | null;
  readonly newestHistoryIndex: number | null;
  readonly evidenceProviders: readonly string[];
  readonly distributions: readonly IncomeTokenDistribution[];
}

export interface IncomeTokenDistributionEvent {
  readonly incomeTokenDistributionSchema: typeof INCOME_TOKEN_DISTRIBUTION_SCHEMA;
  readonly event: "distribution-observed";
  readonly eventId: string;
  readonly recordedAt: string;
  readonly source: IncomeTokenDistribution;
  readonly realization: {
    readonly quantity: string;
    readonly asset: "HIVE";
    readonly status: "realized-transfer";
  };
  readonly valuation: {
    readonly swapHive: null;
    readonly reason: "native-HIVE-distribution-not-valued-as-SWAP.HIVE";
  };
}

const ACCOUNT = /^[a-z][a-z0-9.-]{2,15}$/u;
const SYMBOL = /^[A-Z0-9.]{1,20}$/u;
const HIVE_AMOUNT = /^(0|[1-9][0-9]*)\.([0-9]{3}) HIVE$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("distribution timestamp is absent");
  const milliseconds = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  if (!Number.isFinite(milliseconds)) throw new TypeError("distribution timestamp is malformed");
  return new Date(milliseconds).toISOString();
}

/** Parse one condenser account-history row. Unrelated operations return null;
 * an exact payer-to-holder transfer that names the symbol fails closed when
 * its carrier is malformed. */
export function incomeTokenDistributionFromHistoryRow(
  row: unknown,
  account: string,
  payer: string,
  symbol: string,
): IncomeTokenDistribution | null {
  if (!ACCOUNT.test(account) || !ACCOUNT.test(payer) || !SYMBOL.test(symbol)) throw new TypeError("invalid income-token identity");
  if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0]) || !isRecord(row[1])) return null;
  const historyIndex = Number(row[0]);
  const envelope = row[1];
  const operation = envelope["op"];
  if (!Array.isArray(operation) || operation.length !== 2 || operation[0] !== "transfer" || !isRecord(operation[1])) return null;
  const value = operation[1];
  if (value["from"] !== payer || value["to"] !== account) return null;
  const memo = String(value["memo"] ?? "");
  if (!memo.includes(symbol)) return null;
  const memoPattern = new RegExp(`^Dividends for holding ((?:0|[1-9][0-9]*)(?:\\.[0-9]+)?) ${escapeRegex(symbol)} tokens\\.$`, "u");
  const holding = memoPattern.exec(memo);
  const amount = String(value["amount"] ?? "");
  if (!holding || !HIVE_AMOUNT.test(amount)) throw new TypeError("income-token distribution carrier is malformed");
  const block = Number(envelope["block"]);
  const operationIndex = Number(envelope["op_in_trx"]);
  const transactionId = String(envelope["trx_id"] ?? "");
  if (!Number.isSafeInteger(block) || block <= 0 || !Number.isSafeInteger(operationIndex) || operationIndex < 0
    || !/^[0-9a-f]{40}$/u.test(transactionId)) throw new TypeError("income-token distribution identity is malformed");
  const sourceId = `urn:aagaard:hive-transfer:${createHash("sha256")
    .update(JSON.stringify([account, historyIndex, block, operationIndex, transactionId]))
    .digest("base64url")}`;
  return Object.freeze({ sourceId, account, payer, symbol, historyIndex, block, operationIndex, transactionId,
    timestamp: canonicalTimestamp(envelope["timestamp"]), amount, memo, reportedHolding: holding[1]! });
}

function hiveMillis(amount: string): bigint {
  const match = HIVE_AMOUNT.exec(amount);
  if (!match) throw new TypeError("distribution amount is not exact HIVE");
  return BigInt(match[1]!) * 1_000n + BigInt(match[2]!);
}

function fixed(value: bigint, precision: number): string {
  const scale = 10n ** BigInt(precision);
  return `${value / scale}.${(value % scale).toString().padStart(precision, "0")}`;
}

function validateScan(scan: IncomeTokenDistributionScan): void {
  if (scan.kind !== "aagaard.income-token-distribution-scan" || !ACCOUNT.test(scan.account)
    || !ACCOUNT.test(scan.payer) || !SYMBOL.test(scan.symbol)
    || !Number.isSafeInteger(scan.requestedLimit) || scan.requestedLimit < 1 || scan.requestedLimit > 1_000
    || scan.evidenceProviders.length < 2 || new Set(scan.evidenceProviders).size !== scan.evidenceProviders.length) {
    throw new TypeError("income-token distribution scan identity is malformed");
  }
  for (const source of scan.distributions) {
    if (source.account !== scan.account || source.payer !== scan.payer || source.symbol !== scan.symbol
      || incomeTokenDistributionFromHistoryRow([source.historyIndex, {
        op: ["transfer", { from: source.payer, to: source.account, amount: source.amount, memo: source.memo }],
        block: source.block, op_in_trx: source.operationIndex, trx_id: source.transactionId, timestamp: source.timestamp,
      }], scan.account, scan.payer, scan.symbol)?.sourceId !== source.sourceId) {
      throw new TypeError("income-token distribution does not belong to its scan");
    }
  }
}

export function summarizeIncomeTokenPosition(input: Readonly<{
  scan: IncomeTokenDistributionScan;
  observedAt: string;
  exit: Readonly<Record<string, unknown>>;
}>) {
  validateScan(input.scan);
  const observedAt = new Date(input.observedAt).toISOString();
  const ordered = [...input.scan.distributions].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const year = observedAt.slice(0, 4);
  const ytd = ordered.filter((entry) => entry.timestamp.startsWith(`${year}-`));
  const recent = ordered.slice(-12);
  const sum = (rows: readonly IncomeTokenDistribution[]) => rows.reduce((total, row) => total + hiveMillis(row.amount), 0n);
  const recentTotal = sum(recent);
  const annualizedMicros = recent.length === 0 ? null : recentTotal * 1_000n * 52n / BigInt(recent.length);
  const latest = ordered.at(-1) ?? null;
  const latestAgeDays = latest === null ? null : Math.floor((Date.parse(observedAt) - Date.parse(latest.timestamp)) / 86_400_000);
  const valuation = isRecord(input.exit["valuation"]) ? input.exit["valuation"] : null;
  const completeExit = input.exit["status"] === "certified" && valuation?.["completeExit"] === true;
  const active = latestAgeDays !== null && latestAgeDays >= 0 && latestAgeDays <= 10 && recent.length >= 4;
  return Object.freeze({
    schema: "aagaard.income-token-position.v1" as const,
    observedAt, account: input.scan.account, symbol: input.scan.symbol, payer: input.scan.payer,
    sourceAgreement: Object.freeze({ providers: input.scan.evidenceProviders, distributionCount: ordered.length }),
    realized: Object.freeze({ scanTotal: `${fixed(sum(ordered), 3)} HIVE`, yearToDate: `${fixed(sum(ytd), 3)} HIVE`,
      yearToDateCount: ytd.length, latest: latest === null ? null : Object.freeze({ amount: latest.amount,
        timestamp: latest.timestamp, reportedHolding: latest.reportedHolding }) }),
    projection: Object.freeze({ basis: `latest-${recent.length}-settled-distributions`,
      annualizedNativeHive: annualizedMicros === null ? null : `${fixed(annualizedMicros, 6)} HIVE`,
      status: annualizedMicros === null ? "unavailable" : "historical-run-rate-not-guaranteed" }),
    exit: input.exit,
    comparison: Object.freeze({ yieldBps: null,
      reason: "native-HIVE-distributions-and-SWAP.HIVE-exit-proceeds-are-not-assumed-commensurate" }),
    decision: active && completeExit ? "hold-productive-position-and-monitor" : "manual-review",
    reasons: Object.freeze([active ? "recent recurring HIVE distributions are independently settled" : "recent recurring distribution evidence is insufficient",
      completeExit ? "complete displayed SWAP.HIVE bid exit is independently certified" : "complete displayed exit is not certified"]),
  });
}

async function eventsOf(dataDir: string): Promise<readonly IncomeTokenDistributionEvent[]> {
  return (await querySettlementRecords(INCOME_TOKEN_DISTRIBUTION_CATEGORY)) as readonly IncomeTokenDistributionEvent[];
}

export async function recordIncomeTokenDistributions(
  dataDir: string,
  scan: IncomeTokenDistributionScan,
  recordedAt = new Date().toISOString(),
): Promise<readonly IncomeTokenDistributionEvent[]> {
  validateScan(scan);
  const at = new Date(recordedAt).toISOString();
  const existing = new Set((await eventsOf(dataDir)).map((event) => event.eventId));
  const appended: IncomeTokenDistributionEvent[] = [];
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  for (const source of [...scan.distributions].sort((left, right) => left.historyIndex - right.historyIndex)) {
    const eventId = source.sourceId;
    if (existing.has(eventId)) continue;
    const event: IncomeTokenDistributionEvent = Object.freeze({ incomeTokenDistributionSchema: INCOME_TOKEN_DISTRIBUTION_SCHEMA,
      event: "distribution-observed" as const, eventId, recordedAt: at, source,
      realization: Object.freeze({ quantity: source.amount.slice(0, -5), asset: "HIVE" as const, status: "realized-transfer" as const }),
      valuation: Object.freeze({ swapHive: null, reason: "native-HIVE-distribution-not-valued-as-SWAP.HIVE" as const }) });
    await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
      actor: ACTOR, category: INCOME_TOKEN_DISTRIBUTION_CATEGORY, recordedAt: at, record: event });
    existing.add(eventId);
    appended.push(event);
  }
  return Object.freeze(appended);
}

export async function readIncomeTokenDistributions(dataDir: string, account?: string, symbol?: string): Promise<readonly IncomeTokenDistributionEvent[]> {
  return Object.freeze((await eventsOf(dataDir)).filter((event) => (account === undefined || event.source.account === account)
    && (symbol === undefined || event.source.symbol === symbol)));
}
