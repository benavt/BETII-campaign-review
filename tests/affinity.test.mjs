import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{affinityData,affinityRequest}from '../docs/affinity.mjs';import{renderPublicTabs}from '../docs/public-navigation.mjs';
test('public kD view exports exact scoped requests without authorizing spending',()=>{
 const hash='a'.repeat(64),model={id:'m',status:'verified',modelSha256:hash,target:'BRD3',constructVariant:'untagged',foldingEngine:'boltz2-exact'};
 const campaign={id:'synthetic',subjects:[{id:'c',modelCoverage:{models:[model]}}]};
 assert.match(renderPublicTabs(campaign),/data-tab="affinity"/);
 for(const operation of ['pcann-predict-v1','deltaforge-quote-v1']){const r=affinityRequest(campaign,operation,{},['m']);assert.equal(r.models[0].modelSha256,hash);assert.equal(r.spendingAuthorized,false);assert.equal(r.reuseSavedDeltaforge,true);}
 const app=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');assert.match(app,/tab==='affinity'\?renderAffinity/);assert.match(app,/data-affinity-request/);assert.equal(affinityData(campaign).paired,0);
});

test('public prediction help refers to the configured host',()=>{assert.match(fs.readFileSync(new URL('../docs/affinity.mjs',import.meta.url),'utf8'),/PCANN runs on the configured host/);});
