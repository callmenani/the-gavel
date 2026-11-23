import test from 'node:test';
import assert from 'node:assert/strict';
import { isWatchLiveAuction } from '../src/lib/watchSpectate.js';

test('isWatchLiveAuction: waiting lobby without live lot', () => {
  assert.equal(isWatchLiveAuction({ id: 'AB12CD', status: 'waiting' }), false);
});

test('isWatchLiveAuction: active room', () => {
  assert.equal(isWatchLiveAuction({ id: 'AB12CD', status: 'active' }), true);
});

test('isWatchLiveAuction: directory paused room status', () => {
  assert.equal(isWatchLiveAuction({ id: 'AB12CD', status: 'paused' }), true);
});

test('isWatchLiveAuction: waiting room but live lot bidding', () => {
  assert.equal(
    isWatchLiveAuction({
      id: 'AB12CD',
      status: 'waiting',
      currentAuction: { status: 'bidding', playerId: 1 },
    }),
    true,
  );
});

test('isWatchLiveAuction: completed', () => {
  assert.equal(isWatchLiveAuction({ id: 'AB12CD', status: 'completed' }), false);
});