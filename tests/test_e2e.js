const fs = require('fs');
const w = JSON.parse(fs.readFileSync('/home/claude/belo/belo-transcript-to-ats.json'));
const resolveCode = w.nodes.find(n => n.name === 'Resolve Identity').parameters.jsCode;
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

function resolve(records, ctx) {
  const $input = { first: () => ({ json: { records } }) };
  const $ = (n) => ({ first: () => ({ json: n === 'Validate & Normalize' ? ctx : {} }) });
  return new Function('$input', '$', 'return (function(){' + resolveCode + '})()')($input, $)[0].json;
}
const mkCtx = (first, sur, c, date) => ({
  firstName: first, surname: sur, firstNameKey: norm(first), surnameKey: norm(sur),
  conversationId: 'c', transcriptDate: date, extraction: { candidate: c },
});

// What the LLM would extract from each transcript (subject + the identity-relevant fields).
// Ordered by DATE (the pipeline sorts before processing): T1,T3,T4,T2,T5,T6,T7,T8
const TRANSCRIPTS = [
  { file: 'T1', date: '2026-03-04', first: 'Priyanka', sur: 'Raghavan',
    c: { current_company: 'Nexler Health', company_history: ['Nexler Health', 'Peakform'], location: 'Manchester', education: 'Biomedical Science, Leeds' } },
  { file: 'T3', date: '2026-03-12', first: 'David', sur: 'Chen',
    c: { current_company: 'Fentra', company_history: ['Fentra', 'Kavo'], location: 'London', education: 'Economics, Nottingham' } },
  { file: 'T4', date: '2026-07-02', first: 'David', sur: 'Chen',
    c: { current_company: 'Arden Cyber', company_history: ['Arden Cyber', 'Sophos'], location: 'Edinburgh', education: null } },
  { file: 'T2', date: '2026-07-09', first: 'Priya', sur: 'Raghavan',
    c: { current_company: 'Nexa Health', company_history: ['Nexa Health', 'Nexler Health', 'Peakform'], location: 'Manchester', education: 'Biomedical Science, Leeds' } },
  { file: 'T5', date: '2026-07-14', first: 'Tom', sur: 'Brennan',
    c: { current_company: 'Corva', company_history: ['Corva', 'Nimbus Data', 'Halberd'], location: 'London', education: null } },
  { file: 'T6', date: '2026-07-21', first: 'Priyanka', sur: 'Raghavan',
    c: { current_company: 'Nexler', company_history: ['Nexler'], location: 'Manchester', education: null } }, // note: "Nexler" short form, prep call
  { file: 'T7', date: '2026-07-24', first: 'Priya', sur: 'Raghavan', clientCall: true,
    c: { current_role: 'Commercial Lead', current_company: null, company_history: [], location: null, education: null } }, // client feedback, sparse
  { file: 'T8', date: '2026-07-28', first: 'Tom', sur: 'Brennan',
    c: { current_company: 'Corva', company_history: ['Corva', 'Nimbus Data', 'Halberd'], location: 'London', education: null } }, // interviewed at Quorra, but employer still Corva
];

// mock Airtable, keyed by Candidate Key
const base = {};
const fnv1a = (s) => { let h = 2166136261; for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return (h>>>0).toString(36); };

let creates = 0, updates = 0, flags = 0;
console.log('order: ' + TRANSCRIPTS.map(t => t.file).join(', ') + '\n');

for (const t of TRANSCRIPTS) {
  const ctx = mkCtx(t.first, t.sur, t.c, t.date);
  const records = Object.values(base).filter(r => r.fields['Surname Key'] === norm(t.sur));
  const r = resolve(records, ctx);

  if (r.action === 'create') {
    creates++; if (r.needsReview) flags++;
    // union of company history for the new record
    const hist = [t.c.current_company].concat(t.c.company_history || []).filter(Boolean);
    base[r.candidateKey] = { id: 'rec_' + r.candidateKey, fields: {
      'Candidate Key': r.candidateKey, 'Full Name': t.first + ' ' + t.sur,
      'First Name Key': norm(t.first), 'Surname Key': norm(t.sur),
      'Aliases': t.first, 'Location': t.c.location || '',
      'Company History': [...new Set(hist)].join(', '),
      'Education': t.c.education || '', 'Last Conversation Date': t.date } };
  } else {
    updates++; if (r.needsReview) flags++;
    const rec = base[r.candidateKey].fields;
    // union aliases + history, update state if newer
    if (rec.Aliases.split(', ').indexOf(t.first) === -1) rec.Aliases += ', ' + t.first;
    const hist = new Set(rec['Company History'].split(', ').filter(Boolean));
    for (const h of [t.c.current_company].concat(t.c.company_history || [])) if (h) hist.add(h);
    rec['Company History'] = [...hist].join(', ');
    if (r.updateState) {
      if (t.c.location) rec['Location'] = t.c.location;
      rec['Last Conversation Date'] = t.date;
    }
  }
  const mark = r.action === 'create' ? (r.needsReview ? 'CREATE+FLAG' : 'CREATE    ') : 'MERGE     ';
  console.log(mark + ' ' + t.file + '  ' + t.first + ' ' + t.sur + '  -> ' + r.candidateKey.slice(0, 28));
  console.log('           ' + r.reason);
}

console.log('\n--- candidate records in base: ' + Object.keys(base).length);
for (const k of Object.keys(base)) {
  const f = base[k].fields;
  console.log('   ' + f['Full Name'] + '  [aliases: ' + f['Aliases'] + ']  [' + f['Company History'] + ']  loc=' + f['Location']);
}
console.log('\n--- counts: ' + creates + ' created, ' + updates + ' updated, ' + flags + ' flagged');
