import { mapRoomPlayers } from './auctionRules.js';

export const ADMIN_LAYOUT = {
  HOST_PLAYS: 'host_plays',
  DEDICATED_ADMIN: 'dedicated_admin',
};

export const MAX_FRANCHISE_SLOTS = 10;

export function isDedicatedAdminLayout(room) {
  return room?.adminLayout === ADMIN_LAYOUT.DEDICATED_ADMIN;
}

export function isFranchisePlayer(player) {
  if (!player || player.isBot || String(player.id || '').startsWith('bot_')) return false;
  if (player.isAuctionManager) return false;
  return Boolean(player.team);
}

export function countFranchiseSlotsUsed(players) {
  return mapRoomPlayers(players, (p) => p).filter(isFranchisePlayer).length;
}

export function findPlayerById(players, uid) {
  return mapRoomPlayers(players, (p) => p).find((p) => p.id === uid || p.userId === uid);
}

export function isAuctionManagerUser(room, uid) {
  if (!room || !uid) return false;
  if (room.auctionManagerId === uid) return true;
  const p = findPlayerById(room.players, uid);
  return Boolean(p?.isAuctionManager);
}

export function canJoinAsFranchise(room) {
  return countFranchiseSlotsUsed(room?.players) < MAX_FRANCHISE_SLOTS;
}

export function auctionManagerSlotOpen(room) {
  if (!isDedicatedAdminLayout(room)) return false;
  return !room?.auctionManagerId;
}

export function canOperateAuction(room, uid) {
  if (!room || !uid) return false;
  if (room.hostId === uid) return true;
  if (isAuctionManagerUser(room, uid)) return true;
  if (room.admins?.[uid]) return true;
  if (room.activeAdminId === uid) return true;
  return false;
}