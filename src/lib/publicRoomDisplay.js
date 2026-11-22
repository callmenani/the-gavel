import { MAX_FRANCHISE_SLOTS, mapRoomPlayers } from './auctionRules.js';

/** Franchise slots taken (team assigned or AI bot), same rule as the live auction HUD. */
export function countOccupiedFranchiseSlots(players) {
  const list = mapRoomPlayers(players, (p) => p);
  return list.filter(
    (p) =>
      p &&
      !p.isAuctionManager &&
      (p.team || p.isBot || String(p.id || '').startsWith('bot_')),
  ).length;
}

export function getPublicRoomOccupancy(room) {
  const max = room?.maxPlayers ?? MAX_FRANCHISE_SLOTS;
  if (Array.isArray(room?.players)) {
    return { joined: countOccupiedFranchiseSlots(room.players), max };
  }
  const fromApi = Number(room?.playerCount);
  const joined = Number.isFinite(fromApi) ? Math.min(Math.max(0, fromApi), max) : 1;
  return { joined: joined || 1, max };
}

export function formatPublicRoomOccupancy(room) {
  const { joined, max } = getPublicRoomOccupancy(room);
  return `[${joined}/${max}]`;
}