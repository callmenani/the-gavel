import { IPL_PLAYERS } from '../data/players.js';
import { TEAMS } from '../data/teams.js';
import { toFiniteNumber, countOverseas, isOverseasPlayer, r2 } from './auctionDisplay.js';
import { getNextBidAmount, generatePlayerOrder, CONSENT_DEADLINE_MS } from './auctionRules.js';
import { evaluateBotBid } from './botEngine.js';
import { simulateBotLot, simulateRemainingAuction } from './botSimulation.js';

export const SCHEMA_VERSION = 1;
export const MAX_SOLO_SAVES = 5;
export const STORAGE_PREFIX = 'thegavel_solo_';
export const STORAGE_INDEX_KEY = 'thegavel_solo_index';
export const STORAGE_LOCK_PREFIX = 'thegavel_solo_lock_';

/**
 * Unified detector for local-mode solo auction rooms.
 *
 * Rules:
 * 1. An explicit cloud server parameter (e.g. ?server=server-1) ALWAYS wins over a stale local store.
 * 2. If server is explicitly 'local' (or ?server=local), returns true.
 * 3. If hasLocalStore is true and no explicit cloud server was requested, returns true.
 * 4. Otherwise returns false.
 */
export function isLocalRoom(roomId, serverOrParams, hasLocalStore = false) {
  if (!roomId) return false;

  let serverVal = null;
  if (typeof serverOrParams === 'string') {
    serverVal = serverOrParams;
  } else if (serverOrParams && typeof serverOrParams.get === 'function') {
    serverVal = serverOrParams.get('server');
  }

  // An explicit cloud server parameter ALWAYS overrides a stale local store
  if (serverVal && serverVal !== 'local') {
    return false;
  }

  if (serverVal === 'local') {
    return true;
  }

  if (typeof roomId === 'string' && roomId.startsWith('SOLO-')) {
    return true;
  }

  return Boolean(hasLocalStore);
}

/**
 * Deterministic pseudo-random number generator (LCG) using 32-bit integer arithmetic.
 * Returns a function that produces [0, 1) float and advances the internal seed.
 */
