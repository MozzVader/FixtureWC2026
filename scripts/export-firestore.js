/**
 * Export all Firestore collections to a single static JSON file.
 * Run once after the tournament ends to create data/live-data.json
 *
 * Usage:
 *   FIREBASE_PROJECT_ID=xxx FIREBASE_PRIVATE_KEY="-----BEGIN..." FIREBASE_CLIENT_EMAIL=xxx node scripts/export-firestore.js
 *
 * Output: data/live-data.json
 */

const admin = require('firebase-admin');

// Init from env vars
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
  console.error('Missing env vars: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  })
});

const db = admin.firestore();

async function exportCollection(name) {
  const snap = await db.collection(name).get();
  const docs = [];
  snap.forEach(doc => {
    const data = doc.data();
    // Remove Firestore timestamps (not JSON-serializable)
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && v.toDate) {
        clean[k] = v.toDate().toISOString();
      } else {
        clean[k] = v;
      }
    }
    docs.push({ id: doc.id, ...clean });
  });
  return docs;
}

async function main() {
  console.log('Exporting Firestore → data/live-data.json ...');

  const [matches, knockout, scorers, cards] = await Promise.all([
    exportCollection('matches'),
    exportCollection('knockout'),
    exportCollection('scorers'),
    exportCollection('cards')
  ]);

  const output = {
    _exported: new Date().toISOString(),
    matches,      // [{id, home, away, homeScore, awayScore, status, minute, ...}]
    knockout,     // [{id, home, away, homeScore, awayScore, status, winnerCode, ...}]
    scorers,      // [{name, teamCode, goals, assists, matchId, minute, ...}]
    cards         // [{name, teamCode, type, matchId, minute, ...}]
  };

  const fs = require('fs');
  const path = require('path');
  const outPath = path.join(__dirname, '..', 'data', 'live-data.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`✅ Exported: ${matches.length} matches, ${knockout.length} knockout, ${scorers.length} scorers, ${cards.length} cards`);
  console.log(`📁 Saved to: ${outPath}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });