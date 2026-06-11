/**
 * ESPN → Firestore sync endpoint for Cloudflare Pages Functions.
 * Called by cron-job.org every 2 minutes during the tournament.
 *
 * Environment variables (set in Cloudflare Pages → Settings → Environment variables):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_PRIVATE_KEY   (PEM string, \n as literal \\n or real newlines)
 *   FIREBASE_CLIENT_EMAIL
 *   CRON_SECRET            (optional, prevent unauthorized calls)
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

/* ─── ESPN Maps ─── */
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
const ESPN_TO_LOCAL = {};
for (const [lid, eid] of Object.entries(ESPN_GROUP_MAP)) ESPN_TO_LOCAL[eid] = parseInt(lid);

const TEAM_MAP = {
  'MEX':'MEX','RSA':'RSA','KOR':'KOR','CZE':'CZE','CAN':'CAN','BIH':'BIH','QAT':'QAT','SUI':'SUI',
  'BRA':'BRA','MAR':'MAR','HAI':'HAI','SCO':'SCO','USA':'USA','PAR':'PAR','AUS':'AUS','TUR':'TUR',
  'GER':'GER','CUW':'CUW','CIV':'CIV','ECU':'ECU','NED':'NED','JPN':'JPN','SWE':'SWE','TUN':'TUN',
  'BEL':'BEL','EGY':'EGY','IRN':'IRN','NZL':'NZL','ESP':'ESP','CPV':'CPV','KSA':'KSA','URU':'URU',
  'FRA':'FRA','SEN':'SEN','IRQ':'IRQ','NOR':'NOR','ARG':'ARG','ALG':'ALG','AUT':'AUT','JOR':'JOR',
  'POR':'POR','COD':'COD','UZB':'UZB','COL':'COL','ENG':'ENG','CRO':'CRO','GHA':'GHA','PAN':'PAN'
};

/* ─── ESPN Parsing ─── */
function parseStatus(name) {
  if (name === 'STATUS_SCHEDULED') return 'upcoming';
  if (['STATUS_IN_PROGRESS','STATUS_1ST_PERIOD','STATUS_2ND_PERIOD','STATUS_3RD_PERIOD',
       'STATUS_FIRST_HALF','STATUS_SECOND_HALF','STATUS_EXTRA_TIME','STATUS_PENALTY_SHOOTOUT'].includes(name)) return 'live';
  if (['STATUS_HALFTIME','STATUS_HALF_TIME'].includes(name)) return 'halftime';
  if (['STATUS_FULL_TIME','STATUS_FINAL','STATUS_FINAL_AET','STATUS_FINAL_PEN'].includes(name)) return 'completed';
  return 'upcoming';
}

function parseDetails(comp, competitors) {
  const details = comp.details || [];
  const goals = [], cards = [];
  const idToCode = {};
  if (competitors) competitors.forEach(c => { if (c.team?.id && c.team?.abbreviation) idToCode[c.team.id] = c.team.abbreviation; });
  for (const d of details) {
    const minute = d.clock?.displayValue || '';
    const isGoal = d.scoringPlay === true;
    let teamCode = d.team?.abbreviation || idToCode[d.team?.id] || '';
    let athlete = '';
    if (d.participants?.[0]?.athlete?.displayName) athlete = d.participants[0].athlete.displayName;
    else if (d.athletesInvolved?.[0]?.displayName) athlete = d.athletesInvolved[0].displayName;
    const code = TEAM_MAP[teamCode] || teamCode;
    const isYellow = (d.cardType?.displayValue || '').includes('Yellow') || d.yellowCard === true;
    const isRed = (d.cardType?.displayValue || '').includes('Red') || d.redCard === true;
    if (isGoal && athlete) goals.push({ minute, team: code, scorer: athlete, type: d.ownGoal ? 'own_goal' : d.penaltyKick ? 'penalty' : 'goal' });
    if (isYellow && athlete) cards.push({ minute, team: code, player: athlete, type: 'yellow' });
    else if (isRed && athlete) cards.push({ minute, team: code, player: athlete, type: 'red' });
  }
  return { goals, cards };
}

/* ─── Firebase Auth (JWT via Web Crypto API) ─── */
function b64url(data) {
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  let s = ''; bytes.forEach(b => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----BEGIN[^-]*-----/, '').replace(/-----END[^-]*-----/, '').replace(/\s/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

async function getAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('OAuth failed: ' + JSON.stringify(data));
  return data.access_token;
}

/* ─── Firestore REST API ─── */
const FS = (pid, path) => `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${path}`;
const authHeaders = (token) => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

function toFieldValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return { integerValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  return { stringValue: String(v) };
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFieldValue(v);
  return fields;
}

// Merge-write a document (only updates specified fields)
async function fsMerge(token, pid, collection, docId, fields) {
  const url = FS(pid, `${collection}/${docId}`);
  // Build updateMask from field names
  const mask = Object.keys(fields).map(f => `updateMask.fieldPaths=${f}`).join('&');
  const res = await fetch(`${url}?${mask}`, {
    method: 'PATCH', headers: authHeaders(token),
    body: JSON.stringify({ fields: toFields(fields) })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fsMerge ${collection}/${docId}: ${res.status} ${err}`);
  }
}

// Add a new document (auto-ID)
async function fsAdd(token, pid, collection, fields) {
  const res = await fetch(FS(pid, collection), {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ fields: toFields(fields) })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fsAdd ${collection}: ${res.status} ${err}`);
  }
  return res.json();
}

// Query documents
async function fsQuery(token, pid, collection, field, value) {
  const res = await fetch(FS(pid, ':runQuery'), {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }
      }
    })
  });
  const data = await res.json();
  return (data || []).filter(r => r.document).map(r => ({
    path: r.document.name.split('/documents/')[1],
    data: r.document.fields
  }));
}

