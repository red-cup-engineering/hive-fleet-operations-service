// Exact, dependency-free sizing for the one Hive-Engine arbitrage sequence
// whose failure residue is bounded: pool exact-output acquisition followed by
// a limit sell. Monetary values never pass through a JavaScript Number until
// the final display-only capital field is produced by the caller.

export interface ExactBookLevel {
  readonly priceSwapHivePerToken: string;
  readonly quantity: string;
}

export interface ExactPoolToBookInput {
  readonly tokenPrecision: number;
  readonly swapHivePrecision: number;
  readonly reserveInSwapHive: string;
  readonly reserveOutToken: string;
  readonly balanceSwapHive: string;
  readonly capSwapHiveMilli: number;
  readonly slippageBps: number;
  readonly bids: readonly ExactBookLevel[];
  readonly bidBookComplete: boolean;
  readonly bidBookOrdered: boolean;
}

export interface ExactPoolToBookQuote {
  readonly quantity: string;
  readonly expectedInputSwapHive: string;
  readonly maxInputSwapHive: string;
  readonly limitSellPriceSwapHive: string;
  readonly minimumProceedsSwapHive: string;
  readonly expectedProfitSwapHive: string;
  readonly worstCaseProfitSwapHive: string;
  readonly edgeBps: number;
}

export type ExactPoolToBookResult =
  | { readonly admitted: true; readonly quote: ExactPoolToBookQuote }
  | { readonly admitted: false; readonly reason: string };

const PLAIN_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function factor(precision: number): bigint {
  if (!Number.isInteger(precision) || precision < 0 || precision > 18) throw new Error("precision must be an integer from 0 through 18");
  return 10n ** BigInt(precision);
}

interface DecimalFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

function decimalFraction(value: string): DecimalFraction {
  const match = PLAIN_DECIMAL.exec(value);
  if (!match) throw new Error(`'${value}' is not a canonical unsigned decimal`);
  const fraction = match[1] ?? "";
  if (fraction.length > 30) throw new Error(`'${value}' exceeds the 30-decimal evidence bound`);
  return Object.freeze({ numerator: BigInt(value.replace(".", "")), denominator: 10n ** BigInt(fraction.length) });
}

