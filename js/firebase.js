/**
 * WC2026 — Static Data Module (post-tournament)
 * Replaces Firebase real-time listeners with a single JSON file.
 * Loads data/live-data.json and populates MATCHES[], KNOCKOUT_LIVE, STATS.
 *
 * Requiere: data.js (cargado antes que este archivo)
 */

let db = null;
let firebaseReady = false;
let KNOCKOUT_LIVE = null;

// ─── FEEDER MAP (kept for reference, not used for propagation anymore) ───
const FEEDER_MAP = {
  'R16-1':  { home: 'R32-1',  away: 'R32-2'  },
  'R16-2':  { home: 'R32-3',  away: 'R32-4'  },
  'R16-3':  { home: 'R32-5',  away: 'R32-6'  },
  'R16-4':  { home: 'R32-7',  away: 'R32-8'  },
  'R16-5':  { home: 'R32-9',  away: 'R32-10' },
  'R16-6':  { home: 'R32-11', away: 'R32-12' },
  'R16-7':  { home: 'R32-13', away: 'R32-14' },
  'R16-8':  { home: 'R32-15', away: 'R32-16' },
  'QF-1':   { home: 'R16-1',  away: 'R16-2'  },
  'QF-2':   { home: 'R16-3',  away: 'R16-4'  },
  'QF-3':   { home: 'R16-5',  away: 'R16-6'  },
  'QF-4':   { home: 'R16-7',  away: 'R16-8'  },
  'SF-1':   { home: 'QF-1',   away: 'QF-2'   },
  'SF-2':   { home: 'QF-3',   away: 'QF-4'   },
  'FINAL':  { home: 'SF-1',   away: 'SF-2'   },
  'TP-1':   { home: 'SF-1',   away: 'SF-2',   useLoser: true }
};

/* ===== INIT MATCH FIELDS ===== */
if (typeof MATCHES !== 'undefined') {
  MATCHES.forEach(m => {
    if (m.homeScore === undefined) m.homeScore = null;
    if (m.awayScore === undefined) m.awayScore = null;
    if (!m.status) m.status = 'upcoming';
    if (m.minute === undefined) m.minute = null;
  });
}

/**
 * Load static data from data/live-data.json and populate globals.
 * This replaces all Firebase listeners.
 */
async function initFirebase() {
  console.log('[WC2026] Cargando datos estáticos (torneo finalizado)...');

  try {
    const res = await fetch('data/live-data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // ─── Apply match scores to MATCHES[] ───
    if (data.matches && Array.isArray(data.matches)) {
      let updated = 0;
      data.matches.forEach(live => {
        const local = MATCHES.find(m => String(m.id) === String(live.id));
        if (!local) return;
        if (live.homeScore != null) local.homeScore = live.homeScore;
        if (live.awayScore != null) local.awayScore = live.awayScore;
        if (live.status) local.status = live.status;
        if (live.minute != null) local.minute = live.minute;
        if (live.winnerCode != null) local.winnerCode = live.winnerCode;
        if (live.afterExtraTime != null) local.afterExtraTime = live.afterExtraTime;
        if (live.penaltyScore != null) local.penaltyScore = live.penaltyScore;
        updated++;
      });
      console.log(`[WC2026] ✅ ${updated} partidos de grupo actualizados`);
    }

    // ─── Build KNOCKOUT_LIVE from knockout array ───
    if (data.knockout && Array.isArray(data.knockout)) {
      const docs = data.knockout.map(d => {
        // Normalize: if home/away is an object, extract .code
        if (d.home && typeof d.home === 'object') d.home = d.home.code || null;
        if (d.away && typeof d.away === 'object') d.away = d.away.code || null;
        return d;
      });

      KNOCKOUT_LIVE = {
        roundOf32: docs.filter(d => d.id.startsWith('R32'))
          .sort((a, b) => parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1])),
        roundOf16: docs.filter(d => d.id.startsWith('R16'))
          .sort((a, b) => parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1])),
        quarterfinals: docs.filter(d => d.id.startsWith('QF'))
          .sort((a, b) => parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1])),
        semifinals: docs.filter(d => d.id.startsWith('SF'))
          .sort((a, b) => parseInt(a.id.split('-')[1]) - parseInt(b.id.split('-')[1])),
        thirdPlace: docs.find(d => d.id === 'TP-1') || null,
        final: docs.find(d => d.id === 'FINAL') || null
      };
      console.log(`[WC2026] ✅ ${docs.length} partidos de eliminatorias cargados`);
    }

    // ─── Aggregate scorers ───
    if (data.scorers && Array.isArray(data.scorers)) {
      const playerMap = {};
      data.scorers.forEach(d => {
        const key = (d.name || '') + '_' + (d.teamCode || '');
        if (!playerMap[key]) {
          playerMap[key] = { name: d.name, teamCode: d.teamCode, goals: 0, assists: 0 };
        }
        playerMap[key].goals += (d.goals || 1);
        playerMap[key].assists += (d.assists || 0);
      });
      STATS.scorers = Object.values(playerMap).sort((a, b) => {
        if (b.goals !== a.goals) return b.goals - a.goals;
        return (b.assists || 0) - (a.assists || 0);
      });
      console.log(`[WC2026] ✅ ${STATS.scorers.length} goleadores cargados`);
    }

    // ─── Load cards ───
    if (data.cards && Array.isArray(data.cards)) {
      STATS.yellowCards = data.cards.filter(c => c.type === 'yellow');
      STATS.redCards = data.cards.filter(c => c.type === 'red');
      console.log(`[WC2026] ✅ ${STATS.yellowCards.length} amarillas, ${STATS.redCards.length} rojas`);
    }

    firebaseReady = true;

    // ─── Refresh all UI ───
    recalculateStandings();
    refreshUI();

    console.log('[WC2026] 🏆 Datos estáticos cargados. Torneo finalizado.');
  } catch (e) {
    console.error('[WC2026] Error cargando live-data.json:', e);
    console.log('[WC2026] Usando datos estáticos de data.js (sin scores).');
    // Still render with static data
    recalculateStandings();
    refreshUI();
  }
}

