import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Crown, Lock, ThumbsUp, Trophy, Users } from 'lucide-react';
import { IPL_PLAYERS } from '../../data/players';
import { TEAMS } from '../../data/teams';
import {
  generateRoundRobin,
  getSpectatorTeamIds,
  groupFixturesByRound,
  splitSquadByXI,
  tallyMatchVotes,
} from '../../lib/leagueSchedule';
import {
  getVotesForMatch,
  loadLocalPredictions,
  publishLeaguePredictions,
  setMatchVote,
  subscribeLeaguePredictions,
} from '../../lib/matchPredictions';
import {
  activateLeaguePhase,
  activePlayoffFixtures,
  allLeagueMatchesClosed,
  areAllSquadsFilled,
  beginPlayoffs,
  closeMatchResult,
  computeLeagueStandings,
  maybeAdvancePlayoffs,
  resolveMatchWinnerFromVotes,
  selectTopFour,
  tieBreakLabel,
  TOURNAMENT_PHASE,
} from '../../lib/tournamentEngine';
import {
  loadTournamentState,
  publishTournamentState,
  subscribeTournamentState,
} from '../../lib/tournamentState';
import { getPlayerAvatar, isOverseasPlayer } from '../../lib/auctionDisplay';

function enrichSquad(rawSquad) {
  const squadArr = Array.isArray(rawSquad) ? rawSquad : rawSquad ? Object.values(rawSquad) : [];
  return squadArr
    .map((s) => {
      const pid = typeof s === 'string' ? s : s.id;
      const bid = typeof s === 'string' ? null : s.bid ?? null;
      const p = IPL_PLAYERS.find((x) => x.id === pid);
      return {
        ...(p || {}),
        id: pid,
        name: p?.name || pid,
        role: p?.role || 'Player',
        bid,
      };
    })
    .filter((p) => p?.id);
}

function SquadColumn({ teamMeta, squad, auctionType, side }) {
  const { playingXI, bench } = splitSquadByXI(squad, auctionType);
  const border = side === 'home' ? 'border-emerald-500/30' : 'border-sky-500/30';

  return (
    <div className={`rounded-2xl border ${border} bg-[#0c0d10] p-4 space-y-4 min-w-0`}>
      <div className="flex items-center gap-3">
        <img src={teamMeta?.logo} alt="" className="w-10 h-10 object-contain" />
        <div className="min-w-0">
          <h3 className="font-pixel text-sm uppercase truncate text-white">{teamMeta?.name}</h3>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
            {side === 'home' ? 'Home' : 'Away'}
          </p>
        </div>
      </div>
      <SquadBlock title="Playing XI" players={playingXI} />
      {bench.length > 0 && <SquadBlock title="Bench" players={bench} muted />}
    </div>
  );
}

