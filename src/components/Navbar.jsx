import React, { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, Moon, Sun, X, Zap } from 'lucide-react';
import GithubStarButton from './GithubStarButton';
import { useTheme } from '../contexts/ThemeContext';

const PRIMARY_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/play', label: 'Play', matchPrefix: '/play' },
  { to: '/features', label: 'Features', end: true },
  { to: '/community', label: 'Community', end: true },
  { to: '/guide', label: 'Guide', end: true },
  { to: '/about', label: 'About', end: true },
];

const linkClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors ${
    isActive
      ? 'bg-white/10 text-white border border-white/15'
      : 'text-gray-400 hover:text-white hover:bg-white/5'
  }`;

const Navbar = () => {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isPlayActive = location.pathname.startsWith('/play');

  return (
    <header className="relative z-50 w-full bg-transparent border-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between gap-4">
        <Link
          to="/"
          className="flex items-center gap-2 sm:gap-2.5 font-pixel text-xs sm:text-sm md:text-base tracking-tight text-white select-none group shrink-0"
          aria-label="IPL Auction Game Home"
          onClick={() => setMobileOpen(false)}
        >
          <img
            src="/favicon.svg"
            alt=""
            width="28"
            height="28"
            className="w-6 h-6 sm:w-7 sm:h-7 object-contain drop-shadow-[0_2px_8px_rgba(229,255,63,0.35)] transition-transform duration-300 shrink-0"
          />
          <span>IPL Auction Game</span>
        </Link>

        <nav
          className="hidden lg:flex items-center gap-1 flex-1 justify-center"
          aria-label="Primary"
        >
          {PRIMARY_LINKS.map(({ to, label, end, matchPrefix }) =>
            matchPrefix ? (
              <Link
                key={to}
                to={to}
                className={`px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors ${
                  isPlayActive
                    ? 'bg-white/10 text-white border border-white/15'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {label}
              </Link>
            ) : (
              <NavLink key={to} to={to} end={end} className={linkClass}>
                {label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <Link
            to="/play"
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white text-black text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95"
          >
            <Zap size={14} />
            Play
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all active:scale-95 shrink-0"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <GithubStarButton />
          <button
            type="button"
            className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/5 border border-white/10 text-white"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-white/10 bg-[#0c0d10]/95 backdrop-blur-md">
          <nav className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1" aria-label="Mobile">
            {PRIMARY_LINKS.map(({ to, label, end, matchPrefix }) =>
              matchPrefix ? (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={`px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest ${
                    isPlayActive ? 'bg-white/10 text-white' : 'text-gray-400'
                  }`}
                >
                  {label}
                </Link>
              ) : (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest ${
                      isActive ? 'bg-white/10 text-white' : 'text-gray-400'
                    }`
                  }
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </NavLink>
              ),
            )}
          </nav>
        </div>
      )}
    </header>
  );
};

export default Navbar;