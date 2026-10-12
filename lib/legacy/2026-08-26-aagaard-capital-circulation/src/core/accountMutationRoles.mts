/** Lowest faithful authority boundary for the user-assigned emsenn0 role.
 * Historical observations remain readable, but every future mutation signed
 * by Aagaard for emsenn0 must be one posting-authorized vote. */
export function assertAccountMutationRole(input: Readonly<{ account: string; role: string; lane: string; operation: string }>) {
  if (input.account !== "emsenn0") return true;
  if (input.role !== "posting" || input.lane !== "voting" || input.operation !== "vote") {
    throw new TypeError("emsenn0 is vote-only: Aagaard refuses every non-vote mutation for this account");
  }
  return true;
}
