import { decimalUnits, formatUnits, type ExactBookLevel } from "./exactArbitrage.mts";

/** Exact, read-only assay for the concrete three-hop carrier presently seen
 * on Hive Engine: numeraire -> token A through one constant-product pool,
 * token A -> token B through a second pool, then token B -> numeraire across
 * the complete bid book. This closes the gap between holonomy as a useful
 * obstruction witness and an executable quantity. It deliberately grants no
 * broadcast authority: three sequential contract calls are not atomic. */

export interface ExactInputPoolEvidence {
  readonly pair: string;
  readonly inputSymbol: string;
  readonly outputSymbol: string;
  readonly reserveIn: string;
  readonly reserveOut: string;
  readonly inputPrecision: number;
  readonly outputPrecision: number;
  readonly feeBps: number;
}

export interface ExactTriangleInput {
  readonly initialBalance: string;
  readonly initialPrecision: number;
  readonly capInitialMilli: number;
  readonly firstPool: ExactInputPoolEvidence;
  readonly secondPool: ExactInputPoolEvidence;
  readonly finalTokenPrecision: number;
  readonly bids: readonly ExactBookLevel[];
  readonly bidBookComplete: boolean;
  readonly bidBookOrdered: boolean;
  readonly perPoolSlippageBps: number;
}

export interface ExactTriangleQuote {
  readonly input: string;
  readonly firstExpectedOutput: string;
  readonly firstMinimumOutput: string;
  readonly secondExpectedOutput: string;
  readonly secondMinimumOutput: string;
  readonly fullFillProceeds: string;
  readonly snapshotFullFillSurplus: string;
  readonly snapshotFullFillEdgeBps: number;
  readonly finalLimitPrice: string;
  readonly finalSellQuantity: string;
  readonly executionAdmissible: false;
  readonly evidenceGaps: readonly string[];
}

export type ExactTriangleResult = Readonly<{ admitted: true; quote: ExactTriangleQuote }>
  | Readonly<{ admitted: false; reason: string }>;

const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function scale(precision: number): bigint {
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 18) throw new Error("precision must be an integer from 0 through 18");
  return 10n ** BigInt(precision);
}

function fractionalDigits(value: string): number {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`'${value}' is not a canonical unsigned decimal`);
  return match[1]?.length ?? 0;
}

function unitsAt(value: string, precision: number): bigint {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`'${value}' is not a canonical unsigned decimal`);
  const fraction = match[1] ?? "";
  if (fraction.length > precision) throw new Error(`'${value}' exceeds precision ${precision}`);
  const [whole = "0"] = value.split(".");
  return BigInt(whole) * scale(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
}

function validatePool(pool: ExactInputPoolEvidence): void {
  const pairSymbols = pool.pair.split(":");
  if (pairSymbols.length !== 2 || !pairSymbols.includes(pool.inputSymbol) || !pairSymbols.includes(pool.outputSymbol)
    || pool.inputSymbol === pool.outputSymbol) throw new Error("pool route identity is malformed");
  scale(pool.inputPrecision); scale(pool.outputPrecision);
  if (!Number.isSafeInteger(pool.feeBps) || pool.feeBps < 0 || pool.feeBps >= 10_000) throw new Error("pool fee is malformed");
}

export function exactInputPoolOutput(inputUnits: bigint, pool: ExactInputPoolEvidence): bigint {
  const commonPrecision = Math.max(pool.inputPrecision, pool.outputPrecision,
    fractionalDigits(pool.reserveIn), fractionalDigits(pool.reserveOut));
  if (commonPrecision > 18) throw new Error("pool reserve precision exceeds 18");
  const reserveIn = unitsAt(pool.reserveIn, commonPrecision);
  const reserveOut = unitsAt(pool.reserveOut, commonPrecision);
  const input = inputUnits * scale(commonPrecision) / scale(pool.inputPrecision);
  if (reserveIn <= 0n || reserveOut <= 0n || input <= 0n) return 0n;
  const effectiveInput = input * BigInt(10_000 - pool.feeBps);
  const output = reserveOut * effectiveInput / (reserveIn * 10_000n + effectiveInput);
  return output * scale(pool.outputPrecision) / scale(commonPrecision);
}

export function boundedPoolOutput(expected: bigint, slippageBps: number): bigint {
  return expected * BigInt(10_000 - slippageBps) / 10_000n;
}

type PreparedBid = Readonly<{ price: bigint; quantity: bigint; priceText: string }>;

function prepareBids(input: ExactTriangleInput): readonly PreparedBid[] {
  let prior: bigint | null = null;
  return Object.freeze(input.bids.map((level) => {
    const price = decimalUnits(level.priceSwapHivePerToken, input.initialPrecision);
    const quantity = decimalUnits(level.quantity, input.finalTokenPrecision);
    if (price <= 0n || quantity <= 0n) throw new Error("book levels must be exact and positive");
    if (prior !== null && price > prior) throw new Error("bid prices are not descending");
    prior = price;
    return Object.freeze({ price, quantity, priceText: level.priceSwapHivePerToken });
  }));
}

function sellIntoBids(quantity: bigint, bids: readonly PreparedBid[], tokenPrecision: number): Readonly<{
  proceeds: bigint; limitPrice: string; complete: boolean;
}> {
  let remaining = quantity;
  let proceeds = 0n;
  let limitPrice = "0";
  for (const bid of bids) {
    if (remaining <= 0n) break;
    const taken = remaining < bid.quantity ? remaining : bid.quantity;
    proceeds += taken * bid.price / scale(tokenPrecision);
    remaining -= taken;
    if (taken > 0n) limitPrice = bid.priceText;
  }
  return Object.freeze({ proceeds, limitPrice, complete: remaining === 0n });
}

