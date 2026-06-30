#!/usr/bin/env node
/**
 * ESPN → Firestore Poller para WC2026 (OPTIMIZED)
 *
 * Este script se ejecuta como GitHub Actions (cron cada 5 min).
 * Función:
 *   1. Obtiene partidos del día desde ESPN API
 *   2. Para cada partido, determina si es fase de grupos o eliminatoria
 *   3. Parsea marcador, estado
 *   4. Escribe a Firestore (las colecciones /matches y /knockout)
 *   5. Scorers/cards SOLO se escriben cuando un partido TERMINA (summary API)
 *   6. Los listeners onSnapshot del frontend se actualizan automáticamente
 *
 * Optimizaciones vs. versión original:
 *   - No re-procesa partidos ya completados (skip completed)
 *   - Scorers/cards solo al completar (no durante live) → elimina ~90% de snapshot reads
 *   - Scorers/cards en batch (delete+add en un solo commit) → 1 snapshot trigger en vez de N
 *   - Usa summary API para scorers/cards (datos más completos)
 *   - Cache de knockout docs (1 read por ciclo en vez de por partido)
 *
 * Uso:
 *   node scripts/espn-poller.js
 *
 * Variables de entorno (setear en GitHub Actions secrets):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_PRIVATE_KEY  (PEM del service account)
 *   FIREBASE_CLIENT_EMAIL
 */

const ESPN_BASE = 'http://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

// ─── Group Match Mapping (local_id → ESPN event ID) ───
const ESPN_GROUP_MAP = {
  1:'760415',2:'760414',3:'760416',4:'760417',5:'760420',6:'760419',7:'760418',8:'760421',
  9:'760422',10:'760423',11:'760425',12:'760424',13:'760426',14:'760427',15:'760428',16:'760429',
  17:'760432',18:'760430',19:'760433',20:'760431',21:'760435',22:'760436',23:'760437',24:'760434',
  25:'760438',26:'760441',27:'760439',28:'760440',29:'760445',30:'760444',31:'760442',32:'760443',
  33:'760448',34:'760446',35:'760447',36:'760449',37:'760451',38:'760452',39:'760453',40:'760450',
  41:'760457',42:'760454',43:'760456',44:'760455',45:'760461',46:'760459',47:'760458',48:'760460',
  49:'760467',50:'760466',51:'760463',52:'760462',53:'760465',54:'760464',55:'760470',56:'760469',
  57:'760473',58:'760468',59:'760471',60:'760472',61:'760476',62:'760477',63:'760478',64:'760479',
  65:'760475',66:'760474',67:'760483',68:'760484',69:'760481',70:'760482',71:'760485',72:'760480'
};

// Reverse map: ESPN ID → local match ID
const ESPN_TO_LOCAL = {};
for (const [localId, espnId] of Object.entries(ESPN_GROUP_MAP)) {
  ESPN_TO_LOCAL[espnId] = parseInt(localId);
}

// ─── ESPN Team Code → Our Team Code ───
const TEAM_MAP = {
  'MEX':'MEX','RSA':'RSA','KOR':'KOR','CZE':'CZE','CAN':'CAN','BIH':'BIH','QAT':'QAT','SUI':'SUI',
  'BRA':'BRA','MAR':'MAR','HAI':'HAI','SCO':'SCO','USA':'USA','PAR':'PAR','AUS':'AUS','TUR':'TUR',
  'GER':'GER','CUW':'CUW','CIV':'CIV','ECU':'ECU','NED':'NED','JPN':'JPN','SWE':'SWE','TUN':'TUN',
  'BEL':'BEL','EGY':'EGY','IRN':'IRN','NZL':'NZL','ESP':'ESP','CPV':'CPV','KSA':'KSA','URU':'URU',
  'FRA':'FRA','SEN':'SEN','IRQ':'IRQ','NOR':'NOR','ARG':'ARG','ALG':'ALG','AUT':'AUT','JOR':'JOR',
  'POR':'POR','COD':'COD','UZB':'UZB','COL':'COL','ENG':'ENG','CRO':'CRO','GHA':'GHA','PAN':'PAN'
};

// ─── Knockout Feeder Map (which match feeds into which) ───
// home/away = which feeder's winner goes to home/away slot.
// useLoser = true means the LOSER advances (3rd place match).
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

