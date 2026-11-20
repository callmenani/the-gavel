import { r2, toFiniteNumber } from './auctionDisplay.js';
import { getNextBidAmount, mapRoomPlayers, normalizeSquad } from './auctionRules.js';

/**
 * Pure update functions for the Realtime Database transactions used by the
 * cloud auction. Returning `undefined` aborts the transaction, exactly like the
 * inline functions they replaced. Tests import these directly.
 */

export function transactBid(currentData, {
  userId,
  userName,
  teamId,
  playerId,
  now,
  timerMs,
  budget,
  basePrice,
  targetBid,
}) {
  if (!currentData) return currentData;
  if (currentData.status !== 'bidding') return;
  // The user clicked on a specific lot; never apply that click to the next one.
  if (playerId && currentData.playerId !== playerId) return;
  if (currentData.highBidderId === userId) return;
  if (currentData.timerEndsAt && now >= currentData.timerEndsAt) return;

  const currentBid = toFiniteNumber(currentData.currentBid, 0);
  const minNextBid = currentBid === 0
    ? toFiniteNumber(basePrice, 0)
    : getNextBidAmount({ basePrice }, currentBid);

  const requestedBid = typeof targetBid === 'number' && Number.isFinite(targetBid)
    ? toFiniteNumber(targetBid, 0)
    : null;
  if (requestedBid != null && requestedBid < minNextBid) return;

  const nextBid = requestedBid != null ? r2(requestedBid) : minNextBid;

  if (nextBid > toFiniteNumber(budget, 0)) return;

  return {
    ...currentData,
    currentBid: nextBid,
    highBidderId: userId,
    highBidderName: userName,
    highBidderTeamId: teamId,
    timerEndsAt: now + timerMs,
    passes: null,
  };
}

export function transactSale(currentData, now) {
  if (!currentData) return currentData;
  if (currentData.status !== 'bidding') return;
  if (currentData.timerEndsAt && now < currentData.timerEndsAt) return;

  return {
    ...currentData,
    status: currentData.highBidderId ? 'sold' : 'unsold',
  };
}

export function transactTeamSale(currentTeam, {
  roomId,
  playerId,
  bid,
  winnerId,
  winnerTeamId,
  winnerName,
  initialBudget = 120,
}) {
  const baseTeam = currentTeam || {
    auctionId: roomId,
    userId: winnerId,
    teamId: winnerTeamId || '',
    teamName: winnerName || 'Unknown',
    squad: [],
    spent: 0,
    budgetRemaining: toFiniteNumber(initialBudget, 120),
  };

  const currentSquad = normalizeSquad(baseTeam.squad);

  // A delayed recovery for an older lot must not rewrite a newer squad/purse.
  if (
    !playerId ||
    currentSquad.some((entry) =>
      (typeof entry === 'string' ? entry : entry?.id) === playerId,
    )
  ) {
    return currentTeam;
  }

  const squad = [...currentSquad, { id: playerId, bid: toFiniteNumber(bid, 0) }];
  const spent = squad.reduce(
    (sum, entry) => r2(sum + toFiniteNumber(typeof entry === 'object' ? entry.bid : 0, 0)),
    0,
  );

  return {
    ...baseTeam,
    teamId: winnerTeamId || baseTeam.teamId || '',
    teamName: winnerName || baseTeam.teamName || 'Unknown',
    budgetRemaining: Math.max(0, r2(toFiniteNumber(initialBudget, 120) - spent)),
    spent,
    squad,
  };
}

export function transactRoomPlayersSale(currentRoom, {
  winnerId,
  totalSpent,
  squadCount,
}) {
  if (!currentRoom?.players) return currentRoom;

  return {
    ...currentRoom,
    players: mapRoomPlayers(currentRoom.players, (player) => player).map((player) => (
      player.id === winnerId
        ? {
            ...player,
            spent: Math.max(toFiniteNumber(player.spent, 0), toFiniteNumber(totalSpent, 0)),
            squadCount: Math.max(toFiniteNumber(player.squadCount, 0), toFiniteNumber(squadCount, 0)),
          }
        : player
    )),
  };
}

