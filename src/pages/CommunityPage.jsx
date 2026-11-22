import React, { useEffect } from 'react';
import SiteShell from '../components/layout/SiteShell';
import CommunitySection from '../components/community/CommunitySection';
import useDocumentTitle from '../hooks/useDocumentTitle';

export default function CommunityPage() {
  useDocumentTitle(
    'Community | TheGavel',
    'Feedback, ratings, and community updates from TheGavel players and contributors.',
  );

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <SiteShell showBanner>
      <main className="relative w-full flex-1 z-10 px-3 sm:px-4 pt-6 sm:pt-10 pb-20">
        <div className="max-w-3xl mx-auto text-center mb-8 px-2">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-2">
            Players & builders
          </p>
          <h1 className="text-2xl sm:text-3xl font-pixel text-white">Community</h1>
          <p className="mt-3 text-sm text-slate-400">
            Share feedback, follow updates, and see what other managers are saying about TheGavel.
          </p>
        </div>
        <CommunitySection />
      </main>
    </SiteShell>
  );
}