import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Loader2, Radio, RefreshCw } from 'lucide-react';
import SiteShell from '../components/layout/SiteShell';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { FEATURE_MULTIPLAYER, isDirectoryConfigured } from '../lib/appConfig';
import { getPublicRooms, invalidatePublicRoomsCache, isDirectoryApiConfigured } from '../lib/directoryApi';
import { isPublicRoomDiscoverable } from '../lib/publicRoomsFilter';
import { formatPublicRoomOccupancy } from '../lib/publicRoomDisplay';
import { getServerMeta } from '../lib/auctionServers';
import { buildTvWatchPath } from '../lib/watchLinks';

const HAMMER_STATUSES = new Set(['active', 'paused']);

function roomStatusLabel(status) {
  const s = String(status || 'waiting').toLowerCase();
  if (HAMMER_STATUSES.has(s)) return { text: 'LIVE HAMMER', className: 'text-red-400 border-red-500/30 bg-red-500/10' };
  return { text: 'LOBBY', className: 'text-amber-300 border-amber-500/30 bg-amber-500/10' };
}

export default function LiveNowPage() {
  useDocumentTitle('Live auctions | TheGavel', 'Watch IPL-style auctions live — no sign-in required.');

  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      if (force) invalidatePublicRoomsCache();
      const list = await getPublicRooms(force);
      setRooms(list || []);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 15_000);
    return () => clearInterval(t);
  }, [load]);

  const watchableRooms = useMemo(() => {
    const list = (rooms || []).filter(isPublicRoomDiscoverable);
    return list.sort((a, b) => {
      const aLive = HAMMER_STATUSES.has(String(a.status || '').toLowerCase()) ? 0 : 1;
      const bLive = HAMMER_STATUSES.has(String(b.status || '').toLowerCase()) ? 0 : 1;
      if (aLive !== bLive) return aLive - bLive;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }, [rooms]);

  const hammerRooms = useMemo(
    () => watchableRooms.filter((r) => HAMMER_STATUSES.has(String(r.status || '').toLowerCase())),
    [watchableRooms],
  );

  const lobbyRooms = useMemo(
    () => watchableRooms.filter((r) => !HAMMER_STATUSES.has(String(r.status || '').toLowerCase())),
    [watchableRooms],
  );

  const openTvWatch = (room) => {
    navigate(buildTvWatchPath(room.id, room.server));
  };

  const renderRoomList = (list) =>
    list.map((room) => {
      const badge = roomStatusLabel(room.status);
      return (
        <li
          key={room.id}
          className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
        >
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">
              {room.hostName}&apos;s room ·{' '}
              <span className="font-mono text-sky-300">{room.id}</span>
            </p>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide mt-1 flex flex-wrap items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded border text-[8px] ${badge.className}`}>{badge.text}</span>
              <span>{formatPublicRoomOccupancy(room)}</span>
              <span>{getServerMeta(room.server).shortLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => openTvWatch(room)}
            className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500/20 border border-sky-400/30 text-sky-200 font-black text-[10px] uppercase tracking-widest hover:bg-sky-500/30 cursor-pointer"
            title="Watch live in TV mode (no login)"
          >
            <Eye size={16} />
            Watch
          </button>
        </li>
      );
    });

  return (
    <SiteShell showBanner>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="text-center mb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.4em] text-red-400/90 flex items-center justify-center gap-2 mb-3">
            <Radio size={14} className="animate-pulse" />
            Live now
          </p>
          <h1 className="text-2xl sm:text-4xl font-pixel text-white">Watch auctions on TV</h1>
          <p className="text-sm text-slate-400 mt-3 max-w-lg mx-auto leading-relaxed">
            Public rooms only. No sign-in — tap Watch, then fullscreen for the IPL-style stage.
          </p>
          <button
            type="button"
            onClick={() => load(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 cursor-pointer"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        {!FEATURE_MULTIPLAYER && (
          <p className="text-center text-amber-400/90 text-sm font-bold mb-6">
            Multiplayer is off — configure Firebase in .env.
          </p>
        )}

        {FEATURE_MULTIPLAYER && !isDirectoryConfigured && !isDirectoryApiConfigured() && (
          <p className="text-center text-amber-400/90 text-xs font-bold mb-6 max-w-md mx-auto">
            Set VITE_DIRECTORY_API_URL in .env and restart dev, or the live list stays empty.
          </p>
        )}

        {loading && watchableRooms.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-slate-400">
            <Loader2 className="animate-spin mb-2" size={24} />
            <span className="text-[10px] font-black uppercase tracking-widest">Scanning servers…</span>
          </div>
        ) : watchableRooms.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-white/10 bg-white/[0.02] space-y-2">
            <p className="text-slate-400 font-bold text-sm">Nothing to watch yet.</p>
            <p className="text-slate-500 text-xs max-w-sm mx-auto px-4">
              Create a <strong className="text-slate-400">public</strong> room (not private), stay in the lobby, then
              Start Auction. Refresh here within ~15s.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {hammerRooms.length > 0 && (
              <section>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-red-400/90 mb-3">
                  Live hammer · {hammerRooms.length}
                </h2>
                <ul className="space-y-2">{renderRoomList(hammerRooms)}</ul>
              </section>
            )}

            {lobbyRooms.length > 0 && (
              <section>
                <h2 className="text-[11px] font-black uppercase tracking-widest text-amber-400/80 mb-1">
                  Public lobbies · {lobbyRooms.length}
                </h2>
                <p className="text-[10px] text-slate-500 mb-3">
                  Waiting to start — you can still spectate the lobby. After the host starts, this moves to Live hammer.
                </p>
                <ul className="space-y-2">{renderRoomList(lobbyRooms)}</ul>
              </section>
            )}

            {hammerRooms.length === 0 && lobbyRooms.length > 0 && (
              <p className="text-[10px] text-center text-slate-500">
                Your room shows under Lobbies until the directory updates to ACTIVE (host must use a public room). Click
                Refresh after Start Auction.
              </p>
            )}
          </div>
        )}
      </main>
    </SiteShell>
  );
}