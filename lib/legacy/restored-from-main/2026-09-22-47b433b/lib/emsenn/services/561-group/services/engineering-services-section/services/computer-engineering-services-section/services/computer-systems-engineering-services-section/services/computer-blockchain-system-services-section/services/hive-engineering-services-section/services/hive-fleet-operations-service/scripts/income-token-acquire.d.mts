export function parseOptions(argv: readonly string[]): Readonly<{ keyFile: string; executeOne: boolean }>;
export function assertPilotUnspent(events: readonly unknown[], accountTokenBalance: string): true;
export function operate(options: Readonly<{ keyFile: string; executeOne: boolean }>): Promise<Readonly<Record<string, unknown>>>;