export function createSeededRng(seed = 123456789) {
  let s = (Math.floor(seed) || 123456789) >>> 0;
  return function nextRandom() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Consent-after-sale: true once every non-bot (human) manager in the room has
 * voted. In a solo room that's just the host, so the gate resolves as soon as
 * the host taps Confirm (or the safety deadline / force-advance elapses).
 */
function allHumansConsented(state, consentVotes) {
  const humans = (state.roomTeams || state.teams || []).filter(
    (t) => t.userId && !String(t.userId).startsWith('bot_'),
  );
  if (humans.length === 0) return true;
  return humans.every((t) => consentVotes[t.userId] !== undefined);
}

/**
 * Pure reducer for local solo auction state transitions.
 * Zero Firebase, zero Supabase dependencies.
 */
export function localAuctionReducer(state, action) {
  if (!action) return state;

  switch (action.type) {
    case 'INIT_AUCTION': {
      const {
        roomId,
        humanUser,
        auctionType = 'mega',
        seed = Date.now(),
        settings: initialSettings = {},
      } = action;
      const bidTimer = Number(initialSettings?.bidTimer || action.bidTimer || 10);

      const isSprint5 = auctionType === 'sprint5';
      const isSprint11 = auctionType === 'sprint11';
      const isLegends = auctionType === 'legends';

      const budget = isSprint5 ? 60.0 : isSprint11 ? 90.0 : isLegends ? 100.0 : 120.0;
      const squadLimit = isSprint5 ? 5 : (isSprint11 || isLegends) ? 11 : 25;
      const overseasLimit = isSprint5 ? 2 : (isSprint11 || isLegends) ? 4 : 8;

      const humanTeamId = humanUser.team;
      const humanTeamObj = TEAMS.find((t) => t.id === humanTeamId) || TEAMS[0];

      // 1 human player + 9 AI bot franchises
      const players = [
        {
          id: humanUser.uid,
          name: humanUser.displayName || 'Manager',
          team: humanTeamId,
          teamName: humanTeamObj.name,
          isHost: true,
          isBot: false,
          spent: 0,
          squadCount: 0,
        },
      ];

      const roomTeams = [
        {
          id: `${roomId}_${humanUser.uid}`,
          auctionId: roomId,
          userId: humanUser.uid,
          teamId: humanTeamId,
          teamName: humanTeamObj.name,
          budgetRemaining: budget,
          spent: 0,
          squad: [],
        },
      ];

      TEAMS.forEach((t) => {
        if (t.id === humanTeamId) return;
        const botId = `bot_${t.id}`;
        players.push({
          id: botId,
          name: t.botName || `${t.name} Bot`,
          team: t.id,
          teamName: t.name,
          isHost: false,
          isBot: true,
          spent: 0,
          squadCount: 0,
        });

        roomTeams.push({
          id: `${roomId}_${botId}`,
          auctionId: roomId,
          userId: botId,
          teamId: t.id,
          teamName: t.name,
          budgetRemaining: budget,
          spent: 0,
          squad: [],
        });
      });

      // Same lot order as cloud: grouped by player set, marquee first.
      const playerOrder = generatePlayerOrder(auctionType);

      const firstPlayer = IPL_PLAYERS[playerOrder[0]] || IPL_PLAYERS[0];
      const now = action.now || Date.now();

      return {
        id: roomId,
        hostId: humanUser.uid,
        hostName: humanUser.displayName || 'Manager',
        status: 'active',
        auctionType,
        server: 'local',
        squadLimit,
        overseasLimit,
        settings: { bidTimer, budget },
        players,
        roomTeams,
        teams: roomTeams,
        playerOrder,
        currentPlayerIndex: 0,
        rngSeed: seed,
        fastForwarded: false,
        isFastForwarding: false,
        messages: [
          {
            id: `msg_init_${roomId}`,
            text: `Single player auction started with 9 AI Bots. Mode: ${auctionType.toUpperCase()}.`,
            type: 'log',
            timestamp: now,
          },
        ],
        currentAuction: {
          playerId: firstPlayer.id,
          currentBid: 0,
          highBidderId: '',
          highBidderName: '',
          highBidderTeamId: '',
          timerEndsAt: now + bidTimer * 1000,
          status: 'bidding',
          pausedRemainingMs: null,
        },
        currentLot: {
          playerId: firstPlayer.id,
          currentBid: 0,
          highBidderId: '',
          highBidderName: '',
          highBidderTeamId: '',
          timerEndsAt: now + bidTimer * 1000,
          status: 'bidding',
          pausedRemainingMs: null,
        },
      };
    }

    case 'PLACE_BID': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'bidding') return state;

      const { bidderId, now = Date.now() } = action;
      if (!bidderId) return state;

      const bidderTeam = state.roomTeams.find((t) => t.userId === bidderId);
      if (!bidderTeam) return state;

      const player = IPL_PLAYERS.find((p) => p.id === live.playerId);
      if (!player) return state;

      // Don't bid against self
      if (live.highBidderId === bidderId) return state;

      // Calculate next bid
      const minNextBid = getNextBidAmount(player, live.currentBid);
      const requestedBid = typeof action.targetBid === 'number' && Number.isFinite(action.targetBid)
        ? toFiniteNumber(action.targetBid, 0)
        : null;
      if (requestedBid != null && requestedBid < minNextBid) return state;

      const nextBid = requestedBid != null ? r2(requestedBid) : minNextBid;

      // Validate budget
      const currentSquad = bidderTeam.squad || [];
      const slotsRemaining = state.squadLimit - currentSquad.length;
      if (slotsRemaining <= 0) return state;

      // Reserve budget check for human
      const slotsAfterThis = Math.max(0, slotsRemaining - 1);
      const minReserve = slotsAfterThis * 0.30;
      const budgetRemaining = toFiniteNumber(bidderTeam.budgetRemaining, state.settings?.budget || 120);

      if (budgetRemaining < nextBid || (budgetRemaining - nextBid) < minReserve) {
        return state;
      }

      // Overseas check
      if (isOverseasPlayer(player)) {
        const count = countOverseas(currentSquad, IPL_PLAYERS);
        if (count >= state.overseasLimit) return state;
      }

      const timerSec = state.settings?.bidTimer || 10;
      const teamObj = TEAMS.find((t) => t.id === bidderTeam.teamId);
      const bidderName = bidderTeam.userId.startsWith('bot_')
        ? (teamObj?.botName || `${teamObj?.name || 'Bot'} Bot`)
        : state.hostName || 'Manager';

      const updatedLot = {
        ...live,
        currentBid: nextBid,
        highBidderId: bidderId,
        highBidderName: bidderName,
        highBidderTeamId: bidderTeam.teamId,
        timerEndsAt: now + timerSec * 1000,
      };

      return {
        ...state,
        currentAuction: updatedLot,
        currentLot: updatedLot,
        messages: [
          ...state.messages.slice(-50),
          {
            id: `bid_${now}_${Math.random().toString(36).slice(2, 7)}`,
            text: `New bid: ₹${nextBid.toFixed(2)} Cr by ${bidderName}`,
            type: 'log',
            timestamp: now,
          },
        ],
      };
    }

    case 'BOT_BID': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'bidding') return state;

      const { now = Date.now() } = action;
      const player = IPL_PLAYERS.find((p) => p.id === live.playerId);
      if (!player) return state;

      // Filter eligible bots
      const botTeams = state.roomTeams.filter((t) => t.userId && t.userId.startsWith('bot_'));
      if (botTeams.length === 0) return state;

      const rng = createSeededRng(state.rngSeed + now);
      const shuffledBots = [...botTeams].sort(() => rng() - 0.5);

      for (const bTeam of shuffledBots) {
        if (bTeam.userId === live.highBidderId) continue;

        const decision = evaluateBotBid({
          player,
          currentBid: live.currentBid,
          highBidderId: live.highBidderId,
          botTeam: bTeam,
          squadLimit: state.squadLimit,
          overseasLimit: state.overseasLimit,
          initialBudget: state.settings?.budget || 120,
          randomFn: rng,
        });

        if (decision && decision.shouldBid) {
          const teamObj = TEAMS.find((t) => t.id === decision.teamId);
          const botName = teamObj?.botName || (teamObj ? `${teamObj.name} Bot` : 'Bot');
          const timerSec = state.settings?.bidTimer || 10;

          const updatedLot = {
            ...live,
            currentBid: decision.nextBid,
            highBidderId: decision.botUserId,
            highBidderName: botName,
            highBidderTeamId: decision.teamId,
            timerEndsAt: now + timerSec * 1000,
          };

          return {
            ...state,
            rngSeed: (state.rngSeed + 1) >>> 0,
            currentAuction: updatedLot,
            currentLot: updatedLot,
            messages: [
              ...state.messages.slice(-50),
              {
                id: `bid_bot_${now}_${Math.random().toString(36).slice(2, 7)}`,
                text: `New bid: ₹${decision.nextBid.toFixed(2)} Cr by ${botName}`,
                type: 'log',
                timestamp: now,
              },
            ],
          };
        }
      }

      return state;
    }

    case 'RESOLVE_LOT': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live) return state;

      // A duplicate resolve (e.g. the timer and the bot loop both firing) must not
      // skip the sold/unsold celebration. ADVANCE_LOT is the only way forward.
      if (live.status === 'sold' || live.status === 'unsold') return state;

      if (live.status !== 'bidding') return state;

      const { now = Date.now() } = action;
      const player = IPL_PLAYERS.find((p) => p.id === live.playerId);
      if (!player) return state;

      const isSold = Boolean(live.highBidderId && live.currentBid > 0);
      let updatedRoomTeams = state.roomTeams;
      let updatedPlayers = state.players;

      if (isSold) {
        updatedRoomTeams = state.roomTeams.map((t) => {
          if (t.userId !== live.highBidderId) return t;
          const newSquad = [
            ...(t.squad || []),
            {
              id: player.id,
              name: player.name,
              role: player.role,
              bid: live.currentBid,
              team: live.highBidderTeamId,
            },
          ];
          const newSpent = toFiniteNumber(t.spent, 0) + live.currentBid;
          const newBudget = Math.max(0, toFiniteNumber(t.budgetRemaining, state.settings?.budget || 120) - live.currentBid);
          return {
            ...t,
            squad: newSquad,
            spent: newSpent,
            budgetRemaining: newBudget,
          };
        });

        updatedPlayers = state.players.map((p) => {
          if (p.id !== live.highBidderId) return p;
          return {
            ...p,
            spent: toFiniteNumber(p.spent, 0) + live.currentBid,
            squadCount: toFiniteNumber(p.squadCount, 0) + 1,
          };
        });
      }

      const nextIndex = state.currentPlayerIndex + 1;
      const allDone = nextIndex >= state.playerOrder.length;

      const resultMsg = isSold
        ? `${player.name} SOLD to ${live.highBidderName} for ₹${live.currentBid.toFixed(2)} Cr`
        : `${player.name} UNSOLD`;

      const newMessages = [
        ...state.messages.slice(-50),
        {
          id: `res_${now}_${player.id}`,
          text: resultMsg,
          type: isSold ? 'sold_card' : 'log',
          metadata: isSold ? {
            playerId: player.id,
            teamId: live.highBidderTeamId,
            bid: live.currentBid,
            buyerId: live.highBidderId,
            buyerName: live.highBidderName,
          } : null,
          timestamp: now,
        },
      ];

      // Celebration stage: pause on sold/unsold animation before advancing
      if (action.celebrate) {
        // Match cloud timing: 5s on a sale, 2s on unsold.
        const celebrationMs = action.celebrationMs || (isSold ? 5000 : 2000);
        const resolvedLot = {
          ...live,
          status: isSold ? 'sold' : 'unsold',
          celebrationEndsAt: now + celebrationMs,
          timerEndsAt: now + celebrationMs,
        };
        return {
          ...state,
          roomTeams: updatedRoomTeams,
          teams: updatedRoomTeams,
          players: updatedPlayers,
          messages: newMessages,
          currentAuction: resolvedLot,
          currentLot: resolvedLot,
        };
      }

      if (allDone) {
        const completedLot = {
          ...live,
          status: isSold ? 'sold' : 'unsold',
        };
        return {
          ...state,
          status: 'completed',
          roomTeams: updatedRoomTeams,
          teams: updatedRoomTeams,
          players: updatedPlayers,
          currentPlayerIndex: nextIndex,
          messages: [
            ...newMessages,
            {
              id: `msg_comp_${now}`,
              text: 'The Solo Mega Auction is officially complete!',
              type: 'log',
              timestamp: now,
            },
          ],
          currentAuction: completedLot,
          currentLot: completedLot,
        };
      }

      const nextPlayerId = state.playerOrder[nextIndex];
      const nextPlayer = IPL_PLAYERS[nextPlayerId] || IPL_PLAYERS[0];
      const timerSec = state.settings?.bidTimer || 10;
      const nextLot = {
        playerId: nextPlayer.id,
        // Cloud opens each lot at 0; the first bid equals the base price.
        currentBid: 0,
        highBidderId: '',
        highBidderName: '',
        highBidderTeamId: '',
        timerEndsAt: now + timerSec * 1000,
        status: 'bidding',
        pausedRemainingMs: null,
      };

      return {
        ...state,
        roomTeams: updatedRoomTeams,
        teams: updatedRoomTeams,
        players: updatedPlayers,
        currentPlayerIndex: nextIndex,
        messages: newMessages,
        currentAuction: nextLot,
        currentLot: nextLot,
      };
    }

    case 'ADVANCE_LOT': {
      if (!state || state.status !== 'active') return state;
      const { now = Date.now() } = action;
      const nextIndex = state.currentPlayerIndex + 1;
      const allDone = nextIndex >= state.playerOrder.length;

      if (allDone) {
        const completedLot = {
          ...(state.currentAuction || {}),
          status: 'sold',
        };
        return {
          ...state,
          status: 'completed',
          currentPlayerIndex: nextIndex,
          messages: [
            ...state.messages.slice(-50),
            {
              id: `msg_comp_${now}`,
              text: 'The Solo Mega Auction is officially complete!',
              type: 'log',
              timestamp: now,
            },
          ],
          currentAuction: completedLot,
          currentLot: completedLot,
        };
      }

      const nextPlayerId = state.playerOrder[nextIndex];
      const nextPlayer = IPL_PLAYERS[nextPlayerId] || IPL_PLAYERS[0];
      const timerSec = state.settings?.bidTimer || 10;
      const nextLot = {
        playerId: nextPlayer.id,
        // Cloud opens each lot at 0; the first bid equals the base price.
        currentBid: 0,
        highBidderId: '',
        highBidderName: '',
        highBidderTeamId: '',
        timerEndsAt: now + timerSec * 1000,
        status: 'bidding',
        pausedRemainingMs: null,
      };

      return {
        ...state,
        currentPlayerIndex: nextIndex,
        currentAuction: nextLot,
        currentLot: nextLot,
      };
    }

    case 'PAUSE_AUCTION': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'bidding') return state;

      const { now = Date.now() } = action;
      const remainingMs = Math.max(0, (live.timerEndsAt || 0) - now);
      const pausedLot = {
        ...live,
        status: 'paused',
        pausedRemainingMs: remainingMs,
      };

      return {
        ...state,
        currentAuction: pausedLot,
        currentLot: pausedLot,
      };
    }

    case 'RESUME_AUCTION': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'paused') return state;

      const { now = Date.now() } = action;
      const remaining = live.pausedRemainingMs ?? (state.settings?.bidTimer || 10) * 1000;
      const resumedLot = {
        ...live,
        status: 'bidding',
        timerEndsAt: now + remaining,
        pausedRemainingMs: null,
      };

      return {
        ...state,
        currentAuction: resumedLot,
        currentLot: resumedLot,
      };
    }

    case 'SKIP_LOT': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live) return state;
      if (live.status === 'sold' || live.status === 'unsold') {
        return localAuctionReducer(state, { type: 'ADVANCE_LOT', now: action.now || Date.now() });
      }
      if (live.status !== 'bidding') return state;

      const { now = Date.now() } = action;
      const player = IPL_PLAYERS.find((p) => p.id === live.playerId);
      if (!player) return state;

      const botTeams = state.roomTeams.filter((t) => t.userId !== state.hostId);
      const rng = createSeededRng(state.rngSeed + now);

      const simRes = simulateBotLot({
        player,
        botTeams,
        currentBid: live.currentBid,
        highBidderId: live.highBidderId,
        highBidderName: live.highBidderName,
        highBidderTeamId: live.highBidderTeamId,
        squadLimit: state.squadLimit,
        overseasLimit: state.overseasLimit,
        initialBudget: state.settings?.budget || 120,
        randomFn: rng,
      });

      // Advance with simulated winner or unsold
      const interimState = {
        ...state,
        currentAuction: {
          ...live,
          currentBid: simRes.finalBid,
          highBidderId: simRes.winnerId,
          highBidderName: simRes.winnerName,
          highBidderTeamId: simRes.winnerTeamId,
        },
      };

      return localAuctionReducer(interimState, { type: 'RESOLVE_LOT', now });
    }

    case 'FAST_FORWARD': {
      if (!state || state.status !== 'active') return state;
      if (state.isFastForwarding) return state;

      const { now = Date.now() } = action;
      const live = state.currentAuction;
      const humanTeam = state.roomTeams.find((t) => t.userId === state.hostId);
      const humanTeamId = humanTeam?.teamId || '';

      const rng = createSeededRng(state.rngSeed + now);

      // Runs pure in-memory simulation for all remaining lots
      // Note: If human is leading on active lot, simulateRemainingAuction automatically awards it to human!
      const simResult = simulateRemainingAuction({
        playerOrder: state.playerOrder,
        currentPlayerIndex: state.currentPlayerIndex,
        currentLive: live,
        humanUserId: state.hostId,
        humanTeamId,
        teams: state.roomTeams,
        settings: state.settings,
        squadLimit: state.squadLimit,
        overseasLimit: state.overseasLimit,
        randomFn: rng,
      });

      const simulatedTeams = Array.isArray(simResult)
        ? simResult
        : simResult?.simulatedTeams || [];

      const updatedPlayers = state.players.map((p) => {
        const matchingTeam = simulatedTeams.find((t) => t.userId === p.id);
        if (!matchingTeam) return p;
        return {
          ...p,
          spent: matchingTeam.spent,
          squadCount: matchingTeam.squad?.length || 0,
        };
      });

      return {
        ...state,
        status: 'completed',
        roomTeams: simulatedTeams,
        teams: simulatedTeams,
        players: updatedPlayers,
        fastForwarded: true,
        isFastForwarding: false,
        currentPlayerIndex: state.playerOrder.length,
        currentAuction: {
          ...(live || {}),
          status: 'sold',
        },
        currentLot: {
          ...(live || {}),
          status: 'sold',
        },
        messages: [
          ...state.messages.slice(-50),
          {
            id: `ff_${now}`,
            text: 'Fast-Forward complete: Remaining lots were drafted by AI bots.',
            type: 'log',
            timestamp: now,
          },
        ],
      };
    }

    // ── Consent-after-sale gate ────────────────────────────────────────────
    // After a SOLD lot, the room pauses in `awaiting_consent` until every human
    // manager confirms (bots auto-confirm on a short stagger) or a 30s safety
    // deadline elapses. The host can force the advance or reopen the lot.
    case 'OPEN_CONSENT': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'sold') return state; // only sold lots gate
      const { now = Date.now() } = action;

      // No auto-vote: every human manager (including the host) taps Confirm so
      // the gate is always visible. Bots fill the tally in via CONSENT_TICK.
      const consentLot = {
        ...live,
        status: 'awaiting_consent',
        consentVotes: {},
        consentDeadline: now + CONSENT_DEADLINE_MS,
      };

      return {
        ...state,
        currentAuction: consentLot,
        currentLot: consentLot,
        messages: [
          ...state.messages.slice(-50),
          {
            id: `consent_open_${now}`,
            text: 'Sold. Waiting for all managers to confirm the next player…',
            type: 'consent',
            timestamp: now,
          },
        ],
      };
    }

    case 'CONSENT_VOTE': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'awaiting_consent') return state;
      const { voterId, now = Date.now() } = action;
      if (!voterId) return state;

      const consentVotes = { ...(live.consentVotes || {}), [voterId]: now };

      if (allHumansConsented(state, consentVotes)) {
        return localAuctionReducer(
          { ...state, currentAuction: { ...live, consentVotes }, currentLot: { ...live, consentVotes } },
          { type: 'ADVANCE_LOT', now },
        );
      }

      const consentLot = { ...live, consentVotes };
      return { ...state, currentAuction: consentLot, currentLot: consentLot };
    }

    // Driven by the bot loop / timer: staggers in bot confirmations and enforces
    // the safety deadline so a stuck or lagging manager can never freeze the room.
    case 'CONSENT_TICK': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'awaiting_consent') return state;
      const { now = Date.now(), rngSeed } = action;

      const consentVotes = { ...(live.consentVotes || {}) };
      let changed = false;

      if (typeof rngSeed === 'number' && Number.isFinite(rngSeed)) {
        const rng = createSeededRng(rngSeed);
        const bots = (state.roomTeams || state.teams || [])
          .filter((t) => t.userId && String(t.userId).startsWith('bot_'));
        for (const b of bots) {
          if (consentVotes[b.userId] === undefined && rng() < 0.5) {
            consentVotes[b.userId] = now;
            changed = true;
          }
        }
      }

      const consentLot = { ...live, consentVotes };

      if ((live.consentDeadline && now >= live.consentDeadline) || allHumansConsented(state, consentVotes)) {
        return localAuctionReducer(
          { ...state, currentAuction: consentLot, currentLot: consentLot },
          { type: 'ADVANCE_LOT', now },
        );
      }

      return changed ? { ...state, currentAuction: consentLot, currentLot: consentLot } : state;
    }

    // Host override: skip the consent wait and advance immediately.
    case 'CONSENT_FORCE': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'awaiting_consent') return state;
      const { now = Date.now() } = action;
      const player = IPL_PLAYERS.find((p) => p.id === live.playerId);
      const clearedLot = { ...live, consentVotes: null, consentDeadline: null };
      return localAuctionReducer(
        {
          ...state,
          currentAuction: clearedLot,
          currentLot: clearedLot,
          messages: [
            ...state.messages.slice(-50),
            {
              id: `consent_force_${now}`,
              text: `Host moved on to the next player (skipped the consent wait) after ${player?.name || 'the player'}.`,
              type: 'consent',
              timestamp: now,
            },
          ],
        },
        { type: 'ADVANCE_LOT', now },
      );
    }

    // Host "get the player back": re-insert any player into the order right
    // after the current position so they get re-bid on (solo rooms).
    case 'RECALL_PLAYER': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live) return state;
      const { playerIndex, now = Date.now() } = action;
      const player = IPL_PLAYERS[playerIndex];
      if (playerIndex == null || !player) return state;

      const order = Array.isArray(state.playerOrder) ? state.playerOrder : [];
      const cleaned = order.filter((i) => i !== playerIndex);
      const curIdx = cleaned.findIndex((i) => {
        const p = IPL_PLAYERS[i];
        return p && p.id === live.playerId;
      });
      const insertAt = curIdx >= 0 ? curIdx + 1 : cleaned.length;
      const newOrder = [...cleaned.slice(0, insertAt), playerIndex, ...cleaned.slice(insertAt)];

      const timerSec = state.settings?.bidTimer || 10;
      const isResolved = live.status === 'sold' || live.status === 'unsold' || live.status === 'awaiting_consent';
      let nextIndex = state.currentPlayerIndex;
      let nextLot = live;
      if (isResolved) {
        nextIndex = insertAt; // start the recalled lot right now
        nextLot = {
          playerId: player.id,
          currentBid: 0,
          highBidderId: '',
          highBidderName: '',
          highBidderTeamId: '',
          timerEndsAt: now + timerSec * 1000,
          status: 'bidding',
          pausedRemainingMs: null,
          consentVotes: null,
          consentDeadline: null,
        };
      }

      return {
        ...state,
        playerOrder: newOrder,
        currentPlayerIndex: nextIndex,
        currentAuction: nextLot,
        currentLot: nextLot,
        messages: [
          ...state.messages.slice(-50),
          {
            id: `recall_${player.id}_${now}`,
            text: `Host pulled ${player.name} back into the auction.`,
            type: 'log',
            timestamp: now,
          },
        ],
      };
    }

    // Host undo: pull the just-sold player back and reopen it for fresh bidding.
    // Reverses the sale (refunds the buyer, frees the squad slot) so a lagging
    // manager can still compete. Re-bids start from 0, so the price can rise.
    case 'REOPEN_LOT': {
      if (!state || state.status !== 'active') return state;
      const live = state.currentAuction;
      if (!live || live.status !== 'awaiting_consent') return state;
      const { now = Date.now() } = action;
      const player = IPL_PLAYERS.find((p) => p.id === live.playerId);
      if (!player) return state;

      const buyerId = live.highBidderId;
      const winBid = toFiniteNumber(live.currentBid, 0);

      const updatedRoomTeams = state.roomTeams.map((t) => {
        if (t.userId !== buyerId) return t;
        return {
          ...t,
          squad: (t.squad || []).filter((s) => s.id !== player.id),
          spent: Math.max(0, toFiniteNumber(t.spent, 0) - winBid),
          budgetRemaining: toFiniteNumber(t.budgetRemaining, state.settings?.budget || 120) + winBid,
        };
      });

      const updatedPlayers = state.players.map((p) => {
        if (p.id !== buyerId) return p;
        return {
          ...p,
          spent: Math.max(0, toFiniteNumber(p.spent, 0) - winBid),
          squadCount: Math.max(0, toFiniteNumber(p.squadCount, 0) - 1),
        };
      });

      const timerSec = state.settings?.bidTimer || 10;
      const reopenedLot = {
        ...live,
        currentBid: 0,
        highBidderId: '',
        highBidderName: '',
        highBidderTeamId: '',
        timerEndsAt: now + timerSec * 1000,
        status: 'bidding',
        pausedRemainingMs: null,
        consentVotes: null,
        consentDeadline: null,
        celebrationEndsAt: null,
      };

      return {
        ...state,
        roomTeams: updatedRoomTeams,
        teams: updatedRoomTeams,
        players: updatedPlayers,
        messages: [
          ...state.messages.slice(-50),
          {
            id: `reopen_${now}`,
            text: `${player.name} pulled back for a fresh bid (lag recovery).`,
            type: 'consent',
            timestamp: now,
          },
        ],
        currentAuction: reopenedLot,
        currentLot: reopenedLot,
      };
    }

    case 'END_AUCTION': {
      if (!state) return state;
      const { now = Date.now() } = action;
      return {
        ...state,
        status: 'completed',
        isFastForwarding: false,
        currentAuction: {
          ...(state.currentAuction || {}),
          status: 'sold',
        },
        currentLot: {
          ...(state.currentAuction || {}),
          status: 'sold',
        },
        messages: [
          ...state.messages.slice(-50),
          {
            id: `msg_end_${now}`,
            text: 'Auction COMPLETED by Admin.',
            type: 'log',
            timestamp: now,
          },
        ],
      };
    }

    case 'UPDATE_SETTINGS': {
      if (!state) return state;
      const { settings = {} } = action;
      return {
        ...state,
        settings: {
          ...state.settings,
          ...settings,
        },
      };
    }

    default:
      return state;
  }
}

