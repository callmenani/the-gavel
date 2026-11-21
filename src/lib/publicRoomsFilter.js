import { normalizeServer } from './auctionServers.js';

const LIVE_STATUSES = new Set(['waiting', 'active', 'paused']);

/**
 * Whether a directory row should appear in the public lobby list.
 * Waiting lobbies need an online host (or unknown legacy rows).
 * In-progress auctions are always discoverable regardless of host presence.
 */
export function isPublicRoomDiscoverable(room) {
  if (!room?.id) return false;
  const status = String(room.status || 'waiting').toLowerCase();
  if (!LIVE_STATUSES.has(status)) return false;
  if (status === 'waiting') {
    if (room.hostOnline === false || room.host_online === 0) return false;
  }
  return true;
}

export function filterPublicRooms(rooms, { searchQuery = '', filterMode = 'all', selectedServer } = {}) {
  const q = searchQuery.toLowerCase().trim();
  const targetServer = normalizeServer(selectedServer);

  return (rooms || []).filter((room) => {
    if (!isPublicRoomDiscoverable(room)) return false;

    const matchesSearch =
      !q ||
      (room.id && room.id.toLowerCase().includes(q)) ||
      (room.hostName && room.hostName.toLowerCase().includes(q));

    const roomType = (room.type || room.auction_type || 'mega').toLowerCase();
    const matchesMode =
      filterMode === 'all' || roomType === filterMode.toLowerCase();

    const matchesServer = normalizeServer(room.server) === targetServer;

    return matchesSearch && matchesMode && matchesServer;
  });
}

export function countPublicRoomsOnServer(rooms, selectedServer) {
  return filterPublicRooms(rooms, {
    searchQuery: '',
    filterMode: 'all',
    selectedServer,
  }).length;
}

export function countDiscoverablePublicRooms(rooms) {
  return (rooms || []).filter(isPublicRoomDiscoverable).length;
}