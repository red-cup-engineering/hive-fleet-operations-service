import { createHash } from "node:crypto";

import { querySettlementRecords, recordSettlementRecord } from "@lenticule-science/rwil-rdf-projection-service/client";

export const MARKET_CYCLE_44_SCHEMA = "aagaard.market-cycle-44.v1" as const;
export const MARKET_CYCLE_44_CATEGORY = "aagaard.market-cycle-44-event" as const;
const SETTLEMENT = "eip155:31337:0xb0dfc2eb77fb622c93f791071c66b039a7ae428d";
const ACTOR = "urn:ame:aagaard";
const PRIOR_ID = "urn:aagaard:game-capability-cycle-43:l-VVBc_ryorQioDjY4RvBlQ41h9_3uOKlZa3B_TdsQk";
const RESIDUE = "an A2A RMN operation must carry exactly one application/rmn+cbor raw part";
const FLEET = Object.freeze(["emsenn0", "essiebee", "help-fund", "marshian", "michael561", "sigmund-vexler"]);

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}
function rows(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}
function units8(value: unknown, label: string): bigint {
  const text = String(value ?? "");
  const match = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/u.exec(text);
  if (!match) throw new TypeError(`${label} must be an exact nonnegative decimal with at most eight places`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(`${whole}${fraction.padEnd(8, "0")}`);
}
function format8(value: bigint): string {
  const digits = value.toString().padStart(9, "0");
  return `${digits.slice(0, -8)}.${digits.slice(-8)}`;
}
function exactKnowledge(value: unknown, label: string) {
  const knowledge = record(value, `${label} provider knowledge`);
  if (knowledge.value !== "true") throw new TypeError(`${label} is not independently known`);
  const groups = rows(knowledge.stateDigests, `${label} state digests`);
  if (groups.length !== 1) throw new TypeError(`${label} does not have one exact state`);
  const group = record(groups[0], `${label} state digest`);
  const stateDigest = String(group.stateDigest ?? "");
  const providers = rows(group.providers, `${label} providers`).map(String).sort();
  if (!/^sha256:[0-9a-f]{64}$/u.test(stateDigest) || providers.length < 2
    || new Set(providers).size !== providers.length || providers.some((provider) => !provider.startsWith("https://"))) {
    throw new TypeError(`${label} lacks exact independent support`);
  }
  return Object.freeze({ stateDigest, providers: Object.freeze(providers) });
}
function safe<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function marketCycle44Event(input: Readonly<{
  prior: Readonly<Record<string, unknown>>;
  global: Readonly<Record<string, unknown>>;
  triangle: Readonly<Record<string, unknown>>;
  poolCycle: Readonly<Record<string, unknown>>;
  shadow: Readonly<Record<string, unknown>>;
  procurementResidue: string;
  recordedAt?: string;
}>) {
  const priorCycle = record(input.prior.cycle, "prior cycle");
  if (input.prior.eventId !== PRIOR_ID || input.prior.gameCapabilityCycle43Schema !== "aagaard.game-capability-cycle-43.v1"
    || priorCycle.globalStep !== 43 || priorCycle.angle !== "games-capability" || priorCycle.nextAngle !== "market-arbitrage"
    || input.prior.protectedAlphaVialPreserved !== true) {
    throw new TypeError("cycle 44 requires the exact durable cycle 43 rotation and protected-asset witness");
  }

  const global = input.global;
  if (global.schema !== "aagaard.global-arbitrage-scan.v1" || global.status !== "certified"
    || global.admittedCount !== 0 || global.executionAdmissible !== false
    || global.credentialAccess !== false || global.chainMutation !== false) {
    throw new TypeError("cycle 44 global scan is not a certified treasury-policy refusal");
  }
  const globalExact = exactKnowledge(global.providerKnowledge, "global scan");
  const policy = record(global.policy, "global policy");
  if (policy.capSwapHiveMilli !== 1000 || policy.slippageBps !== 50
    || policy.minimumProfitSwapHive !== "0.00100000" || policy.minimumEdgeBps !== 50) {
    throw new TypeError("cycle 44 treasury policy changed");
  }
  const opportunities = rows(global.opportunities, "global opportunities").map((row) => record(row, "global opportunity"));
  if (opportunities.length === 0 || opportunities.some((row) => row.policyAdmitted !== false)) {
    throw new TypeError("cycle 44 requires every global opportunity to remain policy-refused");
  }
  const photoRows = opportunities.filter((row) => row.symbol === "PHOTO");
  if (photoRows.length !== 1) throw new TypeError("cycle 44 requires one exact global PHOTO near miss");
  const photo = photoRows[0]!; const photoExact = record(photo.exact, "PHOTO exact quote");
  const quote = record(photoExact.quote, "PHOTO quote");
  const maximumInput = units8(quote.maxInputSwapHive, "PHOTO maximum input");
  const minimumProceeds = units8(quote.minimumProceedsSwapHive, "PHOTO minimum proceeds");
  const worstCaseProfit = units8(quote.worstCaseProfitSwapHive, "PHOTO worst-case profit");
  const expectedProfit = units8(quote.expectedProfitSwapHive, "PHOTO expected profit");
  const minimumProfit = units8(policy.minimumProfitSwapHive, "treasury minimum profit");
  const edgeBps = Number(quote.edgeBps);
  if (photo.pool !== "SWAP.HIVE:PHOTO" || photoExact.admitted !== true || photo.fleetSelfCross !== false
    || photo.policyAdmitted !== false || photo.policyRefusal !== "worst-case full-fill profit is below 0.00100000 SWAP.HIVE"
    || maximumInput <= 0n || minimumProceeds - maximumInput !== worstCaseProfit || worstCaseProfit <= 0n
    || expectedProfit < worstCaseProfit || worstCaseProfit >= minimumProfit
    || !Number.isSafeInteger(edgeBps) || edgeBps < Number(policy.minimumEdgeBps)) {
    throw new TypeError("cycle 44 PHOTO quote is not the exact profitable-but-below-floor near miss");
  }

  const triangle = input.triangle; const triangleResult = record(triangle.result, "triangle result");
  if (triangle.schema !== "aagaard.exact-triangle-assay.v1" || triangle.status !== "certified"
    || triangleResult.admitted !== false || triangle.executionAdmissible !== false
    || triangle.credentialAccess !== false || triangle.chainMutation !== false) {
    throw new TypeError("cycle 44 triangle is not a certified refusal");
  }
  const triangleExact = exactKnowledge(triangle.providerKnowledge, "triangle assay");
  const poolCycle = input.poolCycle; const assay = record(poolCycle.assay, "pool-cycle assay");
  const poolResult = record(assay.result, "pool-cycle result");
  if (poolCycle.kind !== "aagaard.exact-pool-cycle-opportunity" || poolCycle.decision !== "refuse"
    || poolCycle.executionAdmissible !== false || poolCycle.credentialAccess !== false || poolCycle.chainMutation !== false
    || assay.status !== "certified" || poolResult.admitted !== false) {
    throw new TypeError("cycle 44 pool cycle is not a certified refusal");
  }
  const poolExact = exactKnowledge(assay.providerKnowledge, "pool-cycle assay");

  const shadow = input.shadow; const maker = record(shadow.makerOrderScan, "fleet maker-order scan");
  const accounts = rows(shadow.accounts, "fleet accounts").map((row) => record(row, "fleet account"));
  const candidates = rows(shadow.executableCandidates, "shadow candidates").map((row) => record(row, "shadow candidate"));
  const accountsObserved = rows(maker.accountsObserved, "maker accounts observed").map(String).sort();
  if (shadow.kind !== "aagaard.market-shadow-scan" || shadow.chainMutation !== false || shadow.credentialAccess !== false
    || maker.complete !== true || maker.orderCount !== 0 || rows(maker.limitations, "maker limitations").length !== 0
    || JSON.stringify(accountsObserved) !== JSON.stringify([...FLEET].sort()) || accounts.length !== FLEET.length
    || shadow.candidateCount !== 1 || candidates.length !== 1) {
    throw new TypeError("cycle 44 fleet/order scan is incomplete or does not contain one bounded shadow candidate");
  }
  const accountRows = accounts.map((account) => {
    if (account.status !== "observed" || typeof account.tradingLive !== "boolean") throw new TypeError("cycle 44 fleet account is unavailable");
    return Object.freeze({ account: String(account.account), swapHiveBalance: format8(units8(account.swapHiveBalance, "fleet balance")),
      tradingLive: account.tradingLive });
  }).sort((left, right) => left.account.localeCompare(right.account));
  if (JSON.stringify(accountRows.map((account) => account.account)) !== JSON.stringify([...FLEET].sort())) {
    throw new TypeError("cycle 44 fleet coverage is not exact");
  }
  const candidate = candidates[0]!;
  if (candidate.account !== "michael561" || candidate.symbol !== "PHOTO"
    || candidate.pool !== "SWAP.HIVE:PHOTO" || candidate.executable !== true || candidate.funded !== true
    || candidate.selfCrossAdmitted !== true || units8(candidate.maximumInputSwapHive, "shadow maximum input") !== maximumInput
    || units8(candidate.minimumProceedsSwapHive, "shadow minimum proceeds") !== minimumProceeds
    || units8(candidate.worstCaseProfitSwapHive, "shadow worst-case profit") !== worstCaseProfit
    || candidate.edgeBps !== edgeBps) throw new TypeError("cycle 44 shadow candidate does not match the certified PHOTO near miss");
  const michael = accountRows.find((account) => account.account === "michael561");
  if (!michael || michael.tradingLive !== true || units8(michael.swapHiveBalance, "michael561 balance") < maximumInput) {
    throw new TypeError("cycle 44 PHOTO near miss is not actually funded by michael561");
  }
  if (input.procurementResidue.trim() !== RESIDUE) throw new TypeError("procurement residue is not exact");

  const candidateSummary = Object.freeze({ account: "michael561" as const, symbol: "PHOTO" as const,
    quantity: String(quote.quantity), maximumInputSwapHive: format8(maximumInput), minimumProceedsSwapHive: format8(minimumProceeds),
    expectedProfitSwapHive: format8(expectedProfit), worstCaseProfitSwapHive: format8(worstCaseProfit), edgeBps,
    treasuryMinimumProfitSwapHive: format8(minimumProfit), shortfallSwapHive: format8(minimumProfit - worstCaseProfit),
    fleetSelfCross: false as const, technicallyExecutable: true as const, treasuryAdmitted: false as const });
  const eventId = `urn:aagaard:market-cycle-44:${createHash("sha256").update(JSON.stringify([
    PRIOR_ID, globalExact.stateDigest, triangleExact.stateDigest, poolExact.stateDigest, shadow.observedAt, candidateSummary,
  ])).digest("base64url")}`;
  return Object.freeze({ marketCycle44Schema: MARKET_CYCLE_44_SCHEMA, eventId,
    recordedAt: new Date(input.recordedAt ?? new Date().toISOString()).toISOString(), sourceCycleEventId: PRIOR_ID,
    cycle: Object.freeze({ globalStep: 44 as const, angle: "market-arbitrage" as const, nextAngle: "curation-attention" as const }),
    policy: Object.freeze({ capSwapHive: "1.00000000 SWAP.HIVE" as const, slippageBps: 50 as const,
      minimumWorstCaseProfit: "0.00100000 SWAP.HIVE" as const, minimumEdgeBps: 50 as const,
      noFleetSelfCross: true as const, independentProviderMinimum: 2 as const }),
    candidate: candidateSummary,
    alternativeRefusals: Object.freeze({ globalOpportunityCount: opportunities.length, globalAdmittedCount: 0 as const,
      triangle: String(triangle.refusal), poolCycle: String(poolCycle.refusal) }),
    fleet: Object.freeze({ accounts: Object.freeze(accountRows), openOrders: 0 as const }),
    evidence: Object.freeze({ global: globalExact, triangle: triangleExact, poolCycle: poolExact,
      shadowObservedAt: new Date(String(shadow.observedAt)).toISOString() }),
    accountRoles: Object.freeze({ emsenn0: "curation-vote-only" as const, candidateAccount: "michael561" as const }),
    decision: "refuse-all-below-treasury-floor" as const,
    interpretation: "technical-executability-does-not-imply-treasury-admission" as const,
    tradeBroadcast: false as const, capitalMoved: "0.00000000 SWAP.HIVE" as const,
    realizedProfit: "0.00000000 SWAP.HIVE" as const, credentialAccess: false as const, chainMutation: false as const,
    protectedAlphaVialPreserved: true as const,
    procurement: Object.freeze({ status: "no-candidate-accepted" as const, residue: RESIDUE }),
    receipts: Object.freeze(safe({ global, triangle, poolCycle, shadow })) });
}

export async function recordMarketCycle44(dataDir: string, input: Parameters<typeof marketCycle44Event>[0]) {
  const event = marketCycle44Event(input);
  const prior = ((await querySettlementRecords(MARKET_CYCLE_44_CATEGORY)) as readonly Readonly<Record<string, unknown>>[])
    .find((row) => row.eventId === event.eventId);
  if (prior) return prior;
  const agentUrl = process.env["RWIL_RDF_AGENT"];
  if (!agentUrl) throw new Error("RWIL_RDF_AGENT must name Aagaard's contracted RWIL/RDF provider");
  await recordSettlementRecord({ agentUrl, settlement: SETTLEMENT,
    actor: ACTOR, category: MARKET_CYCLE_44_CATEGORY, recordedAt: event.recordedAt, record: event });
  return event;
}

export async function readMarketCycle44(dataDir: string) {
  return Object.freeze(await querySettlementRecords(MARKET_CYCLE_44_CATEGORY));
}