/**
 * Storage helpers with schema versioning, safe try/catch, and LRU pruning.
 */

function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function loadLocalSoloRoom(roomId) {
  const storage = getStorage();
  if (!storage || !roomId) return null;

  try {
    const raw = storage.getItem(STORAGE_PREFIX + roomId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SCHEMA_VERSION || !parsed.data) {
      return null;
    }
    return parsed.data;
  } catch (err) {
    console.warn(`[localEngine] Could not load local solo room ${roomId}:`, err);
    return null;
  }
}

export function saveLocalSoloRoom(roomIdOrState, stateArg, synced = false) {
  const storage = getStorage();
  if (!storage || !roomIdOrState) return false;

  let roomId = null;
  let state = null;
  let isSynced = Boolean(synced);

  if (typeof roomIdOrState === 'string') {
    roomId = roomIdOrState;
    state = stateArg;
  } else if (roomIdOrState && typeof roomIdOrState === 'object') {
    state = roomIdOrState;
    roomId = state.id;
    if (typeof stateArg === 'boolean') {
      isSynced = stateArg;
    }
  }

  if (!roomId || !state) return false;

  try {
    const record = {
      version: SCHEMA_VERSION,
      roomId,
      savedAt: Date.now(),
      synced: isSynced,
      data: state,
    };

    // Update LRU index
    let index = [];
    try {
      const indexRaw = storage.getItem(STORAGE_INDEX_KEY);
      if (indexRaw) index = JSON.parse(indexRaw) || [];
    } catch {
      index = [];
    }

    // Move roomId to end of LRU list
    index = index.filter((id) => id !== roomId);
    index.push(roomId);

    // Prune oldest if over MAX_SOLO_SAVES
    // Rule: LRU pruning must NEVER delete saves that are completed but not yet synced!
    while (index.length > MAX_SOLO_SAVES) {
      let candidateIndex = -1;
      for (let i = 0; i < index.length; i++) {
        const idToCheck = index[i];
        if (idToCheck === roomId) continue; // don't prune current save
        try {
          const rawCheck = storage.getItem(STORAGE_PREFIX + idToCheck);
          if (rawCheck) {
            const parsedCheck = JSON.parse(rawCheck);
            // If completed and not synced, DO NOT prune!
            if (parsedCheck?.data?.status === 'completed' && !parsedCheck?.synced) {
              continue;
            }
          }
          candidateIndex = i;
          break;
        } catch {
          candidateIndex = i;
          break;
        }
      }

      if (candidateIndex === -1) {
        // All other saves are protected unsynced saves; stop pruning
        break;
      }

      const [removedId] = index.splice(candidateIndex, 1);
      try {
        storage.removeItem(STORAGE_PREFIX + removedId);
      } catch {
        /* best-effort */
      }
    }

    storage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(record));
    storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch (err) {
    console.warn(`[localEngine] Could not save local solo room ${roomId}:`, err);
    return false;
  }
}

