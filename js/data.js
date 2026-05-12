/**
 * FIFA World Cup 2026 — Data
 * Teams, groups, fixtures, venues, stats
 * Updated: 2026-05-12
 * Source: FIFA.com, Yahoo Sports, Wikipedia (cross-verified)
 * Times: Converted from ET to Argentina (UTC-3). EDT = ET+1 = ART in June.
 */

const TOURNAMENT = {
  name: 'FIFA World Cup 2026',
  hostCountries: ['Estados Unidos', 'México', 'Canadá'],
  startDate: '2026-06-11T16:00:00',
  endDate: '2026-07-19',
  totalTeams: 48,
  totalMatches: 104,
  groups: 12,
  format: '12 grupos de 4 → Dieciseisavos → Octavos → Cuartos → Semifinal → 3er puesto → Final'
};

/**
 * Country codes follow FIFA codes (alpha-3)
 * Flags rendered via flag-icons CSS library (no CORS issues)
 *   https://flag-icons.github.io/flag-icons/
 *   Uses ISO 3166-1 alpha-2 codes internally
 */
const FLAG_MAP = {
  'mex': 'mx',  'rsa': 'za',  'kor': 'kr',  'cze': 'cz',
  'can': 'ca',  'bih': 'ba',  'qat': 'qa',  'sui': 'ch',
  'bra': 'br',  'mar': 'ma',  'hai': 'ht',  'sco': 'gb-sct',
  'usa': 'us',  'par': 'py',  'aus': 'au',  'tur': 'tr',
  'ger': 'de',  'cuw': 'cw',  'civ': 'ci',  'ecu': 'ec',
  'ned': 'nl',  'jpn': 'jp',  'swe': 'se',  'tun': 'tn',
  'bel': 'be',  'egy': 'eg',  'irn': 'ir',  'nzl': 'nz',
  'esp': 'es',  'cpv': 'cv',  'ksa': 'sa',  'uru': 'uy',
  'fra': 'fr',  'sen': 'sn',  'irq': 'iq',  'nor': 'no',
  'arg': 'ar',  'alg': 'dz',  'aut': 'at',  'jor': 'jo',
  'por': 'pt',  'cod': 'cd',  'uzb': 'uz',  'col': 'co',
  'eng': 'gb-eng', 'cro': 'hr', 'gha': 'gh', 'pan': 'pa'
};

function getFlagClass(code) {
  const normalized = code.toLowerCase();
  const mapped = FLAG_MAP[normalized] || normalized;
  return `fi fi-${mapped}`;
}

function getFlagHtml(code, size) {
  const cls = size === 'lg' ? `${getFlagClass(code)} flag-img--lg` : getFlagClass(code);
  return `<span class="${cls}"></span>`;
}

/**
 * TEAMS — All 48 qualified teams
 */