export function transactAdvance(currentLive, {
  currentPlayerId,
  nextPlayerId,
  timerEndsAt,
}) {
  if (!currentLive) return currentLive;
  if (currentLive.playerId !== currentPlayerId) return;
  // Awaiting-consent lots advance via the same transition (host force /
  // everyone consented / safety deadline all funnel into transactAdvance).
  if (
    currentLive.status !== 'sold' &&
    currentLive.status !== 'unsold' &&
    currentLive.status !== 'awaiting_consent'
  ) {
    return;
  }

  return {
    playerId: nextPlayerId,
    currentBid: 0,
    highBidderId: '',
    highBidderName: 'No Bids',
    timerEndsAt,
    status: 'bidding',
    passes: null,
    consentVotes: null,
    consentDeadline: null,
  };
}

/**
 * Record one manager's confirmation in the consent gate. Idempotent: re-voting
 * the same lot is a no-op (the lot is no longer awaiting_consent).
 */
export function transactConsentVote(currentLive, { voterId, now }) {
  if (!currentLive) return currentLive;
  if (currentLive.status !== 'awaiting_consent') return;
  if (!voterId) return;

  const consentVotes = { ...(currentLive.consentVotes || {}) };
  consentVotes[voterId] = now;

  return {
    ...currentLive,
    consentVotes,
  };
}

/**
 * After the sold-lot celebration, park the lot in the consent gate: all human
 * managers must confirm (or the 30s deadline elapses / host forces) before
 * the next player starts. Idempotent: re-opening is aborted if the lot has
 * already advanced.
 */
export function transactOpenConsent(currentLive, {
  currentPlayerId,
  consentDeadline,
}) {
  if (!currentLive) return currentLive;
  if (currentLive.playerId !== currentPlayerId) return;
  if (currentLive.status !== 'sold') return;

  return {
    ...currentLive,
    status: 'awaiting_consent',
    consentVotes: {},
    consentDeadline,
    timerEndsAt: consentDeadline,
  };
}

export function transactTeamSaleRevert(currentTeam, {
  playerId,
  initialBudget = 120,
}) {
  if (!currentTeam) return currentTeam;
  const currentSquad = normalizeSquad(currentTeam.squad);
  if (!playerId || !currentSquad.some((entry) => (typeof entry === 'string' ? entry : entry?.id) === playerId)) {
    return currentTeam;
  }

  // Removing the player recomputes the whole purse from the remaining squad,
  // so the refund is exact (no float drift from subtracting the last bid).
  const squad = currentSquad.filter((entry) => (typeof entry === 'string' ? entry : entry?.id) !== playerId);
  const spent = squad.reduce(
    (sum, entry) => r2(sum + toFiniteNumber(typeof entry === 'object' ? entry.bid : 0, 0)),
    0,
  );

  return {
    ...currentTeam,
    squad,
    spent,
    budgetRemaining: Math.max(0, r2(toFiniteNumber(initialBudget, 120) - spent)),
  };
}

export function transactRoomPlayersSaleRevert(currentRoom, {
  winnerId,
  bid,
}) {
  if (!currentRoom?.players) return currentRoom;
  return {
    ...currentRoom,
    players: mapRoomPlayers(currentRoom.players, (player) => (
      player.id === winnerId
        ? {
            ...player,
            spent: Math.max(0, r2(toFiniteNumber(player.spent, 0) - toFiniteNumber(bid, 0))),
            squadCount: Math.max(0, toFiniteNumber(player.squadCount, 0) - 1),
          }
        : player
    )),
  };
}

/**
 * Host "get the player back": undo a just-sold lot and reopen it for re-bid.
 * Reverting the winner's squad/purse is done separately via the team/room
 * reversal transactions.
 *
 * The lot resumes *from* the last winning bid: the bid amount and the team
 * that placed it are restored rather than reset to ₹0, so the re-auction can
 * only move up (the restored high bidder simply keeps the lot until someone
 * outbids). The consent-gate bookkeeping is cleared so the lot is back in a
 * clean bidding state.
 */
export function transactReopen(currentLive, {
  currentPlayerId,
  timerEndsAt,
}) {
  if (!currentLive) return currentLive;
  if (currentLive.playerId !== currentPlayerId) return;
  if (
    currentLive.status !== 'awaiting_consent' &&
    currentLive.status !== 'sold'
  ) {
    return;
  }

  return {
    ...currentLive,            // ← preserves currentBid, highBidderId, highBidderName, highBidderTeamId
    status: 'bidding',
    timerEndsAt,
    passes: null,
    consentVotes: null,
    consentDeadline: null,
    celebrationEndsAt: null,
  };
}
