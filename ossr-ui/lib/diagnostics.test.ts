import assert from 'node:assert/strict';
import test from 'node:test';
import { measureOperation, readDiagnostics } from './diagnostics';
test('diagnostics retain only bounded timing and outcomes, including rejected operations', async () => {
  const secret = 'sensitive raw transaction';
  assert.equal(await measureOperation('submission', async () => secret), secret);
  await assert.rejects(measureOperation('wallet', async () => { throw new Error(secret); }));
  for (let i = 0; i < 110; i++) await measureOperation('quote', async () => secret);
  const entries = readDiagnostics();
  assert.equal(entries.length, 100);
  assert.ok(!JSON.stringify(entries).includes(secret));
  assert.deepEqual(Object.keys(entries[0]), ['stage', 'outcome', 'durationMs']);
  assert.ok(entries.every(entry => entry.durationMs >= 0));
});