const TEAMS = {
  // Group A
  MEX: { name: 'México', code: 'MEX', group: 'A' },
  RSA: { name: 'Sudáfrica', code: 'RSA', group: 'A' },
  KOR: { name: 'Corea del Sur', code: 'KOR', group: 'A' },
  CZE: { name: 'Chequia', code: 'CZE', group: 'A' },

  // Group B
  CAN: { name: 'Canadá', code: 'CAN', group: 'B' },
  BIH: { name: 'Bosnia y Herzegovina', code: 'BIH', group: 'B' },
  QAT: { name: 'Qatar', code: 'QAT', group: 'B' },
  SUI: { name: 'Suiza', code: 'SUI', group: 'B' },

  // Group C
  BRA: { name: 'Brasil', code: 'BRA', group: 'C' },
  MAR: { name: 'Marruecos', code: 'MAR', group: 'C' },
  HAI: { name: 'Haití', code: 'HAI', group: 'C' },
  SCO: { name: 'Escocia', code: 'SCO', group: 'C' },

  // Group D
  USA: { name: 'Estados Unidos', code: 'USA', group: 'D' },
  PAR: { name: 'Paraguay', code: 'PAR', group: 'D' },
  AUS: { name: 'Australia', code: 'AUS', group: 'D' },
  TUR: { name: 'Turquía', code: 'TUR', group: 'D' },

  // Group E
  GER: { name: 'Alemania', code: 'GER', group: 'E' },
  CUW: { name: 'Curazao', code: 'CUW', group: 'E' },
  CIV: { name: 'Costa de Marfil', code: 'CIV', group: 'E' },
  ECU: { name: 'Ecuador', code: 'ECU', group: 'E' },

  // Group F
  NED: { name: 'Países Bajos', code: 'NED', group: 'F' },
  JPN: { name: 'Japón', code: 'JPN', group: 'F' },
  SWE: { name: 'Suecia', code: 'SWE', group: 'F' },
  TUN: { name: 'Túnez', code: 'TUN', group: 'F' },

  // Group G
  BEL: { name: 'Bélgica', code: 'BEL', group: 'G' },
  EGY: { name: 'Egipto', code: 'EGY', group: 'G' },
  IRN: { name: 'Irán', code: 'IRN', group: 'G' },
  NZL: { name: 'Nueva Zelanda', code: 'NZL', group: 'G' },

  // Group H
  ESP: { name: 'España', code: 'ESP', group: 'H' },
  CPV: { name: 'Cabo Verde', code: 'CPV', group: 'H' },
  KSA: { name: 'Arabia Saudita', code: 'KSA', group: 'H' },
  URU: { name: 'Uruguay', code: 'URU', group: 'H' },

  // Group I
  FRA: { name: 'Francia', code: 'FRA', group: 'I' },
  SEN: { name: 'Senegal', code: 'SEN', group: 'I' },
  IRQ: { name: 'Irak', code: 'IRQ', group: 'I' },
  NOR: { name: 'Noruega', code: 'NOR', group: 'I' },

  // Group J
  ARG: { name: 'Argentina', code: 'ARG', group: 'J' },
  ALG: { name: 'Argelia', code: 'ALG', group: 'J' },
  AUT: { name: 'Austria', code: 'AUT', group: 'J' },
  JOR: { name: 'Jordania', code: 'JOR', group: 'J' },

  // Group K
  POR: { name: 'Portugal', code: 'POR', group: 'K' },
  COD: { name: 'RD del Congo', code: 'COD', group: 'K' },
  UZB: { name: 'Uzbekistán', code: 'UZB', group: 'K' },
  COL: { name: 'Colombia', code: 'COL', group: 'K' },

  // Group L
  ENG: { name: 'Inglaterra', code: 'ENG', group: 'L' },
  CRO: { name: 'Croacia', code: 'CRO', group: 'L' },
  GHA: { name: 'Ghana', code: 'GHA', group: 'L' },
  PAN: { name: 'Panamá', code: 'PAN', group: 'L' }
};

/**
 * GROUPS — Ordered by pot position
 */
const GROUPS = {};
Object.keys(TEAMS).forEach(code => {
  const team = TEAMS[code];
  if (!GROUPS[team.group]) GROUPS[team.group] = [];
  GROUPS[team.group].push({
    ...team,
    flagCode: code,
    played: 0, won: 0, drawn: 0, lost: 0,
    goalsFor: 0, goalsAgainst: 0, points: 0
  });
});

/**
 * VENUES — 16 host cities/stadiums
 */
