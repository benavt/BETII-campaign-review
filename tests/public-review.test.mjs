import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import test from 'node:test';
import {makeCandidateReview,guidedReviewStatus,makeDecision} from '../docs/model.mjs';
import {modelChoices} from '../docs/panel.mjs';
import {publicReadiness} from '../docs/public-readiness.mjs';
import {renderGuidedReview,renderCandidateReviewActions} from '../docs/review-ui.mjs';
import {followupURL} from '../docs/followup.mjs';
import {dimerModelData,DIMER_METHODS} from '../docs/dimer-models.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const c=JSON.parse(fs.readFileSync(new URL('../docs/data/local-workspace.json',import.meta.url))).campaigns[0];
test('approval requires current reviews of all ten and complete requested native evidence',async()=>{
 const selected=c.subjects.map(s=>s.id),records={};
 for(const s of c.subjects)records[s.id]=await makeCandidateReview(c,s.id,{outcome:'looks_good',modelSelection:modelChoices(s,{}).selection});
 let status=await guidedReviewStatus(c,selected,records);assert.equal(status.complete,10);
 const gaps=publicReadiness(c),html=renderGuidedReview(c,{selected,reviewStatus:status,hardIssues:gaps});
 if(gaps.length){assert.match(html,/data-approve-check/);assert.doesNotMatch(html,/data-guided-approve/);}else assert.match(html,/data-guided-approve/);
 await assert.rejects(makeDecision(c,selected.slice(0,9),{reviewer:'Test',note:'Test',checks:{guided:true,package:true},outcome:'approved',viewContext:{candidateReviews:records}}),/all ten/);
 if(gaps.length)await assert.rejects(makeDecision(c,selected,{reviewer:'Test',note:'Test',checks:{guided:true,package:true},outcome:'approved',viewContext:{candidateReviews:records}}),/await/);
 else assert.equal((await makeDecision(c,selected,{reviewer:'Test',note:'Test',checks:{guided:true,package:true},outcome:'approved',viewContext:{candidateReviews:records}})).outcome,'approved');
 assert.match(renderCandidateReviewActions(c.subjects[0],{reviewStatus:status}),/click to undo/);
 delete records[selected[0]];status=await guidedReviewStatus(c,selected,records);assert.equal(status.ready,false);assert.equal(status.complete,9);
 records[selected[0]]=await makeCandidateReview(c,selected[0],{outcome:'follow_up',note:'Check the binding pose',modelSelection:modelChoices(c.subjects[0],{}).selection});
 status=await guidedReviewStatus(c,selected,records);assert.equal(status.rows[0].status,'follow_up');assert.equal(status.ready,false);
});
test('follow-up includes source context and requires explicit GitHub submission',()=>{
 const s=c.subjects[0],selection=modelChoices(s,{}).selection,u=new URL(followupURL(s,{note:'Check <script>alert(1)</script>',selection}));
 assert.equal(u.origin,'https://github.com');assert.equal(u.pathname,'/benavt/BETII-campaign-review/issues/new');assert.match(u.searchParams.get('body'),new RegExp(s.sequenceSha256));assert.match(u.searchParams.get('body'),/modelSha256/);assert.match(u.searchParams.get('body'),/does not authorize/);
});
test('dimer panel declares five methods and rejects mislabeled receptor complexes',()=>{
 assert.equal(Object.keys(DIMER_METHODS).length,5);assert.equal(c.dimerPlan.nativeOutputs,500);assert.equal(dimerModelData(c).assets.length,c.subjects[0].dimerModels?.length?1:0);
 const broken=structuredClone(c),s=broken.subjects[0],m=structuredClone(s.modelCoverage.models[0]);m.copies=2;m.ipTM=.8;m.nativeRank=1;s.dimerModels=[m];
 assert.throws(()=>dimerModelData(broken,{candidateId:s.id,engine:m.foldingEngine,variant:m.constructVariant}),/two exact binder copies/);
});
test('all bound models and PSE downloads carry mapped ET hotspots',()=>{
 for(const s of c.subjects)for(const m of s.modelCoverage.models){const a=m.molecularModel;assert.equal(a.hotspots.length,10);assert.ok(a.hotspots.every(h=>h.chain===a.roles.receptor&&Number.isInteger(h.resi)));assert.equal(a.hotspotMapping.targetSequenceSha256,m.targetSequenceSha256);assert.equal(a.pymolSession.hotspotCount,10);assert.equal(a.pymolSession.renderingStyle,'betii-et-hotspots-v2');}
});