// Delete a document
async function fsDelete(token, pid, docPath) {
  await fetch(FS(pid, docPath), { method: 'DELETE', headers: authHeaders(token) });
}

/* ─── Poll Logic ─── */
function getDates() {
  const dates = [];
  for (let off = -1; off <= 1; off++) {
    const d = new Date(); d.setDate(d.getDate() + off);
    dates.push(d.toISOString().split('T')[0].replace(/-/g, ''));
  }
  return dates;
}

async function processMatch(token, pid, comp) {
  const espnId = String(comp.id);
  const localId = ESPN_TO_LOCAL[espnId];
  if (!localId) return null;

  const home = comp.competitors.find(t => t.homeAway === 'home');
  const away = comp.competitors.find(t => t.homeAway === 'away');
  const hs = parseInt(home.score) || 0, as = parseInt(away.score) || 0;
  const status = parseStatus(comp.status.type.name);
  const minute = (status === 'live' || status === 'halftime')
    ? (status === 'halftime' ? 'HT' : (comp.status.displayClock || '')) : '';
  const { goals, cards } = parseDetails(comp, comp.competitors);

  // Write match score
  await fsMerge(token, pid, 'matches', String(localId), {
    id: localId,
    homeScore: status !== 'upcoming' ? hs : null,
    awayScore: status !== 'upcoming' ? as : null,
    status, minute,
    lastUpdated: new Date().toISOString()
  });

  // Scorers: delete old, write new
  if (goals.length > 0) {
    const old = await fsQuery(token, pid, 'scorers', 'matchId', String(localId));
    for (const doc of old) await fsDelete(token, pid, doc.path);
    for (const g of goals) {
      await fsAdd(token, pid, 'scorers', {
        name: g.scorer, teamCode: g.team, goals: 1, assists: 0,
        matchId: String(localId), minute: g.minute, type: g.type
      });
    }
  }

  // Cards: delete old, write new
  if (cards.length > 0) {
    const old = await fsQuery(token, pid, 'cards', 'matchId', String(localId));
    for (const doc of old) await fsDelete(token, pid, doc.path);
    for (const c of cards) {
      await fsAdd(token, pid, 'cards', {
        name: c.player, teamCode: c.team, type: c.type, count: 1,
        matchId: String(localId), minute: c.minute
      });
    }
  }

  // For completed: also fetch summary for richer details
  if (status === 'completed') {
    try {
      const sumRes = await fetch(`${ESPN_BASE}/summary?event=${espnId}`);
      const sum = await sumRes.json();
      const sumComp = sum.header.competitions[0];
      const { goals: dg, cards: dc } = parseDetails(sumComp, sumComp.competitors);

      if (dg.length > 0) {
        const old = await fsQuery(token, pid, 'scorers', 'matchId', String(localId));
        for (const doc of old) await fsDelete(token, pid, doc.path);
        for (const g of dg) {
          await fsAdd(token, pid, 'scorers', {
            name: g.scorer, teamCode: g.team, goals: 1, assists: 0,
            matchId: String(localId), minute: g.minute, type: g.type
          });
        }
      }
      if (dc.length > 0) {
        const old = await fsQuery(token, pid, 'cards', 'matchId', String(localId));
        for (const doc of old) await fsDelete(token, pid, doc.path);
        for (const c of dc) {
          await fsAdd(token, pid, 'cards', {
            name: c.player, teamCode: c.team, type: c.type, count: 1,
            matchId: String(localId), minute: c.minute
          });
        }
      }
    } catch (e) {
      console.error('Summary error:', e.message);
    }
  }

  return { localId, status, homeScore: hs, awayScore: as, goals: goals.length, cards: cards.length };
}

async function pollDate(dateStr, token, pid) {
  const res = await fetch(`${ESPN_BASE}/scoreboard?dates=${dateStr}`);
  const data = await res.json();
  const events = data.events || [];
  const results = [];

  for (const ev of events) {
    const comp = ev.competitions[0];
    if (comp.status.type.name === 'STATUS_SCHEDULED') continue;
    try {
      const r = await processMatch(token, pid, comp);
      if (r) results.push(r);
    } catch (e) {
      results.push({ error: e.message, espnId: ev.id });
    }
  }
  return results;
}

/* ─── Handler ─── */
export async function onRequestGet(context) {
  const { FIREBASE_PROJECT_ID: pid, FIREBASE_PRIVATE_KEY: pk, FIREBASE_CLIENT_EMAIL: ce, CRON_SECRET: secret } = context.env;

  if (!pid || !pk || !ce) return new Response(JSON.stringify({ error: 'Missing Firebase env vars' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const url = new URL(context.request.url);
  if (secret && url.searchParams.get('secret') !== secret) return new Response('Unauthorized', { status: 401 });

  const start = Date.now();
  try {
    const token = await getAccessToken(ce, pk.replace(/\\n/g, '\n'));
    const dates = getDates();
    const details = {};
    let totalUpdated = 0;
    for (const d of dates) {
      details[d] = await pollDate(d, token, pid);
      totalUpdated += details[d].length;
    }
    return new Response(JSON.stringify({ ok: true, ms: Date.now() - start, totalUpdated, details }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, stack: e.stack, ms: Date.now() - start }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}