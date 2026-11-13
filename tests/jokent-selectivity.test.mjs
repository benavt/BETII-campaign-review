import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {predictedSelectivityData,renderPredictedSelectivityTable} from '../docs/jokent/predicted-selectivity.mjs';
const c=JSON.parse(fs.readFileSync(new URL('../docs/jokent/data/local-workspace.json',import.meta.url))).campaigns[0];
const reference=JSON.parse(fs.readFileSync(new URL('../docs/jokent/data/predicted-selectivity.json',import.meta.url)));
const pcannReference=JSON.parse(fs.readFileSync(new URL('../docs/jokent/data/pcann-predicted-selectivity.json',import.meta.url)));
test('browser calculations match independently verified real saved DeltaForge panels',()=>{
 for(const s of c.subjects){const actual=predictedSelectivityData(s),expected=reference.find(r=>r.candidateId===s.id);assert.equal(actual.status,expected.status);if(actual.status==='complete'){assert.deepEqual(actual.Kd_nM,expected.Kd_nM);assert.deepEqual(actual.ratiosOverBRD3,expected.ratiosOverBRD3);assert.equal(actual.minimumPredictedSelectivity,expected.minimumPredictedSelectivity);assert.equal(actual.limitingIsoform,expected.limitingIsoform);}}
 const html=renderPredictedSelectivityTable(c);assert.match(html,/Predicted BRD3 ET isoform selectivity/);assert.match(html,/not measured selectivity/);
 for(const s of c.subjects){const actual=predictedSelectivityData(s,'PCANN'),expected=pcannReference.find(r=>r.candidateId===s.id);assert.equal(actual.status,expected.status);if(actual.status==='complete')assert.deepEqual(actual.ratiosOverBRD3,expected.ratiosOverBRD3);}
});
test('partial or incompatible native panels withhold numerical selectivity',()=>{
 const original=c.subjects.find(s=>predictedSelectivityData(s).status==='complete');assert.ok(original);
 for(const change of ['remove','calibration','coordinate']){const s=structuredClone(original),m=s.modelCoverage.models.find(m=>m.target==='BRDT'&&m.foldingEngine==='boltz2-exact'),o=m.observations.find(o=>o.method==='DeltaForge'&&o.metric==='Kd_nM');if(change==='remove')m.observations=m.observations.filter(o=>o.method!=='DeltaForge');else if(change==='calibration')o.calibration.scaler_sha256='0'.repeat(64);else o.modelSha256='0'.repeat(64);const result=predictedSelectivityData(s);assert.equal(result.status,change==='remove'?'pending':'incompatible');assert.equal(result.ratiosOverBRD3,undefined);}
});
