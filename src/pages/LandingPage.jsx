import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
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
  fetchPlatformStats,
} from "../lib/directoryApi";
import { generateRoomCode, normalizeRoomCode, generateSoloRoomCode } from "../lib/roomCodes";
import { ref, remove } from "firebase/database";
import {
  DEFAULT_AUCTION_SERVER,
  SERVER_LOCAL,
  getAuctionServer,
  getPreferredServer,
  getServerFromSearch,
  getServerMeta,
  normalizeServer,
  setPreferredServer,
  withServerParam,
} from "../lib/auctionServers";
import { localAuctionReducer, saveLocalSoloRoom, listLocalSoloRooms, deleteLocalSoloRoom } from "../lib/localAuctionEngine";
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
  ArrowLeft,
  Swords,
} from "lucide-react";
import ConfirmDialog from "../components/ConfirmDialog";
import PlayersUnderHammer from "../components/PlayersUnderHammer";
import Footer from "../components/Footer";
import AdSlot from "../components/AdSlot";
import ServerSwitcher from "../components/ServerSwitcher";
import PageBackground from "../components/PageBackground";
import { Brand, LivePill, TeamMark } from "../components/figma/FigmaShell";
import useDocumentTitle from "../hooks/useDocumentTitle";
import {
  computeTeamSpent,
  countOverseas,
  formatCrores,
  isOverseasPlayer,
  toFiniteNumber,
} from "../lib/auctionDisplay";

