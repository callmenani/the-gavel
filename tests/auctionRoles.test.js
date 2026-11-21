import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_LAYOUT,
  auctionManagerSlotOpen,
  canJoinAsFranchise,
  countFranchiseSlotsUsed,
  isAuctionManagerUser,
  isDedicatedAdminLayout,
  isFranchisePlayer,
} from '../src/lib/auctionRoles.js';

test('franchise slots exclude auction manager', () => {
  const players = [
    { id: 'h1', team: 'csk', isHost: true },
    { id: 'mgr', isAuctionManager: true, team: '' },
    { id: 'b1', team: 'mi', isBot: true },
  ];
  assert.equal(countFranchiseSlotsUsed(players), 1);
  assert.equal(isFranchisePlayer(players[1]), false);
});

test('dedicated admin layout and manager detection', () => {
  const room = {
    adminLayout: ADMIN_LAYOUT.DEDICATED_ADMIN,
    auctionManagerId: 'mgr',
    players: [{ id: 'mgr', isAuctionManager: true }],
  };
  assert.equal(isDedicatedAdminLayout(room), true);
  assert.equal(auctionManagerSlotOpen(room), false);
  assert.equal(isAuctionManagerUser(room, 'mgr'), true);
});

test('franchise cap at 10', () => {
  const players = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, team: `t${i}` }));
  const room = { players, adminLayout: ADMIN_LAYOUT.DEDICATED_ADMIN };
  assert.equal(canJoinAsFranchise(room), false);
});