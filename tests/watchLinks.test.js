import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWatchPath, buildWatchUrl, buildTvWatchPath } from '../src/lib/watchLinks.js';
import { SERVER_2 } from '../src/lib/auctionServers.js';

test('buildTvWatchPath appends tv=1', () => {
  assert.match(buildTvWatchPath('XYZ'), /[?&]tv=1$/);
});

test('buildWatchPath includes room id and server query', () => {
  assert.equal(buildWatchPath('AB12CD'), '/watch/AB12CD?server=server-1');
  assert.equal(buildWatchPath('AB12CD', SERVER_2), '/watch/AB12CD?server=server-2');
});

test('buildWatchUrl uses provided origin', () => {
  assert.equal(
    buildWatchUrl('XY99ZZ', 'server-1', 'https://thegavel.app'),
    'https://thegavel.app/watch/XY99ZZ?server=server-1',
  );
});

test('buildWatchUrl trims trailing slash on origin', () => {
  assert.equal(
    buildWatchUrl('R1', 'server-1', 'https://thegavel.app/'),
    'https://thegavel.app/watch/R1?server=server-1',
  );
});