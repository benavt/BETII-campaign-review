// Binder monomers are separate scientific objects from receptor-bound coverage.
// A pending request is never a model, and a complex is never a monomer fallback.
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=4000;
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const METHODS=Object.freeze({'boltz2-exact':'Boltz2 Exact',af3:'AlphaFold 3','opendde-exact':'OpenDDE Exact',openfold:'OpenFold'});
const STATES=new Set(['preparation_pending','not_started','queued','running','completed','failed','needs_attention','blocked','unknown']);
const stateLabel={preparation_pending:'Awaiting input preparation',not_started:'Not submitted',queued:'Queued',running:'Running',completed:'Awaiting validated model import',failed:'Run failed',needs_attention:'Needs attention',blocked:'Blocked',unknown:'Execution not established'};
function unique(values,label){assert(Array.isArray(values)&&values.length>0&&values.length<=64&&values.every(text)&&new Set(values).size===values.length,`Monomer ${label} must contain 1–64 unique identities.`);return [...values];}
function variantLabel(subject,id){return id==='untagged'?'Untagged':id==='ctag64'?'64-residue tag':subject.constructVariants?.find(v=>v.id===id)?.label||id;}
export function monomerSequenceIdentity(subject,variant){
 const declared=subject.constructVariants?.find(v=>v.id===variant);
 const value=declared?.sequenceSha256??(variant==='untagged'?subject.sequenceSha256:null);
 return hash(value)?value:null;
}
function dimensions(subject){
 const records=subject.monomerModels??[],plan=subject.monomerPlan;
 assert(Array.isArray(records)&&records.length<=4096,'Monomer models must be an array (max 4,096).');
 if(plan)assert(plan.schemaVersion===1,'Expected monomerPlan.schemaVersion: 1.');
 const variants=plan?unique(plan.expectedVariants,'construct variants'):[...new Set(records.map(r=>r.constructVariant))];
 const engines=plan?unique(plan.expectedEngines,'folding methods'):[...new Set(records.map(r=>r.foldingEngine))];
 assert(variants.every(id=>text(id)&&monomerSequenceIdentity(subject,id)), 'Each monomer construct needs an exact declared sequence identity.');
 assert(engines.every(text),'Each monomer folding method needs an identity.');
 assert(variants.length*engines.length<=4096,'Monomer coverage exceeds 4,096 cells.');
 return {records,plan,variants,engines};
}
function nativeHash(model){return model?.modelSha256??model?.molecularModel?.source?.sha256??model?.molecularModel?.sha256;}
function assetIssue(subject,model){
 if(!model)return 'No native monomer structure has been imported for this combination.';
 if(model.status!=='verified')return 'The monomer record has not passed source-integrity validation.';
 if(model.constructSequenceSha256!==monomerSequenceIdentity(subject,model.constructVariant))return 'The monomer sequence identity does not match this construct.';
 const asset=model.molecularModel;
 if(!asset)return 'A native monomer record exists; its browser structure has not been imported.';
 if(!hash(nativeHash(model))||!hash(asset.sha256)||nativeHash(model)!==asset.sha256)return 'The browser structure does not match the native monomer hash.';
 if(asset.kind!=='binder_only'||!text(asset.roles?.binder)||Object.keys(asset.roles).some(k=>k!=='binder')||asset.roles.receptor)return 'A monomer needs exactly one explicit designed-binder chain and no receptor chain.';
 if(!['pdb','cif','mmcif'].includes(asset.format))return 'The monomer structure format is not supported.';
 if(typeof asset.url!=='string'||!/^\.\/data\/assets\//.test(asset.url)||/\.\.|[\\%?#:]/.test(asset.url)||/[\u0000-\u0020\u007f]/.test(asset.url))return 'The recorded monomer structure is not a safe local browser asset.';
 const source=model.source;
 if(!source||!text(source.runId)||!text(source.workflowPin)||!hash(source.inputSha256)||!hash(source.manifestSha256))return 'The monomer run, workflow pin or input/manifest identity is missing.';
 return null;
}
export function validateMonomerProgress(subject){
 const p=subject.monomerPlan?.progress;if(p===undefined)return null;
 assert(p&&p.schemaVersion===1&&p.kind==='binder-monomer-progress'&&text(p.runId)&&hash(p.sourceManifestSha256),'Monomer progress needs a frozen run/manifest identity.');
 assert(typeof p.observedAt==='string'&&Number.isFinite(Date.parse(p.observedAt))&&/(Z|[+-]\d\d:\d\d)$/.test(p.observedAt),'Monomer progress needs a timestamp with timezone.');
 const requests=(subject.monomerPlan.requests||[]).filter(r=>r.runId===p.runId);assert(requests.length&&requests.every(r=>r.manifestSha256===p.sourceManifestSha256),'Monomer progress belongs to another run or manifest.');
 assert(Array.isArray(p.stages)&&p.stages.length>0&&p.stages.length<=256,'Monomer progress needs 1–256 stages.');
 const ids=new Set();for(const row of p.stages){
  assert(row&&typeof row.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(row.id)&&!ids.has(row.id),'Monomer progress stage needs a unique identity.');ids.add(row.id);
  assert(['msa','features','inference','validation'].includes(row.stage)&&['queued','running','completed','failed','blocked','unknown'].includes(row.state),'Monomer progress has an unknown stage or state.');
  assert(row.foldingEngine===undefined||subject.monomerPlan.expectedEngines.includes(row.foldingEngine),'Monomer progress uses an undeclared folding method.');
  assert(Array.isArray(row.jobIds)&&row.jobIds.length<=256&&new Set(row.jobIds).size===row.jobIds.length&&row.jobIds.every(j=>typeof j==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(j)),'Monomer progress job identities are invalid.');
  assert(row.source&&text(row.source.path)&&hash(row.source.sha256),'Monomer progress requires a hashed source record.');
 }
 return p;
}
export function renderMonomerProgress(subject,engine){
 const p=validateMonomerProgress(subject);if(!p)return '';
 const labels={msa:'CPU sequence search',features:'CPU feature preparation',inference:'Monomer folding',validation:'Output validation'},states={queued:'queued',running:'running',completed:'completed',failed:'failed',blocked:'blocked',unknown:'state unknown'},rows=p.stages.filter(r=>!r.foldingEngine||r.foldingEngine===engine);
 return `<div class="monomer-progress"><p class="fine"><strong>Run progress</strong> · Updated ${esc(new Date(p.observedAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}))}</p>${rows.length?`<ul class="fine">${rows.map(r=>`<li>${labels[r.stage]} — <strong>${states[r.state]}</strong></li>`).join('')}</ul>`:'<p class="fine muted">No run stage is recorded for this folding method.</p>'}<p class="fine muted">Native structures appear after validated import.</p><details class="audit-details"><summary>Progress source records</summary><pre class="sequence">${esc(JSON.stringify(p,null,2))}</pre></details></div>`;
}
export function validateMonomerModels(subject){
 const d=dimensions(subject),cells=new Set(),ids=new Set();
 for(const m of d.records){
  assert(m&&text(m.id)&&!ids.has(m.id),'Each monomer model needs a unique identity.');ids.add(m.id);
  assert(d.variants.includes(m.constructVariant)&&d.engines.includes(m.foldingEngine),'Monomer model refers to an undeclared construct or method.');
  const key=JSON.stringify([m.constructVariant,m.foldingEngine]);assert(!cells.has(key),'Duplicate selected monomer cell.');cells.add(key);
  assert(['verified','needs_review'].includes(m.status),'Monomer model status must be verified or needs_review.');
  assert(hash(m.constructSequenceSha256)&&m.constructSequenceSha256===monomerSequenceIdentity(subject,m.constructVariant),'Monomer sequence identity does not match its declared construct.');
  assert(m.target===undefined&&!m.targetSequenceSha256,'Monomer records must not name a target receptor.');
  // Unverified records may describe incomplete historical evidence; they stay blocked.
  if(m.status==='verified')assert(!assetIssue(subject,m),assetIssue(subject,m));
 }
 const requests=d.plan?.requests??[];
 assert(Array.isArray(requests)&&requests.length<=4096,'Monomer requests must be an array (max 4,096).');
 const requestIds=new Set(),requestCells=new Set();
 for(const r of requests){const key=JSON.stringify([r.constructVariant,r.foldingEngine]);
  assert(r&&text(r.id)&&!requestIds.has(r.id)&&!requestCells.has(key),'Each monomer request needs a unique identity and construct/method cell.');requestIds.add(r.id);requestCells.add(key);
  assert(d.variants.includes(r.constructVariant)&&d.engines.includes(r.foldingEngine)&&STATES.has(r.status),'Monomer request has an unknown cell or execution state.');
  assert(text(r.runId)&&hash(r.inputSha256),'Monomer request needs its frozen run and input identity.');
  assert(r.manifestSha256===undefined||hash(r.manifestSha256),'Monomer request manifest identity is invalid.');
 }
 validateMonomerProgress(subject);
 return d;
}
export function monomerBrowser(subject,selection={}){
 const d=validateMonomerModels(subject);
 const variants=d.variants.map(id=>({id,label:variantLabel(subject,id)})),engines=d.engines.map(id=>({id,label:subject.monomerPlan?.engineLabels?.[id]||METHODS[id]||id}));
 if(!variants.length||!engines.length)return {selection:null,variants,engines,rows:[],resolved:{model:null,asset:null,status:'missing',reason:'No binder-monomer calculations are recorded for this design.'},molecularModels:[],available:0,expected:0};
 const chosen={variant:selection.variant??variants[0].id,engine:selection.engine??engines[0].id};
 assert(d.variants.includes(chosen.variant)&&d.engines.includes(chosen.engine),'Choose a declared monomer construct and folding method.');
 const rows=d.variants.flatMap(variant=>d.engines.map(engine=>{
  const model=d.records.find(m=>m.constructVariant===variant&&m.foldingEngine===engine)||null,request=d.plan?.requests?.find(r=>r.constructVariant===variant&&r.foldingEngine===engine)||null,issue=assetIssue(subject,model);
  const asset=issue?null:{...structuredClone(model.molecularModel),species:'Designed binder',displayModelId:model.id,constructVariant:variant};
  const status=asset?'available':model?'blocked':request?.status||'missing';
  return {selection:{variant,engine},model,asset,request,status,reason:asset?null:model?issue:request?stateLabel[request.status]:issue};
 }));
 const resolved=rows.find(r=>r.selection.variant===chosen.variant&&r.selection.engine===chosen.engine);
 return {selection:chosen,variants,engines,rows,resolved,molecularModels:resolved.asset?[resolved.asset]:[],available:rows.filter(r=>r.asset).length,expected:rows.length};
}
function ptmSourceMatches(proof,observation){
 const pointer=proof.nativePointer;
 if(pointer===undefined||pointer==='/ptm')return proof.source?.locator==='ptm'&&observation.source?.locator==='ptm';
 if(typeof pointer!=='string'||pointer.length>1024||!/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])+)*\/ptm$/.test(pointer))return false;
 return [proof.source?.locator,observation.source?.locator].every(locator=>locator?.format==='json'&&locator.pointer===pointer);
}
export function monomerMetrics(model){
 if(!model||model.status!=='verified')return [];
 const accepted=[];
 for(const o of Array.isArray(model.observations)?model.observations:[]){
  if(!o||o.modelId!==model.id||o.modelSha256!==nativeHash(model)||o.foldingEngine!==model.foldingEngine||o.constructVariant!==model.constructVariant||!hash(o.source?.sha256)||typeof o.value!=='number'||!Number.isFinite(o.value))continue;
  if(o.metric==='mean_pLDDT'){
   const proof=model.confidenceProof;if(proof?.status!=='verified'||proof.modelSha256!==nativeHash(model)||proof.source?.sha256!==o.source.sha256||o.value<0||o.value>100)continue;
   if(!accepted.some(m=>m.metric===o.metric))accepted.push({...o,label:'Mean binder pLDDT',scope:'Whole designed binder monomer, including the tag where present.'});
  }else if(o.metric==='pTM'){
   const proof=model.nativeSummaryProof;if(proof?.status!=='verified'||proof.metric!=='pTM'||proof.ptmField!=='ptm'||proof.modelSha256!==nativeHash(model)||proof.foldingEngine!==model.foldingEngine||proof.constructVariant!==model.constructVariant||proof.constructSequenceSha256!==model.constructSequenceSha256||proof.source?.sha256!==o.source.sha256||!ptmSourceMatches(proof,o)||proof.value!==o.value||o.value<0||o.value>1)continue;
   if(!accepted.some(m=>m.metric===o.metric))accepted.push({...o,label:'Monomer fold confidence · pTM',scope:'Whole designed binder monomer. Not interface confidence or affinity.'});
  }
 }
 return accepted;
}
export function renderMonomerBrowser(subject,selection={}, {prefix='viewer'}={}){
 assert(/^[a-z][a-z0-9-]*$/.test(prefix),'Use a safe monomer-browser prefix.');
 const browser=monomerBrowser(subject,selection),r=browser.resolved;
 const select=(dimension,label,choices)=>`<label>${label}<select class="input" data-monomer-${dimension} aria-label="${label}">${choices.map(c=>`<option value="${esc(c.id)}" ${browser.selection[dimension]===c.id?'selected':''}>${esc(c.label)}</option>`).join('')}</select></label>`;
 const metrics=r.asset?monomerMetrics(r.model):[],method=browser.engines.find(e=>e.id===browser.selection?.engine)?.label;
 const summary=r.model?`<p class="fine muted">${esc(method)} · Native rank ${esc(r.model.nativeRank??'not recorded')} · ${esc(r.model.sampleCount??'Unknown')} native samples</p>${metrics.length?`<dl class="metric-grid">${metrics.map(m=>`<div><dt>${esc(m.label)}</dt><dd>${m.value.toFixed(m.metric==='pTM'?2:1)}</dd></div>`).join('')}</dl><p class="fine muted">Whole designed binder monomer, including the tag where present.</p>`:'<p class="fine muted">Verified per-residue confidence is not recorded for this monomer.</p>'}`:'';
 const details=r.model?`<details class="audit-details"><summary>Monomer calculation record</summary><p>Native method: ${esc(r.model.engineVersion||'Version not recorded')} · Native rank: ${esc(r.model.nativeRank??'Not recorded')} · Samples: ${esc(r.model.sampleCount??'Not recorded')}</p><pre class="sequence">${esc(JSON.stringify({modelId:r.model.id,constructSequenceSha256:r.model.constructSequenceSha256,nativeModelSha256:nativeHash(r.model),source:r.model.source,provenance:r.model.provenance,confidenceProof:r.model.confidenceProof,nativeSummaryProof:r.model.nativeSummaryProof},null,2))}</pre></details>`:r.request?`<details class="audit-details"><summary>Monomer request record</summary><pre class="sequence">${esc(JSON.stringify(r.request,null,2))}</pre></details>`:'';
 return `<section class="model-browser monomer-browser" id="${prefix}-monomer-browser" data-monomer-browser-prefix="${prefix}" aria-label="Designed binder monomers"><h3>Designed binder on its own</h3><p class="fine muted">A separate monomer prediction of the designed binder, without a target receptor. Isoform, interface and affinity measurements do not apply.</p>${browser.selection?`<div class="model-browser-selectors">${select('engine','Folding method',browser.engines)}${select('variant','Construct',browser.variants)}</div>`:''}<p class="${r.asset?'fine muted':'notice private'}" role="status">${r.asset?'Validated native monomer available.':esc(r.request&&subject.monomerPlan?.progress?'This monomer is not ready to view yet. Run progress is shown below.':r.reason)} ${browser.available} of ${browser.expected} monomer combinations imported.</p>${r.asset&&subject.monomerPlan?.progress?`<details class="audit-details"><summary>Recorded run observations</summary><p class="fine muted">These saved stage observations are separate from the validated model now available above.</p>${renderMonomerProgress(subject,browser.selection?.engine)}</details>`:renderMonomerProgress(subject,browser.selection?.engine)}${summary}${details}</section>`;
}
