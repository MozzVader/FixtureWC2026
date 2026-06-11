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

/* ===== TOAST TRACKING ===== */
// Suppress toasts during initial Firestore load (first snapshot)
let _toastsReady = false;
// Per-listener first-load flags (each listener has its own initial snapshot)
let _matchesFirstDone = false;
let _knockoutFirstDone = false;
let _scorersFirstDone = false;
let _cardsFirstDone = false;
// Track known scorers/cards to detect new entries
const _knownScorers = new Set();
const _knownCards = new Set();
// Track previous match scores for goal detection
const _prevScores = {};  // matchId → { homeScore, awayScore, status }

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

    // Enable toasts after a delay (all 4 listeners got their first snapshot)
    setTimeout(() => {
      _toastsReady = true;
      console.log('[WC2026] Toast notifications activadas.');
    }, 3000);

  } catch (e) {
    console.error('[WC2026] Error al inicializar Firebase:', e);
  }

  // ESPN polling works independently of Firebase (direct API → MATCHES[] → UI)
  startEspnPolling();
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
          const prevHomeScore = localMatch.homeScore;
          const prevAwayScore = localMatch.awayScore;
          localMatch.homeScore = data.homeScore;
          localMatch.awayScore = data.awayScore;
          localMatch.status = data.status || 'upcoming';
          localMatch.minute = data.minute || null;

          // ─── Toast detection (only after initial load AND real-time changes) ───
          if (_toastsReady && _matchesFirstDone && change.type === 'modified' && typeof showToast === 'function') {
            const homeTeam = TEAMS[localMatch.home];
            const awayTeam = TEAMS[localMatch.away];

            // Match started: upcoming → live (or halftime)
            if (prevStatus === 'upcoming' && (localMatch.status === 'live' || localMatch.status === 'halftime')) {
              showToast('match-start', {
                homeName: homeTeam ? homeTeam.name : localMatch.home,
                awayName: awayTeam ? awayTeam.name : localMatch.away,
                homeFlag: homeTeam ? getFlagHtml(homeTeam.code) : '',
                awayFlag: awayTeam ? getFlagHtml(awayTeam.code) : '',
                venue: localMatch.city ? localMatch.city + ' · ' + localMatch.venue : ''
              });
            }

            // Goal detected: score changed (works for ANY status change, not just live)
            if (prevHomeScore != null && data.homeScore != null &&
                prevAwayScore != null && data.awayScore != null) {
              const homeDiff = data.homeScore - prevHomeScore;
              const awayDiff = data.awayScore - prevAwayScore;
              // Home team scored
              if (homeDiff > 0 && homeTeam) {
                showToast('goal', {
                  playerName: '',
                  teamName: homeTeam.name,
                  flag: getFlagHtml(homeTeam.code),
                  matchLabel: homeTeam.name + ' ' + data.homeScore + ' - ' + data.awayScore + ' ' + (awayTeam ? awayTeam.name : ''),
                  minute: data.minute ? data.minute + "'" : ''
                });
              }
              // Away team scored
              if (awayDiff > 0 && awayTeam) {
                showToast('goal', {
                  playerName: '',
                  teamName: awayTeam.name,
                  flag: getFlagHtml(awayTeam.code),
                  matchLabel: (homeTeam ? homeTeam.name : '') + ' ' + data.homeScore + ' - ' + data.awayScore + ' ' + awayTeam.name,
                  minute: data.minute ? data.minute + "'" : ''
                });
              }
            }

            // Match ended: live/halftime → completed (or any → completed with score)
            if ((prevStatus === 'live' || prevStatus === 'halftime' || prevStatus === 'upcoming') && localMatch.status === 'completed') {
              console.log(`[WC2026] Finalizado: ${localMatch.home} ${localMatch.homeScore}-${localMatch.awayScore} ${localMatch.away}`);
              showToast('match-end', {
                homeName: homeTeam ? homeTeam.name : localMatch.home,
                awayName: awayTeam ? awayTeam.name : localMatch.away,
                homeScore: localMatch.homeScore,
                awayScore: localMatch.awayScore,
                homeFlag: homeTeam ? getFlagHtml(homeTeam.code) : '',
                awayFlag: awayTeam ? getFlagHtml(awayTeam.code) : ''
              });
            }
          }

          hasChanges = true;
        }
      }
    });

    // Mark matches listener first load complete
    if (!_matchesFirstDone) {
      _matchesFirstDone = true;
      console.log('[WC2026] Matches listener: primer snapshot completo.');
    }

    if (hasChanges) {
      console.log('[WC2026] Datos actualizados. Refrescando UI...');
      recalculateStandings();
      refreshUI();
      // Auto-update knockout qualifiers as groups complete (admin-only)
      autoUpdateQualifiers();
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
    .onSnapshot(snapshot => {
      if (snapshot.empty && _knownScorers.size === 0) return;
      // Aggregate goals/assists per player (each goal is a separate doc)
      const playerMap = {};
      snapshot.docs.forEach(doc => {
        const d = doc.data();
        const key = (d.name || '') + '_' + (d.teamCode || '');
        if (!playerMap[key]) {
          playerMap[key] = { name: d.name, teamCode: d.teamCode, goals: 0, assists: 0 };
        }
        playerMap[key].goals += (d.goals || 1);
        playerMap[key].assists += (d.assists || 0);
      });
      const aggregated = Object.values(playerMap).sort((a, b) => {
        if (b.goals !== a.goals) return b.goals - a.goals;
        return (b.assists || 0) - (a.assists || 0);
      });
      STATS.scorers = aggregated.slice(0, 20);
      renderScorers();
      console.log('[WC2026] Goleadores actualizados:', STATS.scorers.length);

      // ─── Goal Toast: detect new scorer entries (only after first load) ───
      if (_scorersFirstDone && typeof showToast === 'function') {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const d = change.doc.data();
            const key = (d.name || '') + '_' + (d.teamCode || '');
            if (_knownScorers.has(key)) return;
            _knownScorers.add(key);

            const team = TEAMS[d.teamCode];
            const matchId = d.matchId;
            let matchLabel = '';
            if (matchId != null) {
              const match = MATCHES.find(m => String(m.id) === String(matchId));
              if (match) {
                const ht = TEAMS[match.home];
                const at = TEAMS[match.away];
                matchLabel = (ht ? ht.name : match.home) + ' ' + (match.homeScore != null ? match.homeScore : '?') +
                  ' - ' + (match.awayScore != null ? match.awayScore : '?') + ' ' + (at ? at.name : match.away);
              }
            }
            showToast('goal', {
              playerName: d.name || 'Gol',
              teamName: team ? team.name : (d.teamCode || ''),
              flag: team ? getFlagHtml(team.code) : '',
              matchLabel: matchLabel,
              minute: d.minute || ''
            });
          }
        });
      }
      // Populate known set on first load (suppress toasts)
      if (!_scorersFirstDone) {
        snapshot.docs.forEach(doc => {
          const d = doc.data();
          _knownScorers.add((d.name || '') + '_' + (d.teamCode || ''));
        });
        _scorersFirstDone = true;
      }
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
      if (snapshot.empty && _knownCards.size === 0) return;
      const all = snapshot.docs.map(doc => doc.data());
      STATS.yellowCards = all.filter(c => c.type === 'yellow');
      STATS.redCards = all.filter(c => c.type === 'red');
      renderCards();
      console.log('[WC2026] Tarjetas actualizadas.');

      // ─── Card Toast: detect new card entries (only after first load) ───
      if (_cardsFirstDone && typeof showToast === 'function') {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const d = change.doc.data();
            const key = (d.name || '') + '_' + (d.teamCode || '') + '_' + (d.type || '');
            if (_knownCards.has(key)) return;
            _knownCards.add(key);

            const team = TEAMS[d.teamCode];
            const cardType = d.type === 'red' ? 'card--red' : 'card--yellow';
            const matchId = d.matchId;
            let matchLabel = '';
            if (matchId != null) {
              const match = MATCHES.find(m => String(m.id) === String(matchId));
              if (match) {
                const ht = TEAMS[match.home];
                const at = TEAMS[match.away];
                matchLabel = (ht ? ht.name : match.home) + ' vs ' + (at ? at.name : match.away);
              }
            }
            showToast(cardType, {
              playerName: d.name || '',
              teamName: team ? team.name : (d.teamCode || ''),
              flag: team ? getFlagHtml(team.code) : '',
              matchLabel: matchLabel,
              minute: d.minute || ''
            });
          }
        });
      }
      // Populate known set on first load (suppress toasts)
      if (!_cardsFirstDone) {
        snapshot.docs.forEach(doc => {
          const d = doc.data();
          _knownCards.add((d.name || '') + '_' + (d.teamCode || '') + '_' + (d.type || ''));
        });
        _cardsFirstDone = true;
      }
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
  // Today's matches in hero section
  if (typeof renderTodayMatches === 'function') renderTodayMatches();

  // Upcoming matches in hero section
  renderUpcomingMatches();

  // Calendar (preserve active filter/tab)
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
    // Normalize: if home/away is an object (legacy bug), extract .code
    const docs = snapshot.docs.map(d => {
      const raw = { id: d.id, ...d.data() };
      if (raw.home && typeof raw.home === 'object') raw.home = raw.home.code || null;
      if (raw.away && typeof raw.away === 'object') raw.away = raw.away.code || null;
      return raw;
    });

    // ─── Knockout Toast detection (only after first load + modified docs) ───
    if (_toastsReady && _knockoutFirstDone && typeof showToast === 'function') {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'modified') {
          const d = { id: change.doc.id, ...change.doc.data() };
          if (d.home && typeof d.home === 'object') d.home = d.home.code || null;
          if (d.away && typeof d.away === 'object') d.away = d.away.code || null;

          const prev = KNOCKOUT_LIVE ? flattenKnockout(KNOCKOUT_LIVE).find(m => m.id === d.id) : null;
          if (!prev) return;

          const prevStatus = prev.status || 'upcoming';
          const newStatus = d.status || 'upcoming';
          const homeTeam = d.home ? TEAMS[d.home] : null;
          const awayTeam = d.away ? TEAMS[d.away] : null;

          // Knockout match started
          if (prevStatus === 'upcoming' && (newStatus === 'live' || newStatus === 'halftime') && homeTeam && awayTeam) {
            // Determine round label
            const roundLabel = getKnockoutRoundLabel(d.id);
            showToast('match-start', {
              homeName: homeTeam.name,
              awayName: awayTeam.name,
              homeFlag: getFlagHtml(homeTeam.code),
              awayFlag: getFlagHtml(awayTeam.code),
              venue: roundLabel + (d.date ? ' · ' + formatDate(d.date) : '')
            });
          }

          // Goal in knockout
          if (newStatus === 'live' && prev.homeScore != null && d.homeScore != null &&
              prev.awayScore != null && d.awayScore != null) {
            const homeDiff = (d.homeScore || 0) - (prev.homeScore || 0);
            const awayDiff = (d.awayScore || 0) - (prev.awayScore || 0);
            if (homeDiff > 0 && homeTeam) {
              showToast('goal', {
                playerName: '',
                teamName: homeTeam.name,
                flag: getFlagHtml(homeTeam.code),
                matchLabel: getKnockoutRoundLabel(d.id) + ': ' + homeTeam.name + ' ' + d.homeScore + ' - ' + d.awayScore + ' ' + (awayTeam ? awayTeam.name : ''),
                minute: d.minute ? d.minute + "'" : ''
              });
            }
            if (awayDiff > 0 && awayTeam) {
              showToast('goal', {
                playerName: '',
                teamName: awayTeam.name,
                flag: getFlagHtml(awayTeam.code),
                matchLabel: getKnockoutRoundLabel(d.id) + ': ' + (homeTeam ? homeTeam.name : '') + ' ' + d.homeScore + ' - ' + d.awayScore + ' ' + awayTeam.name,
                minute: d.minute ? d.minute + "'" : ''
              });
            }
          }

          // Knockout match ended
          if ((prevStatus === 'live' || prevStatus === 'halftime') && newStatus === 'completed' && homeTeam && awayTeam) {
            showToast('match-end', {
              homeName: homeTeam.name,
              awayName: awayTeam.name,
              homeScore: d.homeScore,
              awayScore: d.awayScore,
              homeFlag: getFlagHtml(homeTeam.code),
              awayFlag: getFlagHtml(awayTeam.code)
            });
          }
        }
      });
    }

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

    // Mark knockout first load done
    if (!_knockoutFirstDone) {
      _knockoutFirstDone = true;
      console.log('[WC2026] Knockout listener: primer snapshot completo.');
    }

    console.log('[WC2026] Eliminatorias actualizadas. Re-renderizando bracket...');
    initBracket();
    refreshKnockoutCalendar();
    // Auto-propagate winners when knockout matches are completed (admin-only)
    autoPropagateWinners();
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

  // Helper: pick best unused from a set (returns only the code string)
  const pick = (set) => set.find(t => !used.has(t.code))?.code || null;

  // R32-13 and R32-14: {A,B,C} vs {D,E,F}
  assignments['R32-13'].home = pick(setABC);
  if (assignments['R32-13'].home) used.add(assignments['R32-13'].home);
  assignments['R32-13'].away = pick(setDEF);
  if (assignments['R32-13'].away) used.add(assignments['R32-13'].away);

  assignments['R32-14'].home = pick(setABC);
  if (assignments['R32-14'].home) used.add(assignments['R32-14'].home);
  assignments['R32-14'].away = pick(setDEF);
  if (assignments['R32-14'].away) used.add(assignments['R32-14'].away);

  // R32-15 and R32-16: {G,H,I} vs {J,K,L}
  assignments['R32-15'].home = pick(setGHI);
  if (assignments['R32-15'].home) used.add(assignments['R32-15'].home);
  assignments['R32-15'].away = pick(setJKL);
  if (assignments['R32-15'].away) used.add(assignments['R32-15'].away);

  assignments['R32-16'].home = pick(setGHI);
  if (assignments['R32-16'].home) used.add(assignments['R32-16'].home);
  assignments['R32-16'].away = pick(setJKL);
  if (assignments['R32-16'].away) used.add(assignments['R32-16'].away);

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

  // Build a date lookup from static KNOCKOUT data
  const staticDates = {};
  if (typeof KNOCKOUT !== 'undefined') {
    [...KNOCKOUT.roundOf32, ...KNOCKOUT.roundOf16, ...KNOCKOUT.quarterfinals,
     ...KNOCKOUT.semifinals, KNOCKOUT.thirdPlace, KNOCKOUT.final]
      .forEach(m => { if (m && m.id) staticDates[m.id] = m.date; });
  }

  // Helper: safely write a knockout match (creates if missing, merges if exists)
  const writeKO = (id, data) => {
    batch.set(db.collection('knockout').doc(id), {
      id: id,
      date: staticDates[id] || '',
      homeScore: null,
      awayScore: null,
      status: 'upcoming',
      minute: null,
      ...data
    }, { merge: true });
  };

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
    writeKO(id, {
      home: teams.home,
      away: teams.away,
      label: `${homeName} vs ${awayName}`
    });
  });

  // R32-13 through R32-16: Third-placed teams with descriptive labels
  const thirdAssignments = assignThirdPlaceTeams(bestThirds);

  Object.entries(thirdAssignments).forEach(([id, teams]) => {
    if (!teams.home || !teams.away) return;
    const homeName = TEAMS[teams.home]?.name || teams.home;
    const awayName = TEAMS[teams.away]?.name || teams.away;
    // Show which group the 3rd place came from
    const homeTeam = bestThirds.find(t => t.code === teams.home);
    const awayTeam = bestThirds.find(t => t.code === teams.away);
    const homeGroup = homeTeam ? `(3° ${homeTeam.group})` : '';
    const awayGroup = awayTeam ? `(3° ${awayTeam.group})` : '';
    writeKO(id, {
      home: teams.home,
      away: teams.away,
      label: `${homeName} ${homeGroup} vs ${awayName} ${awayGroup}`
    });
  });

  // Ensure all remaining rounds exist in Firestore (with placeholder labels)
  if (typeof KNOCKOUT !== 'undefined') {
    // R16
    KNOCKOUT.roundOf16.forEach(m => writeKO(m.id, { label: m.label }));
    // QF
    KNOCKOUT.quarterfinals.forEach(m => writeKO(m.id, { label: m.label }));
    // SF
    KNOCKOUT.semifinals.forEach(m => writeKO(m.id, { label: m.label }));
    // TP
    writeKO(KNOCKOUT.thirdPlace.id, { label: KNOCKOUT.thirdPlace.label });
    // Final
    writeKO(KNOCKOUT.final.id, { label: KNOCKOUT.final.label });
  }

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
      batch.set(db.collection('knockout').doc(targetId), {
        home: target.home || null,
        away: target.away || null,
        label: `${homeName} vs ${awayName}`
      }, { merge: true });
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

