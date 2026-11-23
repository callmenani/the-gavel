import { withServerParam, normalizeServer, DEFAULT_AUCTION_SERVER } from './auctionServers.js';

/**
 * App route to the read-only live spectate page for a room.
 */
export function buildWatchPath(roomId, server = DEFAULT_AUCTION_SERVER) {
  const id = String(roomId || '').trim();
  if (!id) return '/watch';
  return withServerParam(`/watch/${encodeURIComponent(id)}`, normalizeServer(server));
}

/**
 * Full shareable URL for viral spectate links (clipboard, WhatsApp, etc.).
 */
export function buildWatchUrl(roomId, server = DEFAULT_AUCTION_SERVER, origin) {
  const base =
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');
  return `${base.replace(/\/$/, '')}${buildWatchPath(roomId, server)}`;
}

/** Watch path with optional TV fullscreen experience (`tv=1`). */
export function buildTvWatchPath(roomId, server = DEFAULT_AUCTION_SERVER) {
  const base = buildWatchPath(roomId, server);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}tv=1`;
}

/** Full URL with TV mode — same tab or `window.open` for solo on this device. */
export function buildTvWatchUrl(roomId, server = DEFAULT_AUCTION_SERVER, origin) {
  const base =
    origin ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');
  return `${base.replace(/\/$/, '')}${buildTvWatchPath(roomId, server)}`;
}