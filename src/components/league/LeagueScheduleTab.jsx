import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ThumbsUp, Users } from 'lucide-react';
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

export default function LeagueScheduleTab({
  auctionId,
  activeTeams,
  activeAuction,
  server,
  user,
}) {
  const auctionType = activeAuction?.auctionType || activeAuction?.auction_type || 'mega';
  const [store, setStore] = useState(() => loadLocalPredictions(auctionId));
  const [roundIndex, setRoundIndex] = useState(0);
  const [matchIndex, setMatchIndex] = useState(0);
  const [selectedVoterTeamId, setSelectedVoterTeamId] = useState('');

  const teamsWithSquads = useMemo(() => {
    return (activeTeams || [])
      .map((doc) => {
        const teamId = doc.teamId || doc.team_id;
        const squad = enrichSquad(doc.squad);
        if (!teamId || squad.length === 0) return null;
        const meta = TEAMS.find((t) => t.id === teamId);
        return { teamId, meta, squad, doc };
      })
      .filter(Boolean);
  }, [activeTeams]);

  const teamIds = useMemo(() => teamsWithSquads.map((t) => t.teamId), [teamsWithSquads]);

  const fixtures = useMemo(() => generateRoundRobin(teamIds), [teamIds]);
  const rounds = useMemo(() => groupFixturesByRound(fixtures), [fixtures]);
  const currentRound = rounds[roundIndex];
  const currentMatch = currentRound?.[1]?.[matchIndex];

  const uid = user?.uid;
  const myFranchiseId = uid
    ? activeAuction?.players?.find((p) => p.id === uid || p.userId === uid)?.team || ''
    : '';
  const voterTeamId = selectedVoterTeamId || myFranchiseId;

  useEffect(() => {
    if (!auctionId) return undefined;
    return subscribeLeaguePredictions(auctionId, server, setStore);
  }, [auctionId, server]);

  const votes = currentMatch ? getVotesForMatch(store, currentMatch.matchId) : {};
  const tally = currentMatch ? tallyMatchVotes(votes, currentMatch.homeId, currentMatch.awayId) : { home: 0, away: 0, total: 0 };
  const spectators = useMemo(
    () => (currentMatch ? getSpectatorTeamIds(teamIds, currentMatch.homeId, currentMatch.awayId) : []),
    [currentMatch, teamIds],
  );

  const homeData = teamsWithSquads.find((t) => t.teamId === currentMatch?.homeId);
  const awayData = teamsWithSquads.find((t) => t.teamId === currentMatch?.awayId);

  const castVote = useCallback(
    async (pick) => {
      if (!currentMatch || !voterTeamId) return;
      if (!spectators.includes(voterTeamId)) return;
      const next = setMatchVote(store, currentMatch.matchId, voterTeamId, pick);
      setStore(next);
      await publishLeaguePredictions(auctionId, server, next);
    },
    [auctionId, currentMatch, server, spectators, store, voterTeamId],
  );
  const canVote = Boolean(voterTeamId && spectators.includes(voterTeamId));
  const myPick = voterTeamId ? votes[voterTeamId] : null;

  if (teamIds.length < 2) {
    return (
      <p className="text-center text-sm text-slate-400 py-12">
        Need at least two franchises with players to generate a league schedule.
      </p>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-slate-400">
            <Calendar size={18} />
            <span className="text-[10px] font-black uppercase tracking-[0.25em]">League phase</span>
          </div>
          <h2 className="text-2xl font-pixel uppercase text-white">Match schedule & predictions</h2>
          <p className="text-xs text-slate-400 max-w-xl">
            Round-robin fixtures for {teamIds.length} teams. Franchises not playing in the selected
            match vote on the winner after comparing playing XI and bench.
          </p>
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
          {fixtures.length} fixtures · {rounds.length} rounds
        </p>
      </div>

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
          {currentRound[1].map((m, idx) => (
            <button
              key={m.matchId}
              type="button"
              onClick={() => setMatchIndex(idx)}
              className={`shrink-0 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${
                idx === matchIndex
                  ? 'bg-white text-black border-white'
                  : 'bg-white/5 border-white/10 text-slate-400'
              }`}
            >
              {TEAMS.find((t) => t.id === m.homeId)?.id} vs {TEAMS.find((t) => t.id === m.awayId)?.id}
            </button>
          ))}
        </div>
      )}

      {currentMatch && homeData && awayData && (
        <div className="grid lg:grid-cols-2 gap-4">
          <SquadColumn teamMeta={homeData.meta} squad={homeData.squad} auctionType={auctionType} side="home" />
          <SquadColumn teamMeta={awayData.meta} squad={awayData.squad} auctionType={auctionType} side="away" />
        </div>
      )}

      {currentMatch && (
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
            {myFranchiseId && !spectators.includes(myFranchiseId) && (
              <p className="text-[10px] text-amber-400/90">
                Your franchise is in this match — pick another team above to cast a commissioner vote, or spectate.
              </p>
            )}
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
              Crowd pick · {tally.total} votes
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
            <div className="flex justify-between text-[10px] font-black uppercase text-slate-400">
              <span>
                {homeData?.meta?.id} {tally.home}
              </span>
              <span>
                {awayData?.meta?.id} {tally.away}
              </span>
            </div>
          </div>

          {tally.total > 0 && (
            <ul className="grid sm:grid-cols-2 gap-1 text-[9px] text-slate-500 uppercase tracking-wide">
              {Object.entries(votes).map(([voter, pick]) => (
                <li key={voter}>
                  {TEAMS.find((t) => t.id === voter)?.id || voter} →{' '}
                  {pick === 'home' ? homeData?.meta?.id : awayData?.meta?.id}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}