/* ===== AUTO-QUALIFIERS (REAL-TIME) ===== */
/**
 * Automatically populates R32 slots as groups complete.
 * - When a group's 6 matches are all completed → writes 1st and 2nd to their R32 slots
 * - When all 72 group matches are completed → also calculates and assigns best 8 thirds
 *
 * Called from listenMatches() after every match update.
 * Uses a Set to track already-written groups to avoid redundant Firestore writes.
 */
const _writtenGroups = new Set();

async function autoUpdateQualifiers() {
  if (!db) return;

  // Skip auto-write from public site (no auth) — only works from admin-seed.html
  // This prevents "Missing or insufficient permissions" errors
  console.log('[WC2026 AUTO] autoUpdateQualifiers: skip (solo desde admin).');
  return;
}

/* ===== AUTO-PROPAGATION (REAL-TIME) ===== */
/**
 * Automatically propagates winners through the knockout bracket.
 * When a knockout match is completed, the winner advances to the next round.
 *
 * Called from listenKnockout() after every knockout update.
 * Uses FEEDER_MAP to determine which match feeds into which.
 */
let _autoPropagating = false;

async function autoPropagateWinners() {
  if (!db || _autoPropagating) return;

  // Skip auto-write from public site (no auth) — only works from admin-seed.html
  console.log('[WC2026 AUTO] autoPropagateWinners: skip (solo desde admin).');
  return;
}

