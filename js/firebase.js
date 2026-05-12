/**
 * WC2026 — Firebase Module
 * Real-time match updates, group standings calculation, live stats
 *
 * Requiere: firebase-config.js, data.js (cargados antes que este archivo)
 * Degradación elegante: si Firebase no está configurado, el sitio funciona
 * con los datos estáticos de data.js.
 *
 * Firestore Collections:
 *   /matches/{id}        → Partidos (72 fase de grupos + knockout)
 *   /scorers/{autoId}    → Goleadores del torneo
 *   /cards/{autoId}      → Tarjetas (amarillas/rojas)
 */

let db = null;
let firebaseReady = false;

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
    .orderBy('assists', 'desc')
    .limit(20)
    .onSnapshot(snapshot => {
      if (snapshot.empty) return;
      STATS.scorers = snapshot.docs.map(doc => doc.data());
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

  // Stats
  renderScorers();
  renderCards();
}

/* ===== UTILITY ===== */
function isFirebaseReady() {
  return firebaseReady;
}
