import {metrics, finite, format, rowData, sortRows, median, plotRows} from './metrics.mjs';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const engineNames = {'boltz2-exact':'Boltz2 Exact', af3:'AlphaFold 3', 'opendde-exact':'OpenDDE Exact', openfold:'OpenFold', colabfold:'ColabFold'};
const defaultState = {group:'all', search:'', kind:'complex', engine:'boltz2-exact', target:'BRD3', scorer:'DeltaForge', rank:1, x:'Kd_nM', y:'minimumPredictedSelectivity', sort:'minimumPredictedSelectivity', descending:true};
const requestedScorer = new URLSearchParams(location.search).get('scorer');
if (['DeltaForge','PCANN'].includes(requestedScorer)) defaultState.scorer=requestedScorer;
let data, state = {...defaultState}, rows = [], selected = null;
const groupName = id => data.groups.find(g => g.id === id).label;
const color = s => s.id === 'AP2-9' ? '#d5afff' : s.group === 'our-panel' ? '#f6a15d' : '#63d4c4';
const targets = ['BRD3','BRD2','BRD4','BRDT'];
const columns = [['label','Sequence'], ['group','Group'], ['Kd_nM','Pred. Kd (nM)'], ['minimumPredictedSelectivity','Min BRD3 pref. (×)'], ['limiting','Limiting isoform'], ['BRD2_ratio','BRD2 / BRD3'], ['BRD4_ratio','BRD4 / BRD3'], ['BRDT_ratio','BRDT / BRD3'], ['ipSAE_full','Full ipSAE'], ['ipTM','ipTM'], ['pTM','pTM'], ['mean_pLDDT','Mean pLDDT'], ['solubility','Solubility'], ['usability','Usability']];

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type})), a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) {return '"' + String(value ?? '').replace(/"/g, '""') + '"';}
function currentCsv() {
  const keys = Object.keys(metrics);
  return [['group','candidate_id','model_kind','folding_method','target','scorer','native_rank','model_sha256',...keys,'limiting_isoform'],
    ...rows.map(r => [r.subject.group, r.subject.id, state.kind, state.engine, state.kind === 'complex' ? state.target : '', state.scorer, r.model?.nativeRank ?? '', r.model?.modelSha256 ?? '', ...keys.map(k => finite(r.values[k]) ? r.values[k] : ''), r.limitingIsoform ?? ''])]
    .map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
function groupSummary() {
  $('#group-summary').innerHTML = data.groups.map(g => {
    const groupRows = rows.filter(r => r.subject.group === g.id);
    return `<article class="group-card ${g.id === 'modified-adaptyv' ? 'jokent' : ''}"><h3>${esc(g.label)} <span class="muted">${groupRows.length} visible / 10</span></h3><div class="stats">${['Kd_nM','minimumPredictedSelectivity','ipSAE_full','solubility'].map(key => {
      const values = groupRows.map(r => r.values[key]).filter(finite);
      return `<div class="stat"><span>Median ${esc({Kd_nM:'Kd (nM)',minimumPredictedSelectivity:'BRD3 preference (×)',ipSAE_full:'full ipSAE',solubility:'solubility'}[key])}</span><strong>${format(median(values))}</strong><small>${values.length} / ${groupRows.length} available</small></div>`;
    }).join('')}</div></article>`;
  }).join('');
}
function scatter() {
  const logX = $('#log-x').checked, logY = $('#log-y').checked;
  const plotted = plotRows(rows, state.x, state.y, logX, logY), svg = $('#scatter');
  const x0 = 95, x1 = 965, y0 = 32, y1 = 350;
  if (!plotted.length) {svg.innerHTML = '<text x="500" y="185" text-anchor="middle">No rows have both selected metrics in this view.</text>'; $('#plot-status').textContent = `0 of ${rows.length} rows plotted. Choose another metric, scorer or folding method.`; return;}
  const transform = (v, log) => log ? Math.log10(v) : v;
  function scale(key, log, start, end) {
    const values = plotted.map(r => transform(r.values[key], log));
    let lo = Math.min(...values), hi = Math.max(...values), margin = (hi - lo || Math.max(Math.abs(lo)*.1, .1))*.09;
    lo -= margin; hi += margin;
    return {pos:v => start + (transform(v, log) - lo) / (hi-lo) * (end-start), ticks:Array.from({length:5},(_,i) => lo + (hi-lo)*i/4), pixel:v => start+(v-lo)/(hi-lo)*(end-start)};
  }
  const xs = scale(state.x, logX, x0, x1), ys = scale(state.y, logY, y1, y0);
  let html = xs.ticks.map(t => `<line class="tick" x1="${xs.pixel(t)}" y1="${y0}" x2="${xs.pixel(t)}" y2="${y1}"/><text x="${xs.pixel(t)}" y="${y1+25}" text-anchor="middle">${format(logX ? 10**t : t)}</text>`).join('');
  html += ys.ticks.map(t => `<line class="tick" x1="${x0}" y1="${ys.pixel(t)}" x2="${x1}" y2="${ys.pixel(t)}"/><text x="${x0-14}" y="${ys.pixel(t)+4}" text-anchor="end">${format(logY ? 10**t : t)}</text>`).join('');
  html += `<text x="530" y="411" text-anchor="middle">${esc(metrics[state.x].label)}${logX?' · log scale':''}</text><text transform="translate(19,190) rotate(-90)" text-anchor="middle">${esc(metrics[state.y].label)}${logY?' · log scale':''}</text>`;
  // A neutral 1× reference helps read preference without implying a selection cutoff.
  if (state.y.includes('ratio') || state.y === 'minimumPredictedSelectivity') {
    const y = ys.pos(1); if (y >= y0 && y <= y1) html += `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#b2c4d0" stroke-dasharray="5 6"/><text x="${x1-4}" y="${y-7}" text-anchor="end">1× · equal predicted affinity</text>`;
  }
  html += plotted.map(r => {
    const x=xs.pos(r.values[state.x]), y=ys.pos(r.values[state.y]), s=r.subject;
    const attr=`class="dot" tabindex="0" role="button" data-key="${esc(s.key)}" aria-label="${esc(s.label)}: ${esc(metrics[state.x].label)} ${format(r.values[state.x])}, ${esc(metrics[state.y].label)} ${format(r.values[state.y])}" fill="${color(s)}"`;
    const title=`<title>${esc(s.id)} · ${esc(groupName(s.group))}\n${esc(metrics[state.x].label)}: ${format(r.values[state.x])}\n${esc(metrics[state.y].label)}: ${format(r.values[state.y])}</title>`;
    if (s.id === 'AP2-9') return `<path ${attr} d="M ${x} ${y-10} L ${x+10} ${y} L ${x} ${y+10} L ${x-10} ${y} Z">${title}</path><text x="${x+13}" y="${y-9}">AP2-9</text>`;
    return s.group === 'our-panel' ? `<circle ${attr} cx="${x}" cy="${y}" r="7">${title}</circle>` : `<rect ${attr} x="${x-6.5}" y="${y-6.5}" width="13" height="13" rx="1">${title}</rect>`;
  }).join('');
  svg.innerHTML=html;
  svg.querySelectorAll('[data-key]').forEach(n => {n.onclick=()=>select(n.dataset.key); n.onkeydown=e=>{if (e.key==='Enter'||e.key===' ') {e.preventDefault(); select(n.dataset.key);}};});
  $('#plot-status').textContent=`${plotted.length} of ${rows.length} rows plotted · ${rows.length-plotted.length} missing one or both metrics${logX||logY?' or nonpositive on a log axis':''}. Colors and shapes identify the requested groups; AP2-9 is the diamond.`;
}
function table() {
  const displayed = metrics[state.sort] && !columns.some(([k])=>k===state.sort) ? [...columns,[state.sort,metrics[state.sort].label]] : columns;
  $('#comparison-table thead').innerHTML='<tr>'+displayed.map(([k,label])=>`<th ${k===state.sort?`aria-sort="${state.descending?'descending':'ascending'}"`:''}>${k==='limiting'?esc(label):`<button data-sort="${esc(k)}">${esc(label)}${k===state.sort?(state.descending?' ↓':' ↑'):''}</button>`}</th>`).join('')+'</tr>';
  $('#comparison-table tbody').innerHTML=rows.map(r=>`<tr ${r.subject.key===selected?'class="selected"':''}><td><button class="candidate" data-key="${esc(r.subject.key)}">${esc(r.subject.label)}<small>${esc(r.subject.id)} · ${r.values.length} aa</small></button></td><td><span class="badge ${r.subject.id==='AP2-9'?'control':r.subject.group==='our-panel'?'our':'jokent'}">${r.subject.id==='AP2-9'?'Our panel · AP2-9':r.subject.group==='our-panel'?'Our panel':'Jokent · modified'}</span></td>${displayed.slice(2).map(([k])=>`<td>${k==='limiting'?esc(r.limitingIsoform||'—'):format(r.values[k])}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${displayed.length}">No sequences match these filters.</td></tr>`;
  $('#comparison-table').querySelectorAll('[data-key]').forEach(n=>n.onclick=()=>select(n.dataset.key));
  $('#comparison-table').querySelectorAll('[data-sort]').forEach(n=>n.onclick=()=>{state.descending=state.sort===n.dataset.sort?!state.descending:true; state.sort=n.dataset.sort; $('#sort').value=state.sort; render();});
}
function panelTable(s, scorer) {
  const p=s.panels[scorer];
  return `<h3>${esc(scorer)} · Boltz2 Exact</h3><p class="${p.status==='complete'?'muted':'pending'}">${p.status==='complete'?`Complete panel · minimum BRD3 preference ${format(p.minimumPredictedSelectivity)}× · limiting isoform ${esc(p.limitingIsoform)}`:`${p.status==='incompatible'?'Incompatible calibration; ratios withheld':'Pending '+p.missingTargets.join(', ')}`}</p><table><thead><tr><th>Isoform</th><th>Predicted Kd (nM)</th><th>Kd / BRD3</th></tr></thead><tbody>${targets.map(t=>`<tr><td>${t}</td><td>${format(p.Kd_nM[t])}</td><td>${p.status==='complete'?(t==='BRD3'?'1 (reference)':format(p.ratiosOverBRD3[t])+'×'):'—'}</td></tr>`).join('')}</tbody></table>`;
}
function details() {
  const r=rows.find(r=>r.subject.key===selected);
  if (!r) {$('#detail').innerHTML='<h2>Inspect a sequence</h2><p>Select a row or plot point to see the sequence, four-isoform predictions, native coordinates and metric sources.</p>';return;}
  const s=r.subject,m=r.model;
  $('#detail').innerHTML=`<div class="section-title"><div><p class="eyebrow">${esc(groupName(s.group))}</p><h2>${esc(s.label)}</h2><p class="muted">${esc(s.id)} · origin: ${esc(s.origin)} · ${s.sequence.length} aa · untagged</p></div><button id="download-sequence">Sequence FASTA ↓</button></div><code class="sequence">${esc(s.sequence)}</code><p class="detail-hash">Sequence SHA-256: <code>${esc(s.sequenceSha256)}</code></p><div class="detail-grid"><div>${panelTable(s,'DeltaForge')}</div><div>${panelTable(s,'PCANN')}</div></div><h3 style="margin-top:24px">Selected native model</h3><p>${esc(engineNames[state.engine])} · ${esc(state.kind)}${state.kind==='complex'?' · '+esc(state.target):''}${state.kind==='homodimer'?' · native rank '+state.rank:''}</p>${m?`<p><a href="${esc(m.coordinateUrl)}" download>Download exact native coordinates ↓</a></p><p class="detail-hash">Model: <code>${esc(m.id)}</code><br>Coordinate SHA-256: <code>${esc(m.modelSha256)}</code></p><p class="muted">${esc(m.scope||'Native full-chain model; saved evidence only.')}</p>`:'<p class="pending">No saved native model for this combination.</p>'}<details class="sources"><summary>All metrics and source evidence for this model</summary>${m?`<div class="table-scroll"><table><thead><tr><th>Metric / method</th><th>Value</th><th>Scope</th><th>Saved source</th></tr></thead><tbody>${m.observations.map(o=>`<tr><td>${esc(o.label||o.metric)}<br>${esc(o.metric)} · ${esc(o.method)}</td><td>${format(o.value)} ${esc(o.unit||'')}</td><td>${esc(o.scope||'Selected native model')}</td><td><code>${esc(o.source.path)}</code><br><code>${esc(o.source.sha256)}</code></td></tr>`).join('')}${m.nativeConfidence?`<tr><td>Native confidence summary</td><td colspan="3"><code>${esc(JSON.stringify(m.nativeConfidence))}</code></td></tr>`:''}</tbody></table></div>`:''}<p>NetSolP-D ${esc(JSON.stringify(s.netSolP.scores))}</p><p class="detail-hash">NetSolP-D source: <code>${esc(s.netSolP.source.path)}</code> · SHA-256 <code>${esc(s.netSolP.source.sha256)}</code></p></details>`;
  $('#download-sequence').onclick=()=>download(s.id+'.fasta','>'+s.id+' | '+s.group+'\n'+s.sequence+'\n','text/plain');
}
function select(key) {selected=key; table(); details(); $('#detail').scrollIntoView({behavior:'smooth',block:'start'});}
function render() {
  rows=sortRows(data.subjects.filter(s=>(state.group==='all'||s.group===state.group)&&(!state.search||(s.id+' '+s.label).toLowerCase().includes(state.search.toLowerCase()))).map(s=>rowData(s,state)),state.sort,state.descending);
  $('#direction').textContent=state.descending?'Highest first ↓':'Lowest first ↑';
  $('#target').disabled=state.kind!=='complex';$('#rank-label').hidden=state.kind!=='homodimer';
  const count=rows.filter(r=>finite(r.values.Kd_nM)).length, compatible=state.kind==='complex'&&state.engine==='boltz2-exact';
  $('#context').textContent=`${rows.length} sequences · untagged · ${engineNames[state.engine]} · ${state.kind}${state.kind==='complex'?' · '+state.target:''} · ${state.scorer}: ${count}/${rows.length} Kds available. ${compatible?'BRD3 selectivity uses the complete four-isoform Exact panel.':'Exact-coordinate Kds and selectivity are shown only when Boltz2 Exact complexes are selected.'} All numbers retain their saved source; no new predictions.`;
  groupSummary();scatter();table();details();
}
async function init() {
  const response=await fetch('./data.json');if(!response.ok)throw Error('Saved comparison data unavailable');data=await response.json();
  if(data.subjects.length!==20||data.groups.some(g=>g.count!==10))throw Error('Comparison scope differs from 10 + 10');
  for(const id of ['x','y']) $('#'+id).innerHTML=Object.entries(metrics).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
  $('#sort').innerHTML=[['label','Sequence'],['group','Group'],...Object.entries(metrics).map(([k,v])=>[k,v.label])].map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('');
  for(const id of ['group','search','kind','engine','target','scorer','rank','x','y','sort']) {
    const input=$('#'+id);input.value=state[id];
    input.addEventListener(id==='search'?'input':'change',()=>{state[id]=id==='rank'?Number(input.value):input.value;if(id==='x'||id==='y')$('#log-'+id).checked=Boolean(metrics[state[id]].log);render();});
  }
  for(const id of ['log-x','log-y'])$('#'+id).onchange=scatter;
  $('#direction').onclick=()=>{state.descending=!state.descending;render();};
  $('#reset').onclick=()=>{state={...defaultState};for(const id of ['group','search','kind','engine','target','scorer','rank','x','y','sort'])$('#'+id).value=state[id];$('#log-x').checked=true;$('#log-y').checked=true;selected=null;render();};
  $('#download-current').onclick=()=>download('betii-comparison-'+state.kind+'-'+state.engine+'-'+state.scorer+'.csv',currentCsv(),'text/csv');
  $('#load-status').textContent='';render();
}
init().catch(e=>{$('#load-status').textContent='Comparison could not load: '+e.message;});
