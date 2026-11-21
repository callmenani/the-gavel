/**
 * Tournament progression: squad gate, vote resolution, standings, playoffs, champion.
 */

import { tallyMatchVotes } from './leagueSchedule.js';

export const TOURNAMENT_PHASE = {
  LOCKED: 'locked',
  LEAGUE: 'league',
  PLAYOFFS: 'playoffs',
  COMPLETE: 'complete',
};

export const TIE_BREAK = {
  EXTRA_VOTE: 'extra_vote',
  BUDGET_REMAINING: 'budget_remaining',
  DETERMINISTIC: 'deterministic',
};

export function squadLength(teamDoc) {
  const raw = teamDoc?.squad;
  const arr = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
  return arr.length;
}

/** Schedule unlocks only when every franchise at the table has a full squad. */
export function areAllSquadsFilled(teamDocs, squadLimit = 25) {
  const limit = Math.max(1, Number(squadLimit) || 25);
  const franchises = (teamDocs || []).filter((t) => t?.teamId || t?.team_id);
  if (franchises.length < 2) return { ready: false, filled: 0, total: franchises.length, limit };

  let filled = 0;
  for (const t of franchises) {
    if (squadLength(t) >= limit) filled += 1;
  }
  return {
    ready: filled === franchises.length,
    filled,
    total: franchises.length,
    limit,
  };
}

