#!/usr/bin/env node
/**
 * ESPN → Firestore Poller para WC2026
 *
 * Este script se ejecuta como GitHub Actions (cron cada 5 min).
 * Función:
 *   1. Obtiene partidos del día desde ESPN API
 *   2. Para cada partido, determina si es fase de grupos o eliminatoria
 *   3. Parsea marcador, estado, goles, tarjetas
 *   4. Escribe a Firestore (las colecciones /matches y /knockout)
 *   5. Los listeners onSnapshot del frontend se actualizan automáticamente
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

// ─── Helpers ───
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function parseESPNStatus(statusName) {
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
    case 'STATUS_HALF_TIME':   return 'live';
    case 'STATUS_FULL_TIME':
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

function parseMatchDetails(comp) {
  const details = comp.details || [];
  const goals = [];
  const cards = [];

  for (const d of details) {
    const minute = d.clock?.displayValue || '';
    const teamCode = d.team?.abbreviation || '';
    const ourCode = TEAM_MAP[teamCode] || teamCode;
    const athlete = d.participants?.[0]?.athlete?.displayName || '';
    const isGoal = d.scoringPlay === true;
    const cardType = d.cardType?.displayValue || '';

    if (isGoal) {
      const ownGoal = d.ownGoal === true;
      const penalty = d.penaltyKick === true;
      const type = ownGoal ? 'own_goal' : (penalty ? 'penalty' : 'goal');
      const assist = d.participants?.[1]?.athlete?.displayName || '';
      goals.push({ minute, team: ourCode, scorer: athlete, assist, type });
    }

    if (cardType.includes('Yellow')) {
      cards.push({ minute, team: ourCode, player: athlete, type: 'yellow' });
    } else if (cardType.includes('Red')) {
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
    const admin = require('firebase-admin');
    const cred = admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    });
    admin.initializeApp({ credential: cred });
    db = admin.firestore();
    console.log('[ESPN] ✅ Firebase Admin inicializado');
  } catch (e) {
    console.error('[ESPN] ❌ Error inicializando Firebase:', e.message);
    process.exit(1);
  }
}

// ─── Write Group Match to Firestore ───
async function writeGroupMatch(localId, comp) {
  const teams = comp.competitors;
  const homeTeam = teams.find(t => t.homeAway === 'home');
  const awayTeam = teams.find(t => t.homeAway === 'away');

  const homeScore = parseInt(homeTeam.score) || 0;
  const awayScore = parseInt(awayTeam.score) || 0;
  const status = parseESPNStatus(comp.status.type.name);
  const minute = parseMinute(comp);
  const { goals, cards } = parseMatchDetails(comp);

  const data = {
    id: localId,
    homeScore: status !== 'upcoming' ? homeScore : null,
    awayScore: status !== 'upcoming' ? awayScore : null,
    status,
    minute: status === 'live' ? minute : null,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('matches').doc(String(localId)).set(data, { merge: true });

  return { localId, status, homeScore, awayScore, minute, goals, cards };
}

// ─── Write Knockout Match to Firestore ───
async function findAndWriteKnockout(comp) {
  const teams = comp.competitors;
  const homeTeam = teams.find(t => t.homeAway === 'home');
  const awayTeam = teams.find(t => t.homeAway === 'away');
  const homeCode = TEAM_MAP[homeTeam.team.abbreviation] || homeTeam.team.abbreviation;
  const awayCode = TEAM_MAP[awayTeam.team.abbreviation] || awayTeam.team.abbreviation;
  const artDate = utcToArtDate(comp.date);

  // Skip if teams are still TBD placeholders
  if (!TEAM_MAP[homeTeam.team.abbreviation] && !TEAM_MAP[awayTeam.team.abbreviation]) {
    return null;
  }

  // Look up in Firestore: find knockout doc with matching date + teams
  // Search through all knockout docs on that date
  const snapshot = await db.collection('knockout')
    .where('date', '==', artDate)
    .get();

  let matchDoc = null;
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.home === homeCode && d.away === awayCode) {
      matchDoc = doc;
      break;
    }
    // Also try reversed
    if (d.home === awayCode && d.away === homeCode) {
      matchDoc = doc;
      break;
    }
  }

  if (!matchDoc) {
    // No matching doc found — might be a new knockout match not yet in Firestore
    // Try to match by date only and update teams
    const allKoOnDate = await db.collection('knockout')
      .where('date', '==', artDate)
      .get();

    for (const doc of allKoOnDate.docs) {
      const d = doc.data();
      if (d.status === 'upcoming' && (!d.home || !d.away)) {
        matchDoc = doc;
        break;
      }
    }
  }

  if (!matchDoc) {
    console.log(`  ⚠️  No se encontró doc de eliminatoria para ${homeCode} vs ${awayCode} (${artDate})`);
    return null;
  }

  const homeScore = parseInt(homeTeam.score) || 0;
  const awayScore = parseInt(awayTeam.score) || 0;
  const status = parseESPNStatus(comp.status.type.name);
  const minute = parseMinute(comp);
  const { goals, cards } = parseMatchDetails(comp);

  const homeName = homeCode;
  const awayName = awayCode;

  const data = {
    home: homeCode,
    away: awayCode,
    label: `${homeName} vs ${awayName}`,
    homeScore: status !== 'upcoming' ? homeScore : null,
    awayScore: status !== 'upcoming' ? awayScore : null,
    status,
    minute: status === 'live' ? minute : null,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('knockout').doc(matchDoc.id).set(data, { merge: true });

  return { koId: matchDoc.id, status, homeScore, awayScore, minute, goals, cards };
}

// ─── Write Scorers to Firestore ───
async function writeScorers(goals, matchId) {
  if (!goals || goals.length === 0) return;

  for (const goal of goals) {
    if (!goal.scorer) continue;
    await db.collection('scorers').add({
      name: goal.scorer,
      teamCode: goal.team,
      goals: 1,
      assists: goal.assist ? 1 : 0,
      matchId: String(matchId),
      minute: goal.minute,
      type: goal.type,
    });
  }
}

// ─── Write Cards to Firestore ───
async function writeCards(cards, matchId) {
  if (!cards || cards.length === 0) return;

  for (const card of cards) {
    if (!card.player) continue;
    await db.collection('cards').add({
      name: card.player,
      teamCode: card.team,
      type: card.type,
      count: 1,
      matchId: String(matchId),
      minute: card.minute,
    });
  }
}

// ─── Main Poller ───
async function poll(dateStr) {
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
        const result = await writeGroupMatch(localId, comp);
        const homeTeam = comp.competitors.find(t => t.homeAway === 'home');
        const awayTeam = comp.competitors.find(t => t.homeAway === 'away');
        console.log(`  ✅ #${localId} ${homeTeam.team.abbreviation} ${result.homeScore}-${result.awayScore} ${awayTeam.team.abbreviation} [${result.status}]`);
        updated++;

        // Write goals and cards if match completed or has live action
        // Always delete old entries first to avoid duplicates on re-poll
        if (result.goals.length > 0 || result.cards.length > 0) {
          // Delete old scorers for this match
          const oldScorers = await db.collection('scorers')
            .where('matchId', '==', String(localId))
            .get();
          if (oldScorers.size > 0) {
            const delBatch = db.batch();
            oldScorers.forEach(doc => delBatch.delete(doc.ref));
            await delBatch.commit();
          }
          // Delete old cards for this match
          const oldCards = await db.collection('cards')
            .where('matchId', '==', String(localId))
            .get();
          if (oldCards.size > 0) {
            const delBatch2 = db.batch();
            oldCards.forEach(doc => delBatch2.delete(doc.ref));
            await delBatch2.commit();
          }
        }
        if (result.goals.length > 0) {
          await writeScorers(result.goals, localId);
        }
        if (result.cards.length > 0) {
          await writeCards(result.cards, localId);
        }

        // If completed, also get detailed summary for accurate data
        if (result.status === 'completed') {
          try {
            const summary = await fetchJSON(`${ESPN_BASE}/summary?event=${espnId}`);
            const sumComp = summary.header.competitions[0];
            const { goals: detailedGoals, cards: detailedCards } = parseMatchDetails(sumComp);
            // Delete old scorer/card entries and rewrite with detailed data
            if (detailedGoals.length > 0) {
              // Delete old entries
              const oldScorers = await db.collection('scorers')
                .where('matchId', '==', String(localId))
                .get();
              const batch = db.batch();
              oldScorers.forEach(doc => batch.delete(doc.ref));
              await batch.commit();
              await writeScorers(detailedGoals, localId);
            }
            if (detailedCards.length > 0) {
              const oldCards = await db.collection('cards')
                .where('matchId', '==', String(localId))
                .get();
              const batch2 = db.batch();
              oldCards.forEach(doc => batch2.delete(doc.ref));
              await batch2.commit();
              await writeCards(detailedCards, localId);
            }
            console.log(`    📊 ${detailedGoals.length} goles, ${detailedCards.length} tarjetas`);
          } catch (e) {
            console.log(`    ⚠️ No se pudo obtener summary: ${e.message}`);
          }
        }

      } else {
        // ─── KNOCKOUT MATCH ───
        const result = await findAndWriteKnockout(comp);
        if (result) {
          console.log(`  ✅ ${result.koId} [${result.status}]`);
          updated++;
        }
      }
    } catch (e) {
      console.error(`  ❌ Error ESPN ${espnId}:`, e.message);
      errors++;
    }

    await delay(500); // Rate limit courtesy
  }

  console.log(`[ESPN] ✨ ${dateStr}: ${updated} actualizado(s), ${errors} error(es)`);
  return { matches: events.length, updated, errors };
}

// ─── Entry Point ───
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   ESPN → Firestore Poller — WC2026             ║');
  console.log('╚══════════════════════════════════════════════════╝');

  // Check if we should poll (only during tournament dates)
  const now = new Date();
  const tournamentStart = new Date('2026-06-11');
  const tournamentEnd = new Date('2026-07-20');
  const isTournament = now >= tournamentStart && now <= tournamentEnd;

  // For testing: allow FORCE_POLL=true or specific date
  const forcePoll = process.env.FORCE_POLL === 'true';
  const specificDate = process.env.POLL_DATE; // YYYYMMDD format

  if (!isTournament && !forcePoll && !specificDate) {
    console.log('[ESPN] ℹ️  Fuera del rango del torneo. No hay nada que actualizar.');
    console.log('[ESPN] ℹ️  Setear FORCE_POLL=true o POLL_DATE=YYYYMMDD para forzar.');
    return;
  }

  // Initialize Firebase
  initFirebase();

  // Determine dates to poll
  const dates = [];
  if (specificDate) {
    dates.push(specificDate);
  } else {
    // Poll today + yesterday + tomorrow (to catch late results and early matches)
    const artNow = new Date(now.getTime() + (-3 * 60 * 60000 + now.getTimezoneOffset() * 60000));
    for (let offset = -1; offset <= 1; offset++) {
      const d = new Date(artNow.getTime() + offset * 86400000);
      dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
    }
  }

  // Remove duplicates
  const uniqueDates = [...new Set(dates)];

  let totalUpdated = 0;
  for (const date of uniqueDates) {
    const result = await poll(date);
    totalUpdated += result.updated;
  }

  console.log(`\n[ESPN] 🏁 Total actualizado: ${totalUpdated} partido(s)`);
}

main().catch(e => {
  console.error('[ESPN] 💥 Fatal:', e);
  process.exit(1);
});
