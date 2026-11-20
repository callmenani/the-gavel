import React, { useEffect, useState } from 'react';

/**
 * Renders the consent gate's "Auto-advances in Ns" countdown.
 *
 * Owns its 1s ticker locally so the entire AuctionRoom (a ~2000-line JSX tree
 * plus every child) no longer re-renders every second while the gate is open —
 * that parent-level tick was the main iOS jank source during the gate. Only
 * this leaf re-renders each second now.
 */
const ConsentGateCountdown = ({ deadline = 0, getSyncedTime }) => {
  // The wall-clock read is kept OUT of render: calling getSyncedTime() in the
  // component body trips the impure-call-during-render rule and would read a
  // live module-level offset on every render of this leaf.
  const [now, setNow] = useState(() =>
    typeof getSyncedTime === 'function' ? getSyncedTime() : Date.now(),
  );

  const readClock = () =>
    typeof getSyncedTime === 'function' ? getSyncedTime() : Date.now();

  useEffect(() => {
    if (!deadline) return undefined;
    setNow(readClock());
    const t = setInterval(() => setNow(readClock()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);
  const remaining = Math.max(0, Math.ceil(((deadline || 0) - now) / 1000));

  return <span className="font-pixel text-amber-400">{remaining}s</span>;
};

export default ConsentGateCountdown;
