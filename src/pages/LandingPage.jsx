import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useAuction } from "../contexts/AuctionContext";
import {
  getActiveServer,
  getRtdb,
  getAvailableServers,
  goOfflineServer,
  goOfflineAllServers,
  isServerAvailable,
} from "../lib/firebase";
import {
  fetchUserHistory,
  deleteUserHistoryEntry,
  deleteAuctionRecord,
  getPublicRooms,
  invalidatePublicRoomsCache,
  fetchPlatformStats,
  isDirectoryApiConfigured,
} from "../lib/directoryApi";
import {
  filterPublicRooms,
  countPublicRoomsOnServer,
  countDiscoverablePublicRooms,
} from "../lib/publicRoomsFilter";
import { formatPublicRoomOccupancy } from "../lib/publicRoomDisplay";
import { generateRoomCode, normalizeRoomCode, generateSoloRoomCode } from "../lib/roomCodes";
import { ref, remove } from "firebase/database";
import {
  DEFAULT_AUCTION_SERVER,
  SERVER_LOCAL,
  getPreferredServer,
  getServerFromSearch,
  getServerMeta,
  normalizeServer,
  setPreferredServer,
  withServerParam,
} from "../lib/auctionServers";
import { localAuctionReducer, saveLocalSoloRoom, listLocalSoloRooms, deleteLocalSoloRoom } from "../lib/localAuctionEngine";
import { FEATURE_MULTIPLAYER, isDirectoryConfigured } from "../lib/appConfig";
import { IPL_PLAYERS } from "../data/players";
import { TEAMS } from "../data/teams";
import {
  Zap,
  Loader2,
  Users,
  Trophy,
  Crown,
  ChevronRight,
  ChevronDown,
  Check,
  Star,
  Bot,
  Sparkles,
  Wifi,
  Globe,
  History,
  Trash2,
  RefreshCw,
  Clock,
  Plus,
  Cloud,
} from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog";
import PlayersUnderHammer from "../components/PlayersUnderHammer";
import { Brand, LivePill, TeamMark } from "../components/figma/FigmaShell";
import Footer from "../components/Footer";
import AdSlot from "../components/AdSlot";
import ServerSwitcher from "../components/ServerSwitcher";
import PageBackground from "../components/PageBackground";
import useDocumentTitle from "../hooks/useDocumentTitle";
import {
  computeTeamSpent,
  countOverseas,
  formatCrores,
  isOverseasPlayer,
  toFiniteNumber,
} from "../lib/auctionDisplay";

/** Device-local solo saves shaped like the cloud history rows. */
const buildLocalHistorySessions = (userId) =>
  listLocalSoloRooms()
    .filter(({ state }) => {
      if (!state || !state.id) return false;
      if (!userId) return true;
      return (
        !state.hostId ||
        state.hostId === userId ||
        String(state.hostId).startsWith("guest_") ||
        (state.players || []).some((p) => p?.id === userId)
      );
    })
    .map(({ state, savedAt }) => {
      const teams = state.roomTeams || state.teams || [];
      const humanTeam =
        teams.find((t) => t.userId === state.hostId) ||
        teams.find((t) => !String(t.userId || "").startsWith("bot_")) ||
        teams[0];
      const totalBudget = toFiniteNumber(state.settings?.budget, 120);
      const squad = (humanTeam?.squad || [])
        .map((entry) => {
          const pid = typeof entry === "string" ? entry : entry.id;
          const info = IPL_PLAYERS.find((p) => p.id === pid);
          return {
            id: pid,
            name: info?.name || pid,
            role: info?.role || "Player",
            image: info?.image || "",
            country: info?.country,
            type: info?.type,
            bid: typeof entry === "string" ? null : (entry.bid ?? null),
          };
        })
        .filter((p) => p.id);

      return {
        id: `local_${state.id}`,
        roomId: state.id,
        server: SERVER_LOCAL,
        teamId: humanTeam?.teamId || "",
        teamName: humanTeam?.teamName || "Manager",
        mode: state.auctionType || "mega",
        status: state.status || "active",
        budgetRemaining: humanTeam?.budgetRemaining ?? null,
        spent: computeTeamSpent({
          budget: totalBudget,
          budgetRemaining: humanTeam?.budgetRemaining,
          spent: humanTeam?.spent,
        }),
        overseasLimit: toFiniteNumber(state.overseasLimit, 8),
        squadLimit: toFiniteNumber(state.squadLimit, 25),
        squad,
        date: new Date(savedAt || Date.now()).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        isLocal: true,
      };
    });

/** Local copy wins so an in-progress solo save stays resumable. */
const mergeHistorySessions = (localSessions, remoteSessions) => {
  const localRoomIds = new Set(localSessions.map((s) => s.roomId));
  return [
    ...localSessions,
    ...(remoteSessions || []).filter((s) => !localRoomIds.has(s.roomId)),
  ];
};

const isSessionLocal = (session) =>
  Boolean(
    session?.isLocal ||
    session?.server === SERVER_LOCAL ||
    normalizeServer(session?.server) === SERVER_LOCAL ||
    String(session?.id || "").startsWith("local_") ||
    String(session?.roomId || "").startsWith("SOLO-")
  );