export function decimalUnits(value: string, precision: number): bigint {
  const match = PLAIN_DECIMAL.exec(value);
  if (!match) throw new Error(`'${value}' is not a canonical unsigned decimal`);
  const fraction = match[1] ?? "";
  if (fraction.length > precision) throw new Error(`'${value}' exceeds precision ${precision}`);
  const [whole] = value.split(".");
  return BigInt(whole!) * factor(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
}

export function formatUnits(value: bigint, precision: number): string {
  if (value < 0n) return `-${formatUnits(-value, precision)}`;
  const scale = factor(precision);
  const whole = value / scale;
  if (precision === 0) return whole.toString();
  return `${whole}.${(value % scale).toString().padStart(precision, "0")}`;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new Error("ceilDiv requires a nonnegative numerator and positive denominator");
  return (numerator + denominator - 1n) / denominator;
}

function quoteAt(
  quantity: bigint,
  price: bigint,
  reserveIn: DecimalFraction,
  reserveOut: DecimalFraction,
  tokenFactor: bigint,
  swapFactor: bigint,
  slippageBps: number,
): { readonly edgeBps: number; readonly expectedInputUnits: bigint; readonly maxInputUnits: bigint; readonly worstProfitUnits: bigint } | null {
  const reserveDifference = reserveOut.numerator * tokenFactor - quantity * reserveOut.denominator;
  if (quantity <= 0n || reserveDifference <= 0n) return null;
  // reserveIn * quantity / (reserveOut - quantity), projected into whole
  // SWAP.HIVE precision units. Pool reserves may legitimately carry more
  // fractional digits than either token after repeated swaps, so they remain
  // exact rational values instead of being truncated to token precision.
  const expectedInput = ceilDiv(
    reserveIn.numerator * quantity * reserveOut.denominator * swapFactor,
    reserveIn.denominator * reserveDifference,
  );
  const maxInput = ceilDiv(expectedInput * BigInt(10_000 + slippageBps), 10_000n);
  // market.sell can round a fill's SWAP.HIVE transfer to eight decimals.
  // Flooring here is conservative: it never promises more proceeds than
  // the selected quantity times its hard limit price.
  const proceeds = (quantity * price) / tokenFactor;
  const expectedProfit = proceeds - expectedInput;
  const worstProfit = proceeds - maxInput;
  if (maxInput <= 0n || worstProfit <= 0n) return null;
  return {
    edgeBps: Number((worstProfit * 10_000n) / maxInput),
    expectedInputUnits: expectedInput,
    maxInputUnits: maxInput,
    worstProfitUnits: worstProfit,
  };
}

function maximumQuantityWithinCapital(
  upper: bigint,
  cap: bigint,
  reserveIn: DecimalFraction,
  reserveOut: DecimalFraction,
  tokenFactor: bigint,
  swapFactor: bigint,
  slippageBps: number,
): bigint {
  let low = 0n;
  let high = upper;
  while (low < high) {
    const middle = (low + high + 1n) / 2n;
    const reserveDifference = reserveOut.numerator * tokenFactor - middle * reserveOut.denominator;
    if (reserveDifference <= 0n) {
      high = middle - 1n;
      continue;
    }
    const expectedInput = ceilDiv(
      reserveIn.numerator * middle * reserveOut.denominator * swapFactor,
      reserveIn.denominator * reserveDifference,
    );
    const maxInput = ceilDiv(expectedInput * BigInt(10_000 + slippageBps), 10_000n);
    if (maxInput <= cap) low = middle;
    else high = middle - 1n;
  }
  return low;
}

export function sizeExactPoolToBook(input: ExactPoolToBookInput): ExactPoolToBookResult {
  if (!input.bidBookComplete) return Object.freeze({ admitted: false, reason: "bid book evidence is row-limit truncated" });
  if (!input.bidBookOrdered) return Object.freeze({ admitted: false, reason: "bid book evidence is not price-descending" });
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps > 10_000) {
    return Object.freeze({ admitted: false, reason: "invalid slippage bound" });
  }
  try {
    const tokenScale = factor(input.tokenPrecision);
    const swapScale = factor(input.swapHivePrecision);
    const reserveIn = decimalFraction(input.reserveInSwapHive);
    const reserveOut = decimalFraction(input.reserveOutToken);
    const balance = decimalUnits(input.balanceSwapHive, input.swapHivePrecision);
    const capFromPolicy = BigInt(input.capSwapHiveMilli) * swapScale / 1000n;
    const cap = balance < capFromPolicy ? balance : capFromPolicy;
    if (reserveIn.numerator <= 0n || reserveOut.numerator <= 0n) return Object.freeze({ admitted: false, reason: "exact positive pool reserves unavailable" });
    if (cap <= 0n) return Object.freeze({ admitted: false, reason: "no admitted SWAP.HIVE capital balance" });
    if (input.bids.length === 0) return Object.freeze({ admitted: false, reason: "exact bid depth unavailable" });

    let priorPrice: bigint | null = null;
    let cumulative = 0n;
    let best: { readonly quote: ExactPoolToBookQuote; readonly worst: bigint; readonly maxInput: bigint } | null = null;
    for (const level of input.bids) {
      const price = decimalUnits(level.priceSwapHivePerToken, input.swapHivePrecision);
      const levelQuantity = decimalUnits(level.quantity, input.tokenPrecision);
      if (price <= 0n || levelQuantity <= 0n) throw new Error("book level must be positive");
      if (priorPrice !== null && price > priorPrice) throw new Error("bid prices are not descending");
      priorPrice = price;
      cumulative += levelQuantity;
      const reserveOutFloor = reserveOut.numerator * tokenScale / reserveOut.denominator;
      const reserveExactlyOnTokenUnit = reserveOut.numerator * tokenScale % reserveOut.denominator === 0n;
      const maximumBelowReserve = reserveExactlyOnTokenUnit ? reserveOutFloor - 1n : reserveOutFloor;
      const upper = cumulative < maximumBelowReserve ? cumulative : maximumBelowReserve;
      const quantity = maximumQuantityWithinCapital(upper, cap, reserveIn, reserveOut, tokenScale, swapScale, input.slippageBps);
      const evaluated = quoteAt(quantity, price, reserveIn, reserveOut, tokenScale, swapScale, input.slippageBps);
      if (!evaluated || evaluated.maxInputUnits > cap) continue;
      const quote = Object.freeze({
        quantity: formatUnits(quantity, input.tokenPrecision),
        expectedInputSwapHive: formatUnits(evaluated.expectedInputUnits, input.swapHivePrecision),
        maxInputSwapHive: formatUnits(evaluated.maxInputUnits, input.swapHivePrecision),
        limitSellPriceSwapHive: formatUnits(price, input.swapHivePrecision),
        minimumProceedsSwapHive: formatUnits((quantity * price) / tokenScale, input.swapHivePrecision),
        expectedProfitSwapHive: formatUnits(((quantity * price) / tokenScale) - evaluated.expectedInputUnits, input.swapHivePrecision),
        worstCaseProfitSwapHive: formatUnits(evaluated.worstProfitUnits, input.swapHivePrecision),
        edgeBps: evaluated.edgeBps,
      });
      if (!best || evaluated.worstProfitUnits > best.worst || (evaluated.worstProfitUnits === best.worst && evaluated.maxInputUnits < best.maxInput)) {
        best = { quote, worst: evaluated.worstProfitUnits, maxInput: evaluated.maxInputUnits };
      }
    }
    return best
      ? Object.freeze({ admitted: true, quote: best.quote })
      : Object.freeze({ admitted: false, reason: "bounded round trip is not profitable after exact depth, precision, and slippage" });
  } catch (error) {
    return Object.freeze({ admitted: false, reason: `invalid exact market evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}
