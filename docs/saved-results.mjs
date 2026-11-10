// Read-only presentation of saved, native-coordinate-bound predictions.
import {affinityData,affinityGroup} from './affinity.mjs';
import {privateAssetURL} from './model.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canonical=v=>JSON.stringify(Object.fromEntries(Object.entries(v||{}).sort(([a],[b])=>a.localeCompare(b))));
const number=(v,missing='Deferred')=>Number.isFinite(v)?v.toPrecision(3):missing;
export function savedResultsData(c){
 const config=c.savedResults;if(!config)return null;
 const {targets,referenceTarget,foldingEngine,variants,calibration}=config;
 if(!Array.isArray(targets)||targets.length<2||!targets.includes(referenceTarget)||!Array.isArray(variants)||!calibration)return null;
 const native=affinityData(c,{foldingEngine}).rows.filter(r=>r.model.foldingEngine===foldingEngine);
 const subjects=new Map();for(const s of [...(c.subjects||[]),...(c.candidatePool||[])])if(!subjects.has(s.id))subjects.set(s.id,s);
 const rows=[...subjects.values()].flatMap(subject=>variants.map(variant=>{
  const values=Object.fromEntries(targets.map(target=>{
   const models=native.filter(r=>r.candidateId===subject.id&&r.model.constructVariant===variant&&r.model.target===target);
   // Ambiguous native cells, duplicate observations and different calibrations stay unavailable.
   const matches=models.length===1?(models[0].model.observations||[]).filter(o=>o.method==='DeltaForge'&&o.metric==='Kd_nM'&&o.unit==='nM'&&canonical(o.calibration)===canonical(calibration)):[];
   const selected=matches.length===1?affinityData({...c,subjects:[subject],candidatePool:[]},{foldingEngine,DeltaForge:affinityGroup(matches[0])}).rows.find(r=>r.modelId===models[0].modelId)?.DeltaForge:null;
   return [target,selected?.value??null];
  }));
  const complete=targets.every(t=>values[t]!==null),ratios=complete?targets.filter(t=>t!==referenceTarget).map(t=>({target:t,value:values[t]/values[referenceTarget]})):[];
  const minimum=complete?Math.min(...ratios.map(r=>r.value)):null;
  return {candidateId:subject.id,label:subject.label||subject.id,variant,values,complete,minimum,limitingTargets:ratios.filter(r=>r.value===minimum).map(r=>r.target)};
 }));
 const unscoredConditions=rows.reduce((n,r)=>n+targets.filter(t=>r.values[t]===null).length,0),skipped=config.unscoredDisposition==='skipped';
 return {config,rows,validPredictions:rows.reduce((n,r)=>n+targets.filter(t=>r.values[t]!==null).length,0),completeComparisons:rows.filter(r=>r.complete).length,unscoredConditions,deferredConditions:skipped?0:unscoredConditions,skippedConditions:skipped?unscoredConditions:0};
}
export function renderSavedResults(c,{compact=false}={}){
 const d=savedResultsData(c);if(!d)return '';
 const {config:p}=d,folds=p.foldingValidation,skipped=p.unscoredDisposition==='skipped',missing=skipped?'Skipped':'Deferred';
 const link=(path,label)=>{const url=privateAssetURL(path)||(typeof path==='string'&&/^provenance\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:html|json)$/.test(path)?'./'+path:null);return url?`<a class="text-button" href="${esc(url)}" target="_blank" rel="noopener noreferrer"${path.endsWith('.json')?' download':''}>${label} ↗</a>`:'';};
 return `<section class="panel saved-results" aria-labelledby="saved-results-title"><div class="panel-head"><h2 id="saved-results-title">Folding and affinity results</h2>${compact?'<button class="button primary" data-tab="results">View results →</button>':''}</div>
 ${folds?`<p><strong>${esc(folds.conditions)} folding conditions validated</strong> · ${esc(folds.nativeModels)} native models · complexes, binder monomers and homodimers.</p>`:''}
 <dl class="overview-counts"><div><dt>Saved affinities</dt><dd>${d.validPredictions}</dd></div><div><dt>Complete comparisons</dt><dd>${d.completeComparisons}<span> / ${d.rows.length}</span></dd></div><div><dt>${missing} affinities</dt><dd>${d.unscoredConditions}</dd></div></dl>
 <p>Saved scoring is complete. ${skipped?`${d.skippedConditions} affinity cells are skipped at your request; no additional DeltaForge calculations are planned.`:`${d.deferredConditions} affinity cells remain deferred; missing scores are not negative binding results.`} Scientific and human review remain pending.</p>
 <p><strong>${esc(p.totalChargedCredits)} credits charged</strong>${Number.isFinite(p.rejectedResponseCredits)?` · ${esc(p.rejectedResponseCredits)} for rejected responses`:''}. ${link(p.reportPath,'Full report and credit record')} ${link(p.dataPath,'Download result data')}</p>
 ${compact?'':`<p>DeltaForge predicted Kd in nM from ${esc(p.engineLabel||p.foldingEngine)} coordinates. Lower Kd predicts stronger binding. Selectivity = Kd(counter-target) / Kd(${esc(p.referenceTarget)}); a minimum above 1 favors ${esc(p.referenceTarget)} across the full panel. These are computational predictions.</p>
 <div class="table-scroll" role="region" aria-label="Affinity and selectivity results" tabindex="0"><table><caption>All candidates and constructs · one compatible DeltaForge calibration</caption><thead><tr><th scope="col">Candidate</th><th scope="col">Construct</th>${p.targets.map(t=>`<th scope="col">${esc(t)} Kd (nM)</th>`).join('')}<th scope="col">Minimum ${esc(p.referenceTarget)} selectivity</th><th scope="col">Limiting target</th><th scope="col">Coverage</th></tr></thead><tbody>${d.rows.map(r=>`<tr><th scope="row"><button class="text-button" data-results-candidate="${esc(r.candidateId)}" data-results-variant="${esc(r.variant)}">${esc(r.label)}</button></th><td>${esc(p.variantLabels?.[r.variant]||r.variant)}</td>${p.targets.map(t=>`<td class="numeric">${number(r.values[t],missing)}</td>`).join('')}<td class="numeric">${r.complete?number(r.minimum)+'×':'Incomplete'}</td><td>${esc(r.limitingTargets.join(', ')||'—')}</td><td>${p.targets.filter(t=>r.values[t]!==null).length} / ${p.targets.length}</td></tr>`).join('')}</tbody></table></div>
 <details><summary>Source and calibration</summary><p>Each value is bound to the saved native model hash and response record. Incomplete panels have no selectivity estimate. Constructs and calibration groups remain separate.</p><pre class="sequence">${esc(JSON.stringify({report:p.dataPath,reportSha256:p.reportSha256,calibration:p.calibration},null,2))}</pre></details>`}</section>`;
}
