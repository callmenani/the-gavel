import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Gavel, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { IPL_PLAYERS } from '../data/players';

/**
 * PlayersUnderHammer — the landing page's live-auction showcase.
 *
 * A broadcast-style slate: one marquee lot under the hammer with its hammer
 * price, plus a paging strip of the lots around it. Everything is drawn from
 * our own palette (stadium navy + the lime accent) rather than the reference
 * build's amber, and the photos come straight from the player dataset.
 *
 * All prices here are illustrative marquee figures for the landing slate — the
 * same convention the activity feed already uses.
 */

const PAGE_SIZE = 5; // 1 feature + 4 thumbnails

/** ₹78.32 Cr — the feed's established price format. */
const formatCrores = (value) => `₹${Number(value).toFixed(2)} Cr`;

/** "Rohit Sharma" → "R. Sharma" */
const shortName = (name) => {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return name || '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
};

/**
 * Marquee figure derived from the player's own rating, so the slate is stable
 * across renders and the order matches the lot order.
 */
const hammerPrice = (player) => {
  const rating = Number(player?.rating) || 70;
  return Math.max(20, Math.min(98, 55 + (rating - 70) * 1.8));
};

/** The lots shown on the slate: rated, photographed players, strongest first. */
const buildLots = () =>
  IPL_PLAYERS.filter((p) => p?.image && Number(p?.rating) > 0)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 20)
    .map((player) => ({ player, price: hammerPrice(player) }));

export default function PlayersUnderHammer({ stats = null }) {
  const lots = useMemo(buildLots, []);
  const pageCount = Math.max(1, Math.ceil(lots.length / PAGE_SIZE));

  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback(
    (next) => setPage(((next % pageCount) + pageCount) % pageCount),
    [pageCount]
  );

  // Auto-advance the slate, the way a live auction feed would.
  useEffect(() => {
    if (paused || pageCount < 2) return undefined;
    const id = setInterval(() => setPage((p) => (p + 1) % pageCount), 6500);
    return () => clearInterval(id);
  }, [paused, pageCount]);

  const slice = lots.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const featured = slice[0];
  const thumbs = slice.slice(1);

  const liveRooms =
    stats?.activeCount !== undefined && stats?.activeCount !== null
      ? stats.activeCount
      : 0;

  if (!featured) return null;

  return (
    <section
      className="fs-hammer"
      aria-label="Players under hammer"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* ── Slate header ── */}
      <div className="fs-hammer-head">
        <span className="fs-live-pill">
          <i />
          Live auction activity
        </span>
        <span className="fs-hammer-count fs-label">
          {lots.length} lots · {page + 1} / {pageCount}
        </span>
      </div>

      {/* ── Featured lot ── */}
      <div className="fs-hammer-stage">
        <Gavel className="fs-hammer-gavel" aria-hidden="true" strokeWidth={1.1} />

        <AnimatePresence mode="wait">
          <motion.div
            key={featured.player.id}
            className="fs-lot"
            initial={{ opacity: 0, x: 26 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -26 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="fs-lot-frame">
              <img
                src={featured.player.image}
                alt={featured.player.name}
                loading="eager"
                decoding="async"
              />
              <div className="fs-lot-scrim" aria-hidden="true" />

              <span className="fs-lot-sold">
                <Check size={10} strokeWidth={4} /> Sold
              </span>

              <div className="fs-lot-plates">
                <span className="fs-lot-name">{shortName(featured.player.name)}</span>
                <span className="fs-lot-price">{formatCrores(featured.price)}</span>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* ── Carousel controls ── */}
        {pageCount > 1 && (
          <>
            <button
              type="button"
              className="fs-hammer-arrow prev"
              onClick={() => go(page - 1)}
              aria-label="Previous lots"
            >
              <ChevronLeft size={16} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              className="fs-hammer-arrow next"
              onClick={() => go(page + 1)}
              aria-label="Next lots"
            >
              <ChevronRight size={16} strokeWidth={2.5} />
            </button>
          </>
        )}
      </div>

      {/* ── Paging strip ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={page}
          className="fs-lot-strip"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
        >
          {thumbs.map(({ player, price }) => (
            <div className="fs-lot-thumb" key={player.id}>
              <span className="fs-lot-thumb-frame">
                <img
                  src={player.image}
                  alt={player.name}
                  loading="lazy"
                  decoding="async"
                />
                <span className="fs-lot-thumb-check" aria-hidden="true">
                  <Check size={9} strokeWidth={4} />
                </span>
              </span>
              <b>{shortName(player.name)}</b>
              <small>{formatCrores(price)}</small>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>

      {/* ── Dots ── */}
      {pageCount > 1 && (
        <div className="fs-hammer-dots">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              className={i === page ? 'on' : ''}
              onClick={() => go(i)}
              aria-label={`Go to lot page ${i + 1}`}
              aria-current={i === page}
            />
          ))}
          <span className="fs-label">{liveRooms} live now</span>
        </div>
      )}
    </section>
  );
}
