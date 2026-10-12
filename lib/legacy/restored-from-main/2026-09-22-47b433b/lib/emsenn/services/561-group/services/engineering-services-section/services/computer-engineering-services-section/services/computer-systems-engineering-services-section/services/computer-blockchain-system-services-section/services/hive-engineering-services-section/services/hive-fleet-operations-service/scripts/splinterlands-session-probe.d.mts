export interface SplinterlandsSessionProbeOptions {
  readonly account: string;
  readonly keyFile: string;
  readonly timeoutSeconds: number;
}

export function parseOptions(argv: readonly string[]): SplinterlandsSessionProbeOptions;
export function loginMessage(account: string, timestampMs: number): string;
export function authenticate(options: SplinterlandsSessionProbeOptions): Promise<Readonly<{
  token: string;
  jwtToken: string;
  sessionId: string;
  jwtExpiration: string | null;
}>>;
export function probe(options: SplinterlandsSessionProbeOptions): Promise<Readonly<Record<string, unknown>>>;
