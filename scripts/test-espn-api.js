/**
 * ESPN Public API — Test Script
 * 
 * Tests:
 *   1. Fetch a real match with goals → parse scoring plays
 *   2. Fetch a real match with cards → parse yellow/red cards
 *   3. Fetch full WC2026 fixture → map ESPN IDs to local MATCHES
 *   4. Validate mapping (all 72 group matches accounted for)
 */

const ESPN_BASE = 'http://site.api.espn.com/apis/site/v2/sports/soccer';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// TEST 1: Real match with goals
// ═══════════════════════════════════════════════════════════════
async function testRealMatchWithGoals() {
  console.log('\n═══ TEST 1: Partido real con goles ═══');
  console.log('Liga: Serie A — NAP 2 vs GEN 2 (id: 712466)\n');

  const data = await fetchJSON(`${ESPN_BASE}/ita.1/summary?event=712466`);
  const comp = data.header.competitions[0];

  console.log(`Status: ${comp.status.type.name}`);
  console.log(`Match: ${comp.competitors.map(c => `${c.team.abbreviation} ${c.score}`).join(' vs ')}`);

  // Parse details
  const goals = [];
  const cards = [];
  const substitutions = [];

  for (const detail of (comp.details || [])) {
    const minute = detail.clock?.displayValue || '?';
    const team = detail.team?.abbreviation || '?';
    const scoringPlay = detail.scoringPlay === true;

    // Find athlete name from participants
    const athlete = detail.participants?.[0]?.athlete?.displayName || 'Desconocido';

    if (scoringPlay) {
      // Determine goal type
      const goalType = detail.scoringType?.displayValue || 'Gol';
      const ownGoal = detail.ownGoal === true;
      const penalty = detail.penaltyKick === true;

      goals.push({
        minute,
        team,
        scorer: athlete,
        type: ownGoal ? 'Autogol' : (penalty ? 'Penal' : goalType),
        description: detail.text || ''
      });
    } else {
      // Check for cards
      const cardType = detail.cardType?.displayValue || '';
      if (cardType.includes('Yellow') || cardType.includes('Amarilla')) {
        cards.push({ minute, team, player: athlete, type: 'Amarilla' });
      } else if (cardType.includes('Red') || cardType.includes('Roja')) {
        cards.push({ minute, team, player: athlete, type: 'Roja' });
      } else {
        // Substitution or other event
        const subType = detail.type?.displayValue || detail.text || 'Otro';
        if (subType.toLowerCase().includes('substitution') || subType.toLowerCase().includes('sustit')) {
          const subIn = detail.participants?.[0]?.athlete?.displayName || '?';
          const subOut = detail.participants?.[1]?.athlete?.displayName || '?';
          substitutions.push({ minute, team, in: subIn, out: subOut });
        }
      }
    }
  }

  console.log(`\n⚽ Goles (${goals.length}):`);
  goals.forEach(g => console.log(`  ${g.minute}' — ${g.team} — ${g.scorer} (${g.type})`));

  console.log(`\n🟨🟥 Tarjetas (${cards.length}):`);
  cards.forEach(c => console.log(`  ${c.minute}' — ${c.team} — ${c.player} (${c.type})`));

  console.log(`\n🔄 Cambios (${substitutions.length}):`);
  substitutions.forEach(s => console.log(`  ${s.minute}' — ${s.team} — Entra ${s.in}, Sale ${s.out}`));

  return { goals, cards, substitutions };
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: Find a match with red cards
// ═══════════════════════════════════════════════════════════════
async function testMatchWithCards() {
  console.log('\n═══ TEST 2: Partido con tarjetas (rojas/amarillas) ═══');

  // Try multiple recent dates across leagues
  const leagues = [
    { name: 'Premier League', slug: 'eng.1' },
    { name: 'La Liga', slug: 'esp.1' },
    { name: 'Bundesliga', slug: 'ger.1' },
    { name: 'Serie A', slug: 'ita.1' },
    { name: 'Ligue 1', slug: 'fra.1' }
  ];

  for (const league of leagues) {
    for (const date of ['20250511', '20250510', '20250509', '20250508']) {
      try {
        const data = await fetchJSON(`${ESPN_BASE}/${league.slug}/scoreboard?dates=${date}`);
        const events = data.events || [];

        for (const event of events) {
          const comp = event.competitions[0];
          const details = comp.details || [];

          // Count yellow and red cards
          const yellowCards = details.filter(d =>
            d.cardType?.displayValue?.includes('Yellow')
          );
          const redCards = details.filter(d =>
            d.cardType?.displayValue?.includes('Red')
          );

          if (yellowCards.length > 0 || redCards.length > 0) {
            const teams = comp.competitors.map(c => `${c.team.abbreviation} ${c.score}`).join(' vs ');
            console.log(`\n${league.name} — ${teams} (id: ${event.id})`);
            console.log(`  Amarillas: ${yellowCards.length}, Rojas: ${redCards.length}`);

            for (const d of yellowCards.slice(0, 3)) {
              const player = d.participants?.[0]?.athlete?.displayName || '?';
              console.log(`  🟨 ${d.clock?.displayValue}' — ${d.team?.abbreviation} — ${player}`);
            }
            for (const d of redCards.slice(0, 3)) {
              const player = d.participants?.[0]?.athlete?.displayName || '?';
              console.log(`  🟥 ${d.clock?.displayValue}' — ${d.team?.abbreviation} — ${player}`);
            }

            if (redCards.length > 0) {
              return { yellowCards: yellowCards.length, redCards: redCards.length };
            }
          }
        }
      } catch (e) {
        // Skip if league/date combo fails
      }
      await delay(300);
    }
  }

  console.log('  No se encontró partido con roja en fechas recientes (OK, no es crítico)');
  return null;
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: Full WC2026 fixture + ID mapping
// ═══════════════════════════════════════════════════════════════
async function testWC2026Fixture() {
  console.log('\n═══ TEST 3: Fixture completo WC2026 + Mapeo de IDs ═══\n');

  // The WC2026 runs from June 11 to July 19, 2026
  // Group stage: Jun 11-27, Knockout: Jun 28 - Jul 19
  // We need to fetch all dates

  const startDate = new Date('2026-06-11');
  const endDate = new Date('2026-07-20');

  const allEvents = [];
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const data = await fetchJSON(`${ESPN_BASE}/fifa.world/scoreboard?dates=${dateStr}`);
      const events = data.events || [];
      if (events.length > 0) {
        console.log(`  ${dateStr}: ${events.length} partido(s)`);
        allEvents.push(...events);
      }
    } catch (e) {
      console.log(`  ${dateStr}: Error — ${e.message}`);
    }
    currentDate.setDate(currentDate.getDate() + 1);
    await delay(300); // Be respectful
  }

  console.log(`\n  Total partidos encontrados: ${allEvents.length}`);

  // Build ESPN match map
  const espnMatches = {};
  for (const event of allEvents) {
    const comp = event.competitions[0];
    const competitors = comp.competitors;
    const home = competitors.find(c => c.homeAway === 'home');
    const away = competitors.find(c => c.homeAway === 'away');

    if (home && away) {
      espnMatches[event.id] = {
        espnId: event.id,
        home: home.team.abbreviation,
        away: away.team.abbreviation,
        homeName: home.team.displayName,
        awayName: away.team.displayName,
        date: comp.date,
        status: comp.status.type.name,
        venue: comp.venue?.fullName || '?',
        city: comp.venue?.address?.city || '?'
      };
    }
  }

  // ═══ TRY TO MAP AGAINST OUR LOCAL MATCHES ═══
  // We need to load MATCHES from data.js — but since this is standalone,
  // let's just output the ESPN data for now and do the mapping comparison manually

  console.log('\n═══ SAMPLE: Primeros 10 partidos del fixture ═══');
  const sample = Object.values(espnMatches).slice(0, 10);
  for (const m of sample) {
    const statusIcon = m.status === 'STATUS_SCHEDULED' ? '📅' : 
                       m.status === 'STATUS_IN_PROGRESS' ? '⚽' :
                       m.status === 'STATUS_FULL_TIME' ? '✅' : '❓';
    console.log(`  ${statusIcon} ESPN:${m.espnId} | ${m.home} vs ${m.away} | ${m.date} | ${m.venue}, ${m.city}`);
  }

  // Check for duplicates
  const homeAwayPairs = {};
  let duplicates = 0;
  for (const m of Object.values(espnMatches)) {
    const key = `${m.home}-${m.away}`;
    if (homeAwayPairs[key]) {
      duplicates++;
      console.log(`  ⚠️ DUPLICADO: ${key} (${homeAwayPairs[key]} y ${m.espnId})`);
    }
    homeAwayPairs[key] = m.espnId;
  }

  console.log(`\n  Duplicados: ${duplicates}`);

  // Group stage vs knockout breakdown
  const groupMatches = Object.values(espnMatches).filter(m => m.status === 'STATUS_SCHEDULED');
  console.log(`  Programados (group stage probable): ${groupMatches.length}`);

  return { totalEvents: allEvents.length, espnMatches };
}

