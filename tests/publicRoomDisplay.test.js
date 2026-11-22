import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countOccupiedFranchiseSlots,
  formatPublicRoomOccupancy,
} from '../src/lib/publicRoomDisplay.js';

test('formatPublicRoomOccupancy shows franchise slots', () => {
  const room = {
    players: [
      { id: 'h1', team: 'CSK', isHost: true },
      { id: 'p2', team: 'MI' },
    ],
    maxPlayers: 10,
  };
  assert.equal(countOccupiedFranchiseSlots(room.players), 2);
  assert.equal(formatPublicRoomOccupancy(room), '[2/10]');
});

test('formatPublicRoomOccupancy uses playerCount from API', () => {
  assert.equal(formatPublicRoomOccupancy({ playerCount: 6, maxPlayers: 10 }), '[6/10]');
});