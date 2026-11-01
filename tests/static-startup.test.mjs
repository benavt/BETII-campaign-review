import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {validateWorkspace} from '../docs/model.mjs';

const app=fs.readFileSync(new URL('../docs/app.js',import.meta.url),'utf8');
const data=JSON.parse(fs.readFileSync(new URL('../docs/data/local-workspace.json',import.meta.url),'utf8'));
const connected=app.slice(app.indexOf('async function connectedWorkspace('),app.indexOf('\nfunction download(',app.indexOf('async function connectedWorkspace(')));
const start=app.slice(app.indexOf('async function start() {'),app.indexOf('\nexport const ready='));

function context(available){
  const state={
    console,URL,structuredClone,document:{},location:{href:'https://benavt.github.io/BETII-campaign-review/'},
    key:'isolated-test',forceDemo:false,mode:'demo',workspace:undefined,current:null,tab:'overview',runnerRuntime:null,persistence:'saved',storageError:'',rendered:false,
    readSavedWorkspace:async()=>null,settleWithin:async f=>f(),setStartupMessage:()=>{},
    demoWorkspace:()=>({campaigns:[{id:'illustrative-placeholder'}]}),validateWorkspace,
    runtimeInfo:()=>{throw new Error('Static startup contacted a backend');},
    fetch:async url=>{assert.equal(url,'./data/local-workspace.json');return{ok:available,json:async()=>structuredClone(data)};},
    notify:message=>{throw new Error(message);},
  };
  vm.createContext(state);
  vm.runInContext(connected+'\n'+start+'\nasync function render(){rendered=true;}',state);
  return state;
}

test('Pages hostname loads actual bundled BETII data before rendering',async()=>{
  const state=context(true);
  await vm.runInContext('start()',state);
  assert.equal(state.mode,'cache');
  assert.equal(state.workspace.campaigns.length,1);
  assert.equal(state.workspace.campaigns.reduce((n,c)=>n+c.subjects.length,0),10);
  assert.equal(state.rendered,true);
  assert.equal(state.runnerRuntime,null);
});

test('missing static evidence fails instead of rendering illustrative candidates',async()=>{
  const state=context(false);
  await assert.rejects(vm.runInContext('start()',state),/BETII snapshot could not be opened/);
  assert.equal(state.rendered,false);
});
