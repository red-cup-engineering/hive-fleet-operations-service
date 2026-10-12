import assert from "node:assert/strict";
import test from "node:test";

import { reportFailure } from "../src/commandFailure.mjs";

test("reportFailure writes each rejection reason and sets a failure exit code", () => {
  const writes = [];
  const runtime = {};

  reportFailure(new Error("refused"), { write: (value) => writes.push(value) }, runtime);
  reportFailure(42, { write: (value) => writes.push(value) }, runtime);

  assert.deepEqual(writes, ["refused\n", "42\n"]);
  assert.equal(runtime.exitCode, 1);
});