const VENUES = [
  // United States (11)
  { city: 'Nueva York', stadium: 'MetLife Stadium', capacity: '87,000', country: 'USA', matches: 'Final' },
  { city: 'Los Ángeles', stadium: 'SoFi Stadium', capacity: '70,000', country: 'USA', matches: '8 partidos' },
  { city: 'Dallas', stadium: 'AT&T Stadium', capacity: '80,000', country: 'USA', matches: '8 partidos' },
  { city: 'Atlanta', stadium: 'Mercedes-Benz Stadium', capacity: '71,000', country: 'USA', matches: '8 partidos' },
  { city: 'Houston', stadium: 'NRG Stadium', capacity: '72,000', country: 'USA', matches: '7 partidos' },
  { city: 'Seattle', stadium: 'Lumen Field', capacity: '69,000', country: 'USA', matches: '6 partidos' },
  { city: 'San Francisco', stadium: 'Levi\'s Stadium', capacity: '68,500', country: 'USA', matches: '6 partidos' },
  { city: 'Kansas City', stadium: 'Arrowhead Stadium', capacity: '76,416', country: 'USA', matches: '6 partidos' },
  { city: 'Boston', stadium: 'Gillette Stadium', capacity: '65,000', country: 'USA', matches: '5 partidos' },
  { city: 'Filadelfia', stadium: 'Lincoln Financial Field', capacity: '69,176', country: 'USA', matches: '5 partidos' },
  { city: 'Miami', stadium: 'Hard Rock Stadium', capacity: '65,326', country: 'USA', matches: '7 partidos' },
  // Mexico (3)
  { city: 'Ciudad de México', stadium: 'Estadio Azteca', capacity: '87,000', country: 'MEX', matches: 'Inauguración' },
  { city: 'Guadalajara', stadium: 'Estadio Akron', capacity: '49,000', country: 'MEX', matches: '4 partidos' },
  { city: 'Monterrey', stadium: 'Estadio BBVA', capacity: '53,000', country: 'MEX', matches: '4 partidos' },
  // Canada (2)
  { city: 'Toronto', stadium: 'BMO Field', capacity: '45,000', country: 'CAN', matches: '5 partidos' },
  { city: 'Vancouver', stadium: 'BC Place', capacity: '54,500', country: 'CAN', matches: '5 partidos' }
];

/**
 * MATCHES — Group stage fixtures (all 72 matches)
 * Times in UTC-3 (Argentina time)
 * Source: FIFA.com / Yahoo Sports — cross-verified
 * Conversion: EDT (UTC-4) + 1h = ART (UTC-3)
 */

