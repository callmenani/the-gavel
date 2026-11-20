import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRoundRobin, getSpectatorTeamIds } from './leagueSchedule.js';

test('generateRoundRobin — 4 teams yields 6 fixtures', () => {
  const f = generateRoundRobin(['A', 'B', 'C', 'D']);
  assert.equal(f.length, 6);
  const pairs = new Set(f.map((m) => [m.homeId, m.awayId].sort().join(':')));
  assert.equal(pairs.size, 6);
});

test('spectators exclude playing teams', () => {
  const all = ['T1', 'T2', 'T3', 'T4'];
  const spec = getSpectatorTeamIds(all, 'T1', 'T2');
  assert.deepEqual(spec, ['T3', 'T4']);
});