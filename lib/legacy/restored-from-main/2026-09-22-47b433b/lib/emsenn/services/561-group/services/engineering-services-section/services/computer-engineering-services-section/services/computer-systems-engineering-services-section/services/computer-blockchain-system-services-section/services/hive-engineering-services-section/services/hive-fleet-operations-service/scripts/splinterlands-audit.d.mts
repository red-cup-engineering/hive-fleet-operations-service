export interface SplinterlandsAuditOptions {
  readonly account: string;
}

export function parseOptions(argv: readonly string[]): SplinterlandsAuditOptions;
export function audit(options: SplinterlandsAuditOptions): Promise<Readonly<Record<string, unknown>>>;
