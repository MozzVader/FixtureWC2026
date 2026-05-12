/**
 * WC2026 — Firebase Module
 * Real-time match updates, group standings calculation, live stats
 *
 * Requiere: firebase-config.js, data.js (cargados antes que este archivo)
 * Degradación elegante: si Firebase no está configurado, el sitio funciona
 * con los datos estáticos de data.js.
 *
 * Firestore Collections:
 *   /matches/{id}        → Partidos fase de grupos (72)
 *   /knockout/{id}       → Partidos eliminatorias (60: R32×16 + R16×8 + QF×4 + SF×2 + TP + Final)
 *   /scorers/{autoId}    → Goleadores del torneo
 *   /cards/{autoId}      → Tarjetas (amarillas/rojas)
 */

let db = null;
let firebaseReady = false;

// Live knockout data from Firestore (organized by round)
let KNOCKOUT_LIVE = null;

/**
 * Feeder map: which completed match feeds into the next round.
 * home/away = which feeder's winner goes to home/away slot.
 * useLoser = true means the LOSER advances (3rd place match).
 */
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

/* ===== INITIALIZE MATCH FIELDS ===== */
// Ensure every match has score/status fields (for graceful fallback)
if (typeof MATCHES !== 'undefined') {
  MATCHES.forEach(m => {
    if (m.homeScore === undefined) m.homeScore = null;
    if (m.awayScore === undefined) m.awayScore = null;
    if (!m.status) m.status = 'upcoming';
    if (m.minute === undefined) m.minute = null;
  });
}

/**
 * Initialize Firebase and start real-time listeners.
 * Safe to call even if Firebase is not configured.
 */
function initFirebase() {
  if (typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_ENABLED) {
    console.log('[WC2026] Firebase no configurado. Usando datos estáticos.');
    console.log('[WC2026] Para activar: editá js/firebase-config.js → FIREBASE_ENABLED = true');
    return;
  }

  if (!FIREBASE_CONFIG.projectId) {
    console.warn('[WC2026] Firebase config vacía. Verificá js/firebase-config.js');
    return;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    firebaseReady = true;
    console.log('[WC2026] Firebase inicializado ✓');

    // Offline persistence (works even without connection)
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
      if (err.code === 'failed-precondition') {
        console.warn('[WC2026] Persistencia deshabilitada (múltiples tabs).');
      } else if (err.code === 'unimplemented') {
        console.warn('[WC2026] Navegador no soporta persistencia offline.');
      }
    });

    // Start real-time listeners
    listenMatches();
    listenKnockout();
    listenScorers();
    listenCards();

  } catch (e) {
    console.error('[WC2026] Error al inicializar Firebase:', e);
  }
}

