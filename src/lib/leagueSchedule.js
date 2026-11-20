/**
 * Round-robin schedule and squad split helpers for post-auction league voting.
 */

const normalizeType = (auctionType) =>
  String(auctionType || 'mega')
    .toLowerCase()
    .replace(/_/g, '-');

/** Playing XI size by auction format (bench = remainder of squad). */
export function getPlayingXISize(auctionType) {
  const t = normalizeType(auctionType);
  if (t === '5-sprint' || t === 'sprint5' || t === 'sprint-5') return 5;
  if (t === '11-classic' || t === 'legends' || t === 'classic11') return 11;
  return 11;
}

export function splitSquadByXI(squad, auctionType) {
  const list = Array.isArray(squad) ? squad : [];
  const xiSize = getPlayingXISize(auctionType);
  return {
    playingXI: list.slice(0, xiSize),
    bench: list.slice(xiSize),
    xiSize,
  };
}

/**
 * Circle-method round robin. Each team plays each other once (home/away as listed).
 * @param {string[]} teamIds — franchise ids (e.g. MI, CSK)
 */
export function generateRoundRobin(teamIds) {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (ids.length < 2) return [];

  const teams = [...ids];
  if (teams.length % 2 === 1) teams.push(null);

  const n = teams.length;
  const rounds = n - 1;
  const half = n / 2;
  const fixtures = [];

  let order = [...teams];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < half; i++) {
      const home = order[i];
      const away = order[n - 1 - i];
      if (home && away) {
        const matchId = `r${round + 1}_${home}_vs_${away}`;
        fixtures.push({
          round: round + 1,
          matchId,
          homeId: home,
          awayId: away,
        });
      }
    }
    const fixed = order[0];
    const rest = order.slice(1);
    const last = rest.pop();
    if (last !== undefined) rest.unshift(last);
    order = [fixed, ...rest];
  }

  return fixtures;
}

export function groupFixturesByRound(fixtures) {
  const map = new Map();
  fixtures.forEach((f) => {
    if (!map.has(f.round)) map.set(f.round, []);
    map.get(f.round).push(f);
  });
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

export function getSpectatorTeamIds(allTeamIds, homeId, awayId) {
  const playing = new Set([homeId, awayId]);
  return allTeamIds.filter((id) => !playing.has(id));
}

export function tallyMatchVotes(votes, homeId, awayId) {
  let home = 0;
  let away = 0;
  Object.values(votes || {}).forEach((pick) => {
    if (pick === 'home' || pick === homeId) home += 1;
    else if (pick === 'away' || pick === awayId) away += 1;
  });
  return { home, away, total: home + away };
}