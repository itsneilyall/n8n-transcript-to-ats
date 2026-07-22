const fs=require('fs');
const w=JSON.parse(fs.readFileSync('/home/claude/belo/belo-transcript-to-ats.json'));
const get=n=>w.nodes.find(x=>x.name===n).parameters.jsCode;

// --- date parsing generalization -------------------------------------------
const parse=get('Parse & Sort Transcripts');
const mkFile=(t)=>({json:{content:t,fileName:'x.txt'}});
const runParse=(txts)=>new Function('$input','return (function(){'+parse+'})()')({all:()=>txts.map(mkFile)});
const fmts=[
 ['Title: A, First Call\nDate: 4 March 2026\n','2026-03-04'],
 ['Title: A, First Call\nDate: 2026-03-04\n','2026-03-04'],
 ['Title: A, First Call\nDate: March 4, 2026\n','2026-03-04'],
 ['Title: A, First Call\nDate: 4th Mar 2026\n','2026-03-04'],
 ['Title: A, First Call\nDate: 04/03/2026\n','2026-03-04'],
 ['no header at all, just talking\n',null],
];
let f=0;
for(const [txt,exp] of fmts){
  const got=runParse([txt])[0].json.transcriptDate;
  const ok=got===exp; if(!ok)f++;
  console.log((ok?'PASS':'FAIL')+'  date "'+txt.split('\n')[1]+'" -> '+got);
}
// determinism + no-header id stability
const a=runParse(['no header, body one\n'])[0].json.conversationId;
const b=runParse(['no header, body one\n'])[0].json.conversationId;
const c=runParse(['no header, body TWO\n'])[0].json.conversationId;
console.log((a===b?'PASS':'FAIL')+'  headerless id is deterministic across runs');
console.log((a!==c?'PASS':'FAIL')+'  headerless ids differ by body');
if(a!==b||a===c)f++;

// --- opportunity key stability across role wording -------------------------
const pay=get('Build Airtable Payloads');
const runPay=(ext,id)=>new Function('$input','$','return (function(){'+pay+'})()')(
  {first:()=>({json:id})},
  (n)=>({first:()=>({json:n==='Validate & Normalize'?ext:id})}));
const ctxFor=(opp,iv)=>({conversationId:'c1',fileName:'f',title:'t',transcriptDate:'2026-07-21',
  transcript:'x',firstName:'Priyanka',surnameKey:'raghavan',firstNameKey:'priyanka',confidence:0.9,
  extraction:{candidate:{full_name:'Priyanka Raghavan'},conversation:{},opportunity:opp,interview:iv,tags:[],companies:[]}});
const idObj={action:'merge',candidateKey:'raghavan-priyanka-k1',needsReview:false,reason:'',score:70,
  corroboration:[],contradiction:[],updateState:true,existing:{aliases:['Priyanka'],companyHistory:['Nexler Health']}};

const t6=runPay(ctxFor({company:'Helix Data',role:'Enterprise Account Executive',stage:'Second Stage'},
                       {stage:'Second Stage',interviewer:'Rachel Osei',date:'2026-07-23'}),idObj)[0].json;
const t7=runPay(ctxFor({company:'Helix Data',role:'EAE',stage:'Final'},
                       {stage:'Second Stage',interviewer:'Rachel Osei',date:null,outcome:'Moved to final'}),idObj)[0].json;
console.log((t6.opportunityFields['Opportunity Key']===t7.opportunityFields['Opportunity Key']?'PASS':'FAIL')
  +'  T6/T7 same Opportunity despite "Enterprise Account Executive" vs "EAE"');
console.log((t6.interviewFields['Interview Key']===t7.interviewFields['Interview Key']?'PASS':'FAIL')
  +'  T6/T7 same Interview despite T7 having no date (outcome updates the row)');
if(t6.opportunityFields['Opportunity Key']!==t7.opportunityFields['Opportunity Key'])f++;
if(t6.interviewFields['Interview Key']!==t7.interviewFields['Interview Key'])f++;

// --- alias + history union on merge ----------------------------------------
const merged=runPay({...ctxFor(null,null),firstName:'Priya',firstNameKey:'priya',
  extraction:{candidate:{full_name:'Priya Raghavan',preferred_name:'Priya',current_company:'Nexa Health',company_history:['Nexa Health']},conversation:{},tags:[]}},idObj)[0].json;
const al=merged.candidateFields['Aliases'], hist=merged.candidateFields['Company History'];
console.log((al.includes('Priyanka')&&al.includes('Priya')?'PASS':'FAIL')+'  aliases UNION, "Priyanka" survives a "Priya" merge -> '+al);
console.log((hist.includes('Nexler Health')&&hist.includes('Nexa Health')?'PASS':'FAIL')+'  company history UNION -> '+hist);
console.log((merged.candidateFields['Full Name']===undefined?'PASS':'FAIL')+'  canonical Full Name not overwritten on merge');
if(!al.includes('Priyanka')||!hist.includes('Nexler Health')||merged.candidateFields['Full Name']!==undefined)f++;

console.log('\n'+(f===0?'ALL PASS':f+' FAILURES'));