/* ===== MATCH LISTENER ===== */
function listenMatches() {
  if (!db) return;

  db.collection('matches').onSnapshot(snapshot => {
    if (snapshot.empty) {
      console.log('[WC2026] Firestore vacío. Usá admin-seed.html para cargar datos.');
      return;
    }

    let hasChanges = false;

    snapshot.docChanges().forEach(change => {
      if (change.type === 'added' || change.type === 'modified') {
        const data = change.doc.data();
        const localMatch = MATCHES.find(m => m.id === data.id);
        if (localMatch) {
          const prevStatus = localMatch.status;
          localMatch.homeScore = data.homeScore;
          localMatch.awayScore = data.awayScore;
          localMatch.status = data.status || 'upcoming';
          localMatch.minute = data.minute || null;

          // Track live → completed transitions
          if (prevStatus === 'live' && localMatch.status === 'completed') {
            console.log(`[WC2026] Finalizado: ${localMatch.home} ${localMatch.homeScore}-${localMatch.awayScore} ${localMatch.away}`);
          }

          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      console.log('[WC2026] Datos actualizados. Refrescando UI...');
      recalculateStandings();
      refreshUI();
    }
  }, error => {
    console.error('[WC2026] Error en listener de partidos:', error);
  });
}

/* ===== GROUP STANDINGS CALCULATOR ===== */
function recalculateStandings() {
  // Reset all team stats to zero
  Object.keys(GROUPS).forEach(g => {
    GROUPS[g].forEach(t => {
      t.played = 0;
      t.won = 0;
      t.drawn = 0;
      t.lost = 0;
      t.goalsFor = 0;
      t.goalsAgainst = 0;
      t.points = 0;
    });
  });

  // Process all completed group stage matches
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

      // Update played
      home.played++;
      away.played++;

      // Update goals
      home.goalsFor += hs;
      home.goalsAgainst += as;
      away.goalsFor += as;
      away.goalsAgainst += hs;

      // Update result
      if (hs > as) {
        home.won++;
        home.points += 3;
        away.lost++;
      } else if (hs < as) {
        away.won++;
        away.points += 3;
        home.lost++;
      } else {
        home.drawn++;
        away.drawn++;
        home.points++;
        away.points++;
      }
    });

  // Sort each group: Points → Goal Difference → Goals For → Alphabetical
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

/* ===== SCORERS LISTENER ===== */
function listenScorers() {
  if (!db) return;

  db.collection('scorers')
    .orderBy('goals', 'desc')
    .limit(20)
    .onSnapshot(snapshot => {
      if (snapshot.empty) return;
      // Deduplicate by player name + team (in case of double-seed)
      const seen = {};
      const unique = [];
      snapshot.docs.forEach(doc => {
        const d = doc.data();
        const key = (d.name || '') + '_' + (d.teamCode || '');
        if (!seen[key]) { seen[key] = true; unique.push(d); }
      });
      unique.sort((a, b) => {
        if (b.goals !== a.goals) return b.goals - a.goals;
        return (b.assists || 0) - (a.assists || 0);
      });
      STATS.scorers = unique;
      renderScorers();
      console.log('[WC2026] Goleadores actualizados:', STATS.scorers.length);
    }, error => {
      console.error('[WC2026] Error en listener de goleadores:', error);
    });
}

/* ===== CARDS LISTENER ===== */
function listenCards() {
  if (!db) return;

  db.collection('cards')
    .orderBy('count', 'desc')
    .limit(30)
    .onSnapshot(snapshot => {
      if (snapshot.empty) return;
      const all = snapshot.docs.map(doc => doc.data());
      STATS.yellowCards = all.filter(c => c.type === 'yellow');
      STATS.redCards = all.filter(c => c.type === 'red');
      renderCards();
      console.log('[WC2026] Tarjetas actualizadas.');
    }, error => {
      console.error('[WC2026] Error en listener de tarjetas:', error);
    });
}

/* ===== UI REFRESH ===== */
/**
 * Re-render all sections with updated Firebase data.
 * Preserves current filter state in calendar.
 */
function refreshUI() {
  // Upcoming matches in hero section
  renderUpcomingMatches();

  // Calendar (preserve active filter)
  const container = document.getElementById('calendar-content');
  if (container) {
    const activeBtn = document.querySelector('.calendar__filter-btn.active');
    const filter = activeBtn ? activeBtn.dataset.filter : 'all';
    const groupMatches = MATCHES.filter(m => m.stage === 'group');
    renderCalendar(container, groupMatches, filter);
  }

  // Group standings
  initGroups();

  // Bracket
  if (KNOCKOUT_LIVE) {
    initBracket();
  }

  // Stats
  renderScorers();
  renderCards();
}

/* ===== KNOCKOUT LISTENER ===== */
function listenKnockout() {
  if (!db) return;

  db.collection('knockout').onSnapshot(snapshot => {
    if (snapshot.empty) {
      console.log('[WC2026] Sin datos de eliminatorias en Firestore.');
      return;
    }

    // Organize docs by round into KNOCKOUT-compatible structure
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

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

    console.log('[WC2026] Eliminatorias actualizadas. Re-renderizando bracket...');
    initBracket();
  }, error => {
    console.error('[WC2026] Error en listener de eliminatorias:', error);
  });
}

/* ===== QUALIFIERS CALCULATOR ===== */
/**
 * Determines the 32 teams that qualify for the Round of 32.
 * - Top 2 from each of 12 groups (24 teams)
 * - 8 best third-placed teams
 *
 * Tiebreakers for thirds: Points → GD → GF → Alphabetical
 * Returns { groupWinners, groupRunnersUp, bestThirds } or null if groups not complete.
 */
function determineQualifiers() {
  const groupMatches = MATCHES.filter(m => m.stage === 'group');
  const totalGroupMatches = groupMatches.length;
  const completedGroupMatches = groupMatches.filter(m => m.status === 'completed').length;

  if (completedGroupMatches < totalGroupMatches) {
    console.warn(`[WC2026] Fase de grupos incompleta: ${completedGroupMatches}/${totalGroupMatches} partidos.`);
    return null;
  }

  recalculateStandings();

  const groupWinners = {};   // '1A': 'MEX'
  const groupRunnersUp = {}; // '2B': 'CAN'
  const allThirds = [];

  'ABCDEFGHIJKL'.split('').forEach(g => {
    const teams = GROUPS[g];
    if (!teams || teams.length < 3) return;

    groupWinners[`1${g}`] = teams[0].code;
    groupRunnersUp[`2${g}`] = teams[1].code;

    allThirds.push({
      code: teams[2].code,
      name: teams[2].name,
      group: g,
      points: teams[2].points,
      goalsFor: teams[2].goalsFor,
      goalsAgainst: teams[2].goalsAgainst,
      goalDiff: teams[2].goalsFor - teams[2].goalsAgainst
    });
  });

  // Sort thirds by FIFA tiebreakers
  allThirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.name.localeCompare(b.name);
  });

  return { groupWinners, groupRunnersUp, bestThirds: allThirds.slice(0, 8) };
}

