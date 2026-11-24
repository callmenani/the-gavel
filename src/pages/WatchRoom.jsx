import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Navigate, useLocation } from 'react-router-dom';
import { Home } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAuction } from '../contexts/AuctionContext';
import useRoomServer from '../hooks/useRoomServer';
import PageLoader from '../components/PageLoader';
import PageBackground from '../components/PageBackground';
import AuctionRoom from './AuctionRoom';
import Lobby from './Lobby';
import { FEATURE_MULTIPLAYER } from '../lib/appConfig';
import { withServerParam } from '../lib/auctionServers';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { isWatchLiveAuction } from '../lib/watchSpectate';
import { isLocalRoom, loadLocalSoloRoom } from '../lib/localAuctionEngine';

/**
 * Public spectate entry: no Google/guest UI — silent anonymous auth for RTDB read.
 * Device-local SOLO-* rooms use read-only storage polling (this browser only).
 */
export default function WatchRoom() {
  const { id } = useParams();
  const location = useLocation();
  const wantTv = new URLSearchParams(location.search).get('tv') === '1';
  const [tvMode, setTvMode] = useState(wantTv);
  const [showTvPrompt, setShowTvPrompt] = useState(wantTv);
  useDocumentTitle(
    id ? `Watch #${id} | TheGavel` : 'Watch Live | TheGavel',
    'Read-only live IPL auction stream.',
    true,
  );

  const { user, loading: authLoading, loginAsSpectator } = useAuth();
  const { currentAuction, loading: auctionLoading, joinAuction } = useAuction();
  const { server, ready: serverReady } = useRoomServer(id);
  const spectateAuthStarted = useRef(false);
  const [authError, setAuthError] = useState(null);
  const [roomError, setRoomError] = useState(null);

  const isLocalSoloWatch = useMemo(
    () => isLocalRoom(id, server, Boolean(loadLocalSoloRoom(id))),
    [id, server],
  );

  useEffect(() => {
    if (!id || authLoading || !user || auctionLoading) return undefined;
    if (currentAuction?.id === id) {
      setRoomError(null);
      return undefined;
    }
    const delayMs = isLocalSoloWatch ? 2500 : 12_000;
    const timer = setTimeout(() => {
      if (!currentAuction || currentAuction.id !== id) {
        setRoomError(
          isLocalSoloWatch
            ? `Solo auction "${id}" was not found in this browser. Start it on this device, keep the game tab open, then use See live (TV) from the auction header.`
            : `Room "${id}" was not found on ${server || 'server-1'}. Use the host's real room code from Share live. Public multiplayer rooms on Server 1 — not SOLO-* for friends.`,
        );
      }
    }, delayMs);
    return () => clearTimeout(timer);
  }, [id, user, authLoading, auctionLoading, currentAuction, server, isLocalSoloWatch]);

  useEffect(() => {
    if (authLoading || user || spectateAuthStarted.current) return undefined;
    if (!FEATURE_MULTIPLAYER && !isLocalSoloWatch) return undefined;
    spectateAuthStarted.current = true;
    loginAsSpectator().catch((err) => {
      setAuthError(err?.message || 'Could not open live stream.');
    });
    return undefined;
  }, [authLoading, user, loginAsSpectator, isLocalSoloWatch]);

  useEffect(() => {
    if (!serverReady || !id || !user?.uid) return undefined;
    return joinAuction(id, user.uid, server, isLocalSoloWatch ? { spectate: true } : undefined);
  }, [id, user?.uid, joinAuction, server, serverReady, isLocalSoloWatch]);

  if (!FEATURE_MULTIPLAYER && !isLocalSoloWatch) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center relative">
        <PageBackground showArt={false} />
        <div className="relative z-10 max-w-md space-y-4">
          <h1 className="text-2xl font-black uppercase tracking-tight">Live watch unavailable</h1>
          <p className="text-sm text-slate-400 font-medium leading-relaxed">
            Spectate links need multiplayer (Firebase) configured in <code className="text-slate-300">.env</code>,
            or an active solo auction saved on this device.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-black text-xs uppercase tracking-widest rounded-xl"
          >
            <Home size={16} /> Home
          </a>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center relative">
        <PageBackground showArt={false} />
        <div className="relative z-10 max-w-md space-y-4">
          <h1 className="text-2xl font-black uppercase tracking-tight text-red-400">Stream unavailable</h1>
          <p className="text-sm text-slate-400">{authError}</p>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-black text-xs uppercase tracking-widest rounded-xl"
          >
            <Home size={16} /> Home
          </a>
        </div>
      </div>
    );
  }

  if (authLoading || !user) {
    return <PageLoader text="Opening live stream..." />;
  }

  if (roomError) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center relative">
        <PageBackground showArt={false} />
        <div className="relative z-10 max-w-lg space-y-4">
          <h1 className="text-xl font-black uppercase tracking-tight text-amber-400">Cannot open stream</h1>
          <p className="text-sm text-slate-400 leading-relaxed">{roomError}</p>
          {!isLocalSoloWatch && (
            <p className="text-xs text-slate-500">
              Example:{' '}
              <code className="text-sky-300">
                /watch/ODAUYZ?server=server-1&amp;tv=1
              </code>
            </p>
          )}
          <a
            href={isLocalSoloWatch ? '/play' : '/live'}
            className="inline-flex items-center gap-2 px-6 py-3 bg-sky-500/20 border border-sky-400/30 text-sky-200 font-black text-xs uppercase tracking-widest rounded-xl"
          >
            {isLocalSoloWatch ? 'Start solo auction' : 'Browse /live'}
          </a>
        </div>
      </div>
    );
  }

  if (!serverReady || auctionLoading || !currentAuction || currentAuction.id !== id) {
    return <PageLoader text="Loading auction..." />;
  }

  if (currentAuction.status === 'completed') {
    return <Navigate to={withServerParam(`/summary/${id}`, server)} replace />;
  }

  const enterTvMode = async () => {
    setTvMode(true);
    setShowTvPrompt(false);
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // User may decline fullscreen; TV layout still works in-window.
    }
  };

  if (isWatchLiveAuction(currentAuction)) {
    return (
      <>
        {showTvPrompt && (
          <div className="fixed inset-0 z-[300] bg-black/90 flex items-center justify-center p-6">
            <div className="max-w-md w-full rounded-2xl border border-white/15 bg-[#0c0d10] p-8 text-center space-y-5">
              <h2 className="text-xl font-black uppercase tracking-tight text-white">TV broadcast mode</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                Enter fullscreen for the IPL-style stage: big lot screen, franchise paddles, and live bid
                animations. No sign-in required.
              </p>
              <button
                type="button"
                onClick={enterTvMode}
                className="w-full py-3 rounded-xl bg-sky-500 text-black font-black text-xs uppercase tracking-widest cursor-pointer"
              >
                Enter fullscreen &amp; watch
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTvPrompt(false);
                  setTvMode(false);
                }}
                className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-slate-300 font-black text-xs uppercase tracking-widest cursor-pointer"
              >
                Watch in this window
              </button>
            </div>
          </div>
        )}
        <AuctionRoom
          entrySpectate
          externalSpectateSession
          tvSpectate={tvMode}
          onRequestTvMode={() => setShowTvPrompt(true)}
        />
      </>
    );
  }

  return <Lobby entrySpectate externalSpectateSession />;
}