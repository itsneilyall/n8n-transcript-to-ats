const fs = require('fs');
const w = JSON.parse(fs.readFileSync('/home/claude/belo/belo-transcript-to-ats.json'));
const code = w.nodes.find(n => n.name === 'Resolve Identity').parameters.jsCode;

function run(records, ctx, cfg) {
  const $input = { first: () => ({ json: { records } }) };
  const $ = (n) => ({ first: () => ({ json: n === 'Validate & Normalize' ? ctx : cfg }) });
  return new Function('$input', '$', 'return (function(){' + code + '})()')($input, $)[0].json;
}
const cfg = { mergeThreshold: 70, reviewThreshold: 40 };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const mk = (first, sur, c) => ({
  firstName: first, surname: sur, firstNameKey: norm(first), surnameKey: norm(sur),
  conversationId: 'c', transcriptDate: c.date, extraction: { candidate: c },
});

// Airtable state after T1/T2 have landed (canonical = first sighting)
const priyaRec = { id: 'rec1', fields: {
  'Candidate Key': 'raghavan-priyanka-k1', 'Full Name': 'Priyanka Raghavan',
  'First Name Key': 'priyanka', 'Aliases': 'Priyanka, Priya', 'Location': 'London',
  'Company History': 'Nexa Health, Nexler Health, Peakform', 'Education': 'Biomedical Science, Leeds',
  'Last Conversation Date': '2026-07-09' } };

const davidRec = { id: 'rec2', fields: {
  'Candidate Key': 'chen-david-k2', 'Full Name': 'David Chen', 'First Name Key': 'david',
  'Aliases': 'David', 'Location': 'London', 'Company History': 'Fentra, Kavo',
  'Last Conversation Date': '2026-03-12' } };

const cases = [
  // ---- the eight real transcripts ------------------------------------------
  ['T6 Interview Prep - says "Nexler", not "Nexler Health"; still Manchester', 'merge', [priyaRec],
    mk('Priyanka', 'Raghavan', { current_company: 'Nexler', company_history: ['Nexler'], location: 'Manchester', date: '2026-07-21' })],

  ['T7 Client Feedback - Rachel states role only, no company, no location', 'merge', [priyaRec],
    mk('Priya', 'Raghavan', { current_role: 'Commercial Lead', current_company: null, company_history: [], location: null, date: '2026-07-24' })],

  ['T4 David Chen #2 - must stay separate', 'create+flag', [davidRec],
    mk('David', 'Chen', { current_company: 'Arden Cyber', company_history: ['Arden Cyber', 'Sophos'], location: 'Edinburgh', date: '2026-07-02' })],

  // ---- transcripts that do not exist yet -----------------------------------
  ['NEW: Priya after changing job AND city - genuinely undecidable', 'create+flag', [priyaRec],
    mk('Priya', 'Raghavan', { current_company: 'Snowflake', company_history: ['Snowflake'], location: 'Bristol', date: '2026-11-01' })],

  ['NEW: sparse catch-up, name only, nothing else stated', 'merge', [priyaRec],
    mk('Priya', 'Raghavan', { current_company: null, company_history: [], location: null, date: '2026-08-01' })],

  ['NEW: unrelated Raghavan, different first name', 'create', [priyaRec],
    mk('Anil', 'Raghavan', { current_company: 'Monzo', company_history: ['Monzo'], location: 'Leeds', date: '2026-08-01' })],

  ['NEW: name-only match but TWO people already share it', 'create+flag', [davidRec, { id: 'rec3', fields: {
      'Candidate Key': 'chen-david-k3', 'Full Name': 'David Chen', 'First Name Key': 'david',
      'Aliases': 'David', 'Location': 'Edinburgh', 'Company History': 'Arden Cyber, Sophos' } }],
    mk('David', 'Chen', { current_company: null, company_history: [], location: null, date: '2026-08-01' })],
];

let fails = 0;
for (const [label, expect, recs, ctx] of cases) {
  const r = run(recs, ctx, cfg);
  const got = r.action + (r.needsReview ? '+flag' : '');
  const ok = got === expect;
  if (!ok) fails++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label);
  console.log('        expected ' + expect + ', got ' + got + '  [score ' + r.score + ']');
  if (!ok) console.log('        reason: ' + r.reason);
}
console.log('\n' + (cases.length - fails) + '/' + cases.length + ' passing');