/* ===== UTILITY ===== */
function isFirebaseReady() {
  return firebaseReady;
}

/* ===== KNOCKOUT HELPERS (for toast system + calendar tab) ===== */

/**
 * Flatten knockout data into a single array of match objects.
 */
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

/**
 * Get a human-readable round label from a knockout match ID.
 */
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

/**
 * Refresh the knockout calendar tab if it's currently active.
 */
function refreshKnockoutCalendar() {
  const activeBtn = document.querySelector('.calendar__filter-btn.active');
  if (activeBtn && activeBtn.dataset.filter === 'knockout') {
    const container = document.getElementById('calendar-content');
    if (container && typeof renderKnockoutCalendar === 'function') {
      renderKnockoutCalendar(container);
    }
  }
}

/* ===== ESPN BROWSER POLLING =====
 * Polls ESPN API directly from the browser and writes live scores
 * to the Firestore 'matches' collection. The existing onSnapshot
 * listener (listenMatches) picks up the changes and refreshes the UI.
 *
 * This complements the server-side espn-poller.js (GitHub Actions)
 * by providing real-time updates when users have the page open.
 */

// Reverse map: ESPN ID → local match ID (ESPN_GROUP_MAP is in data.js)
const ESPN_TO_LOCAL_BROWSER = {};
for (const [localId, espnId] of Object.entries(ESPN_GROUP_MAP)) {
  ESPN_TO_LOCAL_BROWSER[espnId] = parseInt(localId);
}

