import type { NativeMarketPlan } from "../src/core/nativeMarket.mts";

export interface NativeMarketCycleOptions {
  readonly account: string;
  readonly live: boolean;
  readonly cancelAll: boolean;
  readonly watchSeconds: number;
  readonly windowMinutes: number;
}

export function parseOptions(argv: readonly string[]): NativeMarketCycleOptions;
export interface NativeMarketCycleResult {
  readonly kind: "aagaard.native-market-cycle";
  readonly mode: string;
  readonly chainMutation: boolean;
  readonly plan: NativeMarketPlan;
}

export function cycle(options: NativeMarketCycleOptions, dependencies?: Readonly<Record<string, unknown>>): Promise<NativeMarketCycleResult>;
export function run(options: NativeMarketCycleOptions, dependencies?: Readonly<Record<string, unknown>>): Promise<readonly NativeMarketCycleResult[]>;
