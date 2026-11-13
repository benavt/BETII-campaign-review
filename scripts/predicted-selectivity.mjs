// Predicted preference only: complete native Exact panels, one compatible scorer.
const targets=['BRD3','BRD2','BRD4','BRDT'];
const keys=['scorer_version','affinity_scorer_version','score_model_sha256','scaler_sha256','calibration_head'];
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const positive=v=>Number.isFinite(v)&&v>0;
const number=v=>positive(v)?Number(v.toPrecision(4)).toLocaleString('en-US',{maximumSignificantDigits:4}):'—';
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
function calibration(o,method){if(method==='DeltaForge'){const c=o.calibration;return c&&keys.every(k=>typeof c[k]==='string'&&c[k])&&hash(c.score_model_sha256)&&hash(c.scaler_sha256)?stable(Object.fromEntries(keys.map(k=>[k,c[k]]))):null;}if(method!=='PCANN'||o.provenance?.temperatureK!==298)return null;try{const v=JSON.parse(o.version),runtime={...v.runtime};delete runtime.embeddingCache;if(v.recipe!=='affinity-v1'||Object.keys(runtime.checkpoints||{}).length!==25)return null;return stable({method:'PCANN',recipe:v.recipe,runtime,temperatureK:298});}catch{return null;}}
export function predictedSelectivityData(subject,method='DeltaForge'){
 const result={candidateId:subject.id,status:'pending',missingTargets:[]},selected={},scores={};
 for(const target of targets){
  const models=(subject.modelCoverage?.models||[]).filter(m=>m.target===target&&m.foldingEngine==='boltz2-exact'&&m.constructVariant==='untagged');
  if(!models.length){result.missingTargets.push(target);continue;}
  if(models.length!==1)return {...result,status:'incompatible'};
  const model=models[0];
  if(model.status!=='verified'||model.nativeCompletion!=='validated'||model.resourceVerification!=='verified'){result.missingTargets.push(target);continue;}
  const observations=(model.observations||[]).filter(o=>o.method===method&&o.metric==='Kd_nM');
  if(!observations.length){result.missingTargets.push(target);continue;}
  if(observations.length!==1)return {...result,status:'incompatible'};
  const o=observations[0];
  if(!positive(o.value)||o.unit!=='nM'||o.modelId!==model.id||o.modelSha256!==model.modelSha256||!['target','foldingEngine','constructVariant'].every(k=>o[k]===model[k])||typeof o.source?.path!=='string'||!hash(o.source.sha256)||!calibration(o,method))return {...result,status:'incompatible'};
  selected[target]=model;scores[target]=o;
 }
 if(result.missingTargets.length)return result;
 if(new Set(Object.values(scores).map(o=>calibration(o,method))).size!==1)return {...result,status:'incompatible'};
 const Kd_nM=Object.fromEntries(targets.map(t=>[t,scores[t].value]));
 const ratiosOverBRD3=Object.fromEntries(targets.slice(1).map(t=>[t,Kd_nM[t]/Kd_nM.BRD3]));
 if(!Object.values(ratiosOverBRD3).every(positive))return {...result,status:'incompatible'};
 const limitingIsoform=targets.slice(1).reduce((a,b)=>ratiosOverBRD3[a]<=ratiosOverBRD3[b]?a:b);
 return {...result,status:'complete',Kd_nM,ratiosOverBRD3,minimumPredictedSelectivity:ratiosOverBRD3[limitingIsoform],limitingIsoform};
}
function table(rows){return `<div class="table-scroll"><table><thead><tr><th>Candidate</th><th>BRD3 predicted Kd (nM)</th><th>BRD2 / BRD3</th><th>BRD4 / BRD3</th><th>BRDT / BRD3</th><th>Minimum predicted selectivity</th><th>Limiting isoform</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${esc(r.candidateId)}</th><td>${number(r.Kd_nM?.BRD3)}</td>${targets.slice(1).map(t=>`<td>${r.status==='complete'?number(r.ratiosOverBRD3[t])+'×':'—'}</td>`).join('')}<td>${r.status==='complete'?number(r.minimumPredictedSelectivity)+'×':'—'}</td><td>${esc(r.limitingIsoform||'—')}</td><td>${r.status==='complete'?'Complete compatible Exact panel':r.status==='incompatible'?'Incompatible evidence; ratios withheld':'Pending '+esc(r.missingTargets.join(', '))}</td></tr>`).join('')}</tbody></table></div>`;}
const explanation='Kd of each comparator divided by BRD3 Kd. Values above 1 predict stronger binding to BRD3; values below 1 predict stronger binding to that comparator. The minimum ratio identifies the limiting isoform. Each row requires all four native untagged Boltz2 Exact models and one compatible calibration of the named scorer. Scorers remain separate. These are computational predictions, not measured selectivity.';
export function renderPredictedSelectivityTable(c){const delta=c.subjects.map(s=>predictedSelectivityData(s)),pcann=c.subjects.map(s=>predictedSelectivityData(s,'PCANN'));return `<section class="panel" id="predicted-selectivity"><h2>Predicted BRD3 ET isoform selectivity</h2><p class="fine muted">${explanation}</p><details open><summary>DeltaForge · ${delta.filter(r=>r.status==='complete').length} of ${c.subjects.length} complete panels</summary>${table(delta)}<p><a href="./data/predicted-selectivity.csv" download>DeltaForge predicted selectivity CSV</a> · <a href="./data/deltaforge-scores.csv" download>DeltaForge Kd and ΔG CSV</a></p></details><details><summary>PCANN · separate prediction series · ${pcann.filter(r=>r.status==='complete').length} of ${c.subjects.length} complete panels</summary>${table(pcann)}<p><a href="./data/pcann-predicted-selectivity.csv" download>PCANN predicted selectivity CSV</a></p></details></section>`;}
export function renderCandidatePredictedSelectivity(subject){return `<section class="panel"><h3>Predicted BRD3 ET isoform selectivity</h3><p class="fine muted">${explanation}</p><h4>DeltaForge</h4>${table([predictedSelectivityData(subject)])}<h4>PCANN · separate prediction series</h4>${table([predictedSelectivityData(subject,'PCANN')])}</section>`;}
