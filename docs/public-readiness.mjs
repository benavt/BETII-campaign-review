const METHODS=['boltz2-exact','af3','opendde-exact','openfold'];
export function publicReadiness(c){
 if(!c.publicReview?.fixedRoster)return [];
 let missing=0;for(const s of c.subjects)for(const variant of ['untagged','ctag64'])for(const engine of METHODS){if(!s.monomerModels?.some(m=>m.constructVariant===variant&&m.foldingEngine===engine&&m.status==='verified'))missing++;for(const target of ['BRD3','BRD2','BRD4','BRDT'])if(!s.modelCoverage?.models?.some(m=>m.constructVariant===variant&&m.foldingEngine===engine&&m.target===target&&m.status==='verified'))missing++;}
 const result=missing?[missing+' of 400 monomer/ET model views still await validated publication.']:[];
 if(c.dimerPlan){let accepted=0;for(const s of c.subjects)for(const variant of c.dimerPlan.variants)for(const engine of c.dimerPlan.methods){const models=(s.dimerModels||[]).filter(m=>m.constructVariant===variant&&m.foldingEngine===engine&&m.status==='verified'&&m.copies===2&&Number.isFinite(m.ipTM));if(models.length===5&&new Set(models.map(m=>m.modelSha256)).size===5)accepted++;}if(accepted<c.dimerPlan.conditions)result.push((c.dimerPlan.conditions-accepted)+' of 100 dimer ensembles still await native validation and publication.');}
 return result;
}
export function renderPublicOverview(c){
 const gaps=publicReadiness(c);
 return '<section class="panel"><h2>Review</h2><div class="review-actions"><button class="button primary" data-tab="subjects">View candidates</button><button class="button subtle" data-tab="monomers">Binder monomers</button><button class="button subtle" data-tab="dimers">Binder dimers</button><button class="button subtle" data-tab="review">Final Review &amp; sequences</button></div><p class="fine muted">Affinity and selectivity are saved computational predictions. They do not establish experimental binding or selectivity.</p></section>'+(gaps.length?'<section class="panel"><h2>Work in progress</h2><ul>'+gaps.map(g=>'<li>'+g+'</li>').join('')+'</ul><p>Available native structures can be reviewed now. Package confirmation opens when the requested models are validated and all ten designs are marked Looks good.</p></section>':'');
}
