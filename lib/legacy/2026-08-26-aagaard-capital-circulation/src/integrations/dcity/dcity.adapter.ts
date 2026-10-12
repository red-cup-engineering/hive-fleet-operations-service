import { swapTokens } from "../hive-engine/hiveEngineOps.mjs";

export interface DCityRecoveryState {
  readonly account: string;
  readonly observedAt: string;
  readonly simBalance: string;
  readonly swapHiveBalance: string;
  readonly simPrecision: number;
  readonly swapHivePrecision: number;
  readonly tokenPair: "SWAP.HIVE:SIM" | "SIM:SWAP.HIVE";
  readonly baseQuantity: string;
  readonly quoteQuantity: string;
  readonly nftCount: number;
  readonly nftLockedSim: string;
}

export interface DCityRecoveryQuote {
  readonly quantitySim: string;
  readonly expectedSwapHive: string;
  readonly minimumSwapHive: string;
  readonly slippageBps: number;
  readonly operation: readonly unknown[];
}

export type DCityRecoveryPlan =
  | { readonly kind: "ready"; readonly reason: string; readonly quote: DCityRecoveryQuote }
  | { readonly kind: "refuse"; readonly reason: string };

const ACCOUNT = /^(?=.{3,16}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function scale(precision: number): bigint {
  if (!Number.isSafeInteger(precision) || precision < 0 || precision > 18) throw new Error("dCity precision must be an integer from 0 through 18");
  return 10n ** BigInt(precision);
}

export function dcityDecimalUnits(value: string, precision: number): bigint {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`dCity value '${value}' is not a canonical unsigned decimal`);
  const fraction = match[1] ?? "";
  if (fraction.length > precision) throw new Error(`dCity value '${value}' exceeds precision ${precision}`);
  const whole = value.split(".")[0] ?? "0";
  return BigInt(whole) * scale(precision) + BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
}

export function dcityFormatUnits(value: bigint, precision: number): string {
  if (value < 0n) throw new Error("dCity amount cannot be negative");
  const factor = scale(precision);
  if (precision === 0) return value.toString();
  return `${value / factor}.${(value % factor).toString().padStart(precision, "0")}`;
}

export function planDCityLiquidSimRecovery(state: DCityRecoveryState, slippageBps = 100): DCityRecoveryPlan {
  try {
    if (!ACCOUNT.test(state.account)) throw new Error("invalid Hive account");
    if (!Number.isSafeInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw new Error("slippage policy must be 1 through 500 basis points");
    if (state.simPrecision !== 3 || state.swapHivePrecision !== 8) throw new Error("live SIM or SWAP.HIVE precision changed");
    if (state.tokenPair !== "SWAP.HIVE:SIM" && state.tokenPair !== "SIM:SWAP.HIVE") throw new Error("pool is not the exact SIM/SWAP.HIVE pair");
    const sim = dcityDecimalUnits(state.simBalance, state.simPrecision);
    if (sim <= 0n) return Object.freeze({ kind: "refuse", reason: "no liquid SIM remains to recover" });

    // Pool rows currently carry eight decimal places on both reserves even
    // though SIM itself settles at three. Lift the input to that common scale
    // and apply the deployed 25-bps mainnet fee. Transaction
    // 57c4578b697b5ab83a56ef8c4fa84f3ef938f72b independently confirmed this
    // fee in both Hive-Engine providers' swap event.
    const reservePrecision = Math.max(
      state.baseQuantity.split(".")[1]?.length ?? 0,
      state.quoteQuantity.split(".")[1]?.length ?? 0,
      state.swapHivePrecision,
      state.simPrecision,
    );
    if (reservePrecision > 18) throw new Error("pool reserve precision exceeds the exact arithmetic bound");
    const base = dcityDecimalUnits(state.baseQuantity, reservePrecision);
    const quote = dcityDecimalUnits(state.quoteQuantity, reservePrecision);
    const reserveIn = state.tokenPair === "SWAP.HIVE:SIM" ? quote : base;
    const reserveOut = state.tokenPair === "SWAP.HIVE:SIM" ? base : quote;
    const input = sim * scale(reservePrecision) / scale(state.simPrecision);
    if (reserveIn <= 0n || reserveOut <= 0n || input <= 0n) throw new Error("positive exact pool reserves are required");
    const effectiveInput = input * 9_975n;
    const outputAtReservePrecision = reserveOut * effectiveInput / (reserveIn * 10_000n + effectiveInput);
    const outputUnits = outputAtReservePrecision * scale(state.swapHivePrecision) / scale(reservePrecision);
    const minimumUnits = outputUnits * BigInt(10_000 - slippageBps) / 10_000n;
    if (minimumUnits <= 0n) throw new Error("bounded pool output rounds to zero");
    const quantitySim = dcityFormatUnits(sim, state.simPrecision);
    const expectedSwapHive = dcityFormatUnits(outputUnits, state.swapHivePrecision);
    const minimumSwapHive = dcityFormatUnits(minimumUnits, state.swapHivePrecision);
    return Object.freeze({
      kind: "ready",
      reason: "the closed dCity token has a live, bounded SIM-to-SWAP.HIVE pool exit; historical CITY NFTs remain untouched",
      quote: Object.freeze({
        quantitySim,
        expectedSwapHive,
        minimumSwapHive,
        slippageBps,
        operation: swapTokens(state.account, state.tokenPair, "SIM", quantitySim, "exactInput", minimumSwapHive),
      }),
    });
  } catch (error) {
    return Object.freeze({ kind: "refuse", reason: `invalid dCity recovery evidence: ${error instanceof Error ? error.message : String(error)}` });
  }
}
