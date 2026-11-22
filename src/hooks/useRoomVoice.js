import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ref, set, get, update, onValue, off } from 'firebase/database';

/**
 * useRoomVoice — free P2P WebRTC voice for a room (Option A).
 *
 * Architecture:
 *  - Full audio-only mesh: each voice member keeps one RTCPeerConnection per
 *    other member. Audio-only opus is ~20-30 kbps per stream, so 10 players
 *    ≈ ~250 kbps uplink per phone — workable on real devices. No video, no
 *    TURN server: if two phones are behind symmetric NATs a link can fail;
 *    the bar then shows that peer as "unreachable" and the rest of the room
 *    keeps talking.
 *  - Signaling rides the room RTDB tree at auctions/{room}/voice:
 *      voice/{uid}          = { online, name, muted, raisedHand, at }
 *      voice/signal/{to}/{from} = { type: 'offer'|'answer', sdp }
 *    New joiners send a bundled (non-trickle) offer to each existing member;
 *    existing members answer. Consumed signal children are deleted.
 *  - "Step out" = leaveVoice(): closes every peer link and mic, the auction
 *    RTDB listeners are untouched, so you keep playing the whole time.
 */

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

const ICE_TIMEOUT_MS = 1500;

const waitIce = (pc, ms = ICE_TIMEOUT_MS) =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, ms);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });

/**
 * @param {{
 *  rtdb: any,              // room RTDB app (or null for solo/local rooms)
 *  roomId: string,
 *  uid: string,
 *  displayName: string,
 *  enabled: boolean,       // master switch — false keeps the whole thing inert
 * }} opts
 */
