import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperatorAuth } from '../src/integrations/oauth/operatorAuth.adapter.mjs';
const options = { publicBaseUrl: 'https://fixture.invalid', allowedEmail: 'fixture@example.invalid', openWhenUnconfigured: false };
test('explicit file custody refuses missing state and unavailable profiles; omission keeps memory default', () => {
  assert.throws(() => createOperatorAuth({ ...options, grantStoreProfile: 'linux-local-flock-v1' }));
  assert.throws(() => createOperatorAuth({ ...options, stateDir: '/synthetic-unused', grantStoreProfile: 'unknown-profile' }));
  assert.equal(typeof createOperatorAuth(options).server.registerClient, 'function');
});
