export interface HashKingsRecoveryOptions { readonly account: string }
export function parseOptions(argv: readonly string[]): HashKingsRecoveryOptions;
export function classifyDomainResponse(status: number, location: string, body: string): "parked" | "operational" | "unknown";
export function statesAgree(left: Record<string, unknown>, right: Record<string, unknown>): boolean;
export function operate(options: HashKingsRecoveryOptions): Promise<Readonly<Record<string, unknown>>>;
