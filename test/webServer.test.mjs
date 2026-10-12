import test from "node:test";
import assert from "node:assert/strict";
import { createAagaardServer, startAagaardServer } from "../src/serve.mjs";
import { createOperatorAuth } from "../src/integrations/oauth/operatorAuth.adapter.mjs";
function fixture() {
  const runtime = { control: { live: false, running: true }, status: () => ({ fixture: true }) };
  const auth = createOperatorAuth({ publicBaseUrl: "http://fleet.test", opsToken: "fixture-token", allowedEmail: "operator@example.test", openWhenUnconfigured: false,
    google: { clientId: "", clientSecret: "" } });
  const { application } = createAagaardServer({ config: { wallets: [], enabled: [], live: false, hive: { enabled: false }, hiveEngine: { enabled: false } }, store: {}, runtime, auth });
  return { application, runtime };
}
test("operator UI and authorization survive shared Fetch dispatch", async () => {
  const { application } = fixture();
  const ui = await application.fetch(new Request("http://fleet.test/ui"));
  assert.equal(ui.status, 200); assert.match(await ui.text(), /<h1>Aagaard<\/h1>/);
  const denied = await application.fetch(new Request("http://fleet.test/ops/health"));
  assert.equal(denied.status, 401); assert.ok(denied.headers.get("www-authenticate"));
  const health = await application.fetch(new Request("http://fleet.test/ops/health", { headers: { authorization: "Bearer fixture-token" } }));
  assert.deepEqual(await health.json(), { status: "ok", running: true, live: false });
  assert.equal((await application.fetch(new Request("http://fleet.test/missing"))).status, 404);
});
test("operator control requires authority before changing the injected runtime", async () => {
  const { application, runtime } = fixture();
  assert.equal((await application.fetch(new Request("http://fleet.test/ops/arm", { method: "POST" }))).status, 401);
  assert.equal(runtime.control.live, false);
  const response = await application.fetch(new Request("http://fleet.test/ops/arm", { method: "POST", headers: { authorization: "Bearer fixture-token" } }));
  assert.equal(response.status, 200); assert.equal(runtime.control.live, true);
});
test("OAuth input uses the shared bounded body reader", async () => {
  const { application } = fixture();
  const response = await application.fetch(new Request("http://fleet.test/oauth/register", { method: "POST", body: "x".repeat(1024 * 1024 + 1) }));
  assert.equal(response.status, 413);
});

test("shared listener serves the operator app and closes its runtime lifetime", async () => {
  let signal;
  const runtime = { control: { live: false, running: true }, start(value) { signal = value; } };
  const auth = { authorize: () => ({ ok: true }) };
  const running = await startAagaardServer({ host: "::1", port: 0,
    config: { live: false, enabled: [], wallets: [], hive: { enabled: false }, hiveEngine: { enabled: false } }, store: {}, runtime, auth });
  try {
    const response = await fetch(`http://[::1]:${running.port}/ops/health`);
    assert.deepEqual(await response.json(), { status: "ok", running: true, live: false });
    assert.equal(signal.aborted, false);
  } finally { await running.close(); }
  assert.equal(signal.aborted, true);
});
