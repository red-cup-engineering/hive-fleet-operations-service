import { decimalUnits, formatUnits } from "./exactArbitrage.mts";
import { boundedPoolOutput, exactInputPoolOutput, type ExactInputPoolEvidence } from "./exactTriangle.mts";

export interface ExactPoolCycleInput {
  readonly initialBalance: string;
  readonly initialPrecision: number;
  readonly maximumInitial: string;
  readonly minimumProfitInitial: string;
  readonly minimumEdgeBps: number;
  readonly perPoolSlippageBps: number;
  readonly pools: readonly ExactInputPoolEvidence[];
}

export interface ExactPoolCycleQuote {
  readonly input: string;
  readonly finalMinimumOutput: string;
  readonly worstCaseProfit: string;
  readonly worstCaseEdgeBps: number;
  readonly hops: readonly Readonly<{ pool: string; inputSymbol: string; outputSymbol: string; input: string; expectedOutput: string; minimumOutput: string }>[];
  readonly policyAdmitted: boolean;
  readonly policyRefusal: string | null;
  readonly executionAdmissible: false;
  readonly evidenceGaps: readonly string[];
}

export type ExactPoolCycleResult = Readonly<{ admitted: true; quote: ExactPoolCycleQuote }>
  | Readonly<{ admitted: false; reason: string }>;

// Floor rounding at each token precision does not, without an additional
// proof, preserve the discrete unimodality needed by a ternary optimizer.
// Keep this assay genuinely exact by scanning a bounded integer domain and
// refusing larger domains rather than presenting a heuristic optimum as a
// theorem. A caller can lower maximumInitial to assay a smaller capital lot.
export const MAX_EXACT_POOL_CYCLE_SEARCH_UNITS = 1_000_000n;

function validate(input: ExactPoolCycleInput): void {
  if (input.pools.length < 2 || input.pools.length > 5) throw new Error("exact pool cycle requires two through five hops");
  if (!Number.isSafeInteger(input.perPoolSlippageBps) || input.perPoolSlippageBps < 0 || input.perPoolSlippageBps > 1_000) throw new Error("pool-cycle slippage bound is malformed");
  if (!Number.isSafeInteger(input.minimumEdgeBps) || input.minimumEdgeBps < 0 || input.minimumEdgeBps > 10_000) throw new Error("pool-cycle edge threshold is malformed");
  const first = input.pools[0]!; const last = input.pools[input.pools.length - 1]!;
  if (first.inputPrecision !== input.initialPrecision || last.outputPrecision !== input.initialPrecision
    || first.inputSymbol !== last.outputSymbol) throw new Error("pool route does not close in the initial token");
  for (let index = 0; index < input.pools.length; index += 1) {
    const pool = input.pools[index]!; const next = input.pools[index + 1];
    const pair = pool.pair.split(":");
    if (pair.length !== 2 || !pair.includes(pool.inputSymbol) || !pair.includes(pool.outputSymbol)
      || pool.inputSymbol === pool.outputSymbol || !Number.isSafeInteger(pool.inputPrecision) || pool.inputPrecision < 0 || pool.inputPrecision > 18
      || !Number.isSafeInteger(pool.outputPrecision) || pool.outputPrecision < 0 || pool.outputPrecision > 18
      || !Number.isSafeInteger(pool.feeBps) || pool.feeBps < 0 || pool.feeBps >= 10_000) throw new Error("pool-cycle hop evidence is malformed");
    if (next && (pool.outputSymbol !== next.inputSymbol || pool.outputPrecision !== next.inputPrecision)) {
      throw new Error("adjacent pool route symbols or precisions do not compose");
    }
  }
}