/**
 * Assigns the 8 best third-placed teams to R32-13 through R32-16.
 *
 * FIFA 2026 Format:
 *   R32-13: 3rd from {A,B,C} vs 3rd from {D,E,F}
 *   R32-14: 3rd from {A,B,C} vs 3rd from {D,E,F}
 *   R32-15: 3rd from {G,H,I} vs 3rd from {J,K,L}
 *   R32-16: 3rd from {G,H,I} vs 3rd from {J,K,L}
 *
 * If a group set doesn't have enough qualifying thirds,
 * the next best available from another set fills in.
 */
function assignThirdPlaceTeams(bestThirds) {
  // Categorize by group set
  const setABC = bestThirds.filter(t => 'ABC'.includes(t.group));
  const setDEF = bestThirds.filter(t => 'DEF'.includes(t.group));
  const setGHI = bestThirds.filter(t => 'GHI'.includes(t.group));
  const setJKL = bestThirds.filter(t => 'JKL'.includes(t.group));

  const assignments = {
    'R32-13': { home: null, away: null },
    'R32-14': { home: null, away: null },
    'R32-15': { home: null, away: null },
    'R32-16': { home: null, away: null }
  };

  const used = new Set();

  // Helper: pick best unused from a set
  const pick = (set) => set.find(t => !used.has(t.code)) || null;

  // R32-13 and R32-14: {A,B,C} vs {D,E,F}
  assignments['R32-13'].home = pick(setABC);
  if (assignments['R32-13'].home) used.add(assignments['R32-13'].home.code);
  assignments['R32-13'].away = pick(setDEF);
  if (assignments['R32-13'].away) used.add(assignments['R32-13'].away.code);

  assignments['R32-14'].home = pick(setABC);
  if (assignments['R32-14'].home) used.add(assignments['R32-14'].home.code);
  assignments['R32-14'].away = pick(setDEF);
  if (assignments['R32-14'].away) used.add(assignments['R32-14'].away.code);

  // R32-15 and R32-16: {G,H,I} vs {J,K,L}
  assignments['R32-15'].home = pick(setGHI);
  if (assignments['R32-15'].home) used.add(assignments['R32-15'].home.code);
  assignments['R32-15'].away = pick(setJKL);
  if (assignments['R32-15'].away) used.add(assignments['R32-15'].away.code);

  assignments['R32-16'].home = pick(setGHI);
  if (assignments['R32-16'].home) used.add(assignments['R32-16'].home.code);
  assignments['R32-16'].away = pick(setJKL);
  if (assignments['R32-16'].away) used.add(assignments['R32-16'].away.code);

  // Fill any remaining nulls with unused thirds (edge case)
  const unused = bestThirds.filter(t => !used.has(t.code));
  Object.entries(assignments).forEach(([slotId, teams]) => {
    if (!teams.home && unused.length > 0) teams.home = unused.shift().code;
    if (!teams.away && unused.length > 0) teams.away = unused.shift().code;
  });

  return assignments;
}

/**
 * Calculate qualifiers and write R32 assignments to Firestore.
 * Call from admin-seed.html after all 72 group matches are completed.
 */
