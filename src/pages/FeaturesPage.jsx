import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Cloud,
  Cpu,
  Layers,
  Shield,
  Timer,
} from 'lucide-react';
import SiteShell from '../components/layout/SiteShell';
import useDocumentTitle from '../hooks/useDocumentTitle';

const ITEMS = [
  {
    icon: Layers,
    title: 'Multi-page information architecture',
    detail:
      'Home, play hub, features, community, and docs each have dedicated routes — better SEO, shareable URLs, and clearer mental models for new users.',
  },
  {
    icon: Timer,
    title: 'Sub-second bidding sync',
    detail: 'Clock-drift aware countdowns keep multiplayer rooms fair across devices and networks.',
  },
  {
    icon: Cpu,
    title: 'Device-local solo engine',
    detail: 'Full bot auctions run in-browser with Web Locks and BroadcastChannel for tab safety.',
  },
  {
    icon: Cloud,
    title: 'RTDB cluster + D1 directory',
    detail: 'Horizontal Firebase scaling for live rooms; Cloudflare edge index for public lobbies and stats.',
  },
  {
    icon: Shield,
    title: 'Consent & integrity gates',
    detail: 'Post-sale confirmation flows, pass consensus, and squad quota enforcement built into room logic.',
  },
];

export default function FeaturesPage() {
  useDocumentTitle(
    'Features | IPL Auction Game',
    'Explore IPL Auction Game platform capabilities: multiplayer auctions, solo bots, AI ratings, and edge infrastructure.',
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <SiteShell>
      <main className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16 pb-24">
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-3">
          Platform
        </p>
        <h1 className="text-3xl sm:text-4xl font-pixel text-white">Features</h1>
        <p className="mt-4 text-sm text-slate-400 leading-relaxed">
          IPL Auction Game is structured as a production-style web app: marketing surfaces on the home page,
          operational workflows in the play hub, and reference content in guide and about pages.
        </p>

        <ul className="mt-10 space-y-5">
          {ITEMS.map(({ icon: Icon, title, detail }) => (
            <li
              key={title}
              className="flex gap-4 p-5 sm:p-6 rounded-2xl border border-white/10 bg-[#0c0d10]/90"
            >
              <div className="shrink-0 w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                <Icon size={18} className="text-slate-200" />
              </div>
              <div>
                <h2 className="font-black uppercase tracking-wide text-sm text-white">{title}</h2>
                <p className="mt-2 text-xs sm:text-sm text-slate-400 leading-relaxed">{detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex flex-wrap gap-3">
          <Link
            to="/play"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-black text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
          >
            Open play hub
            <ArrowRight size={14} />
          </Link>
          <Link
            to="/guide"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/15 text-xs font-black uppercase tracking-widest text-slate-300 hover:bg-white/5 transition-all"
          >
            Read game guide
          </Link>
        </div>
      </main>
    </SiteShell>
  );
}