const LandingPage = () => {
  useDocumentTitle(
    "Play Hub | IPL Auction Game — Create, Join & History",
    "Create auction rooms, join public lobbies, and review your squad history in the IPL Auction Game play hub.",
  );

  const location = useLocation();
  const activeTab = useMemo(() => {
    if (location.pathname.endsWith("/join")) return "join";
    if (location.pathname.endsWith("/history")) return "history";
    return "new";
  }, [location.pathname]);

  const playTabClass = (tab) =>
    `pb-3 px-3 sm:pb-3.5 sm:px-5 font-black text-[11px] sm:text-xs uppercase tracking-wider transition-all duration-200 border-b-2 relative shrink-0 ${
      activeTab === tab
        ? "border-[var(--fs-accent)] text-white"
        : "border-transparent text-[var(--fs-dim)] hover:text-white"
    }`;

  const [selectedTeam, setSelectedTeam] = useState("MI");
  const [auctionType, setAuctionType] = useState("mega");
  const [playSolo, setPlaySolo] = useState(!FEATURE_MULTIPLAYER);
  const [isPublicRoom, setIsPublicRoom] = useState(true);
  const [adminLayout, setAdminLayout] = useState("host_plays");
  const [hostAsAuctionManager, setHostAsAuctionManager] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyFilter, setHistoryFilter] = useState("all");

  const availableServers = useMemo(() => getAvailableServers(), []);
  const [selectedServer, setSelectedServer] = useState(() => {
    const hinted = getServerFromSearch(window.location.search);
    if (hinted && isServerAvailable(hinted)) return hinted;
    const preferred = getPreferredServer();
    return isServerAvailable(preferred) ? preferred : DEFAULT_AUCTION_SERVER;
  });

  const handleServerChange = (server) => {
    if (!isServerAvailable(server)) return;
    setSelectedServer(server);
    setNotice("");
    // Keep the URL in sync so a refresh does not snap back to an older hint.
    const url = new URL(window.location.href);
    url.searchParams.set("server", server);
    window.history.replaceState({}, "", url);
  };

  useEffect(() => {
    setPreferredServer(selectedServer);
  }, [selectedServer]);

  // Live Public Rooms state (Cloudflare D1 directory)
  const [publicRooms, setPublicRooms] = useState([]);
  const [publicRoomsLoading, setPublicRoomsLoading] = useState(false);
  const [publicRoomsError, setPublicRoomsError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState("all");

  const filteredPublicRooms = useMemo(
    () =>
      filterPublicRooms(publicRooms, {
        searchQuery,
        filterMode,
        selectedServer,
      }),
    [publicRooms, searchQuery, filterMode, selectedServer],
  );

  const serverRoomsCount = useMemo(
    () => countPublicRoomsOnServer(publicRooms, selectedServer),
    [publicRooms, selectedServer],
  );

  const discoverablePublicRoomsCount = useMemo(
    () => countDiscoverablePublicRooms(publicRooms),
    [publicRooms],
  );

  const publicLobbyEmptyHint = useMemo(() => {
    if (publicRoomsError) {
      return "Could not load the public room directory. Check your connection, click Refresh, and ensure VITE_DIRECTORY_API_URL is set in .env.";
    }
    if (!isDirectoryConfigured && !isDirectoryApiConfigured()) {
      return "Local dev needs VITE_DIRECTORY_API_URL in .env (same value as Cloudflare Pages). Without it, new rooms are not listed for other tabs or players. Restart npm run dev after adding it.";
    }
    if (
      discoverablePublicRoomsCount > 0 &&
      filteredPublicRooms.length === 0 &&
      serverRoomsCount === 0
    ) {
      return `There are ${discoverablePublicRoomsCount} public room(s) on other servers. Switch the server selector above to match where the host created the room, then refresh.`;
    }
    return `No open public rooms on ${getServerMeta(selectedServer).label} right now. Create one to get started! Hosts must stay in the lobby so waiting rooms stay visible.`;
  }, [
    publicRoomsError,
    discoverablePublicRoomsCount,
    filteredPublicRooms.length,
    serverRoomsCount,
    selectedServer,
  ]);

  // Aggregated platform stats (zero row egress — HEAD count query only)
  const [auctionStats, setAuctionStats] = useState({
    activeCount: 0,
    totalRecent: 0,
  });

  // History state
  const [historyData, setHistoryData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [expandedSession, setExpandedSession] = useState(null);
  const [sessionToDelete, setSessionToDelete] = useState(null);

  // Solo (zero-backend) deploys have no Google sign-in, so the guest name
  // form is the front door and is shown immediately.
  const [isGuestMode, setIsGuestMode] = useState(!FEATURE_MULTIPLAYER);
  const [guestName, setGuestName] = useState("");
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    const checkCooldown = () => {
      const cooldownUntil = parseInt(localStorage.getItem('thegavel_room_cooldown_until') || '0', 10);
      const rem = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownRemaining(rem);
    };
    checkCooldown();
    const interval = setInterval(checkCooldown, 1000);
    return () => clearInterval(interval);
  }, []);

  const { user, loginWithGoogle, loginAsGuest, logout } = useAuth();
  const { createRoom, joinRoomDb } = useAuction();
  const navigate = useNavigate();

  // Check for URL errors (e.g., from being kicked)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "kicked") {
      setError(
        "ACCESS DENIED: You have been removed from that hub by the host.",
      );
      // Clean up the error flag without losing the server hint.
      params.delete("error");
      const query = params.toString();
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
    }
  }, []);

  // Fetch active public rooms & synced stats from Cloudflare D1
  const fetchPublicRoomsList = useCallback(async (force = false) => {
    setPublicRoomsLoading(true);
    setPublicRoomsError(null);
    try {
      if (force) invalidatePublicRoomsCache();
      const rooms = await getPublicRooms(force);
      setPublicRooms(rooms || []);
      // Sync activeCount without firing an extra request (reads from consolidated cache)
      const stats = await fetchPlatformStats(false);
      if (stats?.activeCount !== undefined) {
        setAuctionStats(stats);
      }
    } catch (err) {
      console.warn("[landing] Failed to load public rooms", err);
      setPublicRoomsError(err?.message || "Failed to load public rooms");
    } finally {
      setPublicRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPublicRoomsList();
  }, [fetchPublicRoomsList, selectedServer]);

  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchPublicRoomsList(true);
    };
    const interval = setInterval(tick, 25_000);
    return () => clearInterval(interval);
  }, [fetchPublicRoomsList]);

  const handleJoinPublicRoom = async (room) => {
    if (!room?.id || isSubmitting) return;
    try {
      setIsSubmitting(true);
      setError("");
      const displayName = user?.displayName || "Manager";
      const resolvedServer = await joinRoomDb(room.id, user.uid, {
        name: displayName,
        team: "",
      });
      const actualServer = resolvedServer || room.server || selectedServer;
      setSelectedServer(actualServer);
      navigate(withServerParam(`/lobby/${room.id}`, actualServer));
    } catch (err) {
      console.error("[public-rooms] Failed to join:", err);
      setError(err.message || "Failed to join room. It might be full or closed.");
      setTimeout(() => setError(""), 4000);
      setIsSubmitting(false);
    }
  };

  // Fetch auction history directly from Directory API
  const historyRequestRef = useRef(false);
  const historyCacheRef = useRef(new Map());

  const fetchHistory = useCallback(async (force = false) => {
    const userId = user?.uid;
    const localSessions = buildLocalHistorySessions(userId);

    if (!userId) {
      setHistoryData(localSessions);
      setHistoryError(null);
      return;
    }

    const cached = historyCacheRef.current.get(userId);
    if (!force && cached && Date.now() - cached.timestamp < 45000) {
      setHistoryData(mergeHistorySessions(localSessions, cached.data));
      return;
    }

    // Guard against overlapping requests (and React StrictMode double effects).
    if (historyRequestRef.current) return;

    historyRequestRef.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const serverHistory = await fetchUserHistory(userId);
      const sessions = (serverHistory || []).map((t) => {
        return {
          id: t.id,
          roomId: t.roomId,
          server: t.server || "server-1",
          teamId: t.teamId,
          teamName: t.teamName,
          mode: t.mode || "mega",
          status: t.status || "waiting",
          budgetRemaining: t.budgetRemaining ?? null,
          spent: t.spent || 0,
          overseasLimit: toFiniteNumber(t.overseasLimit, 8),
          squadLimit: toFiniteNumber(t.squadLimit, 25),
          squad: (t.squad || [])
            .map((s) => {
              const pid = typeof s === "string" ? s : s.id;
              const bid = typeof s === "string" ? null : (s.bid ?? null);
              const playerInfo = IPL_PLAYERS.find((p) => p.id === pid);
              return {
                id: pid,
                name: playerInfo?.name || pid,
                role: playerInfo?.role || "Player",
                image: playerInfo?.image || "",
                country: playerInfo?.country,
                type: playerInfo?.type,
                bid,
              };
            })
            .filter((p) => p.id),
          date: t.createdAt
            ? new Date(t.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "Recent Session",
        };
      });

      historyCacheRef.current.set(userId, { data: sessions, timestamp: Date.now() });
      setHistoryData(mergeHistorySessions(localSessions, sessions));
    } catch (err) {
      console.error("[history] Failed to fetch session history:", err);
      setHistoryError("Could not load history. Showing offline sessions.");
      setHistoryData(localSessions);
    } finally {
      historyRequestRef.current = false;
      setHistoryLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    // Load once on mount or when user changes.
    fetchHistory();
  }, [user?.uid, fetchHistory]);

  const cloudSessionsCount = useMemo(
    () => historyData.filter((s) => !isSessionLocal(s)).length,
    [historyData],
  );
  const localSessionsCount = useMemo(
    () => historyData.filter((s) => isSessionLocal(s)).length,
    [historyData],
  );

  const filteredHistory = useMemo(() => {
    if (historyFilter === "all") return historyData;
    if (historyFilter === "cloud") return historyData.filter((s) => !isSessionLocal(s));
    if (historyFilter === "local") return historyData.filter((s) => isSessionLocal(s));
    return historyData.filter(
      (session) =>
        session.server === historyFilter ||
        normalizeServer(session.server) === historyFilter,
    );
  }, [historyData, historyFilter]);

  // Confirm + delete an individual session from history
  const handleDeleteHistory = async () => {
    const session = sessionToDelete;
    if (!session) return;

    const roomId = session.roomId;
    const teamDocId = session.id;

    // Optimistically update the UI immediately so no refresh is needed
    setHistoryData((prev) => prev.filter((item) => item.id !== teamDocId));
    if (expandedSession === teamDocId) setExpandedSession(null);
    setSessionToDelete(null);

    try {
      if (isSessionLocal(session)) {
        deleteLocalSoloRoom(roomId);
        await deleteAuctionRecord(roomId);
      } else {
        await deleteUserHistoryEntry(teamDocId);
        await deleteAuctionRecord(roomId);
      }
    } catch (err) {
      console.error("[history] Failed to delete auction session", err);
      // Roll back the optimistic removal if the server delete failed
      setHistoryData((prev) =>
        prev.some((item) => item.id === teamDocId) ? prev : [session, ...prev],
      );
      setError("Could not delete this room. Please try again.");
      setTimeout(() => setError(""), 3000);
      return;
    }

    // 3. Remove room from the room's own Realtime Database if still sitting in
    // waiting state. Never clean up the other server's namespace.
    if (isServerAvailable(session.server)) {
      try {
        await remove(ref(getRtdb(session.server), `auctions/${roomId}`));
      } catch (err) {
        // The Supabase rows are already gone; RTDB cleanup is best-effort.
        console.warn(
          "[history] Failed to remove deleted auction from RTDB",
          err,
        );
      } finally {
        // Deleting history must not leave a browse-time socket open.
        goOfflineServer(session.server);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await loginWithGoogle();
    } catch {
      setError("Sign-in failed. Please try again.");
      setTimeout(() => setError(""), 3000);
    }
  };

  const handleGuestSignIn = async (e) => {
    e.preventDefault();
    if (!guestName.trim()) {
      setError("Please enter a name");
      return;
    }
    setIsSubmitting(true);
    try {
      await loginAsGuest(guestName.trim());
      setIsSubmitting(false);
    } catch {
      setError("Guest login failed. Ensure Anonymous Auth is enabled.");
      setTimeout(() => setError(""), 3000);
      setIsSubmitting(false);
    }
  };

  const handleStartSoloAuction = async (e) => {
    e.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    try {
      // Disconnect all RTDB instances to guarantee zero open sockets
      goOfflineAllServers();

      const roomId = generateSoloRoomCode();
      const displayName = user.displayName || "Manager";
      const initialState = localAuctionReducer(null, {
        type: "INIT_AUCTION",
        roomId,
        humanUser: { uid: user.uid, displayName, team: selectedTeam },
        auctionType,
        settings: { bidTimer: 10 },
        bidTimer: 10,
      });

      saveLocalSoloRoom(initialState);
      navigate(withServerParam(`/auction/${roomId}`, SERVER_LOCAL));
    } catch (err) {
      console.error("[solo] Failed to launch solo auction", err);
      setError("Failed to start solo auction. Please try again.");
      setIsSubmitting(false);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    try {
      const displayName = user.displayName || "Manager";

      if (activeTab === "new") {
        if (!playSolo) {
          const cooldownUntil = parseInt(localStorage.getItem('thegavel_room_cooldown_until') || '0', 10);
          const remainingSeconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
          if (remainingSeconds > 0) {
            setError(`Please wait ${remainingSeconds}s before creating another auction room.`);
            setTimeout(() => setError(""), 4000);
            setIsSubmitting(false);
            return;
          }
        }

        let newRoomId = null;
        let result = null;

        // Collisions are rare but possible; retry with a fresh code instead of
        // letting an upsert overwrite an existing room.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const candidate = generateRoomCode();
          try {
            result = await createRoom(
              candidate,
              user.uid,
              {
                name: displayName,
                team: adminLayout === "dedicated_admin" && hostAsAuctionManager ? "" : selectedTeam,
              },
              auctionType,
              isPublicRoom,
              selectedServer,
              {
                adminLayout,
                hostAsAuctionManager:
                  adminLayout === "dedicated_admin" && hostAsAuctionManager,
              },
            );
            newRoomId = candidate;
            break;
          } catch (createError) {
            if (
              createError?.code !== "ROOM_CODE_TAKEN" ||
              attempt === 3
            ) {
              throw createError;
            }
          }
        }

        if (!newRoomId) {
          throw new Error("Could not create a room code. Please try again.");
        }

        const actualServer = result?.server || selectedServer;
        setSelectedServer(actualServer);
        if (!playSolo) {
          localStorage.setItem('thegavel_room_cooldown_until', String(Date.now() + 30000));
        }
        if (result?.fellBack) {
          setNotice(
            `${getServerMeta(result.requestedServer).label} was full, so this room was created on ${getServerMeta(actualServer).label}.`,
          );
          setTimeout(() => setNotice(""), 6000);
        }
        navigate(withServerParam(`/lobby/${newRoomId}`, actualServer));
      } else if (activeTab === "join") {
        if (!roomCode) {
          setIsSubmitting(false);
          return;
        }
        const code = normalizeRoomCode(roomCode);
        const resolvedServer = await joinRoomDb(code, user.uid, {
          name: displayName,
          team: "",
        });
        const actualServer = resolvedServer || selectedServer;
        setSelectedServer(actualServer);
        navigate(withServerParam(`/lobby/${code}`, actualServer));
      }
    } catch (error) {
      // createRoom/joinRoomDb may have opened a probe socket before failing.
      // The landing page must stay browse-only; the room page will reconnect.
      goOfflineServer(getActiveServer());
      setError(
        error.message || "Failed to create/join room. Please try again.",
      );
      setTimeout(() => setError(""), 3000);
      setIsSubmitting(false);
    }
  };

  // ─── Not Signed In: Show Google / Guest Login ───
  if (!user) {
    return (
      <div className="fs-app fs-select-page">
        <PageBackground showArt={false} />
        <div className="fs-stadium" aria-hidden="true" />

        <header className="fs-landing-header" style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", height: 84, borderBottom: "1px solid var(--fs-line)" }}>
          <Brand />
          <LivePill>{serverRoomsCount} auctions live</LivePill>
        </header>

        <div className="fs-hero">
          <p className="fs-eyebrow">{playSolo ? "Solo vs AI Bots" : "Mega Auction"} · Step 01</p>
          <h1>
            Build your legacy
            <br />
            <em>is yours.</em>
          </h1>
          <p>
            The ultimate multiplayer IPL auction simulator and game. Host live IPL
            mega auctions with friends in real-time, choose your favourite
            franchise, bid strategically, and build a championship T20 squad.
          </p>
          <div className="fs-rule-strip">
            <span>
              <b>25</b>Players squads
            </span>
            <span>
              <b>₹120</b>starting purse
            </span>
            <span>
              <b>{playSolo ? "9" : "10"}</b>{playSolo ? "AI franchises" : "franchises"}
            </span>
            <span>
              <b>{serverRoomsCount}</b>live right now
            </span>
          </div>
        </div>

        <div className="fs-panel">
          <div className="fs-panel-heading">
            <div>
              <span>Step 01 — Sign in</span>
              <h2>Enter the auction room</h2>
            </div>
            <p>Sign in to claim a franchise, invite friends and start bidding.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 border-t border-[var(--fs-line-soft)]">
            <div className="p-6 sm:p-8 border-b lg:border-b-0 lg:border-r border-[var(--fs-line-soft)]">
              <PlayersUnderHammer stats={auctionStats} />
            </div>

            <div className="p-6 sm:p-8 fs-auth">
              <div className="fs-auth-head">
                <h2>{isGuestMode ? "Guest Access" : "Welcome, Manager"}</h2>
                <p>{isGuestMode ? "Enter a name to join" : "Sign in to enter the auction hub"}</p>
              </div>

              {!isGuestMode ? (
                <div className="fs-auth-form">
                  {FEATURE_MULTIPLAYER && (
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={isSubmitting}
                      className="fs-google-btn"
                    >
                      <svg viewBox="0 0 48 48" width="19" height="19" aria-hidden="true">
                        <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
                        <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
                        <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
                        <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
                      </svg>
                      <span>Continue with Google</span>
                    </button>
                  )}

                  {FEATURE_MULTIPLAYER && (
                    <>
                      <div className="fs-auth-mark">
                        <span>or</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsGuestMode(true)}
                        className="fs-guest-btn"
                      >
                        <Users size={17} /> Join as Guest
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <form onSubmit={handleGuestSignIn} className="fs-auth-form">
                  <label className="fs-auth-field">
                    <span className="fs-label">Your manager name</span>
                    <input
                      type="text"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder="e.g. MS Dhoni"
                      className="fs-auth-input"
                      autoFocus
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="fs-primary-btn w-full"
                    style={{ minWidth: 0 }}
                  >
                    {isSubmitting ? <Loader2 size={17} className="animate-spin" /> : <span>{FEATURE_MULTIPLAYER ? "Start auction hub" : "Start solo auction"}</span>}
                  </button>
                  {FEATURE_MULTIPLAYER && (
                    <button
                      type="button"
                      onClick={() => setIsGuestMode(false)}
                      className="fs-auth-back"
                    >
                      ← Back to Google login
                    </button>
                  )}
                </form>
              )}

              {error && <p className="fs-auth-error">{error}</p>}
            </div>
          </div>
        </div>

        <AdSlot className="mt-8 mb-4 px-2.5 sm:px-4" />
        <Footer />
        <p className="fs-landing-footer">
          Fan-made simulator · Not affiliated with BCCI, the IPL or any franchise
        </p>
      </div>
    );
  }

  // ─── Signed In: Show Create / Join / History ───
  return (
    <div className="fs-app fs-select-page">
      <PageBackground showArt={false} />
      <div className="fs-stadium" aria-hidden="true" />

      <header className="fs-landing-header" style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", height: 84, borderBottom: "1px solid var(--fs-line)" }}>
        <Brand />
        <LivePill>{serverRoomsCount} auctions live</LivePill>
      </header>

      <main className="relative z-[1] pb-20">
        <div className="fs-hero">
          <p className="fs-eyebrow">{playSolo ? "Solo vs AI Bots" : "Auction Hub"} · Step 02</p>
          <h1>
            Build your legacy
            <br />
            <em>is yours.</em>
          </h1>
          <p>
            Choose your franchise, set your auction format, then create a room,
            join friends, or revisit your auction history.
          </p>
          <div className="fs-rule-strip">
            <span>
              <b>25</b>Players squads
            </span>
            <span>
              <b>₹120</b>starting purse
            </span>
            <span>
              <b>{playSolo ? "9" : "10"}</b>{playSolo ? "AI franchises" : "franchises"}
            </span>
            <span>
              <b>{serverRoomsCount}</b>live right now
            </span>
          </div>
        </div>

      <div className="fs-panel">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-stretch">
          <aside className="w-full flex flex-col p-5 sm:p-6 md:p-8 relative border-b lg:border-b-0 lg:border-r border-[var(--fs-line-soft)]">
            <PlayersUnderHammer stats={auctionStats} />
          </aside>

          <div className="min-w-0">
            <div className="fs-panel-heading flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="fs-label text-[var(--fs-accent)]">
              {activeTab === "new"
                ? "Step 02 — Your franchise"
                : activeTab === "join"
                  ? "Live lobby"
                  : "Your auction record"}
            </span>
            <h2 className="fs-display text-2xl sm:text-3xl text-[var(--fs-ink)] mt-1">
              {activeTab === "new"
                ? "Choose your franchise"
                : activeTab === "join"
                  ? "Find a room"
                  : "Auction history"}
            </h2>
          </div>
          <span className="fs-label text-[var(--fs-dim)]">
            {activeTab === "new"
              ? "Build your squad. Own the auction."
              : activeTab === "join"
                ? "Join an active auction room"
                : "Review or resume your auctions"}
          </span>
            </div>
            <div className="w-full p-4 sm:p-6 md:p-8 flex flex-col">
            {FEATURE_MULTIPLAYER && availableServers.length > 1 && !(activeTab === "new" && playSolo) && (
              <div className="flex items-center justify-between gap-3 mb-4 sm:mb-6">
                <div className="min-w-0">
                  <span className="fs-label text-[var(--fs-dim)] block">
                    Auction Server
                  </span>
                  <p className="text-[8px] sm:text-[9px] text-[var(--fs-ghost)] font-medium mt-0.5">
                    Lobbies and history are separate per server.
                  </p>
                </div>
                <div className="shrink-0">
                  <ServerSwitcher
                    servers={availableServers}
                    value={selectedServer}
                    onChange={handleServerChange}
                  />
                </div>
              </div>
            )}
            {/* Flat Tab Bar Navigation: Create / Join / History */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-[var(--fs-line-soft)] mb-5 sm:mb-8 gap-3 sm:gap-4">
              <div className="flex overflow-x-auto no-scrollbar">
                <Link to="/play" className={playTabClass("new")}>
                  Create
                </Link>
                {FEATURE_MULTIPLAYER && (
                <Link
                  to="/play/join"
                  className={`${playTabClass("join")} flex items-center gap-1.5`}
                >
                  <span>Join</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold leading-none transition-colors ${
                      activeTab === "join"
                        ? "bg-white/20 text-white"
                        : "bg-[var(--fs-card)] text-[var(--fs-dim)]"
                    }`}
                  >
                    {serverRoomsCount}
                  </span>
                </Link>
                )}
                <Link to="/play/history" className={playTabClass("history")}>
                  History
                </Link>
              </div>

              {/* User Profile and Logout */}
              <div className="flex items-center gap-2 sm:gap-3 pb-3 px-4 sm:pb-3.5 sm:px-0 self-start sm:self-auto">
                {user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt={user.displayName}
                    className="w-7 h-7 rounded-full border border-[var(--fs-line)]"
                  />
                )}
                <span className="text-[10px] font-black text-[var(--fs-label)] uppercase tracking-widest">
                  {user.displayName}
                </span>
                <button
                  onClick={logout}
                  className="px-3 py-1.5 border border-[var(--fs-line)] bg-[var(--fs-card)] text-[9px] font-black text-[var(--fs-dim)] hover:text-white hover:border-white/40 uppercase tracking-widest transition-colors cursor-pointer"
                >
                  Logout
                </button>
              </div>
            </div>

            {/* ─── CREATE TAB ─── */}
            {activeTab === "new" && (
              <form
                key="create-tab"
                onSubmit={playSolo ? handleStartSoloAuction : handleFormSubmit}
                className="space-y-4 sm:space-y-6"
              >
                <div>
                  <div className="mb-3 ml-1">
                    <h2 className="fs-label text-[var(--fs-dim)]">
                      Franchise
                    </h2>
                    <p className="text-[9px] sm:text-[11px] text-[var(--fs-faint)] font-bold uppercase tracking-wider mt-1">
                      {playSolo
                        ? "Choose the team you'll manage against 9 AI franchises."
                        : "Choose the team you'll manage."}
                    </p>
                  </div>

                  <div className="fs-team-grid">
                    {TEAMS.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTeam(t.id)}
                        aria-label={`Select ${t.name}`}
                        aria-pressed={selectedTeam === t.id}
                        className={`fs-team-choice${selectedTeam === t.id ? " selected" : ""}`}
                      >
                        {selectedTeam === t.id && (
                          <span className="absolute top-1.5 right-1.5 text-[var(--fs-accent)]" aria-hidden="true">
                            <Check size={11} strokeWidth={3.5} />
                          </span>
                        )}
                        <TeamMark team={t} />
                        <span>{t.shortName || t.name}</span>
                        <small>{t.botName}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-3 ml-1">
                    <h2 className="fs-label text-[var(--fs-dim)]">
                      Mode
                    </h2>
                  </div>

                  <div className="fs-mode-grid">
                    <button
                      type="button"
                      onClick={() => setAuctionType("mega")}
                      aria-pressed={auctionType === "mega"}
                      className={`fs-mode-option${auctionType === "mega" ? " selected" : ""}`}
                    >
                      {auctionType === "mega" && (
                        <div className="absolute top-2 right-2 text-[var(--fs-accent)]">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Trophy size={14} className={auctionType === "mega" ? "text-[var(--fs-accent)]" : "text-[var(--fs-dim)]"} />
                        <span className="fs-display text-[13px]">Mega</span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[8px] font-bold text-[var(--fs-faint)] uppercase tracking-wide">
                        <div>25 Players</div>
                        <div>₹120 Cr Budget</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAuctionType("sprint11")}
                      aria-pressed={auctionType === "sprint11"}
                      className={`fs-mode-option${auctionType === "sprint11" ? " selected" : ""}`}
                    >
                      {auctionType === "sprint11" && (
                        <div className="absolute top-2 right-2 text-[var(--fs-accent)]">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Star size={14} className={auctionType === "sprint11" ? "text-[var(--fs-accent)]" : "text-[var(--fs-dim)]"} />
                        <span className="fs-display text-[13px]">Classic</span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[8px] font-bold text-[var(--fs-faint)] uppercase tracking-wide">
                        <div>11 Players</div>
                        <div>₹90 Cr Budget</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAuctionType("sprint5")}
                      aria-pressed={auctionType === "sprint5"}
                      className={`fs-mode-option${auctionType === "sprint5" ? " selected" : ""}`}
                    >
                      {auctionType === "sprint5" && (
                        <div className="absolute top-2 right-2 text-[var(--fs-accent)]">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Zap size={14} className={auctionType === "sprint5" ? "text-[var(--fs-accent)]" : "text-[var(--fs-dim)]"} />
                        <span className="fs-display text-[13px]">Sprint</span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[8px] font-bold text-[var(--fs-faint)] uppercase tracking-wide">
                        <div>5 Players</div>
                        <div>₹60 Cr Budget</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAuctionType("legends")}
                      aria-pressed={auctionType === "legends"}
                      className={`fs-mode-option${auctionType === "legends" ? " selected" : ""}`}
                    >
                      {auctionType === "legends" && (
                        <div className="absolute top-2 right-2 text-[var(--fs-accent)]">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Crown size={14} className={auctionType === "legends" ? "text-[var(--fs-accent)]" : "text-[var(--fs-dim)]"} />
                        <span className="fs-display text-[13px]">Legends</span>
                      </div>
                      <div className="mt-2 space-y-0.5 text-[8px] font-bold text-[var(--fs-faint)] uppercase tracking-wide">
                        <div>11 Players</div>
                        <div>₹100 Cr Budget</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Solo vs AI bots Toggle (only relevant when multiplayer is available) */}
                {FEATURE_MULTIPLAYER && (
                <div className="p-3 sm:p-4 bg-[var(--fs-card)] border border-[var(--fs-line-soft)] flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="fs-display text-[12px] flex items-center gap-1.5">
                      Solo vs AI Bots
                    </h2>
                    <p className="text-[8px] sm:text-[9px] text-[var(--fs-faint)] font-medium">
                      {playSolo
                        ? "Runs 100% on your device - no server, no room code"
                        : "Play instantly against 9 AI franchises, no server needed"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPlaySolo(!playSolo)}
                    aria-label="Toggle solo vs AI bots"
                    className={`w-10 h-5 sm:w-12 sm:h-6 rounded-full transition-colors p-1 flex items-center cursor-pointer shrink-0 ${
                      playSolo
                      ? "bg-[var(--fs-accent)] justify-end"
                      : "bg-[#1a3046] justify-start"
                    }`}
                  >
                    <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[var(--fs-deep)] shadow-md" />
                  </button>
                </div>
                )}

                {FEATURE_MULTIPLAYER && !playSolo && (
                  <div className="p-3 sm:p-4 bg-[var(--fs-card)] border border-[var(--fs-line-soft)] space-y-3">
                    <h2 className="fs-label text-[var(--fs-dim)]">
                      Room layout
                    </h2>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAdminLayout("host_plays");
                          setHostAsAuctionManager(false);
                        }}
                        className={`p-3 border text-left transition-all ${
                          adminLayout === "host_plays"
                            ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)]"
                            : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] hover:border-white/30"
                        }`}
                      >
                        <p className="text-[9px] font-black uppercase text-white tracking-wider">10-player</p>
                        <p className="text-[8px] text-[var(--fs-faint)] mt-1 font-medium">
                          Host is one of the 10 franchises and runs the auction.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdminLayout("dedicated_admin")}
                        className={`p-3 border text-left transition-all ${
                          adminLayout === "dedicated_admin"
                            ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)]"
                            : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] hover:border-white/30"
                        }`}
                      >
                        <p className="text-[9px] font-black uppercase text-white tracking-wider">10 + 1 admin</p>
                        <p className="text-[8px] text-[var(--fs-faint)] mt-1 font-medium">
                          10 bidding franchises plus a separate auction manager who cannot bid.
                        </p>
                      </button>
                    </div>
                    {adminLayout === "dedicated_admin" && (
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hostAsAuctionManager}
                          onChange={(e) => setHostAsAuctionManager(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span className="text-[8px] sm:text-[9px] text-[var(--fs-faint)] font-medium leading-relaxed">
                          I will join as the dedicated auction manager only (no franchise, no bidding).
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {/* Public Lobby Directory Toggle (Cloud Rooms only) */}
                {FEATURE_MULTIPLAYER && !playSolo && (
                  <div className="p-3 sm:p-4 bg-[var(--fs-card)] border border-[var(--fs-line-soft)] flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="fs-display text-[12px] flex items-center gap-1.5">
                        <Globe size={12} className="text-[var(--fs-dim)]" />
                        Public Lobby
                      </h2>
                      <p className="text-[8px] sm:text-[9px] text-[var(--fs-faint)] font-medium">
                        {isPublicRoom
                          ? "Visible in Public Lobbies so other players can discover and join"
                          : "Private room - only players with your room code can join"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsPublicRoom(!isPublicRoom)}
                      aria-label="Toggle public lobby"
                      className={`w-10 h-5 sm:w-12 sm:h-6 rounded-full transition-colors p-1 flex items-center cursor-pointer shrink-0 ${
                        isPublicRoom
                            ? "bg-[var(--fs-accent)] justify-end"
                            : "bg-[#1a3046] justify-start"
                      }`}
                    >
                        <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-[var(--fs-deep)] shadow-md" />
                    </button>
                  </div>
                )}

                {playSolo && (
                  <div className="p-3 sm:p-4 bg-[var(--fs-accent-dim)] border border-[var(--fs-accent)] flex items-start gap-3">
                   
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[10px] sm:text-[11px] font-black uppercase text-[var(--fs-accent)] tracking-wider">
                          Zero RTDB Load
                        </h3>
                      </div>
                      <p className="text-[8px] sm:text-[9px] text-[var(--fs-faint)] font-medium mt-0.5 leading-relaxed">
                        10s bidding timer with pause/resume and fast-forward. Runs 100% on your device and saves locally in browser storage.
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-1 sm:pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting || (cooldownRemaining > 0 && !playSolo)}
                    className="fs-primary-btn w-full"
                    style={{ minWidth: 0 }}
                  >
                    <div className="relative flex items-center justify-center gap-2 font-black uppercase tracking-[0.16em] sm:tracking-[0.2em] text-[10px] sm:text-xs">
                      {isSubmitting ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : cooldownRemaining > 0 && !playSolo ? (
                        <span>Wait {cooldownRemaining}s to Create</span>
                      ) : (
                        <>
                          <span>{playSolo ? "Start Solo Auction" : "Start Auction"}</span>
                          <ChevronRight
                            size={16}
                            className="group-hover/submit:translate-x-1 transition-transform"
                          />
                        </>
                      )}
                    </div>
                  </button>
                
                </div>
              </form>
            )}

            {/* ─── JOIN TAB ─── */}
            {activeTab === "join" && (
              <div key="join-tab" className="space-y-4 sm:space-y-6">
                <form
                  onSubmit={handleFormSubmit}
                  className="space-y-3 sm:space-y-4"
                >
                  <div className="relative group">
                    <div className="flex items-center justify-between mb-1.5 sm:mb-2 ml-1">
                      <label className="fs-label text-[var(--fs-dim)] block">
                        Room Code
                      </label>
                      <span className="fs-label text-[var(--fs-ghost)]">
                        Cloud Room
                      </span>
                    </div>
                    <input
                      type="text"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                      className="w-full bg-[var(--fs-deep-chip)] border border-[var(--fs-line)] px-4 py-4 focus:outline-none focus:border-[var(--fs-accent)] transition-colors text-white font-extrabold uppercase tracking-[0.4em] text-center text-base placeholder:tracking-[0.25em] placeholder:text-[var(--fs-ghost)] placeholder:font-bold"
                      placeholder="e.g. AB12CD"
                    />
                  </div>

                  {roomCode.trim() ? (
                    <div className="p-2 sm:p-2.5 bg-[var(--fs-accent-dim)] border border-[var(--fs-line-soft)] flex flex-wrap items-center justify-between gap-1.5 text-[8.5px] sm:text-[10px] font-mono text-[var(--fs-accent)]">
                      <div className="flex items-center gap-1.5 font-bold min-w-0">
                        <Globe size={12} className="shrink-0" />
                        <span className="truncate">Cloud Room Format</span>
                      </div>
                      <span className="text-[var(--fs-dim)] font-bold uppercase shrink-0 text-[7.5px] sm:text-[9px]">
                        Firebase RTDB Server
                      </span>
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={isSubmitting || !roomCode.trim()}
                    className="fs-primary-btn w-full"
                    style={{ minWidth: 0 }}
                  >
                    <div className="relative flex items-center justify-center gap-2 sm:gap-3 font-black uppercase tracking-[0.16em] sm:tracking-[0.2em] text-[10px] sm:text-xs">
                      {isSubmitting ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <>
                          <span>Join by Code</span>
                          <ChevronRight
                            size={16}
                            className="group-hover/submit:translate-x-1 transition-transform"
                          />
                        </>
                      )}
                    </div>
                  </button>
                </form>

                {/* Public Lobbies Directory Section */}
                <div className="relative py-1 sm:py-2 flex items-center justify-center">
                  <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[var(--fs-line-soft)]" />
                  </div>
                  <span className="relative bg-[var(--fs-card)] px-3 sm:px-4 fs-label text-[var(--fs-ghost)] flex items-center gap-1.5">
                    Or join a public lobby ({serverRoomsCount})
                  </span>
                </div>

                <div className="space-y-2.5 sm:space-y-3 pt-0 sm:pt-1">
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center justify-between">
                    <div className="relative w-full sm:flex-1 flex gap-2">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search room code or manager..."
                        className="w-full bg-[var(--fs-deep-chip)] border border-[var(--fs-line-soft)] focus:border-[var(--fs-accent)] px-3 py-2 text-[11px] text-white placeholder:text-[var(--fs-ghost)] focus:outline-none transition-colors font-medium"
                      />
                      <button
                        type="button"
                        onClick={fetchPublicRoomsList}
                        disabled={publicRoomsLoading}
                        className="flex items-center gap-1.5 px-3 py-2 border border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[8.5px] font-black uppercase tracking-widest text-[var(--fs-label)] hover:text-white hover:border-white/30 transition-colors disabled:opacity-40 cursor-pointer shrink-0"
                        title="Refresh Lobbies"
                      >
                        <RefreshCw
                          size={10}
                          className={publicRoomsLoading ? "animate-spin text-[var(--fs-accent)]" : ""}
                        />
                        Refresh
                      </button>
                    </div>

                    <div className="flex items-center gap-1 w-full sm:w-auto overflow-x-auto custom-scrollbar no-scrollbar py-0.5">
                      {[
                        { id: "all", label: "All" },
                        { id: "mega", label: "Mega" },
                        { id: "sprint11", label: "11-Classic" },
                        { id: "sprint5", label: "5-Sprint" },
                        { id: "legends", label: "Legends" },
                      ].map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setFilterMode(mode.id)}
                          className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[8px] sm:text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer shrink-0 ${
                            filterMode === mode.id
                              ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] text-white"
                              : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white"
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {publicRoomsLoading ? (
                    <div className="flex flex-col items-center justify-center h-[280px] sm:h-[340px] text-[var(--fs-dim)]">
                      <Loader2
                        size={20}
                        className="animate-spin mb-2 text-[var(--fs-accent)]"
                      />
                      <p className="fs-label text-[var(--fs-dim)]">
                        Scanning active rooms...
                      </p>
                    </div>
                  ) : filteredPublicRooms.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[280px] sm:h-[340px] text-center bg-[var(--fs-card)] border border-[var(--fs-line-soft)] p-4">
                      <p className="fs-display text-[15px] mb-1.5">
                        No Active Public Lobbies
                      </p>
                      <p className="text-[9px] sm:text-[10px] text-[var(--fs-ghost)] font-medium max-w-sm px-2">
                        {publicLobbyEmptyHint}
                      </p>
                    </div>
                  ) : (
                    <div className="h-[280px] sm:h-[340px] overflow-y-auto custom-scrollbar pr-1 space-y-2">
                      {filteredPublicRooms.map((room) => (
                        <div
                          key={room.id}
                          className="p-3.5 bg-[var(--fs-card)] hover:bg-[var(--fs-card-hi)] border border-[var(--fs-line-soft)] hover:border-white/30 transition-colors flex flex-row items-center justify-between gap-3 group"
                        >
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <h2 className="text-[10px] sm:text-xs font-bold text-white tracking-tight truncate max-w-[96px] xs:max-w-[160px] sm:max-w-none">
                                  {room.hostName}'s Room -
                                </h2>
                                <span className="text-white font-mono font-bold text-[9px] sm:text-xs tracking-wider shrink-0">
                                  {room.id}
                                </span>
                                <span
                                  className="text-[9px] sm:text-[10px] font-mono font-bold text-[var(--fs-accent)] bg-[var(--fs-accent-dim)] border border-[var(--fs-line-soft)] px-1.5 py-0.5 shrink-0"
                                  title="Franchise slots filled"
                                >
                                  {formatPublicRoomOccupancy(room)}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 sm:gap-1.5 text-[8px] sm:text-[10px] text-[var(--fs-dim)] font-medium mt-0.5 truncate">
                                <span
                                  className={`px-1.5 py-0.5 rounded font-black text-[7px] sm:text-[8px] uppercase tracking-wider shrink-0 border ${
                                    (room.status || 'waiting') === 'active'
                                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
                                      : (room.status || 'waiting') === 'paused'
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                        : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                  }`}
                                >
                                  {(room.status || 'waiting').toUpperCase()}
                                </span>

                                <span className="shrink-0">•</span>
                                <span className="text-[var(--fs-dim)] truncate">
                                  {room.type === "legends"
                                    ? "Legends"
                                    : room.type === "sprint5"
                                    ? "5-Sprint"
                                    : room.type === "sprint11"
                                      ? "11-Classic"
                                      : "Mega"}
                                </span>
                                <span className="shrink-0">•</span>
                                <span className="text-[var(--fs-ghost)] truncate">
                                  {getServerMeta(room.server).shortLabel}
                                </span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleJoinPublicRoom(room)}
                            className="flex items-center gap-1.5 px-4 py-2 border border-[var(--fs-line)] bg-[var(--fs-deep-chip)] text-white font-black text-[9.5px] uppercase tracking-wider hover:border-[var(--fs-accent)] hover:text-[var(--fs-accent)] transition-colors active:scale-95 shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            <span>Join</span>
                            <ChevronRight
                              size={12}
                              className="group-hover:translate-x-0.5 transition-transform"
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── HISTORY TAB ─── */}
            {activeTab === "history" && (
              <div key="history-tab" className="space-y-3 sm:space-y-4">
                <div className="flex items-center justify-between">
                  <span className="fs-label text-[var(--fs-ghost)]">
                    Auction History
                  </span>
                  <button
                    type="button"
                    onClick={fetchHistory}
                    disabled={historyLoading}
                    className="flex items-center gap-1.5 px-3 py-2 border border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[8.5px] font-black uppercase tracking-widest text-[var(--fs-label)] hover:text-white hover:border-white/30 transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    <RefreshCw
                      size={10}
                      className={historyLoading ? "animate-spin" : ""}
                    />
                    Refresh
                  </button>
                </div>
                {historyData.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setHistoryFilter("all")}
                      className={`px-2.5 py-1 rounded-md text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                        historyFilter === "all"
                          ? "bg-[var(--fs-accent)] text-[#06101f]"
                          : "bg-[var(--fs-card)] border border-[var(--fs-line-soft)] text-[var(--fs-dim)] hover:text-white"
                      }`}
                    >
                      All ({historyData.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter(historyFilter === "cloud" ? "all" : "cloud")}
                      className={`px-2.5 py-1 rounded-md text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                        historyFilter === "cloud"
                          ? "bg-[var(--fs-accent)] text-[#06101f]"
                          : "bg-[var(--fs-card)] border border-[var(--fs-line-soft)] text-[var(--fs-dim)] hover:text-white"
                      }`}
                    >
                      <Cloud size={11} />
                      Cloud ({cloudSessionsCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryFilter(historyFilter === "local" ? "all" : "local")}
                      className={`px-2.5 py-1 rounded-md text-[8px] sm:text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                        historyFilter === "local"
                          ? "bg-[var(--fs-accent)] text-[#06101f]"
                          : "bg-[var(--fs-card)] border border-[var(--fs-line-soft)] text-[var(--fs-dim)] hover:text-white"
                      }`}
                    >
                      <Wifi size={11} className="rotate-90" />
                      Local ({localSessionsCount})
                    </button>

                    {availableServers.map((serverKey) => {
                      const count = historyData.filter(
                        (s) => !isSessionLocal(s) && normalizeServer(s.server) === serverKey,
                      ).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={serverKey}
                          type="button"
                          onClick={() => setHistoryFilter(historyFilter === serverKey ? "cloud" : serverKey)}
                          className={`px-2 py-1 rounded-md text-[8px] sm:text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer whitespace-nowrap ${
                            historyFilter === serverKey
                              ? "bg-[var(--fs-accent)] text-[#06101f]"
                              : "bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white border border-[var(--fs-line-soft)]"
                          }`}
                        >
                          {getServerMeta(serverKey).label} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}
                {historyError && filteredHistory.length > 0 && (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
                    <span className="text-[9px] font-bold text-red-400">
                      {historyError}
                    </span>
                    <button
                      type="button"
                      onClick={fetchHistory}
                      className="text-[8px] font-black uppercase tracking-widest text-red-300 hover:text-white cursor-pointer"
                    >
                      Retry
                    </button>
                  </div>
                )}
                {historyLoading ? (
                  <div className="flex flex-col items-center justify-center py-10 sm:py-16">
                    <Loader2
                      size={26}
                      className="text-[var(--fs-accent)] animate-spin mb-3 sm:mb-4 sm:w-8 sm:h-8"
                    />
                    <p className="fs-label text-[var(--fs-dim)] mt-2 sm:mt-4">
                      Syncing Database...
                    </p>
                  </div>
                ) : historyError && filteredHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 sm:py-16 text-center">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-red-500/10 border border-red-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center mb-3 sm:mb-4">
                      <RefreshCw
                        size={22}
                        className="text-red-400 sm:w-7 sm:h-7"
                      />
                    </div>
                    <h2 className="text-xs sm:text-sm font-black text-red-400 uppercase tracking-widest mb-1">
                      History Unavailable
                    </h2>
                    <p className="fs-label text-[var(--fs-dim)] mb-4">
                      {historyError}
                    </p>
                    <button
                      type="button"
                      onClick={fetchHistory}
                      className="px-4 py-2 border border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[9px] font-black uppercase tracking-widest text-white hover:border-[var(--fs-accent)] transition-colors cursor-pointer"
                    >
                      Try Again
                    </button>
                  </div>
                ) : filteredHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 sm:py-16 text-center">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-[var(--fs-card)] border border-dashed border-[var(--fs-line-soft)] flex items-center justify-center mb-3 sm:mb-4">
                      <History size={22} className="text-[var(--fs-dim)] sm:w-7 sm:h-7" />
                    </div>
                    <h2 className="fs-display text-[15px] text-[var(--fs-label)] mb-1">
                      {historyData.length > 0 ? "No Matching Auctions" : "No Auctions Yet"}
                    </h2>
                    <p className="fs-label text-[var(--fs-ghost)] mb-3">
                      {historyData.length > 0
                        ? "No auctions found for this filter tab."
                        : "Create or join a room to start bidding!"}
                    </p>
                    {historyData.length > 0 && historyFilter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setHistoryFilter("all")}
                        className="px-3 py-1.5 bg-[var(--fs-accent)] text-[#06101f] font-black text-[9px] uppercase tracking-wider hover:brightness-110 transition-all cursor-pointer"
                      >
                        Show All Auctions ({historyData.length})
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Session List */}
                    <div className="space-y-2 sm:space-y-3 max-h-[330px] sm:max-h-[400px] overflow-y-auto custom-scrollbar pr-0.5 sm:pr-1">
                      {filteredHistory.map((session) => {
                        const teamMeta = TEAMS.find(
                          (t) => t.id === session.teamId,
                        );
                        const isExpanded = expandedSession === session.id;
                        const isCompleted = session.status === "completed";
                        const isActive = session.status === "active";
                        const overseasCount = countOverseas(
                          session.squad,
                          IPL_PLAYERS,
                        );

                        return (
                          <div key={session.id} className="space-y-1">
                            {/* Outer row: div acts as the expand toggle — avoids nested <button> HTML violation */}
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setExpandedSession(
                                  isExpanded ? null : session.id,
                                )
                              }
                              onKeyDown={(e) =>
                                (e.key === "Enter" || e.key === " ") &&
                                setExpandedSession(
                                  isExpanded ? null : session.id,
                                )
                              }
                              className={`w-full text-left p-2.5 sm:p-4 border transition-all flex items-center justify-between group cursor-pointer ${
                                isExpanded
                                  ? "bg-[var(--fs-card-hi)] border-[var(--fs-accent)] shadow-lg"
                                  : "bg-[var(--fs-card)] border-[var(--fs-line-soft)] hover:bg-[var(--fs-card-hi)]"
                              }`}
                            >
                              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                                <div className="w-8 h-8 sm:w-12 sm:h-12 bg-[var(--fs-deep-chip)] border border-[var(--fs-line-soft)] p-1 sm:p-1.5 flex items-center justify-center shrink-0">
                                  <img
                                    src={teamMeta?.logo}
                                    alt={`${teamMeta?.name || "Team"} Logo`}
                                    className="w-full h-full object-contain"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <h3 className="text-[11px] sm:text-sm font-black uppercase tracking-tight truncate">
                                    {teamMeta?.name || session.teamName}
                                  </h3>
                                  <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 mt-0.5">
                                    <span className="text-[7px] sm:text-[8px] font-bold text-gray-400 uppercase tracking-wider shrink-0">
                                      Room: {session.roomId}
                                    </span>
                                    <span className="text-[7px] sm:text-[8px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 bg-[var(--fs-accent-dim)] text-[var(--fs-accent)] border border-[var(--fs-line-soft)]">
                                      {getServerMeta(session.server).label}
                                    </span>
                                    <span className="text-[7px] sm:text-[8px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 bg-gray-500/10 text-gray-400">
                                      {session.mode}
                                    </span>
                                    <span
                                      className={`text-[7px] font-black uppercase px-1.5 py-0.5 rounded shrink-0 ${
                                        session.status === "completed"
                                          ? "bg-green-500/10 text-green-500"
                                          : session.status === "active"
                                            ? "bg-emerald-500/10 text-emerald-400"
                                            : session.status === "paused"
                                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                              : "bg-gray-500/10 text-gray-400"
                                      }`}
                                    >
                                      {session.status}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 sm:gap-4 shrink-0 ml-1.5 sm:ml-2">
                                <div className="text-right">
                                  <span className="text-[9px] sm:text-xs font-black italic text-[var(--fs-accent)] block">
                                    {session.spent === null
                                      ? "—"
                                      : `₹${formatCrores(session.spent, 1)} Cr`}
                                  </span>
                                  <span className="block text-[7px] sm:text-[8px] font-bold text-gray-400">
                                    {session.squad.length} players
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation(); // Prevent accordion toggle
                                    setSessionToDelete(session);
                                  }}
                                  title="Delete History"
                                  aria-label="Delete history"
                                  className="p-1 sm:p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                >
                                  <Trash2
                                    size={12}
                                    className="sm:w-[13px] sm:h-[13px]"
                                  />
                                </button>
                                <ChevronDown
                                  size={12}
                                  className={`text-gray-400 transition-transform duration-300 sm:w-3.5 sm:h-3.5 ${isExpanded ? "rotate-180" : ""}`}
                                />
                              </div>
                            </div>

                            {/* Expanded Squad */}
                            {isExpanded && (
                              <div className="overflow-hidden">
                                <div className="bg-[var(--fs-card)] border border-[var(--fs-line-soft)] p-2.5 sm:p-4 space-y-2 sm:space-y-3 mt-1">
                                  {isCompleted ? (
                                    <>
                                      {/* Quick Stats */}
                                      <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-3 text-[7px] sm:text-[9px] font-black uppercase tracking-tight px-1.5 py-1 bg-[var(--fs-card)] border border-[var(--fs-line-soft)]">
                                        <span className="text-gray-400">
                                          Budget Left:{" "}
                                          <span className="text-green-400">
                                            {session.budgetRemaining == null
                                              ? "—"
                                              : `₹${formatCrores(session.budgetRemaining)} Cr`}
                                          </span>
                                        </span>
                                        <span className="text-gray-400">
                                          Overseas:{" "}
                                          <span className="text-purple-400">
                                            {overseasCount}/{session.overseasLimit}
                                          </span>
                                        </span>
                                        <span className="text-gray-400">
                                          Squad:{" "}
                                          <span className="text-white">
                                            {session.squad.length}/{session.squadLimit}
                                          </span>
                                        </span>
                                      </div>

                                      {/* Players by Role */}
                                      {[
                                        "Batsman",
                                        "Wicket-Keeper",
                                        "All-Rounder",
                                        "Bowler",
                                      ].map((role) => {
                                        const rolePlayers = session.squad.filter(
                                          (p) => p?.role === role,
                                        );
                                        if (rolePlayers.length === 0) return null;

                                        return (
                                          <div key={role}>
                                            <div className="flex items-center gap-2 px-1 mb-1">
                                              <span className="text-[7px] sm:text-[8px] font-black text-[var(--fs-accent)] uppercase tracking-widest">
                                                {role}s
                                              </span>
                                              <div className="flex-1 h-px bg-[var(--fs-line-soft)]" />
                                              <span className="text-[8px] font-black text-gray-400">
                                                {rolePlayers.length}
                                              </span>
                                            </div>
                                            <div className="space-y-1">
                                              {rolePlayers.map((p, idx) => (
                                                <div
                                                  key={idx}
                                                  className="flex items-center justify-between bg-[var(--fs-deep-chip)] hover:bg-[var(--fs-card-hi)] transition-all p-1.5 sm:p-2.5"
                                                >
                                                  <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 pr-2">
                                                    <img
                                                      src={p?.image}
                                                      alt={p?.name}
                                                      className="w-5 h-5 sm:w-7 sm:h-7 object-contain bg-[var(--fs-card)] shrink-0"
                                                    />
                                                    <div className="min-w-0 flex-1">
                                                      <h4 className="text-[9px] sm:text-[11px] font-black leading-tight truncate">
                                                        {p?.name}
                                                      </h4>
                                                      <div className="flex items-center gap-1.5">
                                                        <span className="text-[7px] font-bold text-gray-400 uppercase">
                                                          {p?.type}
                                                        </span>
                                                        {isOverseasPlayer(p) && (
                                                          <Wifi
                                                            size={8}
                                                            className="text-purple-400 rotate-90 shrink-0"
                                                          />
                                                        )}
                                                      </div>
                                                    </div>
                                                  </div>
                                                  <span className="text-[8px] sm:text-[10px] font-black italic text-[var(--fs-accent)] shrink-0">
                                                    {p?.bid == null
                                                      ? "—"
                                                      : `₹${formatCrores(p.bid)} Cr`}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      })}

                                      {session.squad.length === 0 && (
                                        <p className="text-center text-[9px] sm:text-[10px] text-gray-400 font-bold py-3 sm:py-4 uppercase">
                                          No players acquired in this session
                                        </p>
                                      )}

                                      <button
                                        onClick={() =>
                                          navigate(
                                            withServerParam(
                                              `/summary/${session.roomId}`,
                                              session.server,
                                            ),
                                          )
                                        }
                                        className="w-full mt-1.5 sm:mt-2 py-2 sm:py-3 bg-[var(--fs-accent)] text-[#06101f] text-[8px] sm:text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all cursor-pointer flex items-center justify-center gap-2"
                                      >
                                        <Trophy size={12} /> View Full Summary
                                      </button>
                                    </>
                                  ) : isActive ? (
                                    <>
                                      {/* Live auction info */}
                                      <div className="flex items-start gap-2.5 px-2.5 py-2.5 bg-[var(--fs-accent-dim)] border border-[var(--fs-line-soft)]">
                                        <div className="min-w-0">
                                          <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-[var(--fs-accent)]">
                                            Auction In Progress
                                          </p>
                                          <p className="text-[8px] sm:text-[9px] text-gray-500 font-medium mt-0.5">
                                            {session.isLocal
                                              ? "Saved on this device — resume right where you left off."
                                              : "Bidding is live right now — jump back in to keep building your squad."}
                                          </p>
                                        </div>
                                      </div>

                                      <button
                                        onClick={() =>
                                          navigate(
                                            withServerParam(
                                              session.isLocal
                                                ? `/auction/${session.roomId}`
                                                : `/lobby/${session.roomId}`,
                                              session.server,
                                            ),
                                          )
                                        }
                                        className="w-full mt-1.5 sm:mt-2 py-2 sm:py-3 bg-[var(--fs-card-hi)] border border-[var(--fs-line-soft)] text-[var(--fs-ink)] text-[8px] sm:text-[10px] font-black uppercase tracking-widest hover:border-[var(--fs-accent)] transition-all cursor-pointer flex items-center justify-center gap-2"
                                      >
                                        <Zap size={12} /> Resume Auction
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      {/* Waiting room info */}
                                      <div className="flex items-start gap-2.5 px-2.5 py-2.5 bg-[var(--fs-deep-chip)] border border-[var(--fs-line-soft)]">
                                        <Clock
                                          size={14}
                                          className="text-gray-400 mt-0.5 shrink-0"
                                        />
                                        <div className="min-w-0">
                                          <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-gray-300">
                                            Auction Not Started
                                          </p>
                                          <p className="text-[8px] sm:text-[9px] text-gray-500 font-medium mt-0.5">
                                            This room is still waiting in the lobby for the host to start bidding.
                                          </p>
                                        </div>
                                      </div>

                                      <button
                                        onClick={() =>
                                          navigate(
                                            withServerParam(
                                              session.isLocal
                                                ? `/auction/${session.roomId}`
                                                : `/lobby/${session.roomId}`,
                                              session.server,
                                            ),
                                          )
                                        }
                                        className="w-full mt-1.5 sm:mt-2 py-2 sm:py-3 bg-[var(--fs-card-hi)] border border-[var(--fs-line-soft)] text-[var(--fs-ink)] text-[8px] sm:text-[10px] font-black uppercase tracking-widest hover:border-[var(--fs-accent)] transition-all cursor-pointer flex items-center justify-center gap-2"
                                      >
                                        <Zap size={12} /> Resume / Join Auction
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

            {notice && (
              <p className="mt-4 text-xs text-amber-400 font-bold text-center">
                {notice}
              </p>
            )}

            {error && (
              <p className="mt-4 text-xs text-red-500 font-bold text-center">
                {error}
              </p>
            )}
          </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!sessionToDelete}
        title="Delete This Room?"
        description="This permanently removes the room and its squad history for everyone. This action cannot be undone."
        detail={sessionToDelete ? `Room ${sessionToDelete.roomId}` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteHistory}
        onCancel={() => setSessionToDelete(null)}
      />

      <AdSlot className="mt-8 mb-4 px-2.5 sm:px-4" />

      <Footer />
      </main>
    </div>
  );
};

export default LandingPage;
