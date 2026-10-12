export interface WorkerBeeYieldOptions {
  readonly account: "michael561";
  readonly keyFile: string;
  readonly executeOne: boolean;
  readonly settleTx: string;
}

export function parseOptions(argv: readonly string[]): WorkerBeeYieldOptions;
export function statesAgree(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean;
export function planWorkerBeeYield(state: Readonly<Record<string, any>>): Readonly<Record<string, any>>;
export function operate(options: WorkerBeeYieldOptions): Promise<Readonly<Record<string, unknown>>>;
export function normalizeEngineTransactionInfo(result: unknown, node?: string, candidate?: string): Readonly<Record<string, any>>;