const MATCHES = [
  // ============================================
  // JUEVES 11 DE JUNIO — Inauguración
  // ============================================
  // Group A — MD1
  { id: 1,  home: 'MEX', away: 'RSA', date: '2026-06-11', time: '16:00', venue: 'Estadio Azteca',          city: 'Ciudad de México', group: 'A', stage: 'group', matchday: 1 },
  { id: 2,  home: 'KOR', away: 'CZE', date: '2026-06-11', time: '23:00', venue: 'Estadio Akron',           city: 'Guadalajara',      group: 'A', stage: 'group', matchday: 1 },

  // ============================================
  // VIERNES 12 DE JUNIO
  // ============================================
  // Group B — MD1
  { id: 3,  home: 'CAN', away: 'BIH', date: '2026-06-12', time: '16:00', venue: 'BMO Field',               city: 'Toronto',          group: 'B', stage: 'group', matchday: 1 },
  // Group D — MD1
  { id: 4,  home: 'USA', away: 'PAR', date: '2026-06-12', time: '22:00', venue: 'SoFi Stadium',            city: 'Los Ángeles',      group: 'D', stage: 'group', matchday: 1 },

  // ============================================
  // SÁBADO 13 DE JUNIO
  // ============================================
  // Group B — MD1
  { id: 5,  home: 'QAT', away: 'SUI', date: '2026-06-13', time: '16:00', venue: 'Levi\'s Stadium',          city: 'San Francisco',    group: 'B', stage: 'group', matchday: 1 },
  // Group C — MD1
  { id: 6,  home: 'BRA', away: 'MAR', date: '2026-06-13', time: '19:00', venue: 'MetLife Stadium',         city: 'Nueva York',       group: 'C', stage: 'group', matchday: 1 },
  { id: 7,  home: 'HAI', away: 'SCO', date: '2026-06-13', time: '22:00', venue: 'Gillette Stadium',        city: 'Boston',           group: 'C', stage: 'group', matchday: 1 },
  // Group D — MD1
  { id: 8,  home: 'AUS', away: 'TUR', date: '2026-06-13', time: '01:00', venue: 'BC Place',                city: 'Vancouver',        group: 'D', stage: 'group', matchday: 1 },

  // ============================================
  // DOMINGO 14 DE JUNIO
  // ============================================
  // Group E — MD1
  { id: 9,  home: 'GER', away: 'CUW', date: '2026-06-14', time: '14:00', venue: 'NRG Stadium',              city: 'Houston',          group: 'E', stage: 'group', matchday: 1 },
  { id: 10, home: 'CIV', away: 'ECU', date: '2026-06-14', time: '20:00', venue: 'Lincoln Financial Field', city: 'Filadelfia',       group: 'E', stage: 'group', matchday: 1 },
  // Group F — MD1
  { id: 11, home: 'NED', away: 'JPN', date: '2026-06-14', time: '17:00', venue: 'AT&T Stadium',            city: 'Dallas',           group: 'F', stage: 'group', matchday: 1 },
  { id: 12, home: 'SWE', away: 'TUN', date: '2026-06-14', time: '23:00', venue: 'Estadio BBVA',            city: 'Monterrey',        group: 'F', stage: 'group', matchday: 1 },

  // ============================================
  // LUNES 15 DE JUNIO
  // ============================================
  // Group G — MD1
  { id: 13, home: 'BEL', away: 'EGY', date: '2026-06-15', time: '16:00', venue: 'Lumen Field',              city: 'Seattle',          group: 'G', stage: 'group', matchday: 1 },
  { id: 14, home: 'IRN', away: 'NZL', date: '2026-06-15', time: '22:00', venue: 'SoFi Stadium',            city: 'Los Ángeles',      group: 'G', stage: 'group', matchday: 1 },
  // Group H — MD1
  { id: 15, home: 'ESP', away: 'CPV', date: '2026-06-15', time: '13:00', venue: 'Mercedes-Benz Stadium',  city: 'Atlanta',          group: 'H', stage: 'group', matchday: 1 },
  { id: 16, home: 'KSA', away: 'URU', date: '2026-06-15', time: '19:00', venue: 'Hard Rock Stadium',       city: 'Miami',            group: 'H', stage: 'group', matchday: 1 },

  // ============================================
  // MARTES 16 DE JUNIO
  // ============================================
  // Group I — MD1
  { id: 17, home: 'FRA', away: 'SEN', date: '2026-06-16', time: '16:00', venue: 'MetLife Stadium',         city: 'Nueva York',       group: 'I', stage: 'group', matchday: 1 },
  { id: 18, home: 'IRQ', away: 'NOR', date: '2026-06-16', time: '19:00', venue: 'Gillette Stadium',        city: 'Boston',           group: 'I', stage: 'group', matchday: 1 },
  // Group J — MD1
  { id: 19, home: 'ARG', away: 'ALG', date: '2026-06-16', time: '22:00', venue: 'Arrowhead Stadium',       city: 'Kansas City',      group: 'J', stage: 'group', matchday: 1 },
  { id: 20, home: 'AUT', away: 'JOR', date: '2026-06-16', time: '01:00', venue: 'Levi\'s Stadium',          city: 'San Francisco',    group: 'J', stage: 'group', matchday: 1 },

  // ============================================
  // MIÉRCOLES 17 DE JUNIO
  // ============================================
  // Group K — MD1
  { id: 21, home: 'POR', away: 'COD', date: '2026-06-17', time: '14:00', venue: 'NRG Stadium',              city: 'Houston',          group: 'K', stage: 'group', matchday: 1 },
  { id: 22, home: 'UZB', away: 'COL', date: '2026-06-17', time: '23:00', venue: 'Estadio Azteca',           city: 'Ciudad de México', group: 'K', stage: 'group', matchday: 1 },
  // Group L — MD1
  { id: 23, home: 'ENG', away: 'CRO', date: '2026-06-17', time: '17:00', venue: 'AT&T Stadium',            city: 'Dallas',           group: 'L', stage: 'group', matchday: 1 },
  { id: 24, home: 'GHA', away: 'PAN', date: '2026-06-17', time: '20:00', venue: 'BMO Field',               city: 'Toronto',          group: 'L', stage: 'group', matchday: 1 },

  // ============================================
  // JUEVES 18 DE JUNIO — Matchday 2
  // ============================================
  // Group A — MD2
  { id: 25, home: 'CZE', away: 'RSA', date: '2026-06-18', time: '13:00', venue: 'Mercedes-Benz Stadium',  city: 'Atlanta',          group: 'A', stage: 'group', matchday: 2 },
  { id: 26, home: 'MEX', away: 'KOR', date: '2026-06-18', time: '22:00', venue: 'Estadio Akron',           city: 'Guadalajara',      group: 'A', stage: 'group', matchday: 2 },
  // Group B — MD2
  { id: 27, home: 'SUI', away: 'BIH', date: '2026-06-18', time: '16:00', venue: 'SoFi Stadium',            city: 'Los Ángeles',      group: 'B', stage: 'group', matchday: 2 },
  { id: 28, home: 'CAN', away: 'QAT', date: '2026-06-18', time: '19:00', venue: 'BC Place',                city: 'Vancouver',        group: 'B', stage: 'group', matchday: 2 },

  // ============================================
  // VIERNES 19 DE JUNIO
  // ============================================
  // Group C — MD2
  { id: 29, home: 'SCO', away: 'MAR', date: '2026-06-19', time: '19:00', venue: 'Gillette Stadium',        city: 'Boston',           group: 'C', stage: 'group', matchday: 2 },
  { id: 30, home: 'BRA', away: 'HAI', date: '2026-06-19', time: '21:30', venue: 'Lincoln Financial Field', city: 'Filadelfia',       group: 'C', stage: 'group', matchday: 2 },
  // Group D — MD2
  { id: 31, home: 'USA', away: 'AUS', date: '2026-06-19', time: '16:00', venue: 'Lumen Field',              city: 'Seattle',          group: 'D', stage: 'group', matchday: 2 },
  { id: 32, home: 'TUR', away: 'PAR', date: '2026-06-20', time: '00:00', venue: 'Levi\'s Stadium',          city: 'San Francisco',    group: 'D', stage: 'group', matchday: 2 },

  // ============================================
  // SÁBADO 20 DE JUNIO
  // ============================================
  // Group E — MD2
  { id: 33, home: 'GER', away: 'CIV', date: '2026-06-20', time: '17:00', venue: 'BMO Field',               city: 'Toronto',          group: 'E', stage: 'group', matchday: 2 },
  { id: 34, home: 'ECU', away: 'CUW', date: '2026-06-20', time: '21:00', venue: 'Arrowhead Stadium',       city: 'Kansas City',      group: 'E', stage: 'group', matchday: 2 },
  // Group F — MD2
  { id: 35, home: 'NED', away: 'SWE', date: '2026-06-20', time: '14:00', venue: 'NRG Stadium',              city: 'Houston',          group: 'F', stage: 'group', matchday: 2 },
  { id: 36, home: 'TUN', away: 'JPN', date: '2026-06-20', time: '01:00', venue: 'Estadio BBVA',            city: 'Monterrey',        group: 'F', stage: 'group', matchday: 2 },

  // ============================================
  // DOMINGO 21 DE JUNIO
  // ============================================
  // Group G — MD2
  { id: 37, home: 'BEL', away: 'IRN', date: '2026-06-21', time: '16:00', venue: 'SoFi Stadium',            city: 'Los Ángeles',      group: 'G', stage: 'group', matchday: 2 },
  { id: 38, home: 'NZL', away: 'EGY', date: '2026-06-21', time: '22:00', venue: 'BC Place',                city: 'Vancouver',        group: 'G', stage: 'group', matchday: 2 },
  // Group H — MD2
  { id: 39, home: 'ESP', away: 'KSA', date: '2026-06-21', time: '13:00', venue: 'Mercedes-Benz Stadium',  city: 'Atlanta',          group: 'H', stage: 'group', matchday: 2 },
  { id: 40, home: 'URU', away: 'CPV', date: '2026-06-21', time: '19:00', venue: 'Hard Rock Stadium',       city: 'Miami',            group: 'H', stage: 'group', matchday: 2 },

  // ============================================
  // LUNES 22 DE JUNIO
  // ============================================
  // Group I — MD2
  { id: 41, home: 'FRA', away: 'IRQ', date: '2026-06-22', time: '18:00', venue: 'Lincoln Financial Field', city: 'Filadelfia',       group: 'I', stage: 'group', matchday: 2 },
  { id: 42, home: 'NOR', away: 'SEN', date: '2026-06-22', time: '21:00', venue: 'MetLife Stadium',         city: 'Nueva York',       group: 'I', stage: 'group', matchday: 2 },
  // Group J — MD2
  { id: 43, home: 'ARG', away: 'AUT', date: '2026-06-22', time: '14:00', venue: 'AT&T Stadium',            city: 'Dallas',           group: 'J', stage: 'group', matchday: 2 },
  { id: 44, home: 'JOR', away: 'ALG', date: '2026-06-23', time: '00:00', venue: 'Levi\'s Stadium',          city: 'San Francisco',    group: 'J', stage: 'group', matchday: 2 },

  // ============================================
  // MARTES 23 DE JUNIO
  // ============================================
  // Group K — MD2
  { id: 45, home: 'POR', away: 'UZB', date: '2026-06-23', time: '14:00', venue: 'NRG Stadium',              city: 'Houston',          group: 'K', stage: 'group', matchday: 2 },
  { id: 46, home: 'COL', away: 'COD', date: '2026-06-23', time: '23:00', venue: 'Estadio Akron',           city: 'Guadalajara',      group: 'K', stage: 'group', matchday: 2 },
  // Group L — MD2
  { id: 47, home: 'ENG', away: 'GHA', date: '2026-06-23', time: '17:00', venue: 'Gillette Stadium',        city: 'Boston',           group: 'L', stage: 'group', matchday: 2 },
  { id: 48, home: 'PAN', away: 'CRO', date: '2026-06-23', time: '20:00', venue: 'BMO Field',               city: 'Toronto',          group: 'L', stage: 'group', matchday: 2 },

  // ============================================
  // MIÉRCOLES 24 DE JUNIO — Matchday 3
  // ============================================
  // Group A — MD3
  { id: 49, home: 'CZE', away: 'MEX', date: '2026-06-24', time: '22:00', venue: 'Estadio Azteca',           city: 'Ciudad de México', group: 'A', stage: 'group', matchday: 3 },
  { id: 50, home: 'RSA', away: 'KOR', date: '2026-06-24', time: '22:00', venue: 'Estadio BBVA',            city: 'Monterrey',        group: 'A', stage: 'group', matchday: 3 },
  // Group B — MD3
  { id: 51, home: 'SUI', away: 'CAN', date: '2026-06-24', time: '16:00', venue: 'BC Place',                city: 'Vancouver',        group: 'B', stage: 'group', matchday: 3 },
  { id: 52, home: 'BIH', away: 'QAT', date: '2026-06-24', time: '16:00', venue: 'Lumen Field',              city: 'Seattle',          group: 'B', stage: 'group', matchday: 3 },
  // Group C — MD3
  { id: 53, home: 'SCO', away: 'BRA', date: '2026-06-24', time: '19:00', venue: 'Hard Rock Stadium',       city: 'Miami',            group: 'C', stage: 'group', matchday: 3 },
  { id: 54, home: 'MAR', away: 'HAI', date: '2026-06-24', time: '19:00', venue: 'Mercedes-Benz Stadium',  city: 'Atlanta',          group: 'C', stage: 'group', matchday: 3 },

  // ============================================
  // JUEVES 25 DE JUNIO
  // ============================================
  // Group D — MD3
  { id: 55, home: 'TUR', away: 'USA', date: '2026-06-25', time: '23:00', venue: 'SoFi Stadium',            city: 'Los Ángeles',      group: 'D', stage: 'group', matchday: 3 },
  { id: 56, home: 'PAR', away: 'AUS', date: '2026-06-25', time: '23:00', venue: 'Levi\'s Stadium',          city: 'San Francisco',    group: 'D', stage: 'group', matchday: 3 },
  // Group E — MD3
  { id: 57, home: 'CUW', away: 'CIV', date: '2026-06-25', time: '17:00', venue: 'Lincoln Financial Field', city: 'Filadelfia',       group: 'E', stage: 'group', matchday: 3 },
  { id: 58, home: 'ECU', away: 'GER', date: '2026-06-25', time: '17:00', venue: 'MetLife Stadium',         city: 'Nueva York',       group: 'E', stage: 'group', matchday: 3 },
  // Group F — MD3
  { id: 59, home: 'JPN', away: 'SWE', date: '2026-06-25', time: '20:00', venue: 'AT&T Stadium',            city: 'Dallas',           group: 'F', stage: 'group', matchday: 3 },
  { id: 60, home: 'TUN', away: 'NED', date: '2026-06-25', time: '20:00', venue: 'Arrowhead Stadium',       city: 'Kansas City',      group: 'F', stage: 'group', matchday: 3 },

  // ============================================
  // VIERNES 26 DE JUNIO
  // ============================================
  // Group G — MD3
  { id: 61, home: 'EGY', away: 'IRN', date: '2026-06-27', time: '00:00', venue: 'Lumen Field',              city: 'Seattle',          group: 'G', stage: 'group', matchday: 3 },
  { id: 62, home: 'NZL', away: 'BEL', date: '2026-06-27', time: '00:00', venue: 'BC Place',                city: 'Vancouver',        group: 'G', stage: 'group', matchday: 3 },
  // Group H — MD3
  { id: 63, home: 'CPV', away: 'KSA', date: '2026-06-26', time: '21:00', venue: 'NRG Stadium',              city: 'Houston',          group: 'H', stage: 'group', matchday: 3 },
  { id: 64, home: 'URU', away: 'ESP', date: '2026-06-26', time: '21:00', venue: 'Estadio Akron',           city: 'Guadalajara',      group: 'H', stage: 'group', matchday: 3 },
  // Group I — MD3
  { id: 65, home: 'NOR', away: 'FRA', date: '2026-06-26', time: '16:00', venue: 'Gillette Stadium',        city: 'Boston',           group: 'I', stage: 'group', matchday: 3 },
  { id: 66, home: 'SEN', away: 'IRQ', date: '2026-06-26', time: '16:00', venue: 'BMO Field',               city: 'Toronto',          group: 'I', stage: 'group', matchday: 3 },

  // ============================================
  // SÁBADO 27 DE JUNIO
  // ============================================
  // Group J — MD3
  { id: 67, home: 'JOR', away: 'ARG', date: '2026-06-27', time: '23:00', venue: 'AT&T Stadium',            city: 'Dallas',           group: 'J', stage: 'group', matchday: 3 },
  { id: 68, home: 'ALG', away: 'AUT', date: '2026-06-27', time: '23:00', venue: 'Arrowhead Stadium',       city: 'Kansas City',      group: 'J', stage: 'group', matchday: 3 },
  // Group K — MD3
  { id: 69, home: 'COL', away: 'POR', date: '2026-06-27', time: '20:30', venue: 'Hard Rock Stadium',       city: 'Miami',            group: 'K', stage: 'group', matchday: 3 },
  { id: 70, home: 'COD', away: 'UZB', date: '2026-06-27', time: '20:30', venue: 'Mercedes-Benz Stadium',  city: 'Atlanta',          group: 'K', stage: 'group', matchday: 3 },
  // Group L — MD3
  { id: 71, home: 'PAN', away: 'ENG', date: '2026-06-27', time: '18:00', venue: 'MetLife Stadium',         city: 'Nueva York',       group: 'L', stage: 'group', matchday: 3 },
  { id: 72, home: 'CRO', away: 'GHA', date: '2026-06-27', time: '18:00', venue: 'Lincoln Financial Field', city: 'Filadelfia',       group: 'L', stage: 'group', matchday: 3 }
];