/** Auction modes, in the order the design presents them. */
const MODES = [
  { id: "mega", label: "Mega", icon: Trophy, players: "25 Players", purse: "₹120 Cr Budget", blurb: "Full mega auction" },
  { id: "sprint11", label: "Classic", icon: Star, players: "11 Players", purse: "₹90 Cr Budget", blurb: "Eleven-player draft" },
  { id: "sprint5", label: "Sprint", icon: Zap, players: "5 Players", purse: "₹60 Cr Budget", blurb: "Fast five-player run" },
  { id: "legends", label: "Legends", icon: Crown, players: "11 Players", purse: "₹100 Cr Budget", blurb: "All-time legends XI" },
];

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
    "CrickAuction - Multiplayer T20 Auction Simulator | Fan-Made Cricket Game",
    "An independent, fan-made multiplayer T20 cricket auction simulator. Host tactical auctions with friends, manage squad budgets, and draft your dream T20 squad."
  );

  const [selectedTeam, setSelectedTeam] = useState("MI");
  const [activeTab, setActiveTab] = useState("new");
  const [auctionType, setAuctionType] = useState("mega");
  const [playSolo, setPlaySolo] = useState(false);
  const [isPublicRoom, setIsPublicRoom] = useState(true);
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

  const filteredPublicRooms = useMemo(() => {
    return publicRooms.filter((room) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (room.id && room.id.toLowerCase().includes(q)) ||
        (room.hostName && room.hostName.toLowerCase().includes(q));

      const matchesMode =
        filterMode === "all" ||
        (room.type || "mega").toLowerCase() === filterMode.toLowerCase();

      const matchesServer =
        normalizeServer(room.server) === normalizeServer(selectedServer);

      const matchesHostOnline = room.hostOnline !== false;

      return matchesSearch && matchesMode && matchesServer && matchesHostOnline;
    });
  }, [publicRooms, searchQuery, filterMode, selectedServer]);

  // Client-side active room count for the selected server
  const serverRoomsCount = useMemo(() => {
    return publicRooms.filter(
      (room) =>
        normalizeServer(room.server) === normalizeServer(selectedServer) &&
        room.hostOnline !== false
    ).length;
  }, [publicRooms, selectedServer]);

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

  const [isGuestMode, setIsGuestMode] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    const checkCooldown = () => {
      const cooldownUntil = parseInt(localStorage.getItem('crickauction_room_cooldown_until') || '0', 10);
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
        "ACCESS DENIED: You have been removed from that hub by the host."
      );
      // Clean up the error flag without losing the server hint.
      params.delete("error");
      const query = params.toString();
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${query ? `?${query}` : ""}`
      );
    }
  }, []);

  // Client-side cache for platform stats (5-minute TTL to eliminate egress)
  const statsCacheRef = useRef({ data: null, timestamp: 0 });

  const fetchAuctionStats = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && statsCacheRef.current.data && now - statsCacheRef.current.timestamp < 300000) {
      setAuctionStats(statsCacheRef.current.data);
      return;
    }

    try {
      const stats = await fetchPlatformStats(force);
      statsCacheRef.current = { data: stats, timestamp: Date.now() };
      setAuctionStats(stats);
    } catch {
      // Best-effort stats - UI falls back to animated activity indicator
    }
  }, []);

  // Fetch active public rooms & synced stats from Cloudflare D1
  const fetchPublicRoomsList = useCallback(async (force = false) => {
    setPublicRoomsLoading(true);
    setPublicRoomsError(null);
    try {
      const rooms = await getPublicRooms(force);
      setPublicRooms(rooms || []);
      // Sync activeCount without firing an extra request (reads from consolidated cache)
      const stats = await fetchPlatformStats(false);
      if (stats?.activeCount !== undefined) {
        setAuctionStats(stats);
      }
    } catch (err) {
      console.warn("[landing] Failed to load public rooms", err);
      setPublicRoomsError("Failed to load public rooms");
    } finally {
      setPublicRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPublicRoomsList();
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
    [historyData]
  );
  const localSessionsCount = useMemo(
    () => historyData.filter((s) => isSessionLocal(s)).length,
    [historyData]
  );

  const filteredHistory = useMemo(() => {
    if (historyFilter === "all") return historyData;
    if (historyFilter === "cloud") return historyData.filter((s) => !isSessionLocal(s));
    if (historyFilter === "local") return historyData.filter((s) => isSessionLocal(s));
    return historyData.filter(
      (session) =>
        session.server === historyFilter ||
        normalizeServer(session.server) === historyFilter
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
        prev.some((item) => item.id === teamDocId) ? prev : [session, ...prev]
      );
      setError("Could not delete this room. Please try again.");
      setTimeout(() => setError(""), 3000);
      return;
    }

    // Remove room from the room's own Realtime Database if still sitting in
    // waiting state. Never clean up the other server's namespace.
    if (isServerAvailable(session.server)) {
      try {
        await remove(ref(getRtdb(session.server), `auctions/${roomId}`));
      } catch (err) {
        // The Supabase rows are already gone; RTDB cleanup is best-effort.
        console.warn("[history] Failed to remove deleted auction from RTDB", err);
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
          const cooldownUntil = parseInt(localStorage.getItem('crickauction_room_cooldown_until') || '0', 10);
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
              { name: displayName, team: selectedTeam },
              auctionType,
              isPublicRoom,
              selectedServer
            );
            newRoomId = candidate;
            break;
          } catch (createError) {
            if (createError?.code !== "ROOM_CODE_TAKEN" || attempt === 3) {
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
          localStorage.setItem('crickauction_room_cooldown_until', String(Date.now() + 30000));
        }
        if (result?.fellBack) {
          setNotice(
            `${getServerMeta(result.requestedServer).label} was full, so this room was created on ${getServerMeta(actualServer).label}.`
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
      setError(error.message || "Failed to create/join room. Please try again.");
      setTimeout(() => setError(""), 3000);
      setIsSubmitting(false);
    }
  };

  const activeMode = MODES.find((m) => m.id === auctionType) || MODES[0];
  const pickedTeam = TEAMS.find((t) => t.id === selectedTeam);

  const suggestedRoomCode = useMemo(() => generateRoomCode(), []);
  const displayRoomCode = roomCode.trim() ? roomCode.trim().toUpperCase() : suggestedRoomCode;

  // ─── The shared hero, used by both the signed-out and signed-in states ───
  const hero = (
    <div className="fs-hero">
      <p className="fs-eyebrow">
        {playSolo ? "Solo vs AI Bots" : `${activeMode.label} Auction`} · Step 01
      </p>
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
          <b>{activeMode.players.split(" ")[0]}</b>
          {activeMode.players.split(" ")[1]} squads
        </span>
        <span>
          <b>{activeMode.purse.split(" ")[0]}</b>
          starting purse
        </span>
        <span>
          <b>{playSolo ? "9" : "10"}</b>
          {playSolo ? "AI franchises" : "franchises"}
        </span>
        <span>
          <b>{serverRoomsCount}</b>
          live right now
        </span>
      </div>
    </div>
  );

  // ─── Not Signed In: Google / Guest login inside the selection panel ───
  if (!user) {
    return (
      <div className="fs-app fs-select-page">
        <PageBackground showArt={false} />
        <div className="fs-stadium" aria-hidden="true" />

        <header className="fs-landing-header" style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", height: 84, borderBottom: "1px solid var(--fs-line)" }}>
          <Brand />
          <LivePill>{serverRoomsCount} auctions live</LivePill>
        </header>

        {hero}

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
                    {isSubmitting ? <Loader2 size={17} className="animate-spin" /> : <span>Start auction hub</span>}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsGuestMode(false)}
                    className="fs-auth-back"
                  >
                    <ArrowLeft size={11} /> Back to Google login
                  </button>
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

  // ─── Signed In: Create / Join / History inside the selection panel ───
  return (
    <div className="fs-app fs-select-page">
      <PageBackground showArt={false} />
      <div className="fs-stadium" aria-hidden="true" />

      <header
        className="fs-landing-header"
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          height: 84,
          borderBottom: "1px solid var(--fs-line)",
        }}
      >
        <Brand />

        <div className="flex items-center gap-3 sm:gap-4">
          <LivePill className="hidden sm:flex">{serverRoomsCount} auctions live</LivePill>

          {user.photoURL && (
            <img
              src={user.photoURL}
              alt={user.displayName}
              className="w-8 h-8 rounded-full border border-[var(--fs-line)]"
            />
          )}
          <span className="hidden sm:block text-[10px] font-black text-[var(--fs-label)] uppercase tracking-widest">
            {user.displayName}
          </span>
          <button
            onClick={logout}
            className="px-3 py-1.5 border border-[var(--fs-line)] bg-[var(--fs-card)] text-[9px] font-black text-[var(--fs-dim)] hover:text-white hover:border-white/40 uppercase tracking-widest transition-colors cursor-pointer"
          >
            Logout
          </button>
        </div>
      </header>

      {hero}

      <div className="fs-panel">
        {/* ── Panel heading carries the Create / Join / History tabs ── */}
        <div className="fs-panel-heading flex-wrap gap-4">
          <div>
            <span>
              {activeTab === "new" ? "Step 02 — Your franchise" : activeTab === "join" ? "Step 02 — Join a room" : "Your record"}
            </span>
            <h2>
              {activeTab === "new" ? "Choose your franchise" : activeTab === "join" ? "Enter a room code" : "Auction ledger"}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: "new", label: "Create", icon: Plus },
              { id: "join", label: `Join (${serverRoomsCount})`, icon: Globe },
              { id: "history", label: "History", icon: History },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 border text-[9px] font-black uppercase tracking-[0.15em] transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] text-white"
                    : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white hover:border-white/30"
                }`}
              >
                <tab.icon size={12} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Server switcher (multi-server builds only) ── */}
        {availableServers.length > 1 && !(activeTab === "new" && playSolo) && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 sm:px-7 py-4 border-b border-[var(--fs-line-soft)] bg-[var(--fs-deep-chip)]">
            <div>
              <span className="fs-label text-[var(--fs-dim)]">Auction server</span>
              <p className="text-[9px] text-[var(--fs-ghost)] font-medium mt-0.5">
                Lobbies and history are separate per server.
              </p>
            </div>
            <ServerSwitcher
              servers={availableServers}
              value={selectedServer}
              onChange={handleServerChange}
            />
          </div>
        )}

        {/* ══ CREATE TAB ══ */}
        {activeTab === "new" && (
          <form onSubmit={playSolo ? handleStartSoloAuction : handleFormSubmit}>
            {/* Franchise grid — the design's 10-across strip */}
            <div className="fs-team-grid">
              {TEAMS.map((t) => {
                const isSelected = selectedTeam === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTeam(t.id)}
                    aria-label={`Select ${t.name}`}
                    aria-pressed={isSelected}
                    className={`fs-team-choice${isSelected ? " selected" : ""}`}
                  >
                    {isSelected && (
                      <span
                        className="absolute top-1.5 right-1.5 text-[var(--fs-accent)]"
                        aria-hidden="true"
                      >
                        <Check size={11} strokeWidth={3.5} />
                      </span>
                    )}
                    <TeamMark team={t} />
                    <span>{t.shortName || t.name}</span>
                    <small>{t.botName}</small>
                  </button>
                );
              })}
            </div>

            {/* Mode selection */}
            <div className="px-6 sm:px-7 py-6 border-t border-[var(--fs-line-soft)]">
              <span className="fs-label text-[var(--fs-ghost)]">Auction format</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-3">
                {MODES.map((mode) => {
                  const isSelected = auctionType === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setAuctionType(mode.id)}
                      aria-pressed={isSelected}
                      className={`text-left p-4 border transition-all cursor-pointer ${
                        isSelected
                          ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] shadow-[inset_0_-3px_var(--fs-accent)]"
                          : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] hover:border-white/30 hover:-translate-y-0.5"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <mode.icon
                          size={14}
                          className={isSelected ? "text-[var(--fs-accent)]" : "text-[var(--fs-dim)]"}
                        />
                        <span
                          className={`fs-display text-[13px] ${isSelected ? "text-white" : "text-[var(--fs-label)]"}`}
                        >
                          {mode.label}
                        </span>
                      </div>
                      <p className="mt-2 text-[8px] font-bold uppercase tracking-[0.15em] text-[var(--fs-faint)]">
                        {mode.players}
                      </p>
                      <p className="text-[8px] font-bold uppercase tracking-[0.15em] text-[var(--fs-faint)]">
                        {mode.purse}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Solo + public lobby toggles */}
            <div className="px-6 sm:px-7 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPlaySolo((v) => !v)}
                aria-pressed={playSolo}
                className={`flex items-center justify-between gap-4 p-4 border text-left transition-colors cursor-pointer ${
                  playSolo
                    ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)]"
                    : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] hover:border-white/30"
                }`}
              >
                <span className="min-w-0">
                  <span className="fs-display text-[12px] flex items-center gap-2">
                    <Bot size={14} className={playSolo ? "text-[var(--fs-accent)]" : "text-[var(--fs-dim)]"} />
                    Solo vs AI Bots
                  </span>
                  <span className="block mt-1 text-[8.5px] font-medium text-[var(--fs-faint)] leading-relaxed">
                    {playSolo
                      ? "Runs 100% on your device — no server, no room code"
                      : "Play instantly against 9 AI franchises, no server needed"}
                  </span>
                </span>
                <span
                  className={`w-11 h-6 rounded-full p-1 flex items-center shrink-0 transition-colors ${
                    playSolo ? "bg-[var(--fs-accent)] justify-end" : "bg-[#1a3046] justify-start"
                  }`}
                  aria-hidden="true"
                >
                  <span className="w-4 h-4 rounded-full bg-[var(--fs-deep)] shadow-md" />
                </span>
              </button>

              {!playSolo && (
                <button
                  type="button"
                  onClick={() => setIsPublicRoom((v) => !v)}
                  aria-pressed={isPublicRoom}
                  className={`flex items-center justify-between gap-4 p-4 border text-left transition-colors cursor-pointer ${
                    isPublicRoom
                      ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)]"
                      : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] hover:border-white/30"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="fs-display text-[12px] flex items-center gap-2">
                      <Globe size={14} className={isPublicRoom ? "text-[var(--fs-accent)]" : "text-[var(--fs-dim)]"} />
                      Public Lobby
                    </span>
                    <span className="block mt-1 text-[8.5px] font-medium text-[var(--fs-faint)] leading-relaxed">
                      {isPublicRoom
                        ? "Listed publicly so other players can discover and join"
                        : "Private room — only players with your room code can join"}
                    </span>
                  </span>
                  <span
                    className={`w-11 h-6 rounded-full p-1 flex items-center shrink-0 transition-colors ${
                      isPublicRoom ? "bg-[var(--fs-accent)] justify-end" : "bg-[#1a3046] justify-start"
                    }`}
                    aria-hidden="true"
                  >
                    <span className="w-4 h-4 rounded-full bg-[var(--fs-deep)] shadow-md" />
                  </span>
                </button>
              )}
            </div>

            {/* Hand-off bar — the design's selection-action row */}
            <div className="fs-selection-action">
              <div className="fs-picked-team">
                <TeamMark team={pickedTeam} />
                <span>
                  Your franchise
                  <b>{pickedTeam?.name}</b>
                </span>
                <span className="hidden sm:flex items-center gap-1.5 ml-3 pl-3 border-l border-[var(--fs-line-soft)] text-[var(--fs-faint)] text-[9px] font-bold uppercase tracking-wider">
                  <Swords size={11} />
                  {activeMode.label}
                </span>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || (cooldownRemaining > 0 && !playSolo)}
                className="fs-primary-btn"
              >
                {isSubmitting ? (
                  <Loader2 size={17} className="animate-spin" />
                ) : cooldownRemaining > 0 && !playSolo ? (
                  <span className="text-[11px]">Wait {cooldownRemaining}s</span>
                ) : (
                  <>
                    <span className="text-[11px] tracking-[1px] font-extrabold">
                      {playSolo ? "Start solo auction" : "Start auction"}
                    </span>
                    <span aria-hidden="true">→</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* ══ JOIN TAB ══ */}
        {activeTab === "join" && (
          <div>
            <form onSubmit={handleFormSubmit} className="px-6 sm:px-7 py-6 border-b border-[var(--fs-line-soft)]">
              <span className="fs-label text-[var(--fs-ghost)]">Room code</span>
              <div className="flex flex-col sm:flex-row gap-2.5 mt-3">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder={displayRoomCode}
                  className="flex-1 bg-[var(--fs-deep-chip)] border border-[var(--fs-line)] px-4 py-4 text-white font-extrabold text-center tracking-[0.4em] text-base placeholder:tracking-[0.25em] placeholder:text-[var(--fs-ghost)] placeholder:font-bold focus:outline-none focus:border-[var(--fs-accent)] transition-colors uppercase"
                  aria-label="Room code"
                />
                <button
                  type="submit"
                  disabled={isSubmitting || !roomCode.trim()}
                  className="fs-primary-btn"
                  style={{ minWidth: 200 }}
                >
                  {isSubmitting ? (
                    <Loader2 size={17} className="animate-spin" />
                  ) : (
                    <>
                      <span className="text-[11px] font-extrabold">Join by code</span>
                      <span aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </div>
              <p className="mt-3 text-[8.5px] font-bold uppercase tracking-[0.15em] text-[var(--fs-ghost)]">
                Cloud room · Firebase RTDB · {getServerMeta(selectedServer).label}
              </p>
            </form>

            {/* Public lobby directory */}
            <div className="px-6 sm:px-7 py-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <span className="fs-label text-[var(--fs-ghost)]">
                  Public lobbies ({serverRoomsCount})
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search room code or manager"
                    className="w-full sm:w-56 bg-[var(--fs-deep-chip)] border border-[var(--fs-line-soft)] px-3 py-2 text-[11px] text-white placeholder:text-[var(--fs-ghost)] focus:outline-none focus:border-[var(--fs-accent)] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={fetchPublicRoomsList}
                    disabled={publicRoomsLoading}
                    className="flex items-center gap-1.5 px-3 py-2 border border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[8.5px] font-black uppercase tracking-widest text-[var(--fs-label)] hover:text-white hover:border-white/30 transition-colors disabled:opacity-40 cursor-pointer"
                    title="Refresh lobbies"
                  >
                    <RefreshCw size={11} className={publicRoomsLoading ? "animate-spin text-[var(--fs-accent)]" : ""} />
                    Refresh
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mb-4">
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
                    className={`px-3 py-1.5 border text-[8.5px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                      filterMode === mode.id
                        ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] text-white"
                        : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {publicRoomsLoading ? (
                <div className="flex flex-col items-center justify-center h-[280px] text-[var(--fs-dim)]">
                  <Loader2 size={20} className="animate-spin mb-3 text-[var(--fs-accent)]" />
                  <p className="text-[9px] font-bold uppercase tracking-widest">
                    Scanning active rooms…
                  </p>
                </div>
              ) : filteredPublicRooms.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[280px] text-center border border-[var(--fs-line-soft)] bg-[var(--fs-card)] p-6">
                  <p className="fs-display text-[15px] mb-1.5">No active public lobbies</p>
                  <p className="text-[9.5px] text-[var(--fs-ghost)] font-medium max-w-xs leading-relaxed">
                    No open public rooms on {getServerMeta(selectedServer).label} right now.
                    Create one to get started.
                  </p>
                </div>
              ) : (
                <div className="h-[340px] overflow-y-auto space-y-2 pr-1">
                  {filteredPublicRooms.map((room) => (
                    <div
                      key={room.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3.5 border border-[var(--fs-line-soft)] bg-[var(--fs-card)] hover:border-white/30 hover:bg-[var(--fs-card-hi)] transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12px] font-bold text-white truncate">
                            {room.hostName}&rsquo;s Room
                          </span>
                          <span className="fs-display text-[13px] text-[var(--fs-accent)] tracking-wider">
                            {room.id}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="px-1.5 py-0.5 text-[7.5px] font-black uppercase tracking-wider bg-[#1b3a22] text-[#b9dba5]">
                            Waiting
                          </span>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--fs-faint)]">
                            {room.type === "legends"
                              ? "Legends"
                              : room.type === "sprint5"
                                ? "5-Sprint"
                                : room.type === "sprint11"
                                  ? "11-Classic"
                                  : "Mega"}
                          </span>
                          <span className="text-[9px] uppercase tracking-wider text-[var(--fs-ghost)]">
                            {getServerMeta(room.server).shortLabel}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => handleJoinPublicRoom(room)}
                        className="flex items-center gap-1.5 px-4 py-2 border border-[var(--fs-line)] bg-[var(--fs-deep-chip)] text-white font-black text-[9.5px] uppercase tracking-wider hover:border-[var(--fs-accent)] hover:text-[var(--fs-accent)] transition-colors active:scale-95 disabled:opacity-50 shrink-0 cursor-pointer"
                      >
                        Join
                        <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ HISTORY TAB ══ */}
        {activeTab === "history" && (
          <div className="px-6 sm:px-7 py-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <span className="fs-label text-[var(--fs-ghost)]">Auction history</span>
              <button
                type="button"
                onClick={fetchHistory}
                disabled={historyLoading}
                className="flex items-center gap-1.5 px-3 py-2 border border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[8.5px] font-black uppercase tracking-widest text-[var(--fs-label)] hover:text-white hover:border-white/30 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <RefreshCw size={11} className={historyLoading ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>

            {historyData.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-4">
                <button
                  type="button"
                  onClick={() => setHistoryFilter("all")}
                  className={`px-2.5 py-1.5 border text-[8.5px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                    historyFilter === "all"
                      ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] text-white"
                      : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white"
                  }`}
                >
                  All ({historyData.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter(historyFilter === "cloud" ? "all" : "cloud")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 border text-[8.5px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                    historyFilter === "cloud"
                      ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] text-white"
                      : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white"
                  }`}
                >
                  <Cloud size={11} />
                  Cloud ({cloudSessionsCount})
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter(historyFilter === "local" ? "all" : "local")}
                  className={`flex items-center gap-1 px-2.5 py-1.5 border text-[8.5px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                    historyFilter === "local"
                      ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] text-white"
                      : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white"
                  }`}
                >
                  <Wifi size={11} className="rotate-90" />
                  Local ({localSessionsCount})
                </button>

                {availableServers.map((serverKey) => {
                  const count = historyData.filter(
                    (s) => !isSessionLocal(s) && normalizeServer(s.server) === serverKey
                  ).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={serverKey}
                      type="button"
                      onClick={() =>
                        setHistoryFilter(historyFilter === serverKey ? "cloud" : serverKey)
                      }
                      className={`px-2.5 py-1.5 border text-[8.5px] font-black uppercase tracking-wider transition-colors cursor-pointer ${
                        historyFilter === serverKey
                          ? "border-[var(--fs-accent)] bg-[var(--fs-card-hi)] text-white"
                          : "border-[var(--fs-line-soft)] bg-[var(--fs-card)] text-[var(--fs-dim)] hover:text-white"
                      }`}
                    >
                      {getServerMeta(serverKey).label} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {historyError && filteredHistory.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 mb-3 border border-red-500/30 bg-red-500/10">
                <span className="text-[9.5px] font-bold text-red-300">{historyError}</span>
                <button
                  type="button"
                  onClick={fetchHistory}
                  className="text-[8.5px] font-black uppercase tracking-widest text-red-200 hover:text-white cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {historyLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 size={26} className="text-[var(--fs-accent)] animate-spin mb-4" />
                <p className="text-[9.5px] font-black text-[var(--fs-dim)] uppercase tracking-widest">
                  Syncing database…
                </p>
              </div>
            ) : historyError && filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="w-14 h-14 grid place-items-center border border-red-500/30 bg-red-500/10 mb-4">
                  <RefreshCw size={22} className="text-red-400" />
                </span>
                <h2 className="fs-display text-[17px] text-red-300 mb-1">History unavailable</h2>
                <p className="text-[9.5px] text-[var(--fs-ghost)] font-bold uppercase tracking-widest mb-5">
                  {historyError}
                </p>
                <button
                  type="button"
                  onClick={fetchHistory}
                  className="px-4 py-2 border border-[var(--fs-line)] bg-[var(--fs-card)] text-[9px] font-black uppercase tracking-widest text-white hover:border-white/40 transition-colors cursor-pointer"
                >
                  Try again
                </button>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="w-14 h-14 grid place-items-center border border-dashed border-[var(--fs-line)] bg-[var(--fs-card)] mb-4">
                  <History size={22} className="text-[var(--fs-dim)]" />
                </span>
                <h2 className="fs-display text-[17px] mb-1">
                  {historyData.length > 0 ? "No matching auctions" : "No auctions yet"}
                </h2>
                <p className="text-[9.5px] text-[var(--fs-ghost)] font-bold uppercase tracking-widest mb-4">
                  {historyData.length > 0
                    ? "No auctions found for this filter tab."
                    : "Create or join a room to start bidding!"}
                </p>
                {historyData.length > 0 && historyFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setHistoryFilter("all")}
                    className="px-3.5 py-2 bg-[var(--fs-accent)] text-[var(--fs-deep)] font-black text-[9px] uppercase tracking-wider hover:bg-white transition-colors cursor-pointer"
                  >
                    Show all auctions ({historyData.length})
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                {filteredHistory.map((session) => {
                  const teamMeta = TEAMS.find((t) => t.id === session.teamId);
                  const isExpanded = expandedSession === session.id;
                  const isCompleted = session.status === "completed";
                  const isActive = session.status === "active";
                  const overseasCount = countOverseas(session.squad, IPL_PLAYERS);
                  const serverLabel = getServerMeta(session.server).label;

                  /* The design's ledger row: franchise chip · player · franchise · price */
                  return (
                    <div key={session.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedSession(isExpanded ? null : session.id)}
                        onKeyDown={(e) =>
                          (e.key === "Enter" || e.key === " ") &&
                          setExpandedSession(isExpanded ? null : session.id)
                        }
                        className={`fs-table-row cursor-pointer transition-colors ${
                          isExpanded
                            ? "bg-[var(--fs-card-hi)]"
                            : "bg-[var(--fs-card)] hover:bg-[#0f2237]"
                        }`}
                      >
                        <span className="min-w-0">
                          <b className="truncate">{teamMeta?.name || session.teamName}</b>
                          <small>Room {session.roomId}</small>
                        </span>

                        <span className="flex flex-wrap items-center gap-1.5">
                          <em className="not-italic px-1.5 py-0.5 text-[7.5px] font-black uppercase tracking-wider bg-[#1a4f7d] text-[#9bcaff]">
                            {serverLabel}
                          </em>
                          <em className="not-italic px-1.5 py-0.5 text-[7.5px] font-black uppercase tracking-wider bg-[#1a3046] text-[var(--fs-label)]">
                            {session.mode}
                          </em>
                        </span>

                        <span className="flex items-center gap-2 min-w-0">
                          <span
                            className="not-italic px-1.5 py-0.5 text-[7.5px] font-black uppercase tracking-wider shrink-0"
                            style={{
                              background:
                                isCompleted ? "#1b3a22" : isActive ? "#153a2c" : session.status === "paused" ? "#3d3413" : "#1a3046",
                              color:
                                isCompleted ? "#b9dba5" : isActive ? "#7ee2b0" : session.status === "paused" ? "#f0c869" : "var(--fs-label)",
                            }}
                          >
                            {session.status}
                          </span>
                          <span className="text-[9px] text-[var(--fs-faint)] font-bold uppercase tracking-wider truncate">
                            {session.squad.length} players
                          </span>
                        </span>

                        <span className="flex items-center justify-end gap-2">
                          <strong className="whitespace-nowrap">
                            {session.spent === null ? "—" : `₹${formatCrores(session.spent, 1)} Cr`}
                          </strong>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionToDelete(session);
                            }}
                            title="Delete history"
                            aria-label="Delete history"
                            className="p-1 text-[var(--fs-ghost)] hover:text-red-400 transition-colors cursor-pointer"
                          >
                            <Trash2 size={12} />
                          </button>
                          <ChevronDown
                            size={13}
                            className={`text-[var(--fs-ghost)] transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                          />
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="border border-t-0 border-[var(--fs-line-soft)] bg-[var(--fs-deep-chip)] p-4 space-y-3">
                          {isCompleted ? (
                            <>
                              <div className="fs-squad-summary">
                                <span>
                                  Budget left
                                  <b>
                                    {session.budgetRemaining == null
                                      ? "—"
                                      : `₹${formatCrores(session.budgetRemaining)} Cr`}
                                  </b>
                                </span>
                                <span>
                                  Overseas
                                  <b>
                                    {overseasCount}/{session.overseasLimit}
                                  </b>
                                </span>
                                <span>
                                  Squad
                                  <b>
                                    {session.squad.length}/{session.squadLimit}
                                  </b>
                                </span>
                              </div>

                              {["Batsman", "Wicket-Keeper", "All-Rounder", "Bowler"].map((role) => {
                                const rolePlayers = session.squad.filter((p) => p?.role === role);
                                if (rolePlayers.length === 0) return null;
                                return (
                                  <div key={role}>
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <span className="fs-label text-[var(--fs-accent)]">{role}s</span>
                                      <span className="flex-1 h-px bg-[var(--fs-line-soft)]" />
                                      <span className="fs-num text-[11px] text-[var(--fs-dim)]">
                                        {rolePlayers.length}
                                      </span>
                                    </div>
                                    <div className="fs-roster" style={{ maxHeight: "none", padding: 0 }}>
                                      {rolePlayers.map((p, idx) => (
                                        <div key={idx}>
                                          <span className="flex items-center gap-2.5 min-w-0">
                                            <span className="fs-avatar">
                                              {p?.image ? (
                                                <img src={p.image} alt="" loading="lazy" />
                                              ) : (
                                                (p?.name || "P").slice(0, 2).toUpperCase()
                                              )}
                                            </span>
                                            <span className="min-w-0">
                                              <b className="truncate">{p?.name}</b>
                                              <small className="flex items-center gap-1.5">
                                                {p?.type}
                                                {isOverseasPlayer(p) && (
                                                  <Wifi size={8} className="rotate-90 text-[#9bcaff]" />
                                                )}
                                              </small>
                                            </span>
                                          </span>
                                          <b>
                                            {p?.bid == null ? "—" : `₹${formatCrores(p.bid)} Cr`}
                                          </b>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                );
                              })}

                              {session.squad.length === 0 && (
                                <p className="text-center text-[9.5px] text-[var(--fs-ghost)] font-bold uppercase py-4">
                                  No players acquired in this session
                                </p>
                              )}

                              <button
                                onClick={() =>
                                  navigate(
                                    withServerParam(`/summary/${session.roomId}`, session.server)
                                  )
                                }
                                className="fs-resume-btn flex items-center justify-center gap-2"
                              >
                                <Trophy size={12} /> View full summary
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="flex items-start gap-2.5 p-3 border border-[var(--fs-line-soft)] bg-[var(--fs-card)]">
                                {isActive ? (
                                  <Zap size={14} className="text-[var(--fs-accent)] mt-0.5 shrink-0" />
                                ) : (
                                  <Clock size={14} className="text-[var(--fs-dim)] mt-0.5 shrink-0" />
                                )}
                                <div>
                                  <p className="text-[9px] font-black uppercase tracking-widest text-white">
                                    {isActive ? "Auction in progress" : "Auction not started"}
                                  </p>
                                  <p className="text-[9px] text-[var(--fs-ghost)] font-medium mt-0.5 leading-relaxed">
                                    {isActive
                                      ? session.isLocal
                                        ? "Saved on this device — resume right where you left off."
                                        : "Bidding is live right now — jump back in to keep building your squad."
                                      : "This room is still waiting in the lobby for the host to start bidding."}
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
                                      session.server
                                    )
                                  )
                                }
                                className="fs-resume-btn flex items-center justify-center gap-2"
                              >
                                <Zap size={12} /> {isActive ? "Resume auction" : "Resume / join auction"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {notice && (
              <p className="mt-4 text-[11px] text-amber-300 font-bold text-center">{notice}</p>
            )}
            {error && (
              <p className="mt-4 text-[11px] text-red-400 font-bold text-center">{error}</p>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!sessionToDelete}
        title="Delete this room?"
        description="This permanently removes the room and its squad history for everyone. This action cannot be undone."
        detail={sessionToDelete ? `Room ${sessionToDelete.roomId}` : ""}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleDeleteHistory}
        onCancel={() => setSessionToDelete(null)}
      />

      <AdSlot className="mt-8 mb-4 px-2.5 sm:px-4" />
      <Footer />

      <p className="fs-landing-footer">
        Fan-made simulator · Not affiliated with BCCI, the IPL or any franchise
      </p>
    </div>
  );
};

export default LandingPage;
