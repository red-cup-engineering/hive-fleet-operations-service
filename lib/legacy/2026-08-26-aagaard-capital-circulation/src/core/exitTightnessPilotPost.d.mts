export const EXIT_TIGHTNESS_PILOT_ACCOUNT: "emsenn0";
export const EXIT_TIGHTNESS_PILOT_PERMLINK: "your-hive-engine-balance-is-not-your-exit-value";
export const EXIT_TIGHTNESS_PILOT_TARGET: "emsenn0/your-hive-engine-balance-is-not-your-exit-value";
export const EXIT_TIGHTNESS_PILOT_BODY_SHA256: "c3b7a052484898dabf17c766663e9971222a9c42642527a4037bdabfa7176003";
export const EXIT_TIGHTNESS_PILOT_PRICE: "0.250 HBD";
export const EXIT_TIGHTNESS_PILOT_MAX_REPORTS: 5;

export interface ExitTightnessPilotComment {
  readonly parent_author: "";
  readonly parent_permlink: "hive-engine";
  readonly author: "emsenn0";
  readonly permlink: "your-hive-engine-balance-is-not-your-exit-value";
  readonly title: "Your Hive Engine balance is not your exit value";
  readonly body: string;
  readonly json_metadata: string;
}

export function exitTightnessPilotComment(): ExitTightnessPilotComment;
export function assertExactExitTightnessPilotPost(input: {
  readonly account: unknown;
  readonly role: unknown;
  readonly lane: unknown;
  readonly target: unknown;
  readonly fields: unknown;
}): true;
export function exitTightnessPilotOffer(): Readonly<Record<string, unknown>>;
