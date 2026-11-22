import React from 'react';
import { Link } from 'react-router-dom';
import { Crosshair } from 'lucide-react';

/**
 * FigmaShell — the design system's shared chrome pieces.
 *
 * These are deliberately presentational: every value comes in through props so
 * the screens keep owning all auction behaviour. Each export maps to one class
 * cluster in `styles/figma.css`.
 */

/* ── Brand lockup ─────────────────────────────────────────────────────────
   The lime, skewed tile is the signature mark of the design. On the landing
   page it links home; in the app shell it is inert. */
export const Brand = ({ compact = false, asLink = true, subtitle = 'AUCTION ENGINE' }) => {
  const inner = (
    <>
      <span className="fs-brand-mark">
        <Crosshair size={25} strokeWidth={2.5} />
      </span>
      <span className="fs-brand-text">
        <b>CrickAuction</b>
        <small>{subtitle}</small>
      </span>
    </>
  );

  const className = `fs-brand${compact ? ' compact' : ''}`;

  if (!asLink) {
    return <div className={className}>{inner}</div>;
  }

  return (
    <Link to="/" className={className} aria-label="CrickAuction home">
      {inner}
    </Link>
  );
};

/* ── Live indicator ─────────────────────────────────────────────────────── */
export const LivePill = ({ children = 'LIVE', className = '' }) => (
  <span className={`fs-live-pill ${className}`}>
    <i />
    {children}
  </span>
);

/* ── Franchise crest ──────────────────────────────────────────────────────
   Renders the project's own SVG logo inside the circular team chip. The chip
   carries the franchise colours via --team / --team2 from teamThemeStyle. */
export const TeamMark = ({ team, size = 'md', className = '' }) => {
  if (!team) return null;

  const sizeClass = size === 'sm' ? ' sm' : size === 'lg' ? ' lg' : '';

  return (
    <span
      className={`fs-team-logo${sizeClass} ${className}`}
      style={{ '--team': team.brand, '--team2': team.brandDark }}
      title={team.name}
    >
      <img src={team.logo} alt={`${team.name} logo`} loading="lazy" decoding="async" />
    </span>
  );
};

/* ── Page heading used by the squad / ledger data pages ──────────────────── */
export const PageHeading = ({ eyebrow, title, action }) => (
  <div className="fs-page-heading">
    <div>
      {eyebrow && <p>{eyebrow}</p>}
      <h1>{title}</h1>
    </div>
    {action}
  </div>
);

export default Brand;
