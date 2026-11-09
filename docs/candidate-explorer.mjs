// Read-only source evidence and an editable review draft; never a run mutation.
import {scopedMetrics,nativeModelHash,calibrationIdentity} from './panel.mjs';
import {renderViewerColorControls,renderViewerRepresentationControls} from './viewer-colors.mjs';
import {modelBrowser,renderModelBrowser} from './model-browser.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assert=(v,m)=>{if(!v)throw new Error(m);};
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/i.test(v);
const key=m=>`${m.constructVariant}|${m.target}|${m.foldingEngine}`;
const positive=v=>Number.isFinite(v)&&v>0;
const axisDefinitions={ipSAE_full:{label:'BRD3 full-chain ipSAE',scale:'linear'},ipSAE_core:{label:'BRD3 core ipSAE',scale:'linear'},Kd_nM:{label:'BRD3 predicted Kd (nM)',scale:'log10'},minimum_selectivity:{label:'Minimum predicted BRD3 preference (×)',scale:'log10'}};
function sourced(s){return s&&typeof s.path==='string'&&s.path.trim()&&sha(s.sha256);}

// Fixed generator colors are independent of the currently displayed fold/scorer.
export const GENERATOR_COLORS=Object.freeze({rfd3:'#0072B2',rfd4:'#CC79A7',ligandforge:'#D55E00',apnovo:'#009E73',unknown:'#6B7280'});
const generationText=value=>typeof value==='string'?value.trim().slice(0,160):'';
export function designGenerationCategory(subject){
  const origin=subject?.designOrigin||{},generation=subject?.modelGeneration||{};
  const scopedGeneration=['design','generation','design_generation'].includes(generation.kind)||['design','generation','design_generation'].includes(generation.role)||['design','generation','design_generation'].includes(generation.stage);
  const recorded=generationText(origin.generationModel)||generationText(origin.model)||generationText(origin.engine)||generationText(generation.generationEngine)||(scopedGeneration?generationText(generation.engine):'')||generationText(origin.method);
  const sourceCategory=generationText(subject?.group)||'Source category unrecorded',method=recorded||sourceCategory;
  const definitions=[['rfd3','RFD3',/\brfd3\b|\brfdiffusion\s*3\b/i],['rfd4','RFD4',/\brfd4\b|\brfdiffusion\s*4\b/i],['ligandforge','LigandForge',/\bligand[\s-]?forge\b/i],['apnovo','AP Novo',/\b(?:alpha[\s-]?protein[\s-]?novo|ap[\s-]?novo)\b/i]];
  const found=definitions.find(([, ,pattern])=>pattern.test(method));
  return found?{id:found[0],label:found[1],color:GENERATOR_COLORS[found[0]],known:true,sourceCategory,recordedMethod:recorded||null}:{id:'unknown',label:'Generator unknown',color:GENERATOR_COLORS.unknown,known:false,sourceCategory,recordedMethod:recorded||null};
}
function pointCategory(row,colorBy,shortlist){
  return colorBy==='shortlist'?(shortlist.includes(row.id)?{id:'shortlisted',label:'Shortlisted',color:'#5262b6'}:{id:'unselected',label:'Not shortlisted',color:'#A8AFC5'}):designGenerationCategory(row.subject);
}
function colorLegend(rows,colorBy,shortlist){
  const entries=new Map();for(const row of rows){const category=pointCategory(row,colorBy,shortlist);if(!entries.has(category.id))entries.set(category.id,{...category,count:0});entries.get(category.id).count++;}
  const order=colorBy==='shortlist'?['shortlisted','unselected']:Object.keys(GENERATOR_COLORS);
  return `<div class="model-browser-legend explorer-color-legend"><div role="list" aria-label="${colorBy==='shortlist'?'Shortlist status':'Design generation model'} legend">${[...entries.values()].sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id)).map(entry=>`<span role="listitem"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${entry.color}"/></svg>${esc(entry.label)} · ${entry.count}</span>`).join('')}</div></div><p class="fine muted">${colorBy==='shortlist'?'Colors show shortlist membership.':'Colors show the recorded design generator, independently of refolding and scoring. Unknown generators stay gray.'} An outer ring marks a shortlisted candidate; a larger point marks the model being inspected.</p>`;
}
export function explorerPool(c){
  const entries=c.candidatePool||c.subjects||[],ids=new Set();assert(Array.isArray(entries),'Candidate pool must be an array.');
  for(const s of entries){assert(s&&typeof s.id==='string'&&s.id&&!ids.has(s.id),'Candidate pool contains an invalid or duplicate identity.');ids.add(s.id);}
  return entries;
}
function metric(model,subject,name){const rows=scopedMetrics(subject,model).filter(o=>o.metric===name&&Number.isFinite(o.value)&&sourced(o.source)&&(name!=='Kd_nM'||/deltaforge/i.test(o.method||'')));return rows.length===1?rows[0]:null;}
export function candidateExplorerData(c,{target=null,variant='untagged',engine='boltz2-exact',calibrationId=null,origin='all'}={}){
  const pool=explorerPool(c);target??=pool.find(subject=>subject.modelCoverage?.expectedTargets?.length)?.modelCoverage.expectedTargets[0]||'BRD3';
  const originLabel=s=>s.group||'Origin unrecorded',origins=[...new Set(pool.map(originLabel))];origin=origins.includes(origin)?origin:'all';
  const axes=new Map(Object.entries(axisDefinitions).map(([id,v])=>[id,{id,...v,label:v.label.replace('BRD3',target),available:0}]));
  const candidates=pool.filter(s=>origin==='all'||originLabel(s)===origin).map(subject=>{
    const models=subject.modelCoverage?.models||[],matches=models.filter(m=>m.target===target&&m.constructVariant===variant&&m.foldingEngine===engine),model=matches.length===1?matches[0]:null;
    const metrics={};
    if(model&&nativeModelHash(model)){
      for(const id of ['ipSAE_full','ipSAE_core','Kd_nM']){const o=metric(model,subject,id);if(o&&(id==='Kd_nM'?o.unit==='nM'&&positive(o.value)&&calibrationIdentity(o):o.value>=0&&o.value<=1))metrics[id]={value:o.value,source:o.source,scope:o.scope,modelId:model.id,modelSha256:nativeModelHash(model),...(id==='Kd_nM'?{calibrationId:calibrationIdentity(o)}:{})};}
      const kd=['BRD3','BRD2','BRD4','BRDT'].map(t=>{const found=models.filter(m=>m.target===t&&m.constructVariant===variant&&m.foldingEngine===engine);if(found.length!==1)return null;const o=metric(found[0],subject,'Kd_nM');return o&&o.unit==='nM'&&positive(o.value)&&calibrationIdentity(o)?{...o,calibrationId:calibrationIdentity(o)}:null;});
      if(target==='BRD3'&&kd.every(Boolean)&&new Set(kd.map(o=>o.calibrationId)).size===1)metrics.minimum_selectivity={value:Math.min(...kd.slice(1).map(o=>o.value/kd[0].value)),calibrationId:kd[0].calibrationId,scope:'Four exact native models · same construct, engine and saved scorer calibration',sources:kd.map(o=>o.source),modelIds:kd.map(o=>o.modelId),modelSha256s:kd.map(o=>o.modelSha256)};
      for(const m of subject.explorerMetrics||[]){
        if(!m||typeof m.key!=='string'||!/^[-a-zA-Z0-9_]{1,60}$/.test(m.key)||axisDefinitions[m.key]||typeof m.label!=='string'||m.label.length>160||!Number.isFinite(m.value)||m.modelId!==model.id||m.modelSha256!==nativeModelHash(model)||!sourced(m.source)||typeof m.scope!=='string'||!m.scope.trim())continue;
        if(/dockq/i.test(m.key)&&(!sha(m.referenceModelSha256)||m.value<0||m.value>1))continue;
        if((/distance|proximity/i.test(m.key)||['Å','A','angstrom'].includes(m.unit))&&m.value<0)continue;
        if((subject.explorerMetrics||[]).filter(other=>other.key===m.key&&other.modelId===model.id&&other.modelSha256===nativeModelHash(model)).length!==1)continue;
        const definition={id:m.key,label:m.label,scale:m.scale==='log10'?'log10':'linear',unit:m.unit};
        const existing=axes.get(m.key);if(existing&&(existing.label!==definition.label||existing.scale!==definition.scale))continue;
        if(definition.scale==='log10'&&!positive(m.value))continue;
        if(!existing)axes.set(m.key,{...definition,available:0});metrics[m.key]={...m};
      }
    }
    return {id:subject.id,label:subject.displayName||subject.label||subject.id,subject,model,asset:model?.molecularModel||null,metrics,generation:designGenerationCategory(subject)};
  });
  const calibrations=[...new Set(candidates.flatMap(r=>Object.values(r.metrics).map(m=>m.calibrationId).filter(Boolean)))];
  calibrationId=calibrations.includes(calibrationId)?calibrationId:calibrations[0]||null;
  for(const row of candidates)for(const id of Object.keys(row.metrics)){if(row.metrics[id].calibrationId&&row.metrics[id].calibrationId!==calibrationId)delete row.metrics[id];else if(axes.has(id))axes.get(id).available++;}
  const availableAxes=[...axes.values()].filter(a=>a.available);
  const xAxis=availableAxes.find(a=>a.id==='ipSAE_full')?.id||availableAxes[0]?.id||null;
  const yAxis=availableAxes.find(a=>a.id==='minimum_selectivity')?.id||availableAxes.find(a=>a.id!==xAxis)?.id||xAxis;
  return {candidates,pool,poolCount:pool.length,origin,origins,axes:availableAxes,xAxis,yAxis,target,variant,engine,calibrations,calibrationId};
}
export function selectionDraftFor(c,override){
  const original=override||c.selectionDraft||{schemaVersion:1,id:`${c.run.id}_selection-draft`,selectedIds:(c.subjects||[]).map(s=>s.id),history:[]};
  const d=structuredClone(original),known=new Set(explorerPool(c).map(s=>s.id));
  assert(d.schemaVersion===1&&typeof d.id==='string'&&Array.isArray(d.selectedIds)&&d.selectedIds.length<=known.size&&new Set(d.selectedIds).size===d.selectedIds.length&&d.selectedIds.every(id=>known.has(id)),'Choose unique shortlist candidates from the recorded pool.');
  assert(d.suggestedTarget===undefined||Number.isInteger(d.suggestedTarget)&&d.suggestedTarget>=1&&d.suggestedTarget<=50000,'Suggested shortlist size must be a positive whole number.');
  assert(d.executionAuthorized!==true,'A selection draft cannot authorize execution.');
  assert(d.history===undefined||Array.isArray(d.history)&&d.history.length<=10000,'Draft history must be a bounded list.');
  return {...d,history:d.history||[],reviewStatus:'needs_review',executionAuthorized:false};
}
export function editSelectionDraft(c,draft,{candidateId,action,note='',at=new Date().toISOString()}={}){
  const d=selectionDraftFor(c,draft),known=new Set(explorerPool(c).map(s=>s.id));
  assert(known.has(candidateId)&&['consider','remove'].includes(action),'Choose a recorded candidate and shortlist action.');
  assert(typeof note==='string'&&note.length<=4000&&typeof at==='string'&&Number.isFinite(Date.parse(at))&&/(Z|[+-]\d\d:\d\d)$/.test(at),'Draft edits need a bounded note and timestamp with timezone.');
  const selected=d.selectedIds.includes(candidateId);
  if(action==='consider'){assert(!selected,'Candidate is already in the shortlist.');d.selectedIds.push(candidateId);}
  else{assert(selected,'Candidate is not in the shortlist.');d.selectedIds=d.selectedIds.filter(id=>id!==candidateId);}
  d.updatedAt=at;d.history.push({candidateId,action,note:note.trim(),at});return d;
}
export function materializeSelectionDraft(c,override){
  assert(!c.foldPlan&&!c.openfoldPlan,'Use a separate review campaign; frozen execution campaigns cannot be materialized from a draft.');
  const draft=selectionDraftFor(c,override),pool=explorerPool(c),ids=new Set(draft.selectedIds),proof='selection-draft-complete';
  const evidence=(c.evidence||[]).filter(e=>e.id!==proof&&(!e.subjectIds?.length||e.subjectIds.some(id=>ids.has(id)))).map(e=>e.subjectIds?{...e,subjectIds:e.subjectIds.filter(id=>ids.has(id))}:e);
  evidence.push({id:proof,label:'Review shortlist',kind:'cache_integrity',status:ids.size?'verified':'missing',summary:ids.size?`${ids.size} ${ids.size===1?'candidate is':'candidates are'} selected; final human review is pending.`:'No candidates selected. Add candidates from the recorded pool to begin review.',source:{label:'Editable browser selection draft; no execution authorization'}});
  return {...c,subjects:draft.selectedIds.map(id=>structuredClone(pool.find(s=>s.id===id))),selectionDraft:draft,evidence,requiredEvidence:[...new Set([...(c.requiredEvidence||[]).filter(id=>evidence.some(e=>e.id===id)),proof])],run:{...c.run,acceptance:'needs_review'}};
}
// Clip generous touch targets at the nearest-point boundary. A later point's
// transparent target must never cover a different visible point's center.
export function pointHitRegions(points){
  assert(Array.isArray(points)&&points.every(p=>p&&typeof p.id==='string'&&Number.isFinite(p.x)&&Number.isFinite(p.y)),'Finite plot point identities are required.');
  return points.map((point,index)=>{
    let polygon=[[0,0],[680,0],[680,410],[0,410]];
    for(const other of points){
      if(other===point)continue;
      const dx=other.x-point.x,dy=other.y-point.y;if(dx===0&&dy===0)continue;
      const limit=(other.x**2+other.y**2-point.x**2-point.y**2)/2,next=[];
      for(let j=0;j<polygon.length;j++){
        const a=polygon[j],b=polygon[(j+1)%polygon.length],av=a[0]*dx+a[1]*dy-limit,bv=b[0]*dx+b[1]*dy-limit;
        if(av<=0)next.push(a);
        if((av<0&&bv>0)||(av>0&&bv<0)){const t=-av/(bv-av);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}
      }
      polygon=next;
    }
    return {...point,index,polygon,coincident:points.some((p,i)=>i!==index&&p.x===point.x&&p.y===point.y)};
  });
}
function plot(data,xId,yId,selected,shortlist,colorBy){
  const x=data.axes.find(a=>a.id===xId),y=data.axes.find(a=>a.id===yId);if(!x||!y)return '<p class="notice">No compatible source-bound plot axes are recorded for this model selection.</p>';
  const rows=data.candidates.filter(r=>r.metrics[xId]&&r.metrics[yId]),transform=(n,a)=>a.scale==='log10'?Math.log10(n):n;
  const bounds=(id,a)=>{const values=rows.map(r=>transform(r.metrics[id].value,a));let lo=Math.min(...values),hi=Math.max(...values);if(lo===hi){lo-=.1;hi+=.1;}return [lo,hi];};
  const [xl,xh]=bounds(xId,x),[yl,yh]=bounds(yId,y),px=r=>70+(transform(r.metrics[xId].value,x)-xl)/(xh-xl)*560,py=r=>335-(transform(r.metrics[yId].value,y)-yl)/(yh-yl)*285;
  if(!rows.length)return `<p class="notice">No candidate has both selected source-bound metrics. ${data.candidates.length} candidates excluded; no missing value is plotted as zero.</p>`;
  const hits=pointHitRegions(rows.map(r=>({id:r.id,x:px(r),y:py(r)}))),position=n=>n.toFixed(6);
  const definitions=`<defs>${hits.map(p=>`<clipPath id="explorer-hit-${p.index}"><polygon points="${p.polygon.map(v=>v.map(position).join(',')).join(' ')}"/></clipPath>`).join('')}</defs>`;
  const targets=rows.map((r,i)=>{const p=hits[i];return `<g tabindex="0" role="button" cursor="pointer" data-explorer-point="${esc(r.id)}" aria-pressed="${r.id===selected}" aria-label="Inspect ${esc(r.label)}; ${esc(x.label)} ${r.metrics[xId].value.toPrecision(3)}; ${esc(y.label)} ${r.metrics[yId].value.toPrecision(3)}; ${esc(designGenerationCategory(r.subject).label)}${shortlist.includes(r.id)?'; shortlisted':''}"><circle cx="${position(p.x)}" cy="${position(p.y)}" r="22" fill="transparent" clip-path="url(#explorer-hit-${i})"/><title>${esc(r.label)}</title></g>`;}).join('');
  const dots=rows.map((r,i)=>{const category=pointCategory(r,colorBy,shortlist),radius=r.id===selected?9:6,cx=position(hits[i].x),cy=position(hits[i].y);return `${shortlist.includes(r.id)?`<circle pointer-events="none" cx="${cx}" cy="${cy}" r="${radius+3}" fill="none" stroke="#30394D" stroke-width="2" data-shortlisted-point="${esc(r.id)}"/>`:''}<circle pointer-events="none" cx="${cx}" cy="${cy}" r="${radius}" fill="${category.color}" stroke="${r.id===selected?'#152C60':'#FFFFFF'}" stroke-width="${r.id===selected?3:1.5}" data-point-generator="${esc(designGenerationCategory(r.subject).id)}"/>`;}).join('');
  const ticks=(lo,hi,a)=>Array.from({length:5},(_,i)=>{const n=lo+(hi-lo)*i/4,v=a.scale==='log10'?10**n:n;return {i,label:v.toPrecision(3)};});
  return `<svg class="scatter" viewBox="0 0 680 410" role="group" aria-label="Interactive candidate evidence plot"><line x1="70" x2="630" y1="335" y2="335" stroke="#8a94a5"/><line x1="70" x2="70" y1="50" y2="335" stroke="#8a94a5"/>${ticks(xl,xh,x).map(t=>`<text x="${70+t.i*140}" y="355" text-anchor="middle" font-size="12" fill="#596375">${t.label}</text>`).join('')}${ticks(yl,yh,y).map(t=>`<text x="62" y="${339-t.i*71.25}" text-anchor="end" font-size="12" fill="#596375">${t.label}</text>`).join('')}<text x="350" y="393" text-anchor="middle" font-size="13" fill="#30394d">${esc(x.label)}${x.scale==='log10'?' · log scale':''}</text><text transform="translate(16 195) rotate(-90)" text-anchor="middle" font-size="13" fill="#30394d">${esc(y.label)}${y.scale==='log10'?' · log scale':''}</text>${definitions}${targets}<g aria-hidden="true" pointer-events="none">${dots}</g></svg>${colorLegend(rows,colorBy,shortlist)}<p class="fine muted">${rows.length} candidates plotted · ${data.candidates.length-rows.length} excluded for missing or incompatible metrics. ${hits.some(p=>p.coincident)?'Coincident points share a position; use Inspect candidate to choose among them. ':''}Predictions; no measured selectivity is implied.</p>`;
}
function historicalComparison(row){
  const h=row.subject.historicalSelectivity;if(!h||!positive(h.minimumRatio)||!sourced(h.source)||typeof h.scope!=='string')return '';
  const current=row.metrics.minimum_selectivity?.value;
  return `<div class="candidate-metrics"><div><small>Earlier reported preference</small><strong>${h.minimumRatio.toPrecision(3)}×</strong><span>Historical report</span></div><div><small>Current exact-model preference</small><strong>${positive(current)?current.toPrecision(3)+'×':'Not established'}</strong><span>Native four-isoform panel</span></div></div><p class="fine muted">${esc(h.scope)} These records use different model or calibration evidence; an earlier ratio is not substituted for the current panel.</p>`;
}
function sourceCaveats(subject){
  const evidence=subject.rankingEvidence,record=evidence?.record;
  if(!record||!sourced(evidence.source))return '';
  const notes=[];
  if(record.cryptic_screen_pass===false)notes.push('Does not pass the recorded working cryptic-pocket screen. It remains available for comparison; pocket binding has not been established.');
  if(record.AF3_disagreement_hold===true)notes.push('AlphaFold 3 disagreed with the Exact-model evidence in the source review. Compare the separate models before selecting this design.');
  if(typeof record.selection_qualification==='string'&&record.selection_qualification.trim())notes.push(record.selection_qualification);
  return notes.length?`<aside class="notice candidate-source-caveats" aria-label="Recorded candidate qualifications"><div><strong>Review before selecting</strong><ul>${notes.map(note=>`<li>${esc(note)}</li>`).join('')}</ul></div></aside>`:'';
}
export function renderCandidateExplorer(c,{draft,selectedCandidateId,xAxis,yAxis,browserOptions={},colorBy='generation',...selection}={}){
  colorBy=colorBy==='shortlist'?'shortlist':'generation';
  const data=candidateExplorerData(c,selection),d=selectionDraftFor(c,draft),selected=data.candidates.find(r=>r.id===selectedCandidateId)||data.candidates[0];
  const browserConfig={selection:{variant:data.variant,target:data.target,engine:data.engine},...browserOptions},browser=selected?.subject.modelCoverage?modelBrowser(selected.subject,browserConfig):{assets:[],message:'No native model panel is recorded for this candidate.'};
  const visiblePocket=browser?.assets.some(asset=>selected.subject.explorerAnnotations?.some(a=>a.modelSha256===asset.sha256));
  xAxis=data.axes.some(a=>a.id===xAxis)?xAxis:data.xAxis;yAxis=data.axes.some(a=>a.id===yAxis)?yAxis:data.yAxis;
  const axis=(id,label,value)=>`<label>${label}<select class="input" data-explorer-axis="${id}">${data.axes.map(a=>`<option value="${esc(a.id)}" ${a.id===value?'selected':''}>${esc(a.label)} · ${a.available} recorded</option>`).join('')}</select></label>`;
  return `<section class="panel"><div class="panel-head"><div><h2>Shortlist</h2></div><span class="badge neutral">${d.selectedIds.length} shortlisted</span></div><div class="audit-filters"><label>Color by<select class="input" data-explorer-color><option value="generation" ${colorBy==='generation'?'selected':''}>Design generation model</option><option value="shortlist" ${colorBy==='shortlist'?'selected':''}>Shortlist status</option></select></label><label>Design origin<select class="input" data-explorer-origin><option value="all">All origins · ${data.poolCount}</option>${data.origins.map(origin=>`<option value="${esc(origin)}" ${origin===data.origin?'selected':''}>${esc(origin)} · ${data.pool.filter(s=>(s.group||'Origin unrecorded')===origin).length}</option>`).join('')}</select></label>${axis('x','Horizontal axis',xAxis)}${axis('y','Vertical axis',yAxis)}${data.calibrations.length>1?`<label>Saved scorer calibration<select class="input" data-explorer-calibration>${data.calibrations.map((id,i)=>`<option value="${esc(id)}" ${id===data.calibrationId?'selected':''}>Calibration ${i+1}</option>`).join('')}</select></label>`:''}<label>Inspect candidate<select class="input" data-explorer-candidate>${data.candidates.map(r=>`<option value="${esc(r.id)}" ${r.id===selected?.id?'selected':''}>${esc(r.label)}</option>`).join('')}</select></label></div><p class="fine muted">${data.candidates.length} of ${data.poolCount} pool candidates shown. ${esc(data.target)} · ${data.variant==='untagged'?'Untagged':data.variant==='ctag64'?'64-residue C-terminal tag':esc(data.variant)} · ${esc({'boltz2-exact':'Boltz2 Exact',af3:'AlphaFold 3','opendde-exact':'OpenDDE Exact'}[data.engine]||data.engine)}. ${data.axes.some(a=>/dockq/i.test(a.id))?'DockQ comparisons are source-bound exact model pairs.':'DockQ (diffused ↔ refolded): not recorded for this pool.'} Missing pocket-distance evidence is unavailable as an axis.</p>${plot(data,xAxis,yAxis,selected?.id,d.selectedIds,colorBy)}</section>${selected?`<section class="panel"><div class="panel-head"><div><h3>${esc(selected.label)}</h3><p class="fine muted">${esc(selected.generation.label)}${!selected.generation.known?` · Source category: ${esc(selected.generation.sourceCategory)}`:''}</p><p class="fine muted">Viewer selection is independent of the plot measurements below.</p></div><button class="button ${d.selectedIds.includes(selected.id)?'subtle':'primary'}" data-explorer-shortlist="${d.selectedIds.includes(selected.id)?'remove':'consider'}" data-explorer-candidate-id="${esc(selected.id)}">${d.selectedIds.includes(selected.id)?'Remove from draft shortlist':'Add to shortlist'}</button></div>${selected.subject.summary?`<p class="fine muted">${esc(selected.subject.summary)}</p>`:''}${sourceCaveats(selected.subject)}${historicalComparison(selected)}${selected.subject.modelCoverage?renderModelBrowser(selected.subject,browserConfig,{prefix:'explorer'}):''}${browser.assets.length?`<div class="viewer-options">${renderViewerColorControls('explorer','project')}<label><input id="explorer-sidechains" type="checkbox"> Side chains</label><label><input id="explorer-interface" type="checkbox"> Close contacts</label>${renderViewerRepresentationControls('explorer')}${visiblePocket?'<label><input id="explorer-pocket" type="checkbox"> Working pocket residues</label>':''}<button class="text-button" data-explorer-reset>Reset view</button>${browser.mode==='overlay'?'<button class="text-button" data-explorer-fit>Fit all models</button>':''}</div><div id="candidate-explorer-molecule" class="molecule-container"></div>`:''}<p id="candidate-explorer-status" class="viewer-status" role="status">${browser.assets.length?'Loading the selected native structures…':esc(browser.message)}</p><div class="table-scroll"><table><caption>Plot measurements · ${esc(data.target)} · ${data.variant==='untagged'?'Untagged':data.variant==='ctag64'?'64-residue tag':esc(data.variant)} · ${esc({'boltz2-exact':'Boltz2 Exact',af3:'AlphaFold 3','opendde-exact':'OpenDDE Exact'}[data.engine]||data.engine)}</caption><thead><tr><th>Metric</th><th>Value</th><th>Scope</th></tr></thead><tbody>${Object.entries(selected.metrics).map(([id,m])=>`<tr><th>${esc(data.axes.find(a=>a.id===id)?.label||id)}</th><td>${m.value.toPrecision(3)}</td><td>${esc(m.scope||'Scope not recorded')}</td></tr>`).join('')||'<tr><td colspan="3">No compatible metrics recorded.</td></tr>'}</tbody></table></div></section>`:''}<section class="panel"><h3>Your shortlist · ${d.selectedIds.length} selected</h3><p class="fine muted">Add or remove any recorded candidate; the suggested size of ${d.suggestedTarget??10} is not a limit. Changes require a fresh final review. Submitted jobs retain their original inputs; additional folds are requested separately.</p><div class="table-scroll"><table><thead><tr><th>Candidate</th><th>Actions</th></tr></thead><tbody>${d.selectedIds.map(id=>`<tr><th>${esc((s=>s?.displayName||s?.label||id)(data.pool.find(s=>s.id===id)))}</th><td><div class="shortlist-actions"><button type="button" class="button subtle" data-explorer-inspect="${esc(id)}">Inspect</button><button type="button" class="text-button shortlist-remove" data-explorer-shortlist="remove" data-explorer-candidate-id="${esc(id)}">Remove from draft</button></div></td></tr>`).join('')||'<tr><td colspan="2">No candidates selected.</td></tr>'}</tbody></table></div><button class="button primary" data-tab="review">Review this draft →</button></section>`;
}
