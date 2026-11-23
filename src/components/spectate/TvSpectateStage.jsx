import React, { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Maximize2, Minimize2 } from 'lucide-react';
import { TEAMS } from '../../data/teams';
import { IPL_PLAYERS } from '../../data/players';
import { formatCrores, getPlayerAvatar } from '../../lib/auctionDisplay';

function TeamPaddle({ team, raised, amountLabel }) {
  return (
    <motion.div
      layout
      className={`relative flex flex-col items-center rounded-2xl border px-2 py-3 transition-colors ${
        raised
          ? 'bg-white/10 border-sky-400/50 shadow-[0_0_28px_rgba(56,189,248,0.35)]'
          : 'bg-black/40 border-white/10'
      }`}
    >
      <img src={team.logo} alt="" className="w-10 h-10 sm:w-12 sm:h-12 object-contain mb-1" />
      <span className="text-[10px] font-black uppercase tracking-widest text-white">{team.id}</span>
      <motion.div
        className="mt-2 origin-bottom"
        animate={{
          rotate: raised ? -28 : 0,
          y: raised ? -18 : 0,
          scale: raised ? 1.08 : 1,
        }}
        transition={{ type: 'spring', stiffness: 420, damping: 18 }}
      >
        <div
          className={`w-12 h-6 sm:w-14 sm:h-7 rounded-md border-2 ${
            raised ? 'bg-sky-500/90 border-sky-200' : 'bg-amber-500/30 border-amber-500/50'
          }`}
          style={{ transform: 'perspective(120px) rotateX(8deg)' }}
          title="Bid paddle"
        />
      </motion.div>
      {raised && amountLabel && (
        <motion.span
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1 text-[9px] font-black text-sky-300 uppercase tracking-wide"
        >
          {amountLabel}
        </motion.span>
      )}
    </motion.div>
  );
}

/**
 * Full-screen IPL-style TV spectate: stage, giant lot screen, franchise paddles in front.
 */
export default function TvSpectateStage({
  displayAuctionState,
  roomTeams = [],
  timerRemainingSec = null,
  onToggleFullscreen,
  isFullscreen = false,
}) {
  const playerIndex = displayAuctionState?.playerId;
  const player = useMemo(
    () => (playerIndex != null ? IPL_PLAYERS[playerIndex] : null),
    [playerIndex],
  );
  const currentBid = displayAuctionState?.currentBid ?? 0;
  const leaderId = displayAuctionState?.highBidderTeamId;
  const leaderTeam = TEAMS.find((t) => t.id === leaderId);
  const bidLabel = currentBid > 0 ? `₹${formatCrores(currentBid)} Cr` : '—';

  const franchises = useMemo(() => {
    const ids = new Set(
      (roomTeams || [])
        .map((rt) => rt.teamId || rt.team)
        .filter(Boolean),
    );
    if (ids.size > 0) {
      return TEAMS.filter((t) => ids.has(t.id));
    }
    return TEAMS;
  }, [roomTeams]);

  const lastBidTeamRef = useRef(leaderId);
  useEffect(() => {
    lastBidTeamRef.current = leaderId;
  }, [leaderId]);

  return (
    <div className="tv-spectate-root fixed inset-0 z-[200] bg-gradient-to-b from-[#0a0b12] via-[#12141f] to-black text-white overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/50 shrink-0">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-sky-400/90 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Live TV
        </p>
        {typeof onToggleFullscreen === 'function' && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white cursor-pointer"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
      </div>

      {/* Stage */}
      <div className="flex-1 flex flex-col items-center justify-end px-3 sm:px-8 pb-4 sm:pb-8 min-h-0">
        <div
          className="w-full max-w-5xl mb-6 sm:mb-10 rounded-2xl sm:rounded-3xl border border-white/15 bg-gradient-to-b from-slate-900 to-black p-1 sm:p-2 shadow-[0_40px_80px_rgba(0,0,0,0.8)]"
          style={{ transform: 'perspective(900px) rotateX(4deg)' }}
        >
          <div className="rounded-xl sm:rounded-2xl bg-black/80 border border-white/10 p-4 sm:p-8 grid sm:grid-cols-2 gap-6 items-center min-h-[200px] sm:min-h-[260px]">
            <div className="flex items-center gap-4 sm:gap-6">
              {player ? (
                <img
                  src={getPlayerAvatar(player)}
                  alt=""
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl object-cover border-2 border-white/20 shadow-lg"
                />
              ) : (
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl bg-white/5 border border-white/10" />
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">On the block</p>
                <h2 className="text-xl sm:text-3xl font-pixel text-white truncate">{player?.name || '—'}</h2>
                <p className="text-[10px] sm:text-xs text-slate-400 font-bold uppercase mt-1">
                  {player?.role} · {player?.country}
                </p>
              </div>
            </div>
            <motion.div
              key={`${leaderId}_${currentBid}`}
              initial={{ scale: 0.92, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center sm:text-right"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-400/90">Current bid</p>
              <p className="text-4xl sm:text-6xl font-black text-white tabular-nums mt-1">{bidLabel}</p>
              <AnimatePresence mode="wait">
                {leaderTeam && (
                  <motion.div
                    key={leaderId}
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -8, opacity: 0 }}
                    className="mt-3 flex items-center justify-center sm:justify-end gap-2"
                  >
                    <img src={leaderTeam.logo} alt="" className="w-8 h-8" />
                    <span className="text-sm font-black uppercase tracking-widest text-sky-300">
                      {leaderTeam.name} leading
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
              {timerRemainingSec != null && displayAuctionState?.status === 'bidding' && (
                <p className="mt-2 text-lg font-mono font-black text-emerald-400">{timerRemainingSec}s</p>
              )}
            </motion.div>
          </div>
        </div>

        <p className="text-[9px] font-black uppercase tracking-[0.4em] text-slate-500 mb-3">Franchise floor</p>
        <div className="w-full max-w-6xl grid grid-cols-3 xs:grid-cols-5 sm:grid-cols-5 lg:grid-cols-10 gap-2 sm:gap-3">
          {franchises.map((team) => (
            <TeamPaddle
              key={team.id}
              team={team}
              raised={leaderId === team.id && displayAuctionState?.status === 'bidding'}
              amountLabel={leaderId === team.id ? bidLabel : null}
            />
          ))}
        </div>
      </div>
    </div>
  );
}