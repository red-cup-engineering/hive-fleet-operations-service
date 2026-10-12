export interface HoloZingRewardOptions {
  readonly account: string;
  readonly keyFile: string;
  readonly executeOne: boolean;
}

export interface HoloZingObservedBalance {
  readonly liquid: string;
  readonly staked: string;
}

export function parseOptions(argv: readonly string[]): HoloZingRewardOptions;
export function loginMessage(account: string, expiryUnix: number): string;
export function keychainLoginEnvelope(
  account: string,
  message: string,
  signature: string,
  publicKey: string,
): Readonly<Record<string, unknown>>;
export function balancesAgree(left: HoloZingObservedBalance, right: HoloZingObservedBalance): boolean;
export function attachHolozingDurableRecord(
  receipt: Readonly<Record<string, unknown>>,
  recorder?: (
    dataDir: string,
    receipt: Readonly<Record<string, unknown>>,
    recordedAt?: string,
  ) => Promise<Readonly<{ eventId: string }>>,
): Promise<Readonly<Record<string, unknown>>>;
export function operate(options: HoloZingRewardOptions): Promise<Readonly<Record<string, unknown>>>;
