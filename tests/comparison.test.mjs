import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rowData, sortRows, median, plotRows, solubilityRows} from '../docs/comparison/metrics.mjs';

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
  assert.ok(rowData(original,{...state,scorer:'PCANN'}).values.Kd_nM>0);
  const missing=structuredClone(original);
  for(const m of missing.models)m.observations=m.observations.filter(o=>o.method!=='PCANN');
  missing.panels.PCANN={method:'PCANN',status:'pending',missingTargets:['BRD3','BRD2','BRD4','BRDT'],Kd_nM:{}};
  assert.equal(rowData(missing,{...state,scorer:'PCANN'}).values.Kd_nM,undefined);
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
  assert.equal(data.subjects.filter(s=>s.panels.PCANN.status==='complete').length,20);
});
test('all 80 Exact PCANN Kds and native energies retain their selected model identity',()=>{
  for(const s of data.subjects)for(const target of ['BRD3','BRD2','BRD4','BRDT']){
    const row=rowData(s,{...state,scorer:'PCANN',target});
    assert.ok(row.values.Kd_nM>0);assert.equal(row.panel.status,'complete');
    assert.ok(Math.abs(Math.exp(row.values.deltaG_kcal_mol/(.001987204258*298))*1e9/row.values.Kd_nM-1)<1e-12);
  }
});
test('ProtSATT scores are bound to all twenty exact untagged sequences and remain sequence metrics',()=>{
  const release=JSON.parse(readFileSync(new URL('../docs/comparison/protsatt-scores.json',import.meta.url)));
  assert.equal(release.records.length,20);
  for(const s of data.subjects){
    const saved=release.records.find(r=>r.group===s.group&&r.candidateId===s.id);
    assert.equal(saved.sequenceSha256,s.sequenceSha256);
    for(const selection of [state,{...state,engine:'af3'},{...state,kind:'monomer'},{...state,kind:'homodimer',engine:'colabfold'}]){
      const r=rowData(s,selection);assert.equal(r.values.protsatt_esol,saved.value);
      assert.equal(r.values.solubility,s.netSolP.scores.solubility);
    }
    const bad=structuredClone(s);bad.protSATT.sequenceSha256='bad';
    assert.equal(rowData(bad,state).values.protsatt_esol,undefined);
  }
});
test('paired ranks and reference splits independently reproduce the published export',()=>{
  const compared=solubilityRows(data.subjects);
  assert.deepEqual(compared.filter(r=>r.opposite).map(r=>r.subject.id).sort(),['Brd3ET_Brd3ET_1010_model_0','Brd3ET_Brd3ET_1933_model_6'].sort());
  for(const r of compared){
    const saved=data.solubilityComparison.rows.find(s=>s.candidate_id===r.subject.id);
    assert.equal(r.netRank,saved.NetSolP_rank);assert.equal(r.protRank,saved.ProtSATT_rank);
    assert.equal(r.rankShift,saved.rank_shift_toward_ProtSATT);assert.equal(r.opposite,saved.opposite_sides_of_reference);
    assert.equal(r.difference,saved.raw_score_difference);
  }
});
test('reference equality, tied ranks, missing scores and sequence hash mismatches remain explicit',()=>{
  const sample=(id,n,p)=>({id,key:id,sequenceSha256:id,netSolP:{scores:{solubility:n}},protSATT:{value:p,sequenceSha256:id}});
  const subjects=[sample('a',.5,.5),sample('b',.5,.4),sample('c',.2,.8),sample('d',null,null)];
  const rows=solubilityRows(subjects);
  assert.equal(rows[0].opposite,false);assert.equal(rows[1].opposite,true);assert.equal(rows[2].opposite,true);
  assert.equal(rows[0].netRank,1.5);assert.equal(rows[1].netRank,1.5);
  assert.equal(rows[3].opposite,null);assert.equal(rows[3].rankShift,null);
  subjects[0].protSATT.sequenceSha256='mismatch';assert.equal(solubilityRows(subjects)[0].opposite,null);
});
