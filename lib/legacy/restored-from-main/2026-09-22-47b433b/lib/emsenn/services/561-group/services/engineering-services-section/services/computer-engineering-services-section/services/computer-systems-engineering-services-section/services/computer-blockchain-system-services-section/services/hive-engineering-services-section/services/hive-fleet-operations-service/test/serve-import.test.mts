import assert from "node:assert/strict";
import test from "node:test";

import { startAagaardServer } from "../src/serve.mts";

test("the public serve export is import-safe", () => {
  assert.equal(typeof startAagaardServer, "function");
});