// ─── Helpers ───
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function parseESPNStatus(statusName, completed) {
  switch (statusName) {
    case 'STATUS_SCHEDULED':    return 'upcoming';
    case 'STATUS_IN_PROGRESS':
    case 'STATUS_1ST_PERIOD':
    case 'STATUS_2ND_PERIOD':
    case 'STATUS_3RD_PERIOD':
    case 'STATUS_FIRST_HALF':
    case 'STATUS_SECOND_HALF':
    case 'STATUS_EXTRA_TIME':
    case 'STATUS_PENALTY_SHOOTOUT':
                               return 'live';
    case 'STATUS_HALFTIME':
    case 'STATUS_HALF_TIME':   return 'halftime';
    case 'STATUS_FULL_TIME':
      // ESPN uses STATUS_FULL_TIME for TWO scenarios:
      //   completed=true  → match is permanently finished after 90 min
      //   completed=false → 90 min ended, may continue to ET/PEN
      return completed ? 'completed' : 'full_time';
    case 'STATUS_FINAL':
    case 'STATUS_FINAL_AET':
    case 'STATUS_FINAL_PEN':   return 'completed';
    case 'STATUS_POSTPONED':   return 'postponed';
    case 'STATUS_SUSPENDED':   return 'suspended';
    default:                   return 'upcoming';
  }
}

function parseMinute(comp) {
  const display = comp.status?.displayClock;
  const detail = comp.status?.type?.detail || '';
  const minute = display || detail;
  if (!minute || minute === '0' || minute === "0'") return null;
  // Remove the ' suffix if present
  return String(minute).replace("'", '');
}

/**
 * Extract winner code from ESPN competitors array.
 * ESPN marks the winning team with `winner: true`.
 * Returns the team abbreviation mapped to our code, or null.
 */
function extractWinnerCode(competitors) {
  if (!competitors) return null;
  const winner = competitors.find(c => c.winner === true);
  if (!winner) return null;
  const rawCode = winner.team?.abbreviation || '';
  return TEAM_MAP[rawCode] || rawCode || null;
}

/**
 * Extract penalty shootout score by counting scored shootout penalties
 * per team from ESPN's `details` array (each shootout kick is a detail
 * entry with `shootout: true` and `penaltyKick: true`; `scoringPlay: true`
 * means it was converted). This is far more reliable than parsing the
 * free-text status detail/shortDetail string, whose exact wording ESPN
 * doesn't keep consistent across leagues/seasons.
 * Returns "home-away" (e.g. "3-4") or null if there was no shootout.
 */
function extractPenaltyScoreFromDetails(comp, homeTeamId, awayTeamId) {
  const details = comp.details || [];
  const shootoutKicks = details.filter(d => d.shootout === true);
  if (shootoutKicks.length === 0) return null;

  let homePens = 0;
  let awayPens = 0;
  shootoutKicks.forEach(d => {
    if (!d.scoringPlay) return; // only count converted kicks
    const teamId = d.team?.id;
    if (teamId === homeTeamId) homePens++;
    else if (teamId === awayTeamId) awayPens++;
  });

  return `${homePens}-${awayPens}`;
}

/**
 * Legacy fallback: try to parse a "2-3 on Pen" style string from the
 * status detail/shortDetail text. Kept as a fallback for cases where
 * `details` doesn't include shootout kick-by-kick data.
 */
function extractPenaltyScore(detail) {
  if (!detail) return null;
  const normalized = detail.replace(/\s+/g, ' ');
  const match = normalized.match(/(\d+)\s*[-–]\s*(\d+).*(?:Pen|PEN|Penalties|penalti)/i);
  return match ? `${match[1]}-${match[2]}` : null;
}

/**
 * Determine if match went to extra time based on ESPN status.
 */
function isAfterExtraTime(statusName) {
  return statusName === 'STATUS_FINAL_AET' || statusName === 'STATUS_FINAL_PEN';
}

/**
 * Determine if match was decided on penalties.
 */
function isAfterPenalties(statusName) {
  return statusName === 'STATUS_FINAL_PEN';
}

