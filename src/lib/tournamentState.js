import { ref, onValue, set } from 'firebase/database';
import { FEATURE_MULTIPLAYER } from './appConfig';
import { getRtdb } from './firebase';
import { createInitialTournamentState } from './tournamentEngine';

const storageKey = (auctionId) => `thegavel_tournament_${auctionId}`;

export function loadTournamentState(auctionId) {
  try {
    const raw = localStorage.getItem(storageKey(auctionId));
    if (!raw) return createInitialTournamentState();
    const parsed = JSON.parse(raw);
    return { ...createInitialTournamentState(), ...parsed };
  } catch {
    return createInitialTournamentState();
  }
}

export function saveTournamentState(auctionId, state) {
  try {
    localStorage.setItem(storageKey(auctionId), JSON.stringify(state));
  } catch {
    /* quota */
  }
}

export function subscribeTournamentState(auctionId, server, onData) {
  if (!FEATURE_MULTIPLAYER || !auctionId) {
    onData(loadTournamentState(auctionId));
    return () => {};
  }

  let rtdb;
  try {
    rtdb = getRtdb(server);
  } catch {
    onData(loadTournamentState(auctionId));
    return () => {};
  }

  const pathRef = ref(rtdb, `auctions/${auctionId}/tournament`);
  const unsub = onValue(
    pathRef,
    (snap) => {
      const val = snap.val();
      if (val && typeof val === 'object') {
        const merged = { ...createInitialTournamentState(), ...val };
        onData(merged);
        saveTournamentState(auctionId, merged);
      } else {
        onData(loadTournamentState(auctionId));
      }
    },
    () => onData(loadTournamentState(auctionId)),
  );

  return () => unsub();
}

export async function publishTournamentState(auctionId, server, state) {
  saveTournamentState(auctionId, state);
  if (!FEATURE_MULTIPLAYER || !auctionId) return;

  try {
    const rtdb = getRtdb(server);
    await set(ref(rtdb, `auctions/${auctionId}/tournament`), state);
  } catch (err) {
    console.warn('[tournament] RTDB sync failed, kept local copy', err);
  }
}