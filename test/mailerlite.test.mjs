import test from 'node:test';
import assert from 'node:assert/strict';
import { signupRequest, resultFor } from '../scripts/lib/mailerlite.mjs';

test('sign-up request adds the address to the group with the token', () => {
  const { url, init } = signupRequest({ apiKey: 'tok', groupId: 12345, email: 'a@b.com', referrer: 'https://bristolbrief.com/subscribe/' });
  assert.equal(url, 'https://connect.mailerlite.com/api/subscribers');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer tok');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.groups, ['12345']);
  assert.equal(body.email, 'a@b.com');
});

test('status codes map to results', () => {
  assert.deepEqual(resultFor(200), { ok: true });
  assert.deepEqual(resultFor(201), { ok: true });
  assert.equal(resultFor(422).error, 'invalid');
  assert.equal(resultFor(429).error, 'upstream');
  assert.equal(resultFor(500).error, 'upstream');
});