function parseMatchDetails(comp, competitors) {
  const details = comp.details || [];
  const goals = [];
  const cards = [];

  // Build team ID → abbreviation map from competitors (scoreboard only has team.id)
  const idToCode = {};
  if (competitors) {
    competitors.forEach(c => {
      if (c.team?.id && c.team?.abbreviation) {
        idToCode[c.team.id] = c.team.abbreviation;
      }
    });
  }

  for (const d of details) {
    const minute = d.clock?.displayValue || '';
    const isGoal = d.scoringPlay === true;

    // Support both scoreboard and summary structures
    // Summary: d.team.abbreviation, d.participants[0].athlete.displayName
    // Scoreboard: d.team.id, d.athletesInvolved[0].displayName
    let teamCode = d.team?.abbreviation || idToCode[d.team?.id] || '';
    let athlete = '';
    let assistName = '';
    if (d.participants?.[0]?.athlete?.displayName) {
      // Summary structure (full)
      athlete = d.participants[0].athlete.displayName;
      assistName = d.participants?.[1]?.athlete?.displayName || '';
    } else if (d.participants?.[0]?.name) {
      // Summary structure (flat — no .athlete wrapper)
      athlete = d.participants[0].name;
      assistName = d.participants?.[1]?.name || '';
    } else if (d.athletesInvolved?.[0]?.displayName) {
      // Scoreboard structure
      athlete = d.athletesInvolved[0].displayName;
      assistName = d.athletesInvolved?.[1]?.displayName || '';
    }
    const ourCode = TEAM_MAP[teamCode] || teamCode;

    // Cards: support both structures
    // Summary: d.cardType.displayValue = "Yellow Card" / "Red Card"
    // Scoreboard: d.yellowCard = true/false, d.redCard = true/false
    const cardType = d.cardType?.displayValue || '';
    const isYellow = cardType.includes('Yellow') || d.yellowCard === true;
    const isRed = cardType.includes('Red') || d.redCard === true;

    if (isGoal && athlete) {
      const ownGoal = d.ownGoal === true;
      const penalty = d.penaltyKick === true;
      const type = ownGoal ? 'own_goal' : (penalty ? 'penalty' : 'goal');
      goals.push({ minute, team: ourCode, scorer: athlete, assist: assistName, type });
    }

    if (isYellow && athlete) {
      cards.push({ minute, team: ourCode, player: athlete, type: 'yellow' });
    } else if (isRed && athlete) {
      cards.push({ minute, team: ourCode, player: athlete, type: 'red' });
    }
  }

  return { goals, cards };
}

/**
 * Determine if an ESPN event is a group match (by checking if it's in our map)
 */
function isGroupMatch(espnId) {
  return espnId in ESPN_TO_LOCAL;
}

/**
 * Get ART date string from UTC date
 */
function utcToArtDate(utcDateStr) {
  const d = new Date(utcDateStr);
  // ART = UTC-3
  const artOffset = -3 * 60;
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const artMs = utcMs + artOffset * 60000;
  return new Date(artMs).toISOString().slice(0, 10);
}

// ─── Firebase Admin Setup ───
let db = null;

function initFirebase() {
  if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
    console.error('[ESPN] ❌ Faltan variables de Firebase. Setear FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL.');
    process.exit(1);
  }

  try {
    const adminMod = require('firebase-admin');
    const cred = adminMod.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    });
    adminMod.initializeApp({ credential: cred });
    db = adminMod.firestore();
    console.log('[ESPN] ✅ Firebase Admin inicializado');
  } catch (e) {
    console.error('[ESPN] ❌ Error inicializando Firebase:', e.message);
    process.exit(1);
  }
}

// ─── Knockout Doc Cache (1 read per cycle instead of per match) ───
let _knockoutDocs = null;

function resetKnockoutCache() {
  _knockoutDocs = null;
}

async function getKnockoutDocs() {
  if (!_knockoutDocs) {
    const snap = await db.collection('knockout').get();
    _knockoutDocs = snap.docs;
    console.log(`[ESPN] 📦 Knockout cache cargada: ${_knockoutDocs.length} docs`);
  }
  return _knockoutDocs;
}

