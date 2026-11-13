import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {validateWorkspace} from '../docs/jokent/model.mjs';
import {resolveModel} from '../docs/jokent/panel.mjs';
import {affinityData} from '../docs/jokent/affinity.mjs';
import {candidateExplorerData} from '../docs/jokent/candidate-explorer.mjs';
import {campaignTitle} from '../docs/jokent/campaign-presentation.mjs';
import {DIMER_METHODS,dimerModelData} from '../docs/jokent/dimer-models.mjs';
import {publicReadiness} from '../docs/jokent/public-readiness.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const workspace=JSON.parse(fs.readFileSync(new URL('../docs/jokent/data/local-workspace.json',import.meta.url))),c=workspace.campaigns[0];
const coverage=JSON.parse(fs.readFileSync(new URL('../docs/jokent/data/coverage.json',import.meta.url)));
test('Jokent is a separate exact18-sequence untagged campaign with accurate condition readiness',()=>{
 validateWorkspace(workspace);assert.equal(c.subjects.length,18);assert.equal(campaignTitle(c),'BETII · Jokent Sequences');
 assert.equal(coverage.cells.length,432);assert.equal(Object.keys(DIMER_METHODS).length,4);
 for(const row of coverage.cells.filter(r=>r.kind==='complex')){
  const s=c.subjects.find(s=>s.id===row.candidateId),resolved=resolveModel(s,{variant:row.variant,target:row.target,engine:row.engine});
  assert.equal(resolved.status,row.status==='published'?'verified':'missing');
  if(resolved.model){assert.equal(resolved.model.target,row.target);assert.equal(resolved.model.foldingEngine,row.engine);}
 }
 const missing=coverage.cells.filter(r=>r.status!=='published').length;
 assert.equal(publicReadiness(c).length,missing?1:0);
 if(missing)assert.match(publicReadiness(c).join(' '),new RegExp(missing+' of 432'));
 const incomplete=structuredClone(c);incomplete.subjects[0].modelCoverage.models.pop();
 assert.match(publicReadiness(incomplete).join(' '),new RegExp((missing+1)+' of 432'));
});
test('PCANN and DeltaForge remain separate native-coordinate-bound series',()=>{
 const data=affinityData(c,{foldingEngine:'boltz2-exact'}),expected=c.subjects.flatMap(s=>s.modelCoverage.models).flatMap(m=>(m.observations||[]).filter(o=>o.method==='PCANN'));
 const deltaforge=c.subjects.flatMap(s=>s.modelCoverage.models).flatMap(m=>(m.observations||[]).filter(o=>o.method==='DeltaForge'&&o.metric==='Kd_nM'));
 assert.ok(expected.length>0);assert.equal(data.rows.filter(r=>r.PCANN).length,expected.length);assert.equal(data.rows.filter(r=>r.DeltaForge).length,deltaforge.length);
 for(const row of data.rows.filter(r=>r.PCANN))assert.equal(row.PCANN.modelSha256,row.modelSha256);
 const explorer=candidateExplorerData(c);assert.equal(explorer.candidates.filter(r=>r.metrics.netsolp_d_solubility).length,18);
});
test('homodimers use only their validated five-output ensembles',()=>{
 for(const s of c.subjects)for(const engine of Object.keys(DIMER_METHODS)){
  const models=(s.dimerModels||[]).filter(m=>m.foldingEngine===engine);
  const data=dimerModelData(c,{candidateId:s.id,variant:'untagged',engine});assert.equal(data.models.length,models.length);
  if(models.length){assert.equal(models.length,5);for(const m of models)assert.equal(m.copies,2);}
 }
});