/* ===== GROUP STANDINGS CALCULATOR ===== */
function recalculateStandings() {
  Object.keys(GROUPS).forEach(g => {
    GROUPS[g].forEach(t => {
      t.played = 0; t.won = 0; t.drawn = 0; t.lost = 0;
      t.goalsFor = 0; t.goalsAgainst = 0; t.points = 0;
    });
  });

  MATCHES
    .filter(m => m.stage === 'group' && m.status === 'completed')
    .forEach(m => {
      const group = GROUPS[m.group];
      if (!group) return;
      const home = group.find(t => t.code === m.home);
      const away = group.find(t => t.code === m.away);
      if (!home || !away) return;
      const hs = m.homeScore || 0;
      const as = m.awayScore || 0;
      home.played++; away.played++;
      home.goalsFor += hs; home.goalsAgainst += as;
      away.goalsFor += as; away.goalsAgainst += hs;
      if (hs > as) { home.won++; home.points += 3; away.lost++; }
      else if (hs < as) { away.won++; away.points += 3; home.lost++; }
      else { home.drawn++; away.drawn++; home.points++; away.points++; }
    });

  Object.keys(GROUPS).forEach(g => {
    GROUPS[g].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const gdA = a.goalsFor - a.goalsAgainst;
      const gdB = b.goalsFor - b.goalsAgainst;
      if (gdB !== gdA) return gdB - gdA;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.name.localeCompare(b.name);
    });
  });
}

/* ===== UI REFRESH ===== */
function refreshUI() {
  if (typeof renderTodayMatches === 'function') renderTodayMatches();
  renderUpcomingMatches();

  const container = document.getElementById('calendar-content');
  if (container) {
    const activeBtn = document.querySelector('.calendar__filter-btn.active');
    const filter = activeBtn ? activeBtn.dataset.filter : 'all';
    if (filter === 'knockout') {
      renderKnockoutCalendar(container);
    } else {
      const groupMatches = MATCHES.filter(m => m.stage === 'group');
      renderCalendar(container, groupMatches, filter);
    }
  }

  initGroups();

  if (KNOCKOUT_LIVE) {
    initBracket();
  }

  renderScorers();
  renderCards();
}

/* ===== KNOCKOUT HELPERS ===== */
function flattenKnockout(ko) {
  if (!ko) return [];
  const arr = [];
  (ko.roundOf32 || []).forEach(m => arr.push(m));
  (ko.roundOf16 || []).forEach(m => arr.push(m));
  (ko.quarterfinals || []).forEach(m => arr.push(m));
  (ko.semifinals || []).forEach(m => arr.push(m));
  if (ko.thirdPlace) arr.push(ko.thirdPlace);
  if (ko.final) arr.push(ko.final);
  return arr;
}

function getKnockoutRoundLabel(id) {
  if (!id) return '';
  if (id === 'FINAL') return 'Final';
  if (id === 'TP-1') return 'Tercer Puesto';
  if (id.startsWith('R32')) return 'Dieciseisavos';
  if (id.startsWith('R16')) return 'Octavos';
  if (id.startsWith('QF')) return 'Cuartos';
  if (id.startsWith('SF')) return 'Semifinal';
  return id;
}

function refreshKnockoutCalendar() {
  const activeBtn = document.querySelector('.calendar__filter-btn.active');
  if (activeBtn && activeBtn.dataset.filter === 'knockout') {
    const container = document.getElementById('calendar-content');
    if (container && typeof renderKnockoutCalendar === 'function') {
      renderKnockoutCalendar(container);
    }
  }
}

/* ===== STUBS (kept for compatibility) ===== */
function isFirebaseReady() { return firebaseReady; }
function listenMatches() {}
function listenKnockout() {}
function listenScorers() {}
function listenCards() {}
function startEspnPolling() {}
function autoUpdateQualifiers() {}
function autoPropagateWinners() {}