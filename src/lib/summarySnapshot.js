const PREFIX = 'thegavel_summary_snapshot_';
const MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12h

export function cacheSummarySnapshot(roomId, auction, teams) {
  if (!roomId || typeof window === 'undefined') return false;
  try {
    const payload = {
      savedAt: Date.now(),
      auction: auction || null,
      teams: Array.isArray(teams) ? teams : [],
    };
    sessionStorage.setItem(PREFIX + roomId, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function loadSummarySnapshot(roomId) {
  if (!roomId || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PREFIX + roomId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.auction || !parsed?.teams) return null;
    if (Date.now() - (parsed.savedAt || 0) > MAX_AGE_MS) {
      sessionStorage.removeItem(PREFIX + roomId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeSummaryAuction(auction, roomId) {
  if (!auction) return null;
  return {
    id: auction.id || auction.roomId || roomId,
    hostId: auction.hostId || auction.host_id || '',
    hostName: auction.hostName || auction.host_name || 'Manager',
    status: auction.status || 'completed',
    auctionType: auction.auctionType || auction.auction_type || 'mega',
    squadLimit: auction.squadLimit ?? auction.squad_limit ?? 25,
    overseasLimit: auction.overseasLimit ?? auction.overseas_limit ?? 8,
    players: auction.players || [],
    settings: auction.settings || { budget: 120, bidTimer: 10 },
    fastForwarded: Boolean(auction.fastForwarded),
  };
}

export function normalizeSummaryTeams(teams, roomId) {
  if (!Array.isArray(teams)) return [];
  return teams.map((t, idx) => {
    const rawSquad = t.squad;
    const squadArr = Array.isArray(rawSquad) ? rawSquad : rawSquad ? Object.values(rawSquad) : [];
    return {
      id: t.id || `${roomId}_${t.userId || idx}`,
      auctionId: t.auctionId || t.auction_id || roomId,
      userId: t.userId || t.user_id,
      teamId: t.teamId || t.team_id,
      teamName: t.teamName || t.team_name,
      budgetRemaining: t.budgetRemaining ?? t.budget_remaining ?? null,
      spent: t.spent ?? 0,
      squad: squadArr,
    };
  });
}