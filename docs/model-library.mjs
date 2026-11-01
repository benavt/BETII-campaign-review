// Read-only coverage of exact native objects. Requests are never structures.
import {modelBrowser} from './model-browser.mjs';
import {monomerBrowser,monomerSequenceIdentity} from './monomer-models.mjs';

export const LIBRARY_METHODS=Object.freeze([
  {id:'boltz2-exact',label:'Boltz2 Exact',short:'Boltz2'},
  {id:'af3',label:'AlphaFold 3',short:'AF3'},
  {id:'opendde-exact',label:'OpenDDE Exact',short:'OpenDDE'},
  {id:'openfold',label:'OpenFold',short:'OpenFold'}
]);
export const LIBRARY_ROWS=Object.freeze([
  {target:'binder',kind:'monomer',label:'Binder alone'},
  ...['BRD3','BRD2','BRD4','BRDT'].map(target=>({target,kind:'complex',label:target+' ET'}))
]);
const VARIANTS=[{id:'untagged',label:'Untagged'},{id:'ctag64',label:'Tagged'}];
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sourceValid=s=>s&&text(s.path)&&hash(s.sha256);
const safeAsset=a=>a&&hash(a.sha256)&&['pdb','cif','mmcif'].includes(a.format)&&typeof a.url==='string'&&/^\.\/data\/assets\//.test(a.url)&&!/\.\.|[\\%?#:\u0000-\u0020\u007f]/.test(a.url);

function subjectsOf(campaign){
  const records=new Map();
  for(const s of [...(campaign.candidatePool||[]),...(campaign.subjects||[])])if(s&&text(s.id))records.set(s.id,s);
  return [...records.values()];
}
function construct(subject,variant){
  const declared=subject.constructVariants?.find(v=>v.id===variant);
  const identity=monomerSequenceIdentity(subject,variant);
  if(!identity)return null;
  return {sha256:identity,sequence:declared?.sequence??(variant==='untagged'?subject.sequence:undefined)};
}

function cellFor(subject,row,engine,variant){
  const base={candidateId:subject.id,kind:row.kind,target:row.target,engine,variant};
  const identity=construct(subject,variant);
  if(!identity)return {...base,status:'not_declared',reason:'Exact construct sequence is not declared.',model:null,asset:null};
  const records=row.kind==='monomer'?subject.monomerModels:subject.modelCoverage?.models;
  const matches=(records||[]).filter(m=>m.foldingEngine===engine&&m.constructVariant===variant&&(row.kind==='monomer'||m.target===row.target));
  const unavailable=reason=>({...base,status:'not_imported',reason,model:null,asset:null});
  if(matches.length!==1)return unavailable(matches.length?'Conflicting records need source review.':'No validated browser model is imported for this combination.');
  const model=matches[0],asset=model.molecularModel;
  if(model.status!=='verified'||!text(model.id)||!hash(model.modelSha256)||model.constructSequenceSha256!==identity.sha256||!safeAsset(asset)||model.modelSha256!==asset.sha256)return unavailable('The model or exact construct identity has not passed import checks.');
  if(identity.sequence!==undefined&&model.constructSequence!==undefined&&model.constructSequence!==identity.sequence)return unavailable('The recorded sequence differs from the declared construct.');
  if(!sourceValid(model.source)||model.source.sha256!==model.modelSha256||!sourceValid(asset.source)||asset.source.sha256!==model.modelSha256)return unavailable('A native source identity is missing or differs from the browser model.');
  let resolved;
  try{
    if(row.kind==='monomer'){
      if(model.target!==undefined||model.targetSequenceSha256||asset.kind!=='binder_only')return unavailable('A receptor-bound structure cannot fill a binder-monomer cell.');
      resolved=monomerBrowser(subject,{variant,engine}).resolved;
    }else{
      if(asset.kind==='binder_only'||!hash(model.targetSequenceSha256))return unavailable('A bound complex needs its exact receptor identity.');
      resolved=modelBrowser(subject,{selection:{variant,engine,target:row.target}}).rows[0];
    }
  }catch{return unavailable('The native model metadata needs source review.');}
  if(!resolved?.asset||resolved.model?.id!==model.id)return unavailable(resolved?.reason||'No validated browser model is imported for this combination.');
  return {...base,status:'available',reason:null,model,asset:resolved.asset};
}

export function modelLibrary(campaign,options={}){
  const all=subjectsOf(campaign),selectedIds=options.selectedIds??campaign.selectionDraft?.selectedIds??(campaign.subjects||[]).map(s=>s.id);
  const selectedSet=new Set(selectedIds),scope=options.scope==='all'?'all':'selection';
  const subjects=scope==='all'?all:all.filter(s=>selectedSet.has(s.id));
  const candidate=subjects.find(s=>s.id===options.candidateId)||subjects[0]||null;
  const variant=VARIANTS.some(v=>v.id===options.variant)?options.variant:'untagged';
  const allCells=subjects.flatMap(s=>VARIANTS.flatMap(v=>LIBRARY_ROWS.flatMap(row=>LIBRARY_METHODS.map(m=>cellFor(s,row,m.id,v.id)))));
  const counts=cells=>({available:cells.filter(c=>c.status==='available').length,expected:cells.filter(c=>c.status!=='not_declared').length,notDeclared:cells.filter(c=>c.status==='not_declared').length});
  const engineSummaries=LIBRARY_METHODS.map(method=>({...method,variants:VARIANTS.map(v=>({...v,monomer:counts(allCells.filter(c=>c.engine===method.id&&c.variant===v.id&&c.kind==='monomer')),complex:counts(allCells.filter(c=>c.engine===method.id&&c.variant===v.id&&c.kind==='complex'))}))}));
  const rows=candidate?LIBRARY_ROWS.map(row=>({...row,cells:LIBRARY_METHODS.map(m=>allCells.find(c=>c.candidateId===candidate.id&&c.variant===variant&&c.target===row.target&&c.kind===row.kind&&c.engine===m.id))})):[];
  return {scope,subjects,candidate,variant,methods:LIBRARY_METHODS,variants:VARIANTS,rows,engineSummaries,allCandidateCount:all.length,selectedCount:all.filter(s=>selectedSet.has(s.id)).length,...counts(allCells)};
}

