import React, { useMemo, useState } from 'react';
import { Copy, Check, FileDown, Printer } from 'lucide-react';
import { TEAMS } from '../data/teams';
import { IPL_PLAYERS } from '../data/players';
import {
  formatCrores,
  countOverseas,
  computeTeamSpent,
  toFiniteNumber,
  isOverseasPlayer,
} from '../lib/auctionDisplay';

const ROLES = ['Batsman', 'Wicket-Keeper', 'All-Rounder', 'Bowler'];

/**
 * Notion-style team sheet: a clean, light "paper" document listing every
 * squad with manager, purse, and role-grouped signees + prices. Deliberately
 * the opposite of the dark arena UI — it's meant to be read, copied, and
 * shared like a document. Includes "Copy as text" and "Download" actions so
 * players can drop the whole auction into Notes/WhatsApp instantly.
 */

const buildTeamBlock = (t, teamDoc, manager, squad, osCount, totalSpent, totalBudget) => {
  const lines = [];
  lines.push(`${t.name}  —  ${manager?.name || 'Unmanaged'}`);
  lines.push(`Spent ${totalSpent === null ? '—' : `₹${formatCrores(totalSpent, 1)} Cr`} of ₹${formatCrores(totalBudget, 0)} Cr • ${squad.length} players • ${osCount} overseas`);
  ROLES.forEach((role) => {
    const players = squad.filter((p) => p.role === role);
    if (players.length === 0) return;
    lines.push(`  ${role}s (${players.length})`);
    players.forEach((p) => {
      lines.push(`    • ${p.name}${isOverseasPlayer(p) ? ' 🌐' : ''} — ${p.bidVal == null ? '₹0' : `₹${formatCrores(p.bidVal, 1)} Cr`}`);
    });
  });
  return lines.join('\n');
};

