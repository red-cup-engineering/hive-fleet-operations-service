export interface DCropsCycleOptions {
  readonly account: string;
  readonly keyFile: string;
  readonly landID: number;
  readonly seedID: number;
  readonly plotNo: number;
  readonly executeOne: boolean;
}

export function parseOptions(argv: readonly string[]): DCropsCycleOptions;
export function operate(options: DCropsCycleOptions): Promise<Readonly<Record<string, unknown>>>;
