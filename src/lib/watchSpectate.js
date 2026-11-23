const TERMINAL_ROOM_STATUSES = new Set(['completed', 'cancelled']);
const LIVE_ROOM_STATUSES = new Set(['active', 'paused']);

/**
 * Whether /watch/:id should render the live auction TV (AuctionRoom) vs pre-start lobby.
 * RTDB room.status is authoritative; directory may say "paused" while the lot is still live.
 */
export function isWatchLiveAuction(auction) {
  if (!auction?.id) return false;
  const roomStatus = String(auction.status || 'waiting').toLowerCase();
  if (TERMINAL_ROOM_STATUSES.has(roomStatus)) return false;
  if (LIVE_ROOM_STATUSES.has(roomStatus)) return true;

  const live = auction.currentAuction;
  if (!live || typeof live !== 'object') return false;
  const liveStatus = String(live.status || '').toLowerCase();
  if (!liveStatus || liveStatus === 'waiting' || liveStatus === 'completed') return false;
  return true;
}