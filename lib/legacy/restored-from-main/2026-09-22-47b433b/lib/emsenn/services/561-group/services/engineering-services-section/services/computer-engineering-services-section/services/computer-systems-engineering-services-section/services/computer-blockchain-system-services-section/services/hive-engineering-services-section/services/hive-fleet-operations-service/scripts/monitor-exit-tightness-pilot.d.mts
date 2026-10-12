export interface PilotRequest {
  readonly account: string;
  readonly symbol: string;
  readonly quantity: string | null;
}
export function parsePilotRequest(body: unknown): PilotRequest | null;
export function parseIncomingHbdTransfer(row: unknown): Readonly<Record<string, unknown>> | null;
export function assertPublicationCoverage(rows: unknown): true;
export function agreeOnRequests(rows: readonly Readonly<Record<string, unknown>>[]): Readonly<Record<string, unknown>>;
export function agreeOnIncomingHbd(rows: readonly Readonly<Record<string, unknown>>[]): Readonly<Record<string, unknown>>;
export function observe(): Promise<Readonly<Record<string, unknown>>>;