function auditView(audit){
  if(!audit||!sourceValid(audit.source))return '';
  const notes=Array.isArray(audit.notes)?audit.notes.filter(text).slice(0,20):[];
  const date=text(audit.observedAt)&&Number.isFinite(Date.parse(audit.observedAt))&&/(Z|[+-]\d\d:\d\d)$/.test(audit.observedAt)?audit.observedAt:null;
  return `<details class="library-audit"><summary>Cache check details</summary>${text(audit.summary)?`<p>${esc(audit.summary)}</p>`:''}${date?`<p class="fine muted">Checked ${esc(date)}</p>`:''}${notes.length?`<ul>${notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}<p class="fine library-source">${esc(audit.source.path)}<br>SHA-256 ${esc(audit.source.sha256)}</p></details>`;
}
function bar(label,count){
  return `<div class="library-count"><div><span>${label}</span><strong>${count.available}<span class="muted"> / ${count.expected}</span></strong></div><progress class="library-bar" value="${count.available}" max="${count.expected||1}" aria-label="${label}: ${count.available} of ${count.expected} declared combinations imported">${count.available} / ${count.expected}</progress></div>`;
}
export function renderModelLibrary(campaign,options={}){
  const library=modelLibrary(campaign,options);
  return `<section class="model-library" aria-label="Model library"><header class="library-heading"><div><p class="eyebrow">Structure collection</p><h2>Model library</h2><p class="muted">Compare folding methods, tag variants and target isoforms.</p></div><label class="library-scope">Show<select class="input" data-library-scope aria-label="Model library scope"><option value="selection" ${library.scope==='selection'?'selected':''}>Current selection (${library.selectedCount})</option><option value="all" ${library.scope==='all'?'selected':''}>All candidates (${library.allCandidateCount})</option></select></label></header><p class="library-total"><strong>${library.available}</strong> of ${library.expected} model views available${library.notDeclared?` <span class="muted">· ${library.notDeclared} combinations lack an exact construct declaration</span>`:''}.</p><div class="library-methods">${library.engineSummaries.map(m=>`<article class="library-method"><h3>${m.label}</h3>${m.variants.map(v=>`<div class="library-variant-count"><h4>${v.label}</h4>${bar('Binder alone',v.monomer)}${bar('Bound to isoforms',v.complex)}</div>`).join('')}</article>`).join('')}</div><section class="library-inspect" aria-label="Choose a structure"><div class="library-controls"><label>Candidate<select class="input" data-library-candidate aria-label="Model library candidate">${library.subjects.map(s=>`<option value="${esc(s.id)}" ${s.id===library.candidate?.id?'selected':''}>${esc(s.displayName||s.label||s.id)}</option>`).join('')}</select></label><div class="library-construct" role="group" aria-label="Construct variant">${VARIANTS.map(v=>`<button type="button" data-library-variant="${v.id}" aria-pressed="${library.variant===v.id}">${v.label}</button>`).join('')}</div></div>${library.candidate?`<table class="library-grid"><caption class="sr-only">${esc(library.candidate.displayName||library.candidate.label||library.candidate.id)} · ${library.variant==='untagged'?'Untagged':'Tagged'} native models</caption><thead><tr><th scope="col">Structure</th>${LIBRARY_METHODS.map(m=>`<th scope="col"><abbr title="${m.label}">${m.short}</abbr></th>`).join('')}</tr></thead><tbody>${library.rows.map(r=>`<tr><th scope="row">${r.label}</th>${r.cells.map(c=>`<td>${c.status==='available'?`<button type="button" class="library-view" data-library-model="${esc(c.model.id)}" data-library-candidate="${esc(c.candidateId)}" data-library-kind="${c.kind}" data-library-engine="${c.engine}" data-library-variant="${c.variant}" data-library-target="${c.target}" aria-label="View ${esc(library.candidate.displayName||library.candidate.label||c.candidateId)}, ${r.label}, ${LIBRARY_METHODS.find(m=>m.id===c.engine).label}, ${c.variant==='untagged'?'untagged':'tagged'}"><span aria-hidden="true">●</span> View</button>`:`<span class="library-missing" title="${esc(c.reason)}">${c.status==='not_declared'?'Not declared':'Not imported'}</span>`}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'<p class="notice">No candidates are in this selection. Switch to all candidates to explore the pool.</p>'}<p class="fine muted library-note">Each view is a design, tag setting, folding method and binder-only or target-bound structure. Unfilled combinations are not a job request; a cache check may recover an existing model.</p></section>${auditView(campaign.modelLibraryAudit)}</section>`;
}