export function deleteLocalSoloRoom(roomId) {
  const storage = getStorage();
  if (!storage || !roomId) return;

  try {
    storage.removeItem(STORAGE_PREFIX + roomId);
    const indexRaw = storage.getItem(STORAGE_INDEX_KEY);
    if (indexRaw) {
      const index = JSON.parse(indexRaw) || [];
      storage.setItem(STORAGE_INDEX_KEY, JSON.stringify(index.filter((id) => id !== roomId)));
    }
  } catch (err) {
    console.warn(`[localEngine] Error deleting local solo room ${roomId}:`, err);
  }
}

/**
 * List device-local solo saves, newest first. Used by the History tab so a
 * player can resume a solo auction after leaving the room.
 */
export function listLocalSoloRooms() {
  const storage = getStorage();
  if (!storage) return [];

  let index = [];
  try {
    index = JSON.parse(storage.getItem(STORAGE_INDEX_KEY) || '[]') || [];
  } catch {
    index = [];
  }

  const rooms = [];
  index.forEach((roomId) => {
    try {
      const raw = storage.getItem(STORAGE_PREFIX + roomId);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SCHEMA_VERSION || !parsed.data) return;
      rooms.push({
        roomId: parsed.data.id || roomId,
        savedAt: parsed.savedAt || 0,
        synced: Boolean(parsed.synced),
        state: parsed.data,
      });
    } catch {
      // Corrupt row: skip it rather than blocking the whole list.
    }
  });

  return rooms.sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Rows for Supabase when a device-local auction ends. Mirrors the cloud flush
 * (auction + one team row per franchise) so the summary survives this device.
 */