export default function useRoomVoice({ rtdb, roomId, uid, displayName, enabled }) {
  const [inVoice, setInVoice] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [raisedHand, setRaisedHand] = useState(false);
  const [peers, setPeers] = useState({}); // { uid: { name, muted, raisedHand, connected, speaking } }
  const [voiceError, setVoiceError] = useState('');

  const streamRef = useRef(null);
  const pcsRef = useRef(new Map()); // uid -> { pc, audioEl, analyser, handledOffers:Set, handledAnswers:Set }
  const sigUnsubRef = useRef(null);
  const peersUnsubRef = useRef(null);
  const aliveRef = useRef(true);
  const speakerTimerRef = useRef(null);

  const setPeerMeta = useCallback((patchFn) => {
    setPeers((prev) => patchFn({ ...prev }));
  }, []);

  // ── Join: get mic, write presence, offer to existing members ──
  const joinVoice = useCallback(async () => {
    if (!enabled || !rtdb || !roomId || !uid || inVoice) return;
    setInVoice(true);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      setVoiceError('Microphone unavailable — tap the browser mic permission and retry.');
      setInVoice(false);
      return;
    }
    streamRef.current = stream;

    try {
      // My presence node (self-writable under the room rules).
      await set(ref(rtdb, `auctions/${roomId}/voice/${uid}`), {
        online: true,
        name: displayName || 'Manager',
        muted: false,
        raisedHand: false,
        at: Date.now(),
      });

      // Who's already in the room?
      const snap = await get(ref(rtdb, `auctions/${roomId}/voice`));
      const existing = snap.val() || {};
      Object.keys(existing)
        .filter((p) => p !== uid && existing[p]?.online && p !== 'signal')
        .forEach(async (peerUid) => {
          if (!aliveRef.current || !streamRef.current) return;
          try {
            const pc = new RTCPeerConnection({ iceServers: STUN });
            const entry = {
              pc,
              audioEl: null,
              analyser: null,
              handledOffers: new Set(),
              handledAnswers: new Set(),
            };
            pcsRef.current.set(peerUid, entry);

            streamRef.current.getAudioTracks().forEach((t) => pc.addTrack(t, streamRef.current));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await waitIce(pc);

            setPeers((prev) => ({
              ...prev,
              [peerUid]: {
                ...(prev[peerUid] || {}),
                name: existing[peerUid]?.name || 'Manager',
                connected: 'new',
              },
            }));

            await set(ref(rtdb, `auctions/${roomId}/voice/signal/${peerUid}/${uid}`), {
              type: 'offer',
              sdp: pc.localDescription.sdp,
            });
          } catch {
            /* offer to this peer failed — they may answer via reconnect */
          }
        });
    } catch (err) {
      console.warn('[voice] join failed', err);
      setVoiceError('Could not join voice. Check your connection and retry.');
    }

    // Watch offers/answers addressed to me: voice/signal/{me} subtree.
    if (!sigUnsubRef.current) {
      const sigRef = ref(rtdb, `auctions/${roomId}/voice/signal/${uid}`);
      sigUnsubRef.current = onValue(sigRef, async (snap) => {
        const tree = snap.val() || {};
        Object.entries(tree).forEach(async ([peerUid, sig]) => {
          if (!sig || peerUid === 'signal') return;
          let entry = pcsRef.current.get(peerUid);
          try {
            if (sig.type === 'offer') {
              if (entry?.handledOffers.has(peerUid)) return;
              if (!streamRef.current) return;
              if (!entry) {
                const pc = new RTCPeerConnection({ iceServers: STUN });
                entry = {
                  pc,
                  audioEl: null,
                  analyser: null,
                  handledOffers: new Set(),
                  handledAnswers: new Set(),
                };
                pcsRef.current.set(peerUid, entry);
              }
              streamRef.current.getAudioTracks().forEach((t) => entry.pc.addTrack(t, streamRef.current));
              await entry.pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
              const answer = await entry.pc.createAnswer();
              await entry.pc.setLocalDescription(answer);
              await waitIce(entry.pc);
              entry.handledOffers.add(peerUid);
              await set(ref(rtdb, `auctions/${roomId}/voice/signal/${peerUid}/${uid}`), {
                type: 'answer',
                sdp: entry.pc.localDescription.sdp,
              });
              await update(ref(rtdb, `auctions/${roomId}/voice/signal/${uid}`), { [peerUid]: null });
            } else if (sig.type === 'answer') {
              if (entry?.handledAnswers.has(peerUid)) return;
              if (!entry) return;
              await entry.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
              entry.handledAnswers.add(peerUid);
              await update(ref(rtdb, `auctions/${roomId}/voice/signal/${peerUid}`), { [uid]: null });
            }
          } catch (e) {
            console.warn('[voice] signaling error', peerUid, e);
          }
        });
      });
    }

    // Watch who else is in the room (join / leave).
    if (!peersUnsubRef.current) {
      peersUnsubRef.current = onValue(ref(rtdb, `auctions/${roomId}/voice`), (snap) => {
        const tree = snap.val() || {};
        const list = Object.entries(tree)
          .filter(([k, v]) => k !== 'signal' && v && v.online)
          .reduce((acc, [k, v]) => {
            acc[k] = {
              name: v.name || 'Manager',
              muted: !!v.muted,
              raisedHand: !!v.raisedHand,
              connected: 'new',
            };
            return acc;
          }, {});
        // Merge live connection state from our own pcs.
        pcsRef.current.forEach((entry, k) => {
          list[k] = { ...(list[k] || { name: 'Manager' }), connected: entry.pc.connectionState };
        });
        setPeers((prev) => {
          const next = {};
          Object.entries(list).forEach(([k, v]) => {
            next[k] = { ...v, speaking: prev[k]?.speaking && v.speaking !== undefined ? prev[k].speaking : false };
          });
          return next;
        });
      });
    }

    // Active-speaker detection: RMS on each remote stream every 400ms.
    if (!speakerTimerRef.current && typeof AudioContext !== 'undefined') {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      speakerTimerRef.current = setInterval(() => {
        const speaking = {};
        pcsRef.current.forEach((entry, k) => {
          const remote = entry.pc.getRemoteStreams?.()[0];
          if (!remote) return;
          if (!entry.analyser) {
            const src = ctx.createMediaStreamSource(remote);
            entry.analyser = ctx.createAnalyser();
            entry.analyser.fftSize = 512;
            src.connect(entry.analyser);
            entry.audioCtx = ctx;
          }
          try {
            const data = new Uint8Array(entry.analyser.frequencyBinCount);
            entry.analyser.getByteFrequencyData(data);
            const rms = data.reduce((a, b) => a + b, 0) / data.length;
            speaking[k] = rms > 22; // tuned: quiet room ~5-12, speech ~40+
          } catch {
            speaking[k] = false;
          }
        });
        setPeerMeta((prev) => {
          let changed = false;
          Object.keys(prev).forEach((k) => {
            const isSpeaking = Boolean(speaking[k]);
            if (prev[k]?.speaking !== isSpeaking) {
              prev[k] = { ...prev[k], speaking: isSpeaking };
              changed = true;
            }
          });
          return changed ? prev : prev; // same ref -> React skips re-render
        });
      }, 400);
    }
  }, [enabled, rtdb, roomId, uid, displayName, inVoice, setPeerMeta]);

  // Toggles peer links, mic tracks, and the talking-analyser timer. Hoisted
  // above leaveVoice/unmount because those close over it.
  const cleanupAll = () => {
    pcsRef.current.forEach((entry) => {
      try {
        entry.audioEl?.pause();
        entry.audioEl?.remove();
        entry.pc.close();
        entry.analyser?.disconnect();
      } catch {
        /* already gone */
      }
    });
    pcsRef.current.clear();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (speakerTimerRef.current) {
      clearInterval(speakerTimerRef.current);
      speakerTimerRef.current = null;
    }
  };

  // ── Leave ("step out of the conversation", keep playing) ──
  const leaveVoice = useCallback(() => {
    cleanupAll();
    setInVoice(false);
    setRaisedHand(false);
    setVoiceError('');
    setPeers({});
    try {
      if (rtdb && roomId && uid) {
        set(ref(rtdb, `auctions/${roomId}/voice/${uid}`), { online: false }).catch(() => {});
        update(ref(rtdb, `auctions/${roomId}/voice/signal/${uid}`), null).catch(() => {});
      }
    } catch {
      /* best effort */
    }
  }, [rtdb, roomId, uid]);

  // ── Mic mute (local track + presence flag so the bar shows it) ──
  const toggleMute = useCallback(() => {
    setMicMuted((m) => {
      const next = !m;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach((t) => (t.enabled = !next));
      }
      try {
        if (rtdb && roomId && uid) {
          update(ref(rtdb, `auctions/${roomId}/voice/${uid}`), { muted: next }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [rtdb, roomId, uid]);

  const toggleRaiseHand = useCallback(() => {
    setRaisedHand((h) => {
      const next = !h;
      try {
        if (rtdb && roomId && uid) {
          update(ref(rtdb, `auctions/${roomId}/voice/${uid}`), { raisedHand: next }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [rtdb, roomId, uid]);

  // ── Remote audio: attach a peer's stream to an <audio> element ──
  useEffect(() => {
    const wire = (peerUid) => {
      const entry = pcsRef.current.get(peerUid);
      if (!entry) return;
      entry.pc.ontrack = (ev) => {
        if (!ev.streams?.[0] || entry.audioEl) return;
        const audioEl = document.createElement('audio');
        audioEl.srcObject = ev.streams[0];
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
        entry.audioEl = audioEl;
        audioEl.play().catch(() => {});
        setPeerMeta((prev) => ({
          ...prev,
          [peerUid]: { ...(prev[peerUid] || {}), name: prev[peerUid]?.name || 'Manager', connected: 'connected' },
        }));
      };
      entry.pc.onconnectionstatechange = () => {
        const st = entry.pc.connectionState;
        setPeerMeta((prev) => ({
          ...prev,
          [peerUid]: { ...(prev[peerUid] || {}), connected: st },
        }));
      };
    };
    pcsRef.current.forEach((_, k) => wire(k));
  }, [inVoice, setPeerMeta]);

  // ── Unmount: tear everything down ──
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (sigUnsubRef.current) {
        off(ref(rtdb, `auctions/${roomId}/voice/signal/${uid}`), 'value', sigUnsubRef.current);
        sigUnsubRef.current = null;
      }
      if (peersUnsubRef.current) {
        off(ref(rtdb, `auctions/${roomId}/voice`), 'value', peersUnsubRef.current);
        peersUnsubRef.current = null;
      }
      cleanupAll();
    };
  }, [rtdb, roomId, uid]);

  const peerIds = useMemo(() => Object.keys(peers), [peers]);
  const talkingCount = peerIds.filter((k) => peers[k]?.speaking).length;

  return {
    inVoice,
    joinVoice,
    leaveVoice,
    micMuted,
    toggleMute,
    raisedHand,
    toggleRaiseHand,
    peers,
    peerIds,
    talkingCount,
    voiceError,
    clearVoiceError: () => setVoiceError(''),
  };
}
