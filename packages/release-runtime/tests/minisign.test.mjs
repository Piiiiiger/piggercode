import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyMinisign, DEFAULT_MINISIGN_PUBLIC_KEY } from '../dist/minisign.js';

test('verifyMinisign validates bundled minisign public key format', () => {
  assert.match(DEFAULT_MINISIGN_PUBLIC_KEY, /minisign public key/i);
  assert.match(DEFAULT_MINISIGN_PUBLIC_KEY, /^RW/m);
});

test('verifyMinisign returns false for invalid signature payload', () => {
  assert.equal(
    verifyMinisign({
      message: Buffer.from('hello'),
      pubkeyFile: DEFAULT_MINISIGN_PUBLIC_KEY,
      sigFile: 'bad\nsig\nfile\n',
    }),
    false,
  );
});

// Signed with the PiggerCode release key: `minisign -S -m fixture.txt -t 'piggercode release key fixture'`.
const RELEASE_KEY_FIXTURE_MESSAGE = 'PiggerCode release signing key fixture\n';
const RELEASE_KEY_FIXTURE_SIGNATURE = `untrusted comment: signature from minisign secret key
RURtrBdNnJX5QQNkvo35E99mjnaPZEkBhNukSKrq16TC6umpV8VFvMRr5+q1f7iLpi6s7JgdbOdeCynvlYdEw4CCKxnp9rfczA8=
trusted comment: piggercode release key fixture
cNLr5D0j1nkR5UUQut3tysm5JJuOGSBNqN6PNqyigTuyEhSA13fnsPGVv6JCEQMUHr0AN89UNZQIDbTkfLzeAQ==
`;

test('the bundled public key is the PiggerCode release key', () => {
  const verifyFixture = (message) => verifyMinisign({
    message: Buffer.from(message),
    pubkeyFile: DEFAULT_MINISIGN_PUBLIC_KEY,
    sigFile: RELEASE_KEY_FIXTURE_SIGNATURE,
  });
  assert.equal(verifyFixture(RELEASE_KEY_FIXTURE_MESSAGE), true);
  assert.equal(verifyFixture('PiggerCode release signing key fixture (changed)\n'), false);
});