/**
 * KNOCKOUT BRACKET — Template structure
 * Teams will be populated dynamically based on group results
 * Date ranges: R32 Jun 28-Jul 3, R16 Jul 4-7, QF Jul 9-11, SF Jul 14-15, TP Jul 18, Final Jul 19
 */
const KNOCKOUT = {
  roundOf32: [
    { id: 'R32-1',  label: '1A vs 2B',              date: '2026-06-28', home: null, away: null },
    { id: 'R32-2',  label: '1C vs 2D',              date: '2026-06-28', home: null, away: null },
    { id: 'R32-3',  label: '1E vs 2F',              date: '2026-06-28', home: null, away: null },
    { id: 'R32-4',  label: '1G vs 2H',              date: '2026-06-28', home: null, away: null },
    { id: 'R32-5',  label: '1I vs 2J',              date: '2026-06-29', home: null, away: null },
    { id: 'R32-6',  label: '1K vs 2L',              date: '2026-06-29', home: null, away: null },
    { id: 'R32-7',  label: '1B vs 2A',              date: '2026-06-29', home: null, away: null },
    { id: 'R32-8',  label: '1D vs 2C',              date: '2026-06-29', home: null, away: null },
    { id: 'R32-9',  label: '1F vs 2E',              date: '2026-06-30', home: null, away: null },
    { id: 'R32-10', label: '1H vs 2G',              date: '2026-06-30', home: null, away: null },
    { id: 'R32-11', label: '1J vs 2I',              date: '2026-06-30', home: null, away: null },
    { id: 'R32-12', label: '1L vs 2K',              date: '2026-06-30', home: null, away: null },
    // 8 best third-placed teams
    { id: 'R32-13', label: '3A/B/C vs 3D/E/F',      date: '2026-07-01', home: null, away: null },
    { id: 'R32-14', label: '3A/B/C vs 3D/E/F',      date: '2026-07-01', home: null, away: null },
    { id: 'R32-15', label: '3G/H/I vs 3J/K/L',      date: '2026-07-02', home: null, away: null },
    { id: 'R32-16', label: '3G/H/I vs 3J/K/L',      date: '2026-07-02', home: null, away: null }
  ],
  roundOf16: [
    { id: 'R16-1', label: 'Ganador R32-1  vs Ganador R32-2',  date: '2026-07-04', home: null, away: null },
    { id: 'R16-2', label: 'Ganador R32-3  vs Ganador R32-4',  date: '2026-07-04', home: null, away: null },
    { id: 'R16-3', label: 'Ganador R32-5  vs Ganador R32-6',  date: '2026-07-05', home: null, away: null },
    { id: 'R16-4', label: 'Ganador R32-7  vs Ganador R32-8',  date: '2026-07-05', home: null, away: null },
    { id: 'R16-5', label: 'Ganador R32-9  vs Ganador R32-10', date: '2026-07-06', home: null, away: null },
    { id: 'R16-6', label: 'Ganador R32-11 vs Ganador R32-12', date: '2026-07-06', home: null, away: null },
    { id: 'R16-7', label: 'Ganador R32-13 vs Ganador R32-14', date: '2026-07-07', home: null, away: null },
    { id: 'R16-8', label: 'Ganador R32-15 vs Ganador R32-16', date: '2026-07-07', home: null, away: null }
  ],
  quarterfinals: [
    { id: 'QF-1', label: 'Ganador R16-1 vs Ganador R16-2', date: '2026-07-09', home: null, away: null },
    { id: 'QF-2', label: 'Ganador R16-3 vs Ganador R16-4', date: '2026-07-09', home: null, away: null },
    { id: 'QF-3', label: 'Ganador R16-5 vs Ganador R16-6', date: '2026-07-10', home: null, away: null },
    { id: 'QF-4', label: 'Ganador R16-7 vs Ganador R16-8', date: '2026-07-10', home: null, away: null }
  ],
  semifinals: [
    { id: 'SF-1', label: 'Ganador QF-1 vs Ganador QF-2', date: '2026-07-14', home: null, away: null },
    { id: 'SF-2', label: 'Ganador QF-3 vs Ganador QF-4', date: '2026-07-15', home: null, away: null }
  ],
  thirdPlace: {
    id: 'TP-1', label: 'Perdedor SF-1 vs Perdedor SF-2', date: '2026-07-18', home: null, away: null
  },
  final: {
    id: 'FINAL', label: 'Ganador SF-1 vs Ganador SF-2', date: '2026-07-19', home: null, away: null
  }
};

/**
 * STATS — Empty placeholders, will be populated during the tournament
 */
const STATS = {
  scorers: [],
  yellowCards: [],
  redCards: []
};