function quoteAt(inputUnits: bigint, input: ExactPoolCycleInput) {
  let amount = inputUnits;
  const hops: { pool: string; inputSymbol: string; outputSymbol: string; input: bigint; expected: bigint; minimum: bigint; outputPrecision: number; inputPrecision: number }[] = [];
  for (const pool of input.pools) {
    const expected = exactInputPoolOutput(amount, pool);
    const minimum = boundedPoolOutput(expected, input.perPoolSlippageBps);
    if (expected <= 0n || minimum <= 0n) return null;
    hops.push({ pool: pool.pair, inputSymbol: pool.inputSymbol, outputSymbol: pool.outputSymbol,
      input: amount, expected, minimum, outputPrecision: pool.outputPrecision, inputPrecision: pool.inputPrecision });
    amount = minimum;
  }
  return Object.freeze({ inputUnits, finalMinimum: amount, profit: amount - inputUnits, hops: Object.freeze(hops) });
}

/** Sizes a closed exact-input pool cycle entirely in token integer units. Each
 * subsequent hop spends only the previous hop's hard minimum output, so a
 * positive final bound does not depend on receiving a spot or expected quote. */
export function sizeExactPoolCycle(input: ExactPoolCycleInput): ExactPoolCycleResult {
  try {
    validate(input);
    const balance = decimalUnits(input.initialBalance, input.initialPrecision);
    const maximumPolicy = decimalUnits(input.maximumInitial, input.initialPrecision);
    const maximum = balance < maximumPolicy ? balance : maximumPolicy;
    const minimumProfit = decimalUnits(input.minimumProfitInitial, input.initialPrecision);
    if (maximum <= 0n) return Object.freeze({ admitted: false, reason: "no admitted initial-token inventory" });
    if (maximum > MAX_EXACT_POOL_CYCLE_SEARCH_UNITS) return Object.freeze({ admitted: false,
      reason: `exact pool-cycle domain exceeds the ${MAX_EXACT_POOL_CYCLE_SEARCH_UNITS} integer-unit certification bound` });
    let best: ReturnType<typeof quoteAt> = null;
    for (let at = 1n; at <= maximum; at += 1n) {
      const candidate = quoteAt(at, input);
      if (candidate && (!best || candidate.profit > best.profit
        || (candidate.profit === best.profit && candidate.inputUnits < best.inputUnits))) best = candidate;
    }
    if (!best || best.profit <= 0n) return Object.freeze({ admitted: false,
      reason: "exact pool cycle has no positive minimum-output surplus after fees, precision, and slippage" });
    const edgeBps = Number(best.profit * 10_000n / best.inputUnits);
    const policyRefusal = best.profit < minimumProfit ? `worst-case profit is below ${input.minimumProfitInitial} initial-token units`
      : edgeBps < input.minimumEdgeBps ? `worst-case edge is below ${input.minimumEdgeBps} bps` : null;
    return Object.freeze({ admitted: true, quote: Object.freeze({
      input: formatUnits(best.inputUnits, input.initialPrecision),
      finalMinimumOutput: formatUnits(best.finalMinimum, input.initialPrecision),
      worstCaseProfit: formatUnits(best.profit, input.initialPrecision), worstCaseEdgeBps: edgeBps,
      hops: Object.freeze(best.hops.map((hop) => Object.freeze({ pool: hop.pool, inputSymbol: hop.inputSymbol,
        outputSymbol: hop.outputSymbol, input: formatUnits(hop.input, hop.inputPrecision),
        expectedOutput: formatUnits(hop.expected, hop.outputPrecision), minimumOutput: formatUnits(hop.minimum, hop.outputPrecision) }))),
      policyAdmitted: policyRefusal === null, policyRefusal, executionAdmissible: false as const,
      evidenceGaps: Object.freeze(["sequential-pool-actions-can-settle-partially", "provider-certified-reserves-can-change-before-inclusion",
        "minimum-output-surplus-is-in-the-initial-token-not-realized-SWAP.HIVE"]),
    }) });
  } catch (error) {
    return Object.freeze({ admitted: false, reason: `invalid exact pool-cycle evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}