function quoteAt(inputUnits: bigint, input: ExactTriangleInput, bids: readonly PreparedBid[]): Readonly<{
  inputUnits: bigint;
  firstExpected: bigint;
  firstMinimum: bigint;
  secondExpected: bigint;
  secondMinimum: bigint;
  proceeds: bigint;
  surplus: bigint;
  limitPrice: string;
}> | null {
  const firstExpected = exactInputPoolOutput(inputUnits, input.firstPool);
  const firstMinimum = boundedPoolOutput(firstExpected, input.perPoolSlippageBps);
  const secondExpected = exactInputPoolOutput(firstMinimum, input.secondPool);
  const secondMinimum = boundedPoolOutput(secondExpected, input.perPoolSlippageBps);
  if (firstMinimum <= 0n || secondMinimum <= 0n) return null;
  const sale = sellIntoBids(secondMinimum, bids, input.finalTokenPrecision);
  if (!sale.complete || sale.proceeds <= 0n) return null;
  return Object.freeze({ inputUnits, firstExpected, firstMinimum, secondExpected, secondMinimum,
    proceeds: sale.proceeds, surplus: sale.proceeds - inputUnits, limitPrice: sale.limitPrice });
}

/** Find the greatest conservative full-fill surplus within the admitted
 * initial capital. Constant-product exact-input output and cumulative bid
 * proceeds are concave; a discrete ternary contraction followed by an exact
 * bounded tail scan therefore locates the integer-unit maximum without
 * projecting monetary values through Number. */
export function sizeExactTriangle(input: ExactTriangleInput): ExactTriangleResult {
  try {
    validatePool(input.firstPool); validatePool(input.secondPool);
    if (input.firstPool.outputSymbol !== input.secondPool.inputSymbol) throw new Error("adjacent route symbols do not compose");
    if (input.firstPool.outputPrecision !== input.secondPool.inputPrecision
      || input.secondPool.outputPrecision !== input.finalTokenPrecision
      || input.firstPool.inputPrecision !== input.initialPrecision) throw new Error("adjacent route precisions do not compose");
    if (!input.bidBookComplete) return Object.freeze({ admitted: false, reason: "final bid book is row-limit truncated" });
    if (!input.bidBookOrdered) return Object.freeze({ admitted: false, reason: "final bid book is not price-descending" });
    if (!Number.isSafeInteger(input.perPoolSlippageBps) || input.perPoolSlippageBps < 0 || input.perPoolSlippageBps > 1_000) {
      return Object.freeze({ admitted: false, reason: "per-pool slippage bound is malformed" });
    }
    const balance = decimalUnits(input.initialBalance, input.initialPrecision);
    const cap = BigInt(input.capInitialMilli) * scale(input.initialPrecision) / 1_000n;
    const maximum = balance < cap ? balance : cap;
    if (maximum <= 0n) return Object.freeze({ admitted: false, reason: "no admitted initial capital" });
    if (input.bids.length === 0) return Object.freeze({ admitted: false, reason: "final bid depth is unavailable" });
    const bids = prepareBids(input);
    const score = (at: bigint): bigint => quoteAt(at, input, bids)?.surplus ?? -(1n << 255n);
    let low = 1n;
    let high = maximum;
    while (high - low > 20_000n) {
      const third = (high - low) / 3n;
      const left = low + third;
      const right = high - third;
      if (score(left) <= score(right)) low = left + 1n;
      else high = right - 1n;
    }
    let best: ReturnType<typeof quoteAt> = null;
    for (let at = low; at <= high; at += 1n) {
      const candidate = quoteAt(at, input, bids);
      if (candidate && (!best || candidate.surplus > best.surplus
        || (candidate.surplus === best.surplus && candidate.inputUnits < best.inputUnits))) best = candidate;
    }
    if (!best || best.surplus <= 0n) return Object.freeze({ admitted: false,
      reason: "exact bounded triangle has no positive full-fill surplus after fees, precision, slippage, and depth" });
    return Object.freeze({ admitted: true, quote: Object.freeze({
      input: formatUnits(best.inputUnits, input.initialPrecision),
      firstExpectedOutput: formatUnits(best.firstExpected, input.firstPool.outputPrecision),
      firstMinimumOutput: formatUnits(best.firstMinimum, input.firstPool.outputPrecision),
      secondExpectedOutput: formatUnits(best.secondExpected, input.secondPool.outputPrecision),
      secondMinimumOutput: formatUnits(best.secondMinimum, input.secondPool.outputPrecision),
      fullFillProceeds: formatUnits(best.proceeds, input.initialPrecision),
      snapshotFullFillSurplus: formatUnits(best.surplus, input.initialPrecision),
      snapshotFullFillEdgeBps: Number(best.surplus * 10_000n / best.inputUnits),
      finalLimitPrice: best.limitPrice,
      finalSellQuantity: formatUnits(best.secondMinimum, input.finalTokenPrecision),
      executionAdmissible: false as const,
      evidenceGaps: Object.freeze([
        "three-contract-call-carrier-is-sequential-not-atomic",
        "final-limit-order-full-fill-is-observed-not-guaranteed",
        "provider-certified-snapshot-can-change-before-inclusion",
      ]),
    }) });
  } catch (error) {
    return Object.freeze({ admitted: false, reason: `invalid exact triangle evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}
