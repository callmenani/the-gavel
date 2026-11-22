import React from 'react';
import PageBackground from '../PageBackground';
import Navbar from '../Navbar';
import Footer from '../Footer';
import CommunityBanner from '../community/CommunityBanner';

/**
 * Shared chrome for marketing and hub pages (nav + optional banner + footer).
 */
export default function SiteShell({
  children,
  showBanner = false,
  footer = true,
  className = '',
}) {
  return (
    <div
      className={`relative min-h-screen bg-transparent flex flex-col font-sans text-white overflow-x-clip ${className}`}
    >
      <PageBackground />
      <div className="relative z-50 w-full">
        {showBanner && <CommunityBanner />}
        <Navbar />
      </div>
      {children}
      {footer && <Footer />}
    </div>
  );
}