export function buildSoloPersistPayload(state) {
  if (!state?.id) return null;
  const roomId = state.id;
  const teams = state.roomTeams || state.teams || [];
  const budget = toFiniteNumber(state.settings?.budget, 120);

  return {
    auction: {
      id: roomId,
      host_id: state.hostId || '',
      host_name: state.hostName || 'Manager',
      is_public: false,
      status: state.status || 'completed',
      auction_type: state.auctionType || 'mega',
      players: state.players || [],
      settings: { ...(state.settings || {}), server: 'local', finalTeams: teams },
      banned_players: [],
      overseas_limit: toFiniteNumber(state.overseasLimit, 8),
      squad_limit: toFiniteNumber(state.squadLimit, 25),
    },
    // Only persist genuine human player teams to the teams table (for user history)
    teams: teams
      .filter((t) => t.userId && !String(t.userId).startsWith('bot_'))
      .map((t) => ({
        id: `${roomId}_${t.userId}`,
        auction_id: roomId,
        user_id: t.userId || '',
        team_id: t.teamId || '',
        team_name: t.teamName || 'Unknown',
        budget_remaining: toFiniteNumber(t.budgetRemaining, budget),
        spent: toFiniteNumber(t.spent, 0),
        squad: t.squad || [],
      })),
  };
}

