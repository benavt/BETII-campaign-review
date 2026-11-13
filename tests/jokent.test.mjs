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
test('Jokent is a separate exact18-sequence untagged campaign with explicit gaps',()=>{
 validateWorkspace(workspace);assert.equal(c.subjects.length,18);assert.equal(campaignTitle(c),'BETII · Jokent Sequences');
 assert.equal(coverage.cells.length,432);assert.equal(Object.keys(DIMER_METHODS).length,4);
 for(const row of coverage.cells.filter(r=>r.kind==='complex')){
  const s=c.subjects.find(s=>s.id===row.candidateId),resolved=resolveModel(s,{variant:row.variant,target:row.target,engine:row.engine});
  assert.equal(resolved.status,row.status==='published'?'verified':'missing');
  if(resolved.model){assert.equal(resolved.model.target,row.target);assert.equal(resolved.model.foldingEngine,row.engine);}
 }
 assert.match(publicReadiness(c).join(' '),/of 432/);
});
test('PCANN is available as its own native-coordinate-bound series without DeltaForge substitutes',()=>{
 const data=affinityData(c,{foldingEngine:'boltz2-exact'}),expected=c.subjects.flatMap(s=>s.modelCoverage.models).flatMap(m=>(m.observations||[]).filter(o=>o.method==='PCANN'));
 assert.ok(expected.length>0);assert.equal(data.rows.filter(r=>r.PCANN).length,expected.length);assert.equal(data.rows.filter(r=>r.DeltaForge).length,0);
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
