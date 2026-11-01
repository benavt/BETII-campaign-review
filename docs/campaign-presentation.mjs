// Display names do not rename scientific campaign IDs, runs or model files.
const weeks={'egfr-final20-cached':1,'adaptive-week2-tnfa':2,'adaptive-week3-glp1r':3,'tfr1-conserved-apical':4};
const targets={1:'EGFR',2:'TNF-alpha',3:'GLP-1R',4:'TfR1'};
const clean=v=>String(v||'').replace(/[a-f0-9]{64}/gi,'').replace(/\s+/g,' ').trim();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function campaignWeek(c){return weeks[c.id]??(Number.isInteger(c.adaptiveWeek)&&c.adaptiveWeek>=1&&c.adaptiveWeek<=4?c.adaptiveWeek:null);}
export function campaignTitle(c){
 const week=campaignWeek(c);if(week)return `Adaptive Week ${week} · ${targets[week]}`;
 if(c.selectionDraft&&c.id.startsWith('betii-'))return 'BETII · shortlist';
 const known={'betii-final10-exact-r5':'BETII · shortlist review','betii-final10-exact-r4':c.supersededBy?'BETII · previous final 10':'BETII · final 10'};
 return (clean(c.shortName||c.displayName||known[c.id]||c.name)||'Untitled campaign').slice(0,90);
}
export function orderCampaigns(campaigns){return campaigns.map((c,i)=>({c,i})).sort((a,b)=>(campaignWeek(a.c)??100)-(campaignWeek(b.c)??100)||a.i-b.i).map(x=>x.c);}
export function renderRecordedMetrics(metrics){
 if(!Array.isArray(metrics))return '';
 return `<div class="candidate-metrics">${metrics.filter(m=>m&&typeof m.label==='string').map(m=>`<div><small>${esc(m.label)}</small><strong>${esc(m.value===null||m.value===undefined||typeof m.value==='number'&&!Number.isFinite(m.value)?'Not recorded':m.value)}${m.unit?` <em>${esc(m.unit)}</em>`:''}</strong><span>${esc(m.scope||'Recorded source value')}</span></div>`).join('')}</div>`;
}
