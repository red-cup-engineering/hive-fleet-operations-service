/** Report a rejected command promise without exposing an error stack. */
export function reportFailure(error, stderr = process.stderr, runtime = process) {
  stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  runtime.exitCode = 1;
}
