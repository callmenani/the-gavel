import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Globe,
  Radio,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import SiteShell from '../components/layout/SiteShell';
import PanelSurface from '../components/PanelSurface';
import useDocumentTitle from '../hooks/useDocumentTitle';
import { fetchPlatformStats } from '../lib/directoryApi';
import { FEATURE_MULTIPLAYER } from '../lib/appConfig';

const FEATURES = [
  {
    icon: Users,
    title: 'Live multiplayer',
    body: 'Host private rooms, invite friends, and bid in real time with synchronized countdowns and purse rules.',
  },
  {
    icon: Bot,
    title: 'Solo vs AI bots',
    body: 'Run a full auction on your device with nine autonomous franchises — no account or server required.',
  },
  {
    icon: Sparkles,
    title: 'AI squad ratings',
    body: 'Post-auction scout analysis with format-aware grades and tactical verdicts powered by Groq.',
  },
  {
    icon: Radio,
    title: 'Edge directory',
    body: 'Public lobby discovery and platform stats served from Cloudflare D1 with smart caching.',
  },
];

const HomePage = () => {
  useDocumentTitle(
    'TheGavel — Live T20 Auction Simulator',
    'Host multiplayer cricket auctions, play solo against bots, and build championship squads on the production-grade TheGavel platform.',
  );

  const [stats, setStats] = useState({ activeCount: 0, totalRecent: 0 });

  useEffect(() => {
    window.scrollTo(0, 0);
    fetchPlatformStats(false)
      .then((s) => {
        if (s) setStats(s);
      })
      .catch(() => {});
  }, []);

  return (
    <SiteShell showBanner>
      <main className="relative w-full flex-1 z-10 pb-16 sm:pb-24">
        {/* Hero */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-16 pb-12 sm:pb-20">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-14 items-center">
            <div className="lg:col-span-7 text-center lg:text-left">
              <p className="text-[10px] sm:text-xs font-black uppercase tracking-[0.35em] text-slate-400 mb-4">
                Production auction platform
              </p>
              <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-pixel leading-[1.05] text-balance">
                <span className="bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/70">
                  Build squads.
                </span>
                <br />
                <span className="text-white/90">Win the hammer.</span>
              </h1>
              <p className="mt-4 text-sm sm:text-base text-slate-400 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                TheGavel splits the experience into focused pages — explore the platform here, then
                head to the auction hub to create rooms, join lobbies, or replay your history.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row flex-wrap items-center justify-center lg:justify-start gap-3">
                <Link
                  to="/play"
                  className="inline-flex items-center justify-center gap-2 min-h-12 px-8 rounded-xl bg-white text-black font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all active:scale-[0.98] shadow-[0_10px_40px_rgba(255,255,255,0.12)]"
                >
                  <Zap size={16} />
                  Enter auction hub
                  <ArrowRight size={16} />
                </Link>
                <Link
                  to="/features"
                  className="inline-flex items-center justify-center gap-2 min-h-12 px-8 rounded-xl bg-white/5 border border-white/15 text-slate-200 font-black uppercase tracking-widest text-xs hover:bg-white/10 hover:border-white/25 transition-all"
                >
                  View capabilities
                </Link>
              </div>
              {!FEATURE_MULTIPLAYER && (
                <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-amber-400/90">
                  Solo mode — runs fully on your device
                </p>
              )}
            </div>

            <div className="lg:col-span-5 w-full">
              <PanelSurface>
                <div className="bg-[#0c0d10] rounded-[2rem] border border-white/10 p-6 sm:p-8 space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                      <Globe size={20} className="text-slate-200" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                        Live network
                      </p>
                      <p className="text-lg font-pixel text-white">Platform pulse</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <StatCard label="Active rooms" value={stats.activeCount ?? '—'} />
                    <StatCard label="Recent auctions" value={stats.totalRecent ?? '—'} />
                  </div>
                  <Link
                    to="/play/join"
                    className="flex items-center justify-between w-full py-3 px-4 rounded-xl bg-white/[0.04] border border-dashed border-white/15 text-[10px] font-black uppercase tracking-widest text-slate-300 hover:bg-white/[0.08] hover:text-white transition-all"
                  >
                    Browse public lobbies
                    <ArrowRight size={14} />
                  </Link>
                </div>
              </PanelSurface>
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section className="border-y border-white/[0.06] bg-white/[0.02]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <h2 className="text-2xl sm:text-3xl font-pixel text-white">Built for real auctions</h2>
              <p className="mt-3 text-sm text-slate-400">
                Each major workflow lives on its own route — cleaner URLs, faster loads, and a
                structure that scales like a product site.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <article
                  key={title}
                  className="p-6 rounded-2xl border border-white/10 bg-[#0c0d10]/80 hover:border-white/20 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center mb-4">
                    <Icon size={18} className="text-slate-200" />
                  </div>
                  <h3 className="font-black uppercase tracking-wide text-sm text-white">{title}</h3>
                  <p className="mt-2 text-xs text-slate-400 leading-relaxed">{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* CTA strip */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#0c0d10] to-[#12141c] p-8 sm:p-12 text-center">
            <Trophy className="mx-auto text-amber-400/90 mb-4" size={32} />
            <h2 className="text-xl sm:text-2xl font-pixel text-white">Ready to gavel in?</h2>
            <p className="mt-2 text-sm text-slate-400 max-w-lg mx-auto">
              Create a room, join friends, or battle nine AI franchises — all from the dedicated play
              hub.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/play"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Start playing
              </Link>
              <Link
                to="/community"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/15 text-xs font-black uppercase tracking-widest text-slate-300 hover:bg-white/5 transition-all"
              >
                Community
              </Link>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
};

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 text-center">
      <p className="text-2xl font-pixel text-white tabular-nums">{value}</p>
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">{label}</p>
    </div>
  );
}

export default HomePage;