export function resolveMatchWinnerFromVotes(votes, homeId, awayId, teamMetaById = {}) {
  const { home, away } = tallyMatchVotes(votes, homeId, awayId);
  if (home > away) {
    return { winnerId: homeId, loserId: awayId, homeVotes: home, awayVotes: away, tieBreak: null };
  }
  if (away > home) {
    return { winnerId: awayId, loserId: homeId, homeVotes: home, awayVotes: away, tieBreak: null };
  }

  const homeMeta = teamMetaById[homeId] || {};
  const awayMeta = teamMetaById[awayId] || {};
  const homeBudget = Number(homeMeta.budgetRemaining ?? homeMeta.budget_remaining);
  const awayBudget = Number(awayMeta.budgetRemaining ?? awayMeta.budget_remaining);

  if (Number.isFinite(homeBudget) && Number.isFinite(awayBudget) && homeBudget !== awayBudget) {
    const winnerId = homeBudget > awayBudget ? homeId : awayId;
    const loserId = winnerId === homeId ? awayId : homeId;
    return {
      winnerId,
      loserId,
      homeVotes: home,
      awayVotes: away,
      tieBreak: TIE_BREAK.BUDGET_REMAINING,
    };
  }

  const seed = `${homeId}:${awayId}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const winnerId = hash % 2 === 0 ? homeId : awayId;
  return {
    winnerId,
    loserId: winnerId === homeId ? awayId : homeId,
    homeVotes: home,
    awayVotes: away,
    tieBreak: TIE_BREAK.DETERMINISTIC,
  };
}

/**
 * League standings from closed fixtures only.
 * Rank: wins desc, vote margin desc, teamId asc.
 */
export function computeLeagueStandings(leagueFixtures, matchResults, teamIds) {
  const stats = new Map(
    teamIds.map((id) => [id, { teamId: id, played: 0, wins: 0, losses: 0, voteMargin: 0 }]),
  );

  leagueFixtures.forEach((m) => {
    const result = matchResults?.[m.matchId];
    if (!result || result.status !== 'closed' || !result.winnerId) return;
    const loserId = result.winnerId === m.homeId ? m.awayId : m.homeId;
    const homeSide = stats.get(m.homeId);
    const awaySide = stats.get(m.awayId);
    if (!homeSide || !awaySide) return;

    homeSide.played += 1;
    awaySide.played += 1;
    const margin = Math.abs((result.homeVotes || 0) - (result.awayVotes || 0));

    if (result.winnerId === m.homeId) {
      homeSide.wins += 1;
      awaySide.losses += 1;
      homeSide.voteMargin += margin;
      awaySide.voteMargin -= margin;
    } else {
      awaySide.wins += 1;
      homeSide.losses += 1;
      awaySide.voteMargin += margin;
      homeSide.voteMargin -= margin;
    }
  });

  const list = [...stats.values()].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.voteMargin !== a.voteMargin) return b.voteMargin - a.voteMargin;
    return String(a.teamId).localeCompare(String(b.teamId));
  });

  return list.map((row, idx) => ({ ...row, rank: idx + 1 }));
}

export function selectTopFour(standings) {
  return standings.slice(0, 4).map((s) => s.teamId);
}

export function generateSemifinalFixtures(seedOrder) {
  const [s1, s2, s3, s4] = seedOrder;
  if (!s1 || !s2 || !s3 || !s4) return [];
  return [
    {
      leg: 'semifinal',
      round: 'sf',
      matchId: 'playoff_sf1',
      homeId: s1,
      awayId: s4,
      seedHome: 1,
      seedAway: 4,
    },
    {
      leg: 'semifinal',
      round: 'sf',
      matchId: 'playoff_sf2',
      homeId: s2,
      awayId: s3,
      seedHome: 2,
      seedAway: 3,
    },
  ];
}

export function generateFinalFixture(winnerSf1, winnerSf2, standings) {
  if (!winnerSf1 || !winnerSf2) return null;
  const r1 = standings.find((s) => s.teamId === winnerSf1)?.rank ?? 99;
  const r2 = standings.find((s) => s.teamId === winnerSf2)?.rank ?? 99;
  const homeId = r1 <= r2 ? winnerSf1 : winnerSf2;
  const awayId = homeId === winnerSf1 ? winnerSf2 : winnerSf1;
  return {
    leg: 'final',
    round: 'final',
    matchId: 'playoff_final',
    homeId,
    awayId,
  };
}

export function allLeagueMatchesClosed(leagueFixtures, matchResults) {
  if (!leagueFixtures.length) return false;
  return leagueFixtures.every((m) => matchResults?.[m.matchId]?.status === 'closed');
}

export function activePlayoffFixtures(state, standings) {
  const semis = state?.playoff?.semis || [];
  const results = state?.matchResults || {};
  const w1 = results.playoff_sf1?.status === 'closed' ? results.playoff_sf1.winnerId : null;
  const w2 = results.playoff_sf2?.status === 'closed' ? results.playoff_sf2.winnerId : null;

  const list = [...semis];
  if (w1 && w2) {
    const finalMatch = state.playoff?.final || generateFinalFixture(w1, w2, standings);
    if (finalMatch) list.push(finalMatch);
  }
  return list;
}

export function maybeAdvancePlayoffs(state, standings) {
  const results = { ...(state.matchResults || {}) };
  const playoff = { ...(state.playoff || {}) };
  let phase = state.phase;
  let championId = state.championId || null;

  const sf1 = results.playoff_sf1;
  const sf2 = results.playoff_sf2;
  const finalR = results.playoff_final;

  if (sf1?.status === 'closed' && sf2?.status === 'closed' && !playoff.final) {
    playoff.final = generateFinalFixture(sf1.winnerId, sf2.winnerId, standings);
  }

  if (finalR?.status === 'closed' && finalR.winnerId) {
    phase = TOURNAMENT_PHASE.COMPLETE;
    championId = finalR.winnerId;
  }

  return { ...state, matchResults: results, playoff, phase, championId };
}

export function createInitialTournamentState() {
  return {
    phase: TOURNAMENT_PHASE.LOCKED,
    matchResults: {},
    playoff: { semis: [], final: null },
    championId: null,
  };
}

export function activateLeaguePhase(state) {
  if (state.phase !== TOURNAMENT_PHASE.LOCKED) return state;
  return { ...state, phase: TOURNAMENT_PHASE.LEAGUE };
}

export function beginPlayoffs(state, seedOrder) {
  const semis = generateSemifinalFixtures(seedOrder);
  return {
    ...state,
    phase: TOURNAMENT_PHASE.PLAYOFFS,
    playoff: { semis, final: null },
  };
}

export function closeMatchResult(state, matchId, outcome) {
  return {
    ...state,
    matchResults: {
      ...(state.matchResults || {}),
      [matchId]: {
        status: 'closed',
        closedAt: Date.now(),
        ...outcome,
      },
    },
  };
}

export function tieBreakLabel(code) {
  if (code === TIE_BREAK.BUDGET_REMAINING) return 'Tie — higher remaining purse';
  if (code === TIE_BREAK.DETERMINISTIC) return 'Tie — scoreline draw (deterministic toss)';
  return null;
}