export default function NotionTeamSheet({ roomTeams = [], auction, topPlayers = [] }) {
  const [copied, setCopied] = useState(false);

  const teamData = useMemo(() => {
    return TEAMS.map((t) => {
      const teamDoc = roomTeams.find((doc) => (doc.teamId || doc.team_id) === t.id);
      const manager = auction?.players?.find((p) => p.team === t.id);
      const rawSquad = teamDoc?.squad;
      const squadArr = Array.isArray(rawSquad) ? rawSquad : (rawSquad ? Object.values(rawSquad) : []);
      const squad = squadArr
        .map((s) => {
          const pid = typeof s === 'string' ? s : s.id;
          const bid = typeof s === 'string' ? null : (s.bid ?? null);
          const info = IPL_PLAYERS.find((p) => p.id === pid);
          return { ...(info || {}), id: pid, name: info?.name || pid, bidVal: bid };
        })
        .filter((p) => p && p.id);

      const osCount = countOverseas(teamDoc?.squad, IPL_PLAYERS);
      const totalBudget = toFiniteNumber(auction?.settings?.budget, 120);
      const totalSpent = computeTeamSpent({
        budget: totalBudget,
        budgetRemaining: teamDoc?.budgetRemaining,
        spent: teamDoc?.spent,
      });

      return { t, teamDoc, manager, squad, osCount, totalBudget, totalSpent };
    }).filter((d) => d.squad.length > 0);
  }, [roomTeams, auction]);

  const sheetText = useMemo(() => {
    const lines = [];
    lines.push('THE GAVEL — IPL AUCTION RESULTS');
    lines.push(`Room #${auction?.id || '—'} • ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    lines.push('');
    lines.push('══════════════ TEAMS ══════════════');
    teamData.forEach(({ t, manager, squad, osCount, totalSpent, totalBudget }, i) => {
      lines.push('');
      lines.push(`${i + 1}. ${buildTeamBlock(t, null, manager, squad, osCount, totalSpent, totalBudget)}`);
    });
    lines.push('');
    lines.push('══════════════ TOP SIGNINGS ══════════════');
    topPlayers.forEach((p, i) => {
      const teamName = TEAMS.find((t) => t.id === p.teamId)?.name || p.teamId || '—';
      lines.push(`${i + 1}. ${p.name} → ${teamName} ${p.bidVal == null ? '' : `(₹${formatCrores(p.bidVal, 1)} Cr)`}`);
    });
    lines.push('');
    lines.push('Unsolved/unsold players were passed by all managers.');
    return lines.join('\n');
  }, [teamData, topPlayers, auction?.id]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sheetText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([sheetText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gavel-auction-${(auction?.id || 'sheet').slice(0, 12)}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* download unavailable */
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 mb-3 sm:mb-4">
        <p className="text-[9px] sm:text-[10px] font-pixel text-slate-400 uppercase tracking-widest">Neat team sheet • copy or download</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print?.()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-[9px] sm:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer"
          >
            <Printer size={12} /> <span className="hidden sm:inline">Print</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-[9px] sm:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer"
          >
            <FileDown size={12} /> <span className="hidden sm:inline">Download</span>
          </button>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer ${
              copied ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300' : 'bg-white text-black hover:bg-slate-200 shadow-[0_8px_20px_rgba(255,255,255,0.1)]'
            }`}
          >
            {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy text</>}
          </button>
        </div>
      </div>

      {/* Paper sheet */}
      <div className="bg-[#faf9f7] text-[#1f2328] rounded-2xl sm:rounded-3xl border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.6)] overflow-hidden">
        <div className="px-4 sm:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
          {/* Doc title */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg sm:text-2xl font-black tracking-tight text-[#1f2328]">IPL Auction — Team Sheet</h3>
              <p className="text-[10px] sm:text-[11px] font-semibold text-[#6b7075] mt-1">
                Room #{auction?.id || '—'} • {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} • Budget ₹{formatCrores(toFiniteNumber(auction?.settings?.budget, 120), 0)} Cr
              </p>
            </div>
            <div className="shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#1f2328] flex items-center justify-center text-white">
              <FileDown size={15} />
            </div>
          </div>

          {/* Teams */}
          {teamData.length === 0 ? (
            <p className="text-sm font-semibold text-[#6b7075]">No squads were completed in this auction yet.</p>
          ) : (
            <div className="space-y-5">
              {teamData.map(({ t, manager, squad, osCount, totalSpent, totalBudget }, i) => (
                <div key={t.id} className="border border-[#e4e1dc] rounded-xl overflow-hidden bg-white">
                  {/* Team header row */}
                  <div className="flex items-center justify-between gap-3 px-3 sm:px-4 py-2.5 bg-[#f1efec] border-b border-[#e4e1dc]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[10px] font-black text-[#8a8f98] w-4 text-right">{i + 1}.</span>
                      <img src={t.logo} alt="" className="w-6 h-6 sm:w-7 sm:h-7 object-contain" loading="lazy" />
                      <span className="text-[13px] sm:text-[15px] font-black text-[#1f2328] truncate">{t.name}</span>
                    </div>
                    <span className="text-[9px] sm:text-[10px] font-bold text-[#6b7075] uppercase tracking-wider shrink-0">
                      {manager?.name || 'Unmanaged'}
                    </span>
                  </div>

                  {/* Stat chips */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 sm:px-4 py-2 border-b border-[#e4e1dc]/60">
                    <span className="text-[10px] sm:text-[11px] font-bold text-[#6b7075]">
                      Spent <span className="text-[#1f2328] font-black">{totalSpent === null ? '—' : `₹${formatCrores(totalSpent, 1)} Cr`}</span> of ₹{formatCrores(totalBudget, 0)} Cr
                    </span>
                    <span className="text-[10px] sm:text-[11px] font-bold text-[#6b7075]">
                      Players <span className="text-[#1f2328] font-black">{squad.length}</span>
                    </span>
                    <span className="text-[10px] sm:text-[11px] font-bold text-[#6b7075]">
                      Overseas <span className="text-[#1f2328] font-black">{osCount}</span>
                    </span>
                  </div>

                  {/* Role-grouped roster table */}
                  <div className="px-3 sm:px-4 py-2.5">
                    {ROLES.map((role) => {
                      const players = squad.filter((p) => p.role === role);
                      if (players.length === 0) return null;
                      return (
                        <div key={role} className="mb-2 last:mb-0">
                          <p className="text-[8px] sm:text-[9px] font-black uppercase tracking-[0.15em] text-[#8a8f98] mb-1">{role}s</p>
                          <div className="grid grid-cols-[1fr_auto] gap-x-3">
                            {players.map((p) => (
                              <React.Fragment key={p.id}>
                                <span className="text-[12px] sm:text-[13px] font-semibold text-[#1f2328] py-0.5 border-b border-dashed border-[#e4e1dc] flex items-center gap-1.5 min-w-0">
                                  {isOverseasPlayer(p) && <span className="text-[#7c5cd6] text-[9px] font-black">🌐</span>}
                                  <span className="truncate">{p.name}</span>
                                </span>
                                <span className="text-[12px] sm:text-[13px] font-black text-[#1f2328] py-0.5 border-b border-dashed border-[#e4e1dc] tabular-nums">
                                  {p.bidVal == null ? '—' : `₹${formatCrores(p.bidVal, 1)} Cr`}
                                </span>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Top signings */}
          {topPlayers.length > 0 && (
            <div className="border border-[#e4e1dc] rounded-xl overflow-hidden bg-white">
              <div className="px-3 sm:px-4 py-2.5 bg-[#f1efec] border-b border-[#e4e1dc]">
                <p className="text-[11px] sm:text-[12px] font-black text-[#1f2328] uppercase tracking-wider">Top {topPlayers.length} Signings</p>
              </div>
              <div className="px-3 sm:px-4 py-2">
                {topPlayers.map((p, i) => {
                  const teamName = TEAMS.find((tt) => tt.id === p.teamId)?.name || p.teamId || '—';
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-dashed border-[#e4e1dc] last:border-b-0">
                      <span className="text-[12px] sm:text-[13px] font-semibold text-[#1f2328] min-w-0 truncate">
                        <span className="text-[#8a8f98] font-black mr-2">{i + 1}.</span>{p.name}
                        <span className="text-[#6b7075] font-bold"> → {teamName}</span>
                      </span>
                      <span className="text-[12px] sm:text-[13px] font-black tabular-nums text-[#1f2328] shrink-0">
                        {p.bidVal == null ? '—' : `₹${formatCrores(p.bidVal, 1)} Cr`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[9px] sm:text-[10px] font-semibold text-[#8a8f98] text-center">
            TheGavel • fan-made auction • 🌐 = overseas player
          </p>
        </div>
      </div>
    </div>
  );
}