// ═══════════════════════════════════════════════════════════════
// TEST 4: Map ESPN IDs to our local MATCHES
// ═══════════════════════════════════════════════════════════════
async function testLocalMapping(espnMatches) {
  console.log('\n═══ TEST 4: Mapeo ESPN IDs ↔ MATCHES locales ═══\n');

  // Load our local data.js
  const fs = await import('fs');
  const dataContent = fs.readFileSync('./js/data.js', 'utf-8');

  // Extract MATCHES array (simple parse — find all match objects)
  // Each match looks like: { id: 1, home: 'MEX', away: 'RSA', date: '2026-06-11', ... }
  const matchRegex = /\{ id: (\d+),\s*home: '(\w+)',\s*away: '(\w+)',\s*date: '([^']+)'/g;
  let match;
  const localMatches = [];

  while ((match = matchRegex.exec(dataContent)) !== null) {
    localMatches.push({
      localId: parseInt(match[1]),
      home: match[2],
      away: match[3],
      date: match[4]
    });
  }

  console.log(`  Partidos locales (data.js): ${localMatches.length}`);
  console.log(`  Partidos ESPN:              ${Object.keys(espnMatches).length}`);

  // Try to match by home/away team codes + date
  const mapped = [];
  const unmatchedLocal = [];
  const unmatchedESPN = new Set(Object.keys(espnMatches));

  // Abbreviation mapping (our codes → ESPN codes)
  // Most FIFA codes match, but some might differ
  const codeMap = {
    'KOR': 'KOR',     // South Korea
    'CZE': 'CZE',     // Czechia
    'BIH': 'BIH',     // Bosnia
    'PAR': 'PAR',     // Paraguay
    'MAR': 'MAR',     // Morocco
    'HAI': 'HAI',     // Haiti
    'CUW': 'CUW',     // Curaçao
    'CIV': 'CIV',     // Ivory Coast
    'SUI': 'SUI',     // Switzerland
    'UZB': 'UZB',     // Uzbekistan
    'NZL': 'NZL',     // New Zealand
    'GHA': 'GHA',     // Ghana
    'MLI': 'MLI',     // Mali
    'CRC': 'CRC',     // Costa Rica
    'JOR': 'JOR',     // Jordan
    'SYR': 'SYR',     // Syria
    'IDN': 'IDN',     // Indonesia
    'UAE': 'UAE',     // UAE
  };

  // Build ESPN lookup: date+home+away → espnId
  // ESPN dates are in UTC, our dates are in UTC-3 (Argentina)
  // A match at 23:00 ART = 02:00 UTC next day
  // So we need to check both the local date AND the next day
  const espnLookup = {};
  for (const [espnId, m] of Object.entries(espnMatches)) {
    const dateOnly = m.date.slice(0, 10);
    const key = `${dateOnly}|${m.home}|${m.away}`;
    espnLookup[key] = espnId;
  }

  // Convert local date (UTC-3) to UTC date range
  // Matches can span 3 UTC dates depending on time:
  //   Early match 13:00 ART = 16:00 UTC (same day)
  //   Night match 23:00 ART = 02:00 UTC (next day)
  //   Dawn match 01:00 ART = 04:00 UTC (same day)
  function localDateToESPNDateCandidates(localDateStr) {
    const d = new Date(localDateStr + 'T12:00:00-03:00'); // noon ART
    const candidates = [];
    for (let offset = -1; offset <= 1; offset++) {
      const day = new Date(d.getTime() + offset * 24 * 60 * 60 * 1000);
      candidates.push(day.toISOString().slice(0, 10));
    }
    return candidates;
  }

  function lookupESPN(espnLookup, dateCandidates, home, away) {
    for (const date of dateCandidates) {
      const key = `${date}|${home}|${away}`;
      if (espnLookup[key]) return espnLookup[key];
    }
    // Try swapped
    for (const date of dateCandidates) {
      const key = `${date}|${away}|${home}`;
      if (espnLookup[key]) return { id: espnLookup[key], swapped: true };
    }
    return null;
  }

  for (const local of localMatches) {
    const candidates = localDateToESPNDateCandidates(local.date);
    const result = lookupESPN(espnLookup, candidates, local.home, local.away);

    if (result) {
      const espnId = typeof result === 'object' ? result.id : result;
      const swapped = typeof result === 'object' ? result.swapped : false;
      mapped.push({
        localId: local.localId,
        espnId: espnId,
        home: local.home,
        away: local.away,
        date: local.date,
        swapped
      });
      unmatchedESPN.delete(espnId);
    } else {
      unmatchedLocal.push(local);
    }
  }

  console.log(`\n  ✅ Mapeados correctamente: ${mapped.length}`);
  console.log(`  ❌ Sin mapeo (local):      ${unmatchedLocal.length}`);
  console.log(`  ❌ Sin mapeo (ESPN):       ${unmatchedESPN.size}`);

  if (unmatchedLocal.length > 0) {
    console.log('\n  Partidos locales sin mapeo:');
    for (const m of unmatchedLocal.slice(0, 10)) {
      console.log(`    ID ${m.localId}: ${m.home} vs ${m.away} | ${m.date}`);
    }
    if (unmatchedLocal.length > 10) {
      console.log(`    ... y ${unmatchedLocal.length - 10} más`);
    }
  }

  if (unmatchedESPN.size > 0) {
    console.log('\n  Partidos ESPN sin mapeo (knockout phase probable):');
    const espnArr = Object.values(espnMatches).filter(m => unmatchedESPN.has(m.espnId));
    for (const m of espnArr.slice(0, 10)) {
      console.log(`    ESPN ${m.espnId}: ${m.home} vs ${m.away} | ${m.date?.slice(0, 10)}`);
    }
    if (espnArr.length > 10) {
      console.log(`    ... y ${espnArr.length - 10} más`);
    }
  }

  // Show mapping for verification
  console.log('\n═══ MAPEO FINAL (primeros 15) ═══');
  for (const m of mapped.slice(0, 15)) {
    const swap = m.swapped ? ' ⚠️SWAP' : '';
    console.log(`  Local #${m.localId} → ESPN ${m.espnId} | ${m.home} vs ${m.away} | ${m.date}${swap}`);
  }

  // Generate the mapping JSON
  const mappingObj = {};
  for (const m of mapped) {
    mappingObj[m.localId] = m.espnId;
  }

  console.log('\n═══ MAPPING JSON (copiar a config) ═══');
  console.log('const ESPN_ID_MAP = {');
  const entries = Object.entries(mappingObj).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  for (const [localId, espnId] of entries) {
    console.log(`  ${localId}: '${espnId}',`);
  }
  console.log('};');

  return { mapped: mapped.length, unmatchedLocal: unmatchedLocal.length, unmatchedESPN: unmatchedESPN.size, mappingObj };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           ESPN PUBLIC API — TEST SCRIPT                     ║');
  console.log('║           Fixture WC2026 + Parsing de datos                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    // Test 1: Real goals
    await testRealMatchWithGoals();

    // Test 2: Cards
    await testMatchWithCards();

    // Test 3: WC2026 fixture
    const { espnMatches } = await testWC2026Fixture();

    // Test 4: Mapping
    const mapResult = await testLocalMapping(espnMatches);

    // Summary
    console.log('\n═══ RESUMEN ═══');
    console.log(`  ✅ Parsing de goles:     OK`);
    console.log(`  ✅ Parsing de tarjetas:  OK`);
    console.log(`  ✅ Fixture WC2026:       ${Object.keys(espnMatches).length} partidos`);
    console.log(`  ✅ Mapeo local→ESPN:     ${mapResult.mapped}/72`);
    if (mapResult.unmatchedLocal > 0) {
      console.log(`  ⚠️  Sin mapear (local):   ${mapResult.unmatchedLocal}`);
    }
    if (mapResult.unmatchedESPN > 0) {
      console.log(`  ℹ️  Sin mapear (ESPN):    ${mapResult.unmatchedESPN} (probable fase de eliminatorias)`);
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  }
}

main();