async function calculateAndAssignQualifiers() {
  if (!db) return { success: false, message: 'Firebase no conectado.' };

  const result = determineQualifiers();
  if (!result) {
    return { success: false, message: 'No todos los partidos de grupos están completados.' };
  }

  const { groupWinners, groupRunnersUp, bestThirds } = result;
  const batch = db.batch();

  // R32-1 through R32-12: Group winners and runners-up
  const r32GroupMatchups = {
    'R32-1':  { home: groupWinners['1A'], away: groupRunnersUp['2B'] },
    'R32-2':  { home: groupWinners['1C'], away: groupRunnersUp['2D'] },
    'R32-3':  { home: groupWinners['1E'], away: groupRunnersUp['2F'] },
    'R32-4':  { home: groupWinners['1G'], away: groupRunnersUp['2H'] },
    'R32-5':  { home: groupWinners['1I'], away: groupRunnersUp['2J'] },
    'R32-6':  { home: groupWinners['1K'], away: groupRunnersUp['2L'] },
    'R32-7':  { home: groupWinners['1B'], away: groupRunnersUp['2A'] },
    'R32-8':  { home: groupWinners['1D'], away: groupRunnersUp['2C'] },
    'R32-9':  { home: groupWinners['1F'], away: groupRunnersUp['2E'] },
    'R32-10': { home: groupWinners['1H'], away: groupRunnersUp['2G'] },
    'R32-11': { home: groupWinners['1J'], away: groupRunnersUp['2I'] },
    'R32-12': { home: groupWinners['1L'], away: groupRunnersUp['2K'] }
  };

  Object.entries(r32GroupMatchups).forEach(([id, teams]) => {
    if (!teams.home || !teams.away) return;
    const homeName = TEAMS[teams.home]?.name || teams.home;
    const awayName = TEAMS[teams.away]?.name || teams.away;
    batch.update(db.collection('knockout').doc(id), {
      home: teams.home,
      away: teams.away,
      label: `${homeName} vs ${awayName}`
    });
  });

  // R32-13 through R32-16: Third-placed teams
  const thirdAssignments = assignThirdPlaceTeams(bestThirds);

  Object.entries(thirdAssignments).forEach(([id, teams]) => {
    if (!teams.home || !teams.away) return;
    const homeName = TEAMS[teams.home]?.name || teams.home;
    const awayName = TEAMS[teams.away]?.name || teams.away;
    batch.update(db.collection('knockout').doc(id), {
      home: teams.home,
      away: teams.away,
      label: `${homeName} vs ${awayName}`
    });
  });

  await batch.commit();

  // Log qualified teams
  const qualified = [...Object.values(groupWinners), ...Object.values(groupRunnersUp), ...bestThirds.map(t => t.code)];
  console.log('[WC2026] Clasificados a R32:', qualified.map(c => TEAMS[c]?.name || c).join(', '));

  return {
    success: true,
    message: `32 clasificados. R32 actualizado.`,
    qualified: qualified,
    thirds: bestThirds.map(t => `${t.name} (${t.group}) - ${t.points}pts, GD:${t.goalDiff}`)
  };
}

/**
 * Propagate winners through the knockout bracket.
 * After each round completes, winners advance to the next round.
 * Call from admin-seed.html after completing knockout matches.
 */
async function propagateWinners() {
  if (!db) return { success: false, message: 'Firebase no conectado.' };

  // Get all knockout matches
  const snapshot = await db.collection('knockout').get();
  if (snapshot.empty) {
    return { success: false, message: 'No hay partidos de eliminatorias.' };
  }

  const allMatches = {};
  snapshot.docs.forEach(doc => { allMatches[doc.id] = doc.data(); });

  const batch = db.batch();
  let propagated = 0;

  // For each target match, check if its feeders are complete
  Object.entries(FEEDER_MAP).forEach(([targetId, feeders]) => {
    const target = allMatches[targetId];
    if (!target) return;

    const homeFeeder = allMatches[feeders.home];
    const awayFeeder = allMatches[feeders.away];
    if (!homeFeeder || !awayFeeder) return;

    // Determine who advances from each feeder
    const getAdvancing = (feeder, isLoserSlot) => {
      if (feeder.status !== 'completed') return null;
      if (feeder.homeScore === feeder.awayScore) return null; // Draw = not decided
      if (isLoserSlot) {
        // Loser advances (3rd place)
        return feeder.homeScore > feeder.awayScore ? feeder.away : feeder.home;
      }
      // Winner advances
      return feeder.homeScore > feeder.awayScore ? feeder.home : feeder.away;
    };

    const advancingHome = getAdvancing(homeFeeder, false);
    const advancingAway = getAdvancing(awayFeeder, feeders.useLoser || false);

    let needsUpdate = false;

    if (advancingHome && target.home !== advancingHome) {
      target.home = advancingHome;
      needsUpdate = true;
    }

    if (advancingAway && target.away !== advancingAway) {
      target.away = advancingAway;
      needsUpdate = true;
    }

    if (needsUpdate) {
      const homeName = target.home ? (TEAMS[target.home]?.name || target.home) : 'Por definir';
      const awayName = target.away ? (TEAMS[target.away]?.name || target.away) : 'Por definir';
      batch.update(db.collection('knockout').doc(targetId), {
        home: target.home || null,
        away: target.away || null,
        label: `${homeName} vs ${awayName}`
      });
      propagated++;
    }
  });

  if (propagated > 0) {
    await batch.commit();
  }

  return {
    success: true,
    message: propagated > 0
      ? `${propagated} equipo(s) propagados al bracket.`
      : 'No hay nuevos ganadores para propagar.',
    propagated: propagated
  };
}

/* ===== UTILITY ===== */
function isFirebaseReady() {
  return firebaseReady;
}
