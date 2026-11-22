import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areAllSquadsFilled,
  computeLeagueStandings,
  generateSemifinalFixtures,
  resolveMatchWinnerFromVotes,
  selectTopFour,
  allLeagueMatchesClosed,
  TOURNAMENT_PHASE,
  beginPlayoffs,
  closeMatchResult,
  maybeAdvancePlayoffs,
  createInitialTournamentState,
} from '../src/lib/tournamentEngine.js';
import { generateRoundRobin } from '../src/lib/leagueSchedule.js';

test('areAllSquadsFilled waits for every franchise', () => {
  const teams = [
    { teamId: 'A', squad: new Array(25).fill({ id: 'p' }) },
    { teamId: 'B', squad: new Array(24).fill({ id: 'p' }) },
  ];
  const partial = areAllSquadsFilled(teams, 25);
  assert.equal(partial.ready, false);
  teams[1].squad.push({ id: 'p' });
  const full = areAllSquadsFilled(teams, 25);
  assert.equal(full.ready, true);
});

test('resolveMatchWinnerFromVotes uses votes then purse tie-break', () => {
  const votes = { T3: 'home', T4: 'home', T5: 'away' };
  const w = resolveMatchWinnerFromVotes(votes, 'MI', 'CSK');
  assert.equal(w.winnerId, 'MI');
  assert.equal(w.tieBreak, null);

  const tied = { T3: 'home', T4: 'away' };
  const tb = resolveMatchWinnerFromVotes(tied, 'MI', 'CSK', {
    MI: { budgetRemaining: 5 },
    CSK: { budgetRemaining: 12 },
  });
  assert.equal(tb.winnerId, 'CSK');
  assert.equal(tb.tieBreak, 'budget_remaining');
});

test('league standings and top four after all fixtures closed', () => {
  const fixtures = generateRoundRobin(['A', 'B', 'C', 'D']);
  let state = createInitialTournamentState();
  state.phase = TOURNAMENT_PHASE.LEAGUE;

  fixtures.forEach((m, idx) => {
    const winner = idx % 2 === 0 ? m.homeId : m.awayId;
    state = closeMatchResult(state, m.matchId, {
      winnerId: winner,
      homeVotes: winner === m.homeId ? 2 : 0,
      awayVotes: winner === m.awayId ? 2 : 0,
    });
  });

  assert.equal(allLeagueMatchesClosed(fixtures, state.matchResults), true);
  const standings = computeLeagueStandings(fixtures, state.matchResults, ['A', 'B', 'C', 'D']);
  assert.equal(standings.length, 4);
  const top = selectTopFour(standings);
  assert.equal(top.length, 4);

  state = beginPlayoffs(state, top);
  assert.equal(state.playoff.semis.length, 2);
  assert.equal(state.playoff.semis[0].homeId, standings[0].teamId);
  assert.equal(state.playoff.semis[0].awayId, standings[3].teamId);
});

test('playoff progression to champion', () => {
  const semis = generateSemifinalFixtures(['S1', 'S2', 'S3', 'S4']);
  let state = {
    phase: TOURNAMENT_PHASE.PLAYOFFS,
    matchResults: {},
    playoff: { semis, final: null },
    championId: null,
  };
  const standings = [
    { teamId: 'S1', rank: 1 },
    { teamId: 'S2', rank: 2 },
    { teamId: 'S3', rank: 3 },
    { teamId: 'S4', rank: 4 },
  ];

  state = closeMatchResult(state, 'playoff_sf1', { winnerId: 'S1', homeVotes: 3, awayVotes: 1 });
  state = closeMatchResult(state, 'playoff_sf2', { winnerId: 'S3', homeVotes: 2, awayVotes: 1 });
  state = maybeAdvancePlayoffs(state, standings);
  assert.ok(state.playoff.final);
  assert.equal(state.playoff.final.homeId, 'S1');

  state = closeMatchResult(state, 'playoff_final', { winnerId: 'S1', homeVotes: 5, awayVotes: 2 });
  state = maybeAdvancePlayoffs(state, standings);
  assert.equal(state.phase, TOURNAMENT_PHASE.COMPLETE);
  assert.equal(state.championId, 'S1');
});