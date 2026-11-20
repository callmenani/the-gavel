import { ref, onValue, set, remove } from 'firebase/database';
import { FEATURE_MULTIPLAYER } from './appConfig';
import { getRtdb } from './firebase';

const storageKey = (auctionId) => `thegavel_league_votes_${auctionId}`;

export function loadLocalPredictions(auctionId) {
  try {
    const raw = localStorage.getItem(storageKey(auctionId));
    return raw ? JSON.parse(raw) : { matches: {} };
  } catch {
    return { matches: {} };
  }
}

export function saveLocalPredictions(auctionId, data) {
  try {
    localStorage.setItem(storageKey(auctionId), JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

/**
 * @param {'home'|'away'} pick — side predicted to win
 */
export function setMatchVote(store, matchId, voterTeamId, pick) {
  const next = { ...store, matches: { ...store.matches } };
  const match = { ...(next.matches[matchId] || { votes: {} }), votes: { ...(next.matches[matchId]?.votes || {}) } };
  match.votes[voterTeamId] = pick;
  next.matches[matchId] = match;
  return next;
}

export function getVotesForMatch(store, matchId) {
  return store?.matches?.[matchId]?.votes || {};
}

export function subscribeLeaguePredictions(auctionId, server, onData) {
  if (!FEATURE_MULTIPLAYER || !auctionId) {
    onData(loadLocalPredictions(auctionId));
    return () => {};
  }

  let rtdb;
  try {
    rtdb = getRtdb(server);
  } catch {
    onData(loadLocalPredictions(auctionId));
    return () => {};
  }

  const pathRef = ref(rtdb, `auctions/${auctionId}/leaguePredictions`);
  const unsub = onValue(
    pathRef,
    (snap) => {
      const val = snap.val();
      if (val && typeof val === 'object') {
        onData({ matches: val.matches || val });
        saveLocalPredictions(auctionId, { matches: val.matches || val });
      } else {
        onData(loadLocalPredictions(auctionId));
      }
    },
    () => onData(loadLocalPredictions(auctionId)),
  );

  return () => unsub();
}

export async function publishLeaguePredictions(auctionId, server, store) {
  saveLocalPredictions(auctionId, store);
  if (!FEATURE_MULTIPLAYER || !auctionId) return;

  try {
    const rtdb = getRtdb(server);
    await set(ref(rtdb, `auctions/${auctionId}/leaguePredictions/matches`), store.matches || {});
  } catch (err) {
    console.warn('[league] RTDB sync failed, kept local copy', err);
  }
}

export async function clearMatchVoteRemote(auctionId, server, matchId, voterTeamId) {
  const store = loadLocalPredictions(auctionId);
  if (store.matches?.[matchId]?.votes?.[voterTeamId]) {
    delete store.matches[matchId].votes[voterTeamId];
    saveLocalPredictions(auctionId, store);
  }
  if (!FEATURE_MULTIPLAYER) return;
  try {
    const rtdb = getRtdb(server);
    await remove(ref(rtdb, `auctions/${auctionId}/leaguePredictions/matches/${matchId}/votes/${voterTeamId}`));
  } catch {
    /* local only */
  }
}