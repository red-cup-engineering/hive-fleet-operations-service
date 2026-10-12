export interface WorkerBeePoolAuditOptions {
  readonly account: "michael561";
  readonly record: boolean;
}

export function parseOptions(argv: readonly string[]): WorkerBeePoolAuditOptions;
export function operate(options: WorkerBeePoolAuditOptions): Promise<Readonly<Record<string, unknown>>>;
