export interface ProtectedHiveEngineNft {
  readonly account: string;
  readonly chain: "hive-engine";
  readonly symbol: string;
  readonly id: string;
  readonly policy: "preserve-closed-and-owned";
}

export const PROTECTED_HOLOZING_ALPHA_VIAL: ProtectedHiveEngineNft;
export function assertNoProtectedAssetMutation(input: {
  readonly account: string;
  readonly decoded: unknown;
}): void;
export function assertLiquidationSymbolAllowed(account: string, symbol: string): void;
export function assertProtectedAlphaVialObserved(account: string, alphaVialIds: readonly (string | number)[]): void;
export function assertHoloZingApiMutationAllowed(path: string, body: unknown): void;
