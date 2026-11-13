import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rowData, sortRows, median, plotRows} from '../docs/comparison/metrics.mjs';

const data=JSON.parse(readFileSync(new URL('../docs/comparison/data.json',import.meta.url)));
const state={kind:'complex',engine:'boltz2-exact',target:'BRD3',scorer:'DeltaForge',rank:1};

test('comparison contains precisely the requested panel and ten FASTA records',()=>{
  assert.equal(data.subjects.length,20);
  assert.equal(data.subjects.filter(s=>s.group==='our-panel').length,10);
  assert.equal(data.subjects.filter(s=>s.group==='modified-adaptyv').length,10);
  assert.equal(data.subjects.filter(s=>s.id==='AP2-9').length,1);
  const input=readFileSync(new URL('../docs/comparison/sequences_for_Adaptyv_modified.fa',import.meta.url),'utf8');
  const records=input.split('>').filter(Boolean).map(r=>{const [header,...lines]=r.trim().split(/\r?\n/);return [header.split(/\s+/)[0],lines.join('').replace(/\s/g,'')];});
  assert.deepEqual(data.subjects.filter(s=>s.group==='modified-adaptyv').map(s=>[s.id,s.sequence]),records);
});
test('pending comparator scores never produce a selectivity value or remove saved BRD3 Kd',()=>{
  const s=data.subjects.find(s=>s.id==='miniprotein_879'), row=rowData(s,state);
  assert.ok(row.values.Kd_nM>0);assert.equal(row.values.minimumPredictedSelectivity,undefined);
  assert.equal(rowData(s,{...state,target:'BRD2'}).values.Kd_nM,undefined);
  assert.deepEqual(row.panel.missingTargets,['BRD2','BRD4','BRDT']);
});
test('scorer and folding-method switches cannot reuse another score or exact selectivity',()=>{
  const original=data.subjects.find(s=>s.id==='C2K_L60_0608');
  assert.ok(rowData(original,state).values.Kd_nM>0);
  assert.equal(rowData(original,{...state,scorer:'PCANN'}).values.Kd_nM,undefined);
  const af3=rowData(original,{...state,engine:'af3'});
  assert.equal(af3.values.Kd_nM,undefined);assert.equal(af3.values.minimumPredictedSelectivity,undefined);
  assert.equal(af3.model.foldingEngine,'af3');
  assert.equal(rowData(original,{...state,kind:'monomer'}).values.Kd_nM,undefined);
});
test('every supported model selection stays bound to its native hash and selected dimer rank',()=>{
  for(const s of data.subjects) for(const model of s.models){
    const row=rowData(s,{...state,kind:model.kind,engine:model.foldingEngine,target:model.target,rank:model.nativeRank});
    assert.equal(row.model?.modelSha256,model.modelSha256,model.id);
    for(const o of model.observations) assert.equal(o.modelSha256,model.modelSha256);
  }
});
test('missing values remain last in either sort direction; zero is valid on linear axes',()=>{
  const rows=[{subject:{key:'a'},values:{x:0,y:2}},{subject:{key:'b'},values:{x:10,y:1}},{subject:{key:'c'},values:{y:0}}];
  assert.deepEqual(sortRows(rows,'x').map(r=>r.subject.key),['a','b','c']);
  assert.deepEqual(sortRows(rows,'x',true).map(r=>r.subject.key),['b','a','c']);
  assert.equal(plotRows(rows,'x','y',false,false).length,2);
  assert.equal(plotRows(rows,'x','y',true,false).length,1);
  assert.equal(median([undefined,null,0,10]),5);
});
test('published ratios match all four saved isoform values and pending values remain absent',()=>{
  for(const s of data.subjects) for(const scorer of ['DeltaForge','PCANN']){
    const row=rowData(s,{...state,scorer}),p=s.panels[scorer];
    if(p.status!=='complete'){assert.equal(row.values.minimumPredictedSelectivity,undefined);continue;}
    for(const t of ['BRD2','BRD4','BRDT']) assert.equal(row.values[t+'_ratio'],p.Kd_nM[t]/p.Kd_nM.BRD3);
    assert.equal(row.values.minimumPredictedSelectivity,Math.min(...Object.values(p.ratiosOverBRD3)));
  }
  assert.equal(data.subjects.filter(s=>s.panels.DeltaForge.status==='complete').length,19);
  assert.equal(data.subjects.filter(s=>s.panels.PCANN.status==='complete').length,10);
});