const ESPN_API_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';
const ESPN_CORS_PROXIES = [
  { name: 'allorigins', build: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  { name: 'corsproxy.org', build: u => 'https://corsproxy.org/?' + encodeURIComponent(u) },
  { name: 'corsproxy.io',  build: u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
];

let _espnPollTimer = null;

function _parseESPNStatus(statusName) {
  switch (statusName) {
    case 'STATUS_IN_PROGRESS': case 'STATUS_1ST_PERIOD': case 'STATUS_2ND_PERIOD':
    case 'STATUS_3RD_PERIOD': case 'STATUS_FIRST_HALF': case 'STATUS_SECOND_HALF':
    case 'STATUS_EXTRA_TIME': case 'STATUS_PENALTY_SHOOTOUT':
      return 'live';
    case 'STATUS_HALFTIME': case 'STATUS_HALF_TIME':
      return 'halftime';
    case 'STATUS_FULL_TIME': case 'STATUS_FINAL':
    case 'STATUS_FINAL_AET': case 'STATUS_FINAL_PEN':
      return 'completed';
    default:
      return 'upcoming';
  }
}

async function _espnBrowserFetch(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.json();
  } catch (e) { /* CORS blocked */ }
  for (const proxy of ESPN_CORS_PROXIES) {
    try {
      const res = await fetch(proxy.build(url));
      if (res.ok) {
        console.log(`[ESPN-Poll] via ${proxy.name}`);
        return await res.json();
      }
    } catch (e) { /* try next */ }
  }
  return null;
}

function _getEspnPollDates() {
  const dates = [];
  const now = new Date();
  for (let offset = -1; offset <= 1; offset++) {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    dates.push(d.toISOString().split('T')[0].replace(/-/g, ''));
  }
  return dates;
}

const ESPN_CACHE_KEY = 'wc2026_espn_cache';
const ESPN_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — stale but better than nothing

/**
 * Save current live scores to localStorage.
 * Stores a map of matchId → { homeScore, awayScore, status, minute, ts }
 */
function _saveEspnCache() {
  const cache = {};
  MATCHES.forEach(m => {
    if (m.status && m.status !== 'upcoming') {
      cache[m.id] = {
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        status: m.status,
        minute: m.minute,
        ts: Date.now()
      };
    }
  });
  try {
    localStorage.setItem(ESPN_CACHE_KEY, JSON.stringify(cache));
  } catch(e) { /* quota exceeded, ignore */ }
}

/**
 * Restore live scores from localStorage cache into MATCHES[].
 * Called on page load before first ESPN poll.
 */
function _restoreEspnCache() {
  try {
    const raw = localStorage.getItem(ESPN_CACHE_KEY);
    if (!raw) return 0;
    const cache = JSON.parse(raw);
    let restored = 0;
    MATCHES.forEach(m => {
      const c = cache[m.id];
      if (!c) return;
      // Apply cached data (even if slightly stale, better than 'upcoming')
      if (c.homeScore != null) { m.homeScore = c.homeScore; restored++; }
      if (c.awayScore != null) { m.awayScore = c.awayScore; }
      if (c.status) { m.status = c.status; }
      if (c.minute != null) { m.minute = c.minute; }
    });
    if (restored > 0) {
      console.log(`[ESPN-Cache] ${restored} match(es) restored from localStorage`);
    }
    return restored;
  } catch(e) { return 0; }
}

async function _espnPollOnce() {
  const dates = _getEspnPollDates();
  let updated = 0;

  for (const dateStr of dates) {
    const url = `${ESPN_API_BASE}/scoreboard?dates=${dateStr}`;
    const data = await _espnBrowserFetch(url);
    if (!data || !data.events) continue;

    for (const event of data.events) {
      const espnId = String(event.id);
      const comp = event.competitions[0];
      const statusName = comp.status.type.name;
      if (statusName === 'STATUS_SCHEDULED') continue;

      const localId = ESPN_TO_LOCAL_BROWSER[espnId];
      if (!localId) continue;

      // Update MATCHES[] in memory directly (no Firestore write needed)
      const localMatch = MATCHES.find(m => m.id === localId);
      if (!localMatch) continue;

      const homeTeam = comp.competitors.find(t => t.homeAway === 'home');
      const awayTeam = comp.competitors.find(t => t.homeAway === 'away');
      if (!homeTeam || !awayTeam) continue;

      const homeScore = parseInt(homeTeam.score) || 0;
      const awayScore = parseInt(awayTeam.score) || 0;
      const status = _parseESPNStatus(statusName);
      const displayClock = comp.status.displayClock || '';
      const minute = (status === 'live' || status === 'halftime')
        ? (status === 'halftime' ? 'HT' : (displayClock || null))
        : null;

      // Only update if something changed
      if (localMatch.status !== status ||
          localMatch.homeScore !== homeScore ||
          localMatch.awayScore !== awayScore ||
          localMatch.minute !== minute) {
        localMatch.homeScore = homeScore;
        localMatch.awayScore = awayScore;
        localMatch.status = status;
        localMatch.minute = minute;
        updated++;
      }
    }
  }

  if (updated > 0) {
    console.log(`[ESPN-Poll] ${updated} match(es) updated from ESPN API`);
    // Persist to localStorage for next visit
    _saveEspnCache();
    // Refresh the entire UI with new data
    recalculateStandings();
    refreshUI();
  }
}

/**
 * Start browser-side ESPN polling (every 2 min).
 * Restores localStorage cache first for instant data on page load.
 * If cache is empty, backfills recent completed matchdays from ESPN.
 * Idempotent — safe to call multiple times.
 */
function startEspnPolling() {
  if (_espnPollTimer) return;
  console.log('[ESPN-Poll] Starting every 2 min...');
  // Restore cached results from previous visits (instant, no API call)
  const restored = _restoreEspnCache();
  if (restored > 0) {
    recalculateStandings();
    refreshUI();
  }
  // Fetch current live data immediately
  _espnPollOnce();
  // If no cache at all, backfill recent past matchdays (async, non-blocking)
  if (restored === 0) {
    _espnBackfill();
  }
  _espnPollTimer = setInterval(_espnPollOnce, 120000);
}

/**
 * Backfill: fetch past matchdays from ESPN to populate scores for
 * matches that already ended. Runs once on first visit with empty cache.
 */
async function _espnBackfill() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0].replace(/-/g, '');
  // Check up to 10 past days
  const pastDates = [];
  for (let i = 1; i <= 10; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    pastDates.push(d.toISOString().split('T')[0].replace(/-/g, ''));
  }

  let totalUpdated = 0;
  for (const dateStr of pastDates) {
    // Stop if we've gone before the tournament start
    if (dateStr < '20260611') break;
    const url = `${ESPN_API_BASE}/scoreboard?dates=${dateStr}`;
    const data = await _espnBrowserFetch(url);
    if (!data || !data.events) continue;

    for (const event of data.events) {
      const espnId = String(event.id);
      const comp = event.competitions[0];
      const statusName = comp.status.type.name;

      // Only interested in completed matches for backfill
      const status = _parseESPNStatus(statusName);
      if (status !== 'completed') continue;

      const localId = ESPN_TO_LOCAL_BROWSER[espnId];
      if (!localId) continue;
      const localMatch = MATCHES.find(m => m.id === localId);
      if (!localMatch) continue;
      // Skip if already has this result
      if (localMatch.status === 'completed' && localMatch.homeScore != null) continue;

      const homeTeam = comp.competitors.find(t => t.homeAway === 'home');
      const awayTeam = comp.competitors.find(t => t.homeAway === 'away');
      if (!homeTeam || !awayTeam) continue;

      localMatch.homeScore = parseInt(homeTeam.score) || 0;
      localMatch.awayScore = parseInt(awayTeam.score) || 0;
      localMatch.status = 'completed';
      localMatch.minute = null;
      totalUpdated++;
    }
    // Small delay between days to be nice to API
    await new Promise(r => setTimeout(r, 300));
  }

  if (totalUpdated > 0) {
    console.log(`[ESPN-Backfill] ${totalUpdated} historical match(es) restored`);
    _saveEspnCache();
    recalculateStandings();
    refreshUI();
  }
}