function SquadBlock({ title, players, muted = false }) {
  if (!players.length) return null;
  return (
    <div>
      <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${muted ? 'text-slate-500' : 'text-slate-300'}`}>
        {title} ({players.length})
      </p>
      <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-slate-300 bg-white/[0.03] rounded-lg px-2 py-1.5"
          >
            <img
              src={p.image || getPlayerAvatar(p.name)}
              alt=""
              className="w-7 h-7 rounded-md object-cover bg-black/40"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = getPlayerAvatar(p.name);
              }}
            />
            <span className="truncate flex-1">{p.name}</span>
            <span className="text-slate-500 shrink-0">{p.role}</span>
            {isOverseasPlayer(p) && <span className="text-purple-400 text-[8px]">OS</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StandingsTable({ standings }) {
  if (!standings.length) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0c0d10] overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
        <Trophy size={16} className="text-amber-400" />
        <h3 className="text-xs font-black uppercase tracking-widest text-white">League standings</h3>
      </div>
      <table className="w-full text-left text-[10px] font-bold uppercase tracking-wide">
        <thead className="text-slate-500">
          <tr>
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Team</th>
            <th className="px-4 py-2 text-center">P</th>
            <th className="px-4 py-2 text-center">W</th>
            <th className="px-4 py-2 text-center">L</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.teamId} className="border-t border-white/5 text-slate-300">
              <td className="px-4 py-2 text-slate-500">{row.rank}</td>
              <td className="px-4 py-2">{TEAMS.find((t) => t.id === row.teamId)?.id || row.teamId}</td>
              <td className="px-4 py-2 text-center">{row.played}</td>
              <td className="px-4 py-2 text-center text-emerald-400">{row.wins}</td>
              <td className="px-4 py-2 text-center text-red-400/80">{row.losses}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-[9px] text-slate-500 normal-case tracking-normal">
        Top 4 advance to semifinals. Ties in standings use wins, then vote margin, then team code.
      </p>
    </div>
  );
}

function PlayoffBracket({ semis, results, finalMatch }) {
  const sf1 = results?.playoff_sf1;
  const sf2 = results?.playoff_sf2;
  const fin = results?.playoff_final;
  const winnerLabel = (id) => TEAMS.find((t) => t.id === id)?.id || id;

  return (
    <div className="grid md:grid-cols-3 gap-3 text-[10px] font-black uppercase tracking-wider">
      {(semis || []).map((m) => {
        const r = results?.[m.matchId];
        const closed = r?.status === 'closed';
        return (
          <div key={m.matchId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-1">
            <p className="text-slate-500">Semifinal · {m.seedHome} vs {m.seedAway}</p>
            <p className="text-white">{m.homeId} vs {m.awayId}</p>
            {closed ? (
              <p className="text-emerald-400">Winner: {winnerLabel(r.winnerId)}</p>
            ) : (
              <p className="text-amber-400/90">Voting open</p>
            )}
          </div>
        );
      })}
      {finalMatch && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1 md:col-span-3">
          <p className="text-amber-300 flex items-center gap-1">
            <Crown size={14} /> Final
          </p>
          <p className="text-white">{finalMatch.homeId} vs {finalMatch.awayId}</p>
          {fin?.status === 'closed' ? (
            <p className="text-emerald-400">Champion: {winnerLabel(fin.winnerId)}</p>
          ) : (
            <p className="text-slate-400">Awaiting semifinal results</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function LeagueScheduleTab({
  auctionId,
  activeTeams,
  activeAuction,
  server,
  user,
  isHost = false,
}) {
  const auctionType = activeAuction?.auctionType || activeAuction?.auction_type || 'mega';
  const squadLimit = activeAuction?.squadLimit ?? activeAuction?.squad_limit ?? 25;

  const [voteStore, setVoteStore] = useState(() => loadLocalPredictions(auctionId));
  const [tournament, setTournament] = useState(() => loadTournamentState(auctionId));
  const [viewMode, setViewMode] = useState('league');
  const [roundIndex, setRoundIndex] = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  const [playoffIndex, setPlayoffIndex] = useState(0);
  const [selectedVoterTeamId, setSelectedVoterTeamId] = useState('');

  const teamsWithSquads = useMemo(() => {
    return (activeTeams || [])
      .map((doc) => {
        const teamId = doc.teamId || doc.team_id;
        const squad = enrichSquad(doc.squad);
        if (!teamId) return null;
        const meta = TEAMS.find((t) => t.id === teamId);
        return { teamId, meta, squad, doc };
      })
      .filter(Boolean);
  }, [activeTeams]);

  const teamIds = useMemo(
    () => teamsWithSquads.filter((t) => t.squad.length > 0).map((t) => t.teamId),
    [teamsWithSquads],
  );

  const squadGate = useMemo(
    () => areAllSquadsFilled(activeTeams, squadLimit),
    [activeTeams, squadLimit],
  );

  const teamMetaById = useMemo(() => {
    const map = {};
    teamsWithSquads.forEach((t) => {
      map[t.teamId] = t.doc;
    });
    return map;
  }, [teamsWithSquads]);

  const leagueFixtures = useMemo(
    () => (squadGate.ready ? generateRoundRobin(teamIds) : []),
    [squadGate.ready, teamIds],
  );
  const rounds = useMemo(() => groupFixturesByRound(leagueFixtures), [leagueFixtures]);
  const standings = useMemo(
    () => computeLeagueStandings(leagueFixtures, tournament.matchResults, teamIds),
    [leagueFixtures, tournament.matchResults, teamIds],
  );

  const playoffFixtures = useMemo(
    () => activePlayoffFixtures(tournament, standings),
    [tournament, standings],
  );

  const currentRound = rounds[roundIndex];
  const currentLeagueMatch = currentRound?.[1]?.[matchIndex];
  const currentPlayoffMatch = playoffFixtures[playoffIndex];
  const currentMatch = viewMode === 'playoffs' ? currentPlayoffMatch : currentLeagueMatch;

  const uid = user?.uid;
  const myFranchiseId = uid
    ? activeAuction?.players?.find((p) => p.id === uid || p.userId === uid)?.team || ''
    : '';
  const voterTeamId = selectedVoterTeamId || myFranchiseId;

  useEffect(() => {
    if (!auctionId) return undefined;
    const unsubVotes = subscribeLeaguePredictions(auctionId, server, setVoteStore);
    const unsubTour = subscribeTournamentState(auctionId, server, setTournament);
    return () => {
      unsubVotes();
      unsubTour();
    };
  }, [auctionId, server]);

  useEffect(() => {
    if (!auctionId || !squadGate.ready) return;
    setTournament((prev) => {
      if (prev.phase !== TOURNAMENT_PHASE.LOCKED) return prev;
      const next = activateLeaguePhase(prev);
      publishTournamentState(auctionId, server, next);
      return next;
    });
  }, [squadGate.ready, auctionId, server]);

  useEffect(() => {
    if (tournament.phase === TOURNAMENT_PHASE.PLAYOFFS || tournament.phase === TOURNAMENT_PHASE.COMPLETE) {
      setViewMode('playoffs');
    }
  }, [tournament.phase]);

  const matchResult = currentMatch ? tournament.matchResults?.[currentMatch.matchId] : null;
  const matchClosed = matchResult?.status === 'closed';
  const votes = currentMatch && !matchClosed ? getVotesForMatch(voteStore, currentMatch.matchId) : {};
  const tally = currentMatch ? tallyMatchVotes(votes, currentMatch.homeId, currentMatch.awayId) : { home: 0, away: 0, total: 0 };
  const spectators = useMemo(
    () => (currentMatch ? getSpectatorTeamIds(teamIds, currentMatch.homeId, currentMatch.awayId) : []),
    [currentMatch, teamIds],
  );

  const homeData = teamsWithSquads.find((t) => t.teamId === currentMatch?.homeId);
  const awayData = teamsWithSquads.find((t) => t.teamId === currentMatch?.awayId);

  const persistTournament = useCallback(
    async (next) => {
      setTournament(next);
      await publishTournamentState(auctionId, server, next);
    },
    [auctionId, server],
  );

  const castVote = useCallback(
    async (pick) => {
      if (!currentMatch || matchClosed || !voterTeamId) return;
      if (!spectators.includes(voterTeamId)) return;
      const next = setMatchVote(voteStore, currentMatch.matchId, voterTeamId, pick);
      setVoteStore(next);
      await publishLeaguePredictions(auctionId, server, next);
    },
    [auctionId, currentMatch, matchClosed, server, spectators, voteStore, voterTeamId],
  );

  const closeCurrentMatch = useCallback(async () => {
    if (!isHost || !currentMatch || matchClosed) return;
    const allVotes = getVotesForMatch(voteStore, currentMatch.matchId);
    const outcome = resolveMatchWinnerFromVotes(
      allVotes,
      currentMatch.homeId,
      currentMatch.awayId,
      teamMetaById,
    );
    let next = closeMatchResult(tournament, currentMatch.matchId, outcome);
    next = maybeAdvancePlayoffs(next, standings);
    await persistTournament(next);
  }, [isHost, currentMatch, matchClosed, voteStore, teamMetaById, tournament, standings, persistTournament]);

  const startPlayoffs = useCallback(async () => {
    if (!isHost || !allLeagueMatchesClosed(leagueFixtures, tournament.matchResults)) return;
    const seeds = selectTopFour(standings);
    if (seeds.length < 4) return;
    const next = beginPlayoffs(tournament, seeds);
    await persistTournament(next);
    setViewMode('playoffs');
    setPlayoffIndex(0);
  }, [isHost, leagueFixtures, tournament, standings, persistTournament]);

  const canVote = Boolean(!matchClosed && voterTeamId && spectators.includes(voterTeamId));
  const myPick = voterTeamId && !matchClosed ? votes[voterTeamId] : null;

  if (teamIds.length < 2) {
    return (
      <p className="text-center text-sm text-slate-400 py-12">
        Need at least two franchises with players to generate a league schedule.
      </p>
    );
  }

  if (!squadGate.ready) {
    return (
      <div className="max-w-lg mx-auto text-center space-y-4 py-16 px-6 rounded-2xl border border-white/10 bg-[#0c0d10]">
        <Lock size={28} className="mx-auto text-slate-400" />
        <h2 className="text-lg font-pixel uppercase text-white">Tournament locked</h2>
        <p className="text-sm text-slate-400">
          The schedule unlocks when every franchise fills their squad ({squadGate.limit} players).
        </p>
        <p className="text-xs font-black uppercase tracking-widest text-amber-400">
          {squadGate.filled} / {squadGate.total} teams ready
        </p>
      </div>
    );
  }

  const championTeam = tournament.championId
    ? TEAMS.find((t) => t.id === tournament.championId)
    : null;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {tournament.phase === TOURNAMENT_PHASE.COMPLETE && championTeam && (
        <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-orange-500/5 p-6 flex items-center gap-4">
          <Crown className="text-amber-400 shrink-0" size={36} />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-300">Tournament champion</p>
            <h2 className="text-2xl font-pixel uppercase text-white flex items-center gap-3">
              <img src={championTeam.logo} alt="" className="w-10 h-10" />
              {championTeam.name}
            </h2>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-slate-400">
            <Calendar size={18} />
            <span className="text-[10px] font-black uppercase tracking-[0.25em]">
              {tournament.phase === TOURNAMENT_PHASE.PLAYOFFS || tournament.phase === TOURNAMENT_PHASE.COMPLETE
                ? 'Playoffs'
                : 'League phase'}
            </span>
          </div>
          <h2 className="text-2xl font-pixel uppercase text-white">Tournament schedule</h2>
          <p className="text-xs text-slate-400 max-w-xl">
            Round-robin league, then top-four semifinals and final. Non-playing franchises vote before the host
            closes each matchup.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode('league')}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border ${
              viewMode === 'league' ? 'bg-white text-black' : 'border-white/15 text-slate-400'
            }`}
          >
            League
          </button>
          <button
            type="button"
            onClick={() => setViewMode('playoffs')}
            disabled={tournament.phase === TOURNAMENT_PHASE.LEAGUE && !allLeagueMatchesClosed(leagueFixtures, tournament.matchResults)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border disabled:opacity-40 ${
              viewMode === 'playoffs' ? 'bg-white text-black' : 'border-white/15 text-slate-400'
            }`}
          >
            Playoffs
          </button>
        </div>
      </div>

      <StandingsTable standings={standings} />

      {isHost &&
        tournament.phase === TOURNAMENT_PHASE.LEAGUE &&
        allLeagueMatchesClosed(leagueFixtures, tournament.matchResults) &&
        teamIds.length >= 4 && (
          <button
            type="button"
            onClick={startPlayoffs}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-black text-xs uppercase tracking-widest"
          >
            Start playoffs (top 4)
          </button>
        )}

      {(tournament.phase === TOURNAMENT_PHASE.PLAYOFFS || tournament.phase === TOURNAMENT_PHASE.COMPLETE) && (
        <PlayoffBracket
          semis={tournament.playoff?.semis}
          results={tournament.matchResults}
          finalMatch={tournament.playoff?.final}
        />
      )}

      {viewMode === 'league' && tournament.phase !== TOURNAMENT_PHASE.COMPLETE && (
        <>
          <div className="flex flex-wrap items-center justify-center gap-2 bg-[#0c0d10] border border-white/10 rounded-2xl p-2">
            <button
              type="button"
              disabled={roundIndex <= 0}
              onClick={() => {
                setRoundIndex((i) => Math.max(0, i - 1));
                setMatchIndex(0);
              }}
              className="p-2 rounded-xl bg-white/5 disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-black uppercase tracking-widest text-white px-3">
              Round {currentRound?.[0] ?? 1}
            </span>
            <button
              type="button"
              disabled={roundIndex >= rounds.length - 1}
              onClick={() => {
                setRoundIndex((i) => Math.min(rounds.length - 1, i + 1));
                setMatchIndex(0);
              }}
              className="p-2 rounded-xl bg-white/5 disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {currentRound && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {currentRound[1].map((m, idx) => {
                const closed = tournament.matchResults?.[m.matchId]?.status === 'closed';
                return (
                  <button
                    key={m.matchId}
                    type="button"
                    onClick={() => setMatchIndex(idx)}
                    className={`shrink-0 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${
                      idx === matchIndex
                        ? 'bg-white text-black border-white'
                        : 'bg-white/5 border-white/10 text-slate-400'
                    } ${closed ? 'ring-1 ring-emerald-500/40' : ''}`}
                  >
                    {TEAMS.find((t) => t.id === m.homeId)?.id} vs {TEAMS.find((t) => t.id === m.awayId)?.id}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {viewMode === 'playoffs' && playoffFixtures.length === 0 && tournament.phase === TOURNAMENT_PHASE.LEAGUE && (
        <p className="text-center text-sm text-slate-400 py-6">
          Close every league fixture, then the host starts playoffs with the top four.
        </p>
      )}

      {viewMode === 'playoffs' && playoffFixtures.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {playoffFixtures.map((m, idx) => {
            const closed = tournament.matchResults?.[m.matchId]?.status === 'closed';
            return (
              <button
                key={m.matchId}
                type="button"
                onClick={() => setPlayoffIndex(idx)}
                className={`shrink-0 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border ${
                  idx === playoffIndex ? 'bg-white text-black' : 'bg-white/5 border-white/10 text-slate-400'
                } ${closed ? 'ring-1 ring-emerald-500/40' : ''}`}
              >
                {m.leg || m.round} · {m.homeId} vs {m.awayId}
              </button>
            );
          })}
        </div>
      )}

      {currentMatch && homeData && awayData && (
        <div className="grid lg:grid-cols-2 gap-4">
          <SquadColumn teamMeta={homeData.meta} squad={homeData.squad} auctionType={auctionType} side="home" />
          <SquadColumn teamMeta={awayData.meta} squad={awayData.squad} auctionType={auctionType} side="away" />
        </div>
      )}

      {matchClosed && matchResult && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Voting closed</p>
          <p className="text-lg font-pixel uppercase text-emerald-200">
            Winner: {TEAMS.find((t) => t.id === matchResult.winnerId)?.name || matchResult.winnerId}
          </p>
          {matchResult.tieBreak && (
            <p className="text-xs text-slate-400">{tieBreakLabel(matchResult.tieBreak)}</p>
          )}
        </div>
      )}

      {currentMatch && !matchClosed && tournament.phase !== TOURNAMENT_PHASE.COMPLETE && (
        <div className="rounded-2xl border border-white/10 bg-[#0c0d10] p-5 space-y-5">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-slate-400" />
            <h3 className="text-sm font-black uppercase tracking-widest text-white">
              Spectator predictions ({spectators.length} franchises)
            </h3>
          </div>

          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Vote as franchise</p>
            <div className="flex flex-wrap gap-2">
              {spectators.map((tid) => (
                <button
                  key={tid}
                  type="button"
                  onClick={() => setSelectedVoterTeamId(tid)}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase border ${
                    voterTeamId === tid ? 'bg-white text-black border-white' : 'border-white/15 text-slate-400'
                  }`}
                >
                  {TEAMS.find((t) => t.id === tid)?.id || tid}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              disabled={!canVote}
              onClick={() => castVote('home')}
              className={`flex-1 py-4 rounded-xl font-black uppercase text-xs tracking-widest border flex items-center justify-center gap-2 transition-all ${
                myPick === 'home'
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-white/5 border-white/15 text-slate-300 hover:bg-white/10 disabled:opacity-40'
              }`}
            >
              <ThumbsUp size={14} />
              {homeData?.meta?.name} wins
            </button>
            <button
              type="button"
              disabled={!canVote}
              onClick={() => castVote('away')}
              className={`flex-1 py-4 rounded-xl font-black uppercase text-xs tracking-widest border flex items-center justify-center gap-2 transition-all ${
                myPick === 'away'
                  ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                  : 'bg-white/5 border-white/15 text-slate-300 hover:bg-white/10 disabled:opacity-40'
              }`}
            >
              <ThumbsUp size={14} />
              {awayData?.meta?.name} wins
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
              Crowd pick · {tally.total} votes (open)
            </p>
            <div className="h-3 rounded-full overflow-hidden flex bg-white/10">
              <div
                className="h-full bg-emerald-500/80 transition-all"
                style={{ flexGrow: tally.total ? tally.home : 1, flexBasis: 0 }}
              />
              <div
                className="h-full bg-sky-500/80 transition-all"
                style={{ flexGrow: tally.total ? tally.away : 1, flexBasis: 0 }}
              />
            </div>
          </div>

          {isHost && (
            <button
              type="button"
              onClick={closeCurrentMatch}
              className="w-full py-3 rounded-xl border border-white/20 hover:bg-white/10 text-xs font-black uppercase tracking-widest text-white"
            >
              Close voting & record result
            </button>
          )}
          {!isHost && (
            <p className="text-[10px] text-center text-slate-500 uppercase tracking-widest">
              Host closes voting before standings / advancement update
            </p>
          )}
        </div>
      )}
    </div>
  );
}