// ─── Write Group Match to Firestore ───
async function writeGroupMatch(localId, comp) {
  const teams = comp.competitors;
  const homeTeam = teams.find(t => t.homeAway === 'home');
  const awayTeam = teams.find(t => t.homeAway === 'away');

  const homeScore = parseInt(homeTeam.score) || 0;
  const awayScore = parseInt(awayTeam.score) || 0;
  const statusName = comp.status.type.name;
  const completed = comp.status.type.completed;
  const status = parseESPNStatus(statusName, completed);
  const minute = parseMinute(comp);

  const data = {
    id: localId,
    homeScore: status !== 'upcoming' ? homeScore : null,
    awayScore: status !== 'upcoming' ? awayScore : null,
    status,
    minute: (status === 'live' || status === 'halftime' || status === 'full_time') ? (status === 'halftime' ? 'HT' : minute) : null,
    winnerCode: status === 'completed' ? extractWinnerCode(teams) : null,
    afterExtraTime: status === 'completed' ? isAfterExtraTime(statusName) : null,
    penaltyScore: status === 'completed'
      ? (extractPenaltyScoreFromDetails(comp, homeTeam.team.id, awayTeam.team.id) || extractPenaltyScore(comp.status.type.detail))
      : null,
    lastUpdated: require('firebase-admin').firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('matches').doc(String(localId)).set(data, { merge: true });

  return { localId, status, homeScore, awayScore, minute };
}

// ─── Find & Write Knockout Match to Firestore ───
async function findAndWriteKnockout(comp) {
  const teams = comp.competitors;
  const homeTeam = teams.find(t => t.homeAway === 'home');
  const awayTeam = teams.find(t => t.homeAway === 'away');
  const homeCode = TEAM_MAP[homeTeam.team.abbreviation] || homeTeam.team.abbreviation;
  const awayCode = TEAM_MAP[awayTeam.team.abbreviation] || awayTeam.team.abbreviation;

  // Skip if teams are still TBD placeholders
  if (!TEAM_MAP[homeTeam.team.abbreviation] && !TEAM_MAP[awayTeam.team.abbreviation]) {
    return null;
  }

  // ─── Use cached knockout docs ───
  const allDocs = await getKnockoutDocs();
  let matchDoc = null;

  // STEP 1: Match by team codes (most reliable)
  for (const doc of allDocs) {
    const d = doc.data();
    if ((d.home === homeCode && d.away === awayCode) ||
        (d.home === awayCode && d.away === homeCode)) {
      matchDoc = doc;
      break;
    }
  }

  // STEP 2: Fallback — match by date (ART) for upcoming matches
  if (!matchDoc) {
    const artDate = utcToArtDate(comp.date);
    for (const doc of allDocs) {
      const d = doc.data();
      if (d.date === artDate && d.status === 'upcoming') {
        matchDoc = doc;
        break;
      }
    }
    // Also try previous day (timezone edge)
    if (!matchDoc) {
      const prevDate = new Date(new Date(artDate + 'T12:00:00').getTime() - 86400000).toISOString().slice(0, 10);
      for (const doc of allDocs) {
        const d = doc.data();
        if (d.date === prevDate && d.status === 'upcoming') {
          matchDoc = doc;
          break;
        }
      }
    }
  }

  if (!matchDoc) {
    console.log(`  ⚠️  No se encontró doc de eliminatoria para ${homeCode} vs ${awayCode}`);
    return null;
  }

  // ─── Skip already-completed knockout matches ───
  // Don't skip if the doc is missing winnerCode/afterExtraTime/penaltyScore —
  // it finished before this poller version existed and needs a one-time
  // backfill of the new fields (otherwise ET/PEN results stay stuck forever).
  const existing = matchDoc.data();
  const needsBackfill = existing.status === 'completed' &&
    (existing.winnerCode === undefined ||
     (existing.afterExtraTime === true && existing.penaltyScore === null));
  if (existing.status === 'completed' && !needsBackfill) {
    console.log(`  ⏭️  ${matchDoc.id} ya completado, saltando`);
    return null;
  }
  if (needsBackfill) {
    console.log(`  🔧 ${matchDoc.id} completado pero sin winnerCode/ET/PEN — backfilling`);
  }

  const homeScore = parseInt(homeTeam.score) || 0;
  const awayScore = parseInt(awayTeam.score) || 0;
  const statusName = comp.status.type.name;
  const completed = comp.status.type.completed;
  const status = parseESPNStatus(statusName, completed);
  const minute = parseMinute(comp);

  // Build update — only write scores/status/minute.
  // Do NOT overwrite home/away/label (static data has correct Spanish names).
  const data = {
    homeScore: status !== 'upcoming' ? homeScore : (existing.homeScore ?? null),
    awayScore: status !== 'upcoming' ? awayScore : (existing.awayScore ?? null),
    status,
    minute: (status === 'live' || status === 'halftime' || status === 'full_time') ? (status === 'halftime' ? 'HT' : minute) : null,
    winnerCode: status === 'completed' ? extractWinnerCode(teams) : null,
    afterExtraTime: status === 'completed' ? isAfterExtraTime(statusName) : null,
    penaltyScore: status === 'completed'
      ? (extractPenaltyScoreFromDetails(comp, homeTeam.team.id, awayTeam.team.id) || extractPenaltyScore(comp.status.type.detail))
      : null,
    lastUpdated: require('firebase-admin').firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('knockout').doc(matchDoc.id).set(data, { merge: true });

  return { koId: matchDoc.id, status, homeScore, awayScore, minute };
}

// ─── Replace Scorers (batched delete + add → 1 snapshot trigger) ───
async function replaceScorers(goals, matchId) {
  const batch = db.batch();

  // Delete existing scorers for this match
  const old = await db.collection('scorers')
    .where('matchId', '==', String(matchId)).get();
  old.forEach(doc => batch.delete(doc.ref));

  // Add new scorers
  let count = 0;
  for (const goal of goals) {
    if (!goal.scorer) continue;
    const ref = db.collection('scorers').doc();
    batch.set(ref, {
      name: goal.scorer,
      teamCode: goal.team,
      goals: 1,
      assists: 0,
      matchId: String(matchId),
      minute: goal.minute,
      type: goal.type,
    });
    count++;
  }

  if (count > 0 || old.size > 0) {
    await batch.commit();
  }
  return count;
}

// ─── Replace Cards (batched delete + add → 1 snapshot trigger) ───
async function replaceCards(cards, matchId) {
  const batch = db.batch();

  // Delete existing cards for this match
  const old = await db.collection('cards')
    .where('matchId', '==', String(matchId)).get();
  old.forEach(doc => batch.delete(doc.ref));

  // Add new cards
  let count = 0;
  for (const card of cards) {
    if (!card.player) continue;
    const ref = db.collection('cards').doc();
    batch.set(ref, {
      name: card.player,
      teamCode: card.team,
      type: card.type,
      count: 1,
      matchId: String(matchId),
      minute: card.minute,
    });
    count++;
  }

  if (count > 0 || old.size > 0) {
    await batch.commit();
  }
  return count;
}

// ─── Fetch summary and write scorers/cards (single operation per match completion) ───
async function writeSummaryScorersCards(espnId, localId) {
  try {
    const summary = await fetchJSON(`${ESPN_BASE}/summary?event=${espnId}`);
    const sumComp = summary.header.competitions[0];
    const { goals, cards } = parseMatchDetails(sumComp, sumComp.competitors);

    // Batched: delete old + add new in single commit per collection
    const goalCount = await replaceScorers(goals, localId);
    const cardCount = await replaceCards(cards, localId);
    console.log(`    📊 ${goalCount} goles, ${cardCount} tarjetas`);
  } catch (e) {
    console.log(`    ⚠️ No se pudo obtener summary: ${e.message}`);
  }
}

// ─── Propagate Knockout Winners ───
// After each cycle, check if any completed match's winner can advance to the next round.
async function propagateKnockoutWinners() {
  const allDocs = await getKnockoutDocs();
  const allMatches = {};
  allDocs.forEach(doc => { allMatches[doc.id] = doc.data(); });

  const batch = db.batch();
  let propagated = 0;

  const getAdvancing = (feeder, isLoserSlot) => {
    if (feeder.status !== 'completed') return null;
    // Use winnerCode when available (handles ET/PEN draws correctly)
    if (feeder.winnerCode) {
      if (isLoserSlot) {
        // Loser advances (3rd place match)
        return feeder.home === feeder.winnerCode ? feeder.away : feeder.home;
      }
      return feeder.winnerCode;
    }
    // Fallback: score comparison (shouldn't normally be needed)
    if (feeder.homeScore == null || feeder.awayScore == null) return null;
    if (feeder.homeScore === feeder.awayScore) return null;
    if (isLoserSlot) {
      return feeder.homeScore > feeder.awayScore ? feeder.away : feeder.home;
    }
    return feeder.homeScore > feeder.awayScore ? feeder.home : feeder.away;
  };

  for (const [targetId, feeders] of Object.entries(FEEDER_MAP)) {
    const target = allMatches[targetId];
    if (!target) continue;

    const homeFeeder = allMatches[feeders.home];
    const awayFeeder = allMatches[feeders.away];
    if (!homeFeeder || !awayFeeder) continue;

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
      batch.set(db.collection('knockout').doc(targetId), {
        home: target.home || null,
        away: target.away || null,
        label: `${target.home || 'Por definir'} vs ${target.away || 'Por definir'}`
      }, { merge: true });
      propagated++;
      console.log(`  🔄 ${targetId}: ${target.home} vs ${target.away}`);
    }
  }

  if (propagated > 0) {
    await batch.commit();
    resetKnockoutCache(); // Invalidate cache after writes
    console.log(`[ESPN] 🏆 ${propagated} equipo(s) propagados al bracket`);
  }

  return propagated;
}

// ─── Main Poller ───
async function poll(dateStr, { forceWrite = false } = {}) {
  console.log(`\n[ESPN] 🔍 Consultando ${dateStr}...`);

  let data;
  try {
    data = await fetchJSON(`${ESPN_BASE}/scoreboard?dates=${dateStr}`);
  } catch (e) {
    console.error(`[ESPN] ❌ Error fetch ${dateStr}:`, e.message);
    return { matches: 0, updated: 0 };
  }

  const events = data.events || [];
  if (events.length === 0) {
    console.log(`[ESPN] ℹ️  Sin partidos el ${dateStr}`);
    return { matches: 0, updated: 0 };
  }

  console.log(`[ESPN] 📋 ${events.length} partido(s) encontrado(s)`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const event of events) {
    const comp = event.competitions[0];
    const espnId = String(event.id);
    const statusName = comp.status.type.name;

    // Skip upcoming matches (no data to write)
    if (statusName === 'STATUS_SCHEDULED') continue;

    try {
      if (isGroupMatch(espnId)) {
        // ─── GROUP MATCH ───
        const localId = ESPN_TO_LOCAL[espnId];

        // ─── Skip already-completed matches (unless forceWrite/backfill) ───
        // Don't skip if the doc is missing winnerCode/afterExtraTime/penaltyScore —
        // those matches finished before this poller version existed and need a
        // one-time backfill of the new fields.
        if (!forceWrite) {
          const existingDoc = await db.collection('matches').doc(String(localId)).get();
          const existingData = existingDoc.exists ? existingDoc.data() : null;
          const needsBackfill = existingData && existingData.status === 'completed' &&
            existingData.winnerCode === undefined;
          if (existingData && existingData.status === 'completed' && !needsBackfill) {
            console.log(`  ⏭️  #${localId} ya completado, saltando`);
            skipped++;
            continue;
          }
          if (needsBackfill) {
            console.log(`  🔧 #${localId} completado pero sin winnerCode/ET/PEN — backfilling`);
          }
        }

        // Write match data (score, status, minute)
        const result = await writeGroupMatch(localId, comp);
        const homeTeam = comp.competitors.find(t => t.homeAway === 'home');
        const awayTeam = comp.competitors.find(t => t.homeAway === 'away');
        console.log(`  ✅ #${localId} ${homeTeam.team.abbreviation} ${result.homeScore}-${result.awayScore} ${awayTeam.team.abbreviation} [${result.status}]`);
        updated++;

        // ─── Scorers/Cards: ONLY when match completes ───
        if (forceWrite && result.status === 'completed') {
          // Backfill mode: write scorers/cards for all completed matches
          await writeSummaryScorersCards(espnId, localId);
        } else if (result.status === 'completed') {
          // Normal mode: check if this is a transition to completed
          // (we already skipped if existing was completed, so this IS a transition)
          await writeSummaryScorersCards(espnId, localId);
        }
        // Live/halftime: NO scorers/cards writes — only score/status/minute above

      } else {
        // ─── KNOCKOUT MATCH ───
        const result = await findAndWriteKnockout(comp);
        if (result) {
          const homeT = comp.competitors.find(t => t.homeAway === 'home');
          const awayT = comp.competitors.find(t => t.homeAway === 'away');
          const score = (result.homeScore != null) ? ` ${result.homeScore}-${result.awayScore} ` : ' ';
          console.log(`  ✅ ${result.koId} ${homeT.team.abbreviation}${score}${awayT.team.abbreviation} [${result.status}]`);
          updated++;
        }
      }
    } catch (e) {
      console.error(`  ❌ Error ESPN ${espnId}:`, e.message);
      errors++;
    }

    await delay(500); // Rate limit courtesy
  }

  console.log(`[ESPN] ✨ ${dateStr}: ${updated} actualizado(s), ${skipped} saltado(s), ${errors} error(es)`);
  return { matches: events.length, updated, skipped, errors };
}

// ─── Entry Point ───
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   ESPN → Firestore Poller — WC2026 (OPTIMIZED)  ║');
  console.log('╚══════════════════════════════════════════════════╝');

  // Check if we should poll (only during tournament dates)
  const now = new Date();
  const tournamentStart = new Date('2026-06-11');
  const tournamentEnd = new Date('2026-07-20');
  const isTournament = now >= tournamentStart && now <= tournamentEnd;

  // For testing: allow FORCE_POLL=true or specific date
  const forcePoll = process.env.FORCE_POLL === 'true';
  const specificDate = process.env.POLL_DATE; // YYYYMMDD format
  const backfillAll = process.env.BACKFILL_ALL === 'true';

  if (!isTournament && !forcePoll && !specificDate && !backfillAll) {
    console.log('[ESPN] ℹ️  Fuera del rango del torneo. No hay nada que actualizar.');
    console.log('[ESPN] ℹ️  Setear FORCE_POLL=true o POLL_DATE=YYYYMMDD para forzar.');
    return;
  }

  // Initialize Firebase
  initFirebase();

  // ─── BACKFILL ALL MODE: clean scorers/cards, then re-process all dates sequentially ───
  if (backfillAll) {
    console.log('[ESPN] 🧹 BACKFILL ALL — limpiando colecciones scorers y cards...');
    // Delete entire scorers collection
    const scorersSnap = await db.collection('scorers').get();
    if (scorersSnap.size > 0) {
      const batch = db.batch();
      scorersSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      console.log(`[ESPN] 🗑️  Eliminados ${scorersSnap.size} docs de scorers`);
    }
    // Delete entire cards collection
    const cardsSnap = await db.collection('cards').get();
    if (cardsSnap.size > 0) {
      const batch2 = db.batch();
      cardsSnap.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();
      console.log(`[ESPN] 🗑️  Eliminados ${cardsSnap.size} docs de cards`);
    }
    console.log('[ESPN] 📅 Procesando todas las fechas del torneo secuencialmente...');

    // Generate all dates from tournament start to today (ART)
    const artNow = new Date(now.getTime() + (-3 * 60 * 60000 + now.getTimezoneOffset() * 60000));
    let d = new Date(tournamentStart.getTime() + (-3 * 60 * 60000 + new Date('2026-06-11').getTimezoneOffset() * 60000));
    const end = new Date(artNow.getTime());
    let totalUpdated = 0;
    let dayNum = 0;
    while (d <= end) {
      const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
      dayNum++;
      console.log(`\n[ESPN] 📅 Día ${dayNum}: ${dateStr}`);
      // forceWrite=true: don't skip completed matches, always write scorers/cards
      const result = await poll(dateStr, { forceWrite: true });
      totalUpdated += result.updated;
      // Wait between dates to avoid Firestore quota
      if (d < end) {
        console.log('[ESPN] 😴 Esperando 3s antes de la próxima fecha...');
        await delay(3000);
      }
      d = new Date(d.getTime() + 86400000);
    }
    console.log(`\n[ESPN] 🏁 BACKFILL ALL completado: ${totalUpdated} partido(s) actualizado(s)`);
    return;
  }

  // Determine dates to poll (yesterday, today, tomorrow)
  const dates = [];
  if (specificDate) {
    dates.push(specificDate);
  } else {
    // Poll 1 day back through tomorrow
    const artNow = new Date(now.getTime() + (-3 * 60 * 60000 + now.getTimezoneOffset() * 60000));
    for (let offset = -1; offset <= 1; offset++) {
      const d = new Date(artNow.getTime() + offset * 86400000);
      dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }
  }

  // Remove duplicates
  const uniqueDates = [...new Set(dates)];

  // Reset knockout cache for this cycle
  resetKnockoutCache();

  let totalUpdated = 0;
  let totalSkipped = 0;
  for (const date of uniqueDates) {
    const result = await poll(date);
    totalUpdated += result.updated;
    totalSkipped += result.skipped || 0;
  }

  if (totalSkipped > 0) {
    console.log(`[ESPN] ⏭️  ${totalSkipped} partido(s) completados saltados`);
  }
  console.log(`\n[ESPN] 🏁 Total actualizado: ${totalUpdated} partido(s)`);

  // ─── Propagate knockout winners after all dates processed ───
  await propagateKnockoutWinners();
}

main().catch(e => {
  console.error('[ESPN] 💥 Fatal:', e);
  process.exit(1);
});