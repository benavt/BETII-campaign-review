import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import{renderPublicTabs}from '../docs/public-navigation.mjs';import{hotspotTargets}from '../docs/hotspot-design.mjs';import{owningRepository,DESIGN_ENGINES}from '../docs/hotspot-request.mjs';
test('public hotspot composer routes to the scientific repo and retains custom viewers',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../docs/data/local-workspace.json',import.meta.url))).campaigns[0];
 const config=JSON.parse(fs.readFileSync(new URL('../docs/design-issue-config.json',import.meta.url)));
 assert.equal(owningRepository(c,config),'MontelioneLab/BETII');assert.equal(config.issueCreationEnabled,false);assert.equal(config.listenerEnabled,true);assert.ok(hotspotTargets(c).length>0);assert.deepEqual(Object.keys(DESIGN_ENGINES),['rfd3','rfd4','ligandforge']);
 assert.match(renderPublicTabs(c),/data-tab="hotspot-design"/);const app=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');assert.match(app,/tab==='hotspot-design'\?renderHotspotDesign/);assert.match(app,/preview:null/);assert.match(app,/publish:null/);assert.match(app,/hotspotDesignDrafts/);assert.match(app,/renderDimerModels/);assert.match(app,/renderPymolDownload/);
 const molecule=fs.readFileSync(new URL('../docs/molecule.mjs',import.meta.url),'utf8');assert.match(molecule,/getAtomCatalog/);assert.match(molecule,/binder_homodimer/);
});
