export const BOT_COACHES = {
  GT: 'Nehra Ji',
  CSK: 'Zak Bhai',
  MI: 'Polly Bhai',
  RCB: 'Flower Power',
  KKR: 'Nayar Saab',
  DC: 'Punter Saab',
  PBKS: "Preity Ma'am",
  RR: 'Sanga Sir',
  SRH: 'Kavya Queen',
  LSG: 'Langer Bhai',
};

export const getTeamBotName = (teamOrId) => {
  const id = typeof teamOrId === 'string' ? teamOrId : teamOrId?.id;
  if (id && BOT_COACHES[id]) return BOT_COACHES[id];
  const name = typeof teamOrId === 'object' ? teamOrId?.name : '';
  return name ? `${name} Bot` : 'AI Bot';
};

/**
 * Each franchise carries two brand hex values on top of its Tailwind classes:
 * `brand` (primary) and `brandDark` (shadow end). The Figma design system drives
 * every franchise-tinted surface — purse cards, squad headers, podium cards —
 * from these through the `--team` / `--team2` CSS custom properties.
 */
export const TEAMS = [
  {
    id: 'MI',
    name: 'MI',
    shortName: 'MI',
    botName: BOT_COACHES.MI,
    color: 'bg-blue-600',
    textColor: 'text-white',
    brand: '#1e4fd8',
    brandDark: '#0a1f4d',
    logo: '/logos/MI.svg'
  },
  {
    id: 'CSK',
    name: 'CSK',
    shortName: 'CSK',
    botName: BOT_COACHES.CSK,
    color: 'bg-yellow-400',
    textColor: 'text-black',
    brand: '#f5c518',
    brandDark: '#4a3a05',
    logo: '/logos/CSK.svg'
  },
  {
    id: 'RCB',
    name: 'RCB',
    shortName: 'RCB',
    botName: BOT_COACHES.RCB,
    color: 'bg-red-600',
    textColor: 'text-white',
    brand: '#d61f26',
    brandDark: '#3d0a0c',
    logo: '/logos/RCB.svg'
  },
  {
    id: 'KKR',
    name: 'KKR',
    shortName: 'KKR',
    botName: BOT_COACHES.KKR,
    color: 'bg-purple-800',
    textColor: 'text-white',
    brand: '#6b2fa0',
    brandDark: '#210d33',
    logo: '/logos/KKR.svg'
  },
  {
    id: 'DC',
    name: 'DC',
    shortName: 'DC',
    botName: BOT_COACHES.DC,
    color: 'bg-blue-500',
    textColor: 'text-white',
    brand: '#1f6bd6',
    brandDark: '#0a2447',
    logo: '/logos/DC.svg'
  },
  {
    id: 'PBKS',
    name: 'PBKS',
    shortName: 'PBKS',
    botName: BOT_COACHES.PBKS,
    color: 'bg-red-500',
    textColor: 'text-white',
    brand: '#dd1f2d',
    brandDark: '#420810',
    logo: '/logos/PBKS.svg'
  },
  {
    id: 'RR',
    name: 'RR',
    shortName: 'RR',
    botName: BOT_COACHES.RR,
    color: 'bg-pink-600',
    textColor: 'text-white',
    brand: '#e0218a',
    brandDark: '#3d0a26',
    logo: '/logos/RR.svg'
  },
  {
    id: 'SRH',
    name: 'SRH',
    shortName: 'SRH',
    botName: BOT_COACHES.SRH,
    color: 'bg-orange-500',
    textColor: 'text-white',
    brand: '#f26522',
    brandDark: '#45180a',
    logo: '/logos/SRH.svg'
  },
  {
    id: 'GT',
    name: 'GT',
    shortName: 'GT',
    botName: BOT_COACHES.GT,
    color: 'bg-slate-700',
    textColor: 'text-white',
    brand: '#1b3a5c',
    brandDark: '#08152a',
    logo: '/logos/GT.svg'
  },
  {
    id: 'LSG',
    name: 'LSG',
    shortName: 'LSG',
    botName: BOT_COACHES.LSG,
    color: 'bg-pink-800',
    textColor: 'text-white',
    brand: '#00a3e0',
    brandDark: '#062a3d',
    logo: '/logos/LSG.svg'
  },
];

/** Franchise hex colours for a team id, with a neutral fallback. */
export const getTeamBrand = (teamId) => {
  const team = TEAMS.find((t) => t.id === teamId);
  return { brand: team?.brand || '#2b4a6d', brandDark: team?.brandDark || '#0d2237' };
};

/** Inline style object that themes a subtree to a franchise's colours. */
export const teamThemeStyle = (teamId) => {
  const { brand, brandDark } = getTeamBrand(teamId);
  return { '--team': brand, '--team2': brandDark };
};
