import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {validateWorkspace} from '../docs/model.mjs';
import {publicationOptions, resolveStartupWorkspace} from '../docs/startup.mjs';
import {validateSavedWorkspace} from '../docs/workspace-storage.mjs';

const base = 'https://benavt.github.io/BETII-campaign-review/';
const data = validateWorkspace(JSON.parse(fs.readFileSync(new URL('../docs/data/local-workspace.json',import.meta.url),'utf8')));
const html = fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
const app = fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../docs/publication-manifest.json',import.meta.url),'utf8'));
const dataset = {
  workspaceMode: html.match(/data-workspace-mode="([^"]+)"/)[1],
  publicationId: html.match(/data-publication-id="([^"]+)"/)[1],
};

test('published BETII opens the bundled snapshot before rendering',async()=>{
  const options = publicationOptions({dataset,href:base});
  assert.equal(options.published,true);
  assert.equal(options.importView,false);
  const result = await resolveStartupWorkspace({
    href:base, published:options.published, connect:async()=>data,
    demo:()=>{throw new Error('Static startup must use published data');},
  });
  assert.equal(result.mode,'published');
  assert.equal(result.workspace.campaigns.length,1);
  assert.equal(result.workspace.campaigns[0].subjects.length,10);
});

test('missing static evidence fails instead of falling back to illustrative data',async()=>{
  await assert.rejects(resolveStartupWorkspace({
    href:base, published:true,
    connect:async()=>{throw new Error('Missing bundled BETII snapshot');},
    demo:()=>{throw new Error('Static startup must use published data');},
  }),/Published review data could not be opened.*Missing bundled BETII snapshot/);
});

test('BETII retains the original browser record and isolates backup imports',()=>{
  const key = 'betii-static-'+manifest.exportedWorkspaceSha256;
  assert.ok(app.includes("const publicationStorageKey='"+key+"';"));
  assert.ok(app.includes("importKey:publicationStorageKey+':import'"));
  assert.ok(app.includes("workspacePath:'./data/local-workspace.json'"));
  assert.doesNotThrow(()=>validateSavedWorkspace({schemaVersion:2,mode:'cache',state:{subjectReviews:{}}}));
  assert.equal(publicationOptions({dataset,href:base+'?workspace=import'}).importView,true);
});

test('publication saves use the record shape supported by the previous BETII build',()=>{
  const snapshotFor = app.slice(app.indexOf('function snapshotFor('),app.indexOf('const importLabel'));
  const state = {subjectReviews:{}};
  const result = vm.runInNewContext(snapshotFor+"\nJSON.stringify(snapshotFor({mode:'published',workspace:state}))",{
    savedState:value=>value, state,
  });
  assert.deepEqual(JSON.parse(result),{schemaVersion:2,mode:'cache',state});
});