/**
 * Two-tab lease lock: Web Locks API with fallback heartbeat lease (5000ms).
 * Supports lock stealing (takeover) and onSteal notifications.
 */
export async function acquireSoloRoomLock(roomId, tabId = Math.random().toString(36).slice(2), onSteal = null) {
  let channel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(`thegavel_solo_tab_${roomId}`);
      channel.onmessage = (e) => {
        if (e.data?.type === 'takeover' && e.data?.tabId !== tabId) {
          if (onSteal) onSteal();
        }
      };
    } catch {
      // BroadcastChannel unavailable
    }
  }

  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    try {
      let releaseLock = null;
      const lockName = `thegavel_lock_${roomId}`;

      return await new Promise((resolve) => {
        navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            try { channel?.close(); channel = null; } catch {}
            resolve({
              acquired: false,
              steal: async () => {
                try {
                  const ch = new BroadcastChannel(`thegavel_solo_tab_${roomId}`);
                  ch.postMessage({ type: 'takeover', tabId });
                  ch.close();
                } catch {}
                return await new Promise((resSteal) => {
                  navigator.locks.request(lockName, { steal: true }, async (stolenLock) => {
                    const stolenCh = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`thegavel_solo_tab_${roomId}`) : null;
                    if (stolenCh && onSteal) {
                      stolenCh.onmessage = (e) => {
                        if (e.data?.type === 'takeover' && e.data?.tabId !== tabId) onSteal();
                      };
                    }
                    resSteal({
                      acquired: true,
                      release: async () => {
                        if (releaseLock) releaseLock();
                        try { stolenCh?.close(); } catch {}
                      },
                    });
                    await new Promise((r) => { releaseLock = r; });
                  });
                });
              },
              release: async () => {
                try { channel?.close(); } catch {}
              },
            });
            return;
          }

          resolve({
            acquired: true,
            release: async () => {
              if (releaseLock) releaseLock();
              try { channel?.close(); } catch {}
              await new Promise((r) => setTimeout(r, 20));
            },
          });

          try {
            await new Promise((r) => {
              releaseLock = r;
            });
          } finally {
            if (onSteal) onSteal();
          }
        });
      });
    } catch {
      // Fall back to storage heartbeat
    }
  }

  // Fallback: Heartbeat timestamp in localStorage
  const storage = getStorage();
  if (!storage) {
    return {
      acquired: true,
      release: async () => {
        try { channel?.close(); } catch {}
      },
    };
  }

  const lockKey = STORAGE_LOCK_PREFIX + roomId;
  const now = Date.now();
  const currentLockRaw = storage.getItem(lockKey);

  if (currentLockRaw) {
    try {
      const currentLock = JSON.parse(currentLockRaw);
      // 5-second lease: if still active by another tab, reject
      if (currentLock.tabId !== tabId && now - currentLock.timestamp < 5000) {
        try { channel?.close(); channel = null; } catch {}
        return {
          acquired: false,
          steal: async () => {
            try {
              const ch = new BroadcastChannel(`thegavel_solo_tab_${roomId}`);
              ch.postMessage({ type: 'takeover', tabId });
              ch.close();
            } catch {}
            storage.setItem(lockKey, JSON.stringify({ tabId, timestamp: Date.now() }));
            return {
              acquired: true,
              release: async () => {
                try { storage.removeItem(lockKey); } catch {}
              },
            };
          },
          release: async () => {
            try { channel?.close(); } catch {}
          },
        };
      }
    } catch {
      // Corrupt lock, take over
    }
  }

  // Claim lease
  storage.setItem(lockKey, JSON.stringify({ tabId, timestamp: now }));

  const heartbeat = setInterval(() => {
    storage.setItem(lockKey, JSON.stringify({ tabId, timestamp: Date.now() }));
  }, 2000);
  if (heartbeat.unref) heartbeat.unref();

  return {
    acquired: true,
    release: async () => {
      clearInterval(heartbeat);
      try { channel?.close(); } catch {}
      try {
        const cur = storage.getItem(lockKey);
        if (cur && JSON.parse(cur).tabId === tabId) {
          storage.removeItem(lockKey);
        }
      } catch {
        // Ignore
      }
    },
  };
}
