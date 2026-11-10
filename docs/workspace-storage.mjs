import {validateWorkspace} from './model.mjs';
import {checkWorkspaceSize,SAVED_STATE_FIELDS} from './workspace-transfer.mjs';

export const LEGACY_STORAGE_KEY='campaign-studio-v1';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateSavedWorkspace(value){
  if(!record(value))throw new Error('Saved workspace must be an object.');
  if(value.preservedReviewKeys!==undefined&&(!Array.isArray(value.preservedReviewKeys)||value.preservedReviewKeys.length>1000||value.preservedReviewKeys.some(key=>typeof key!=='string'||!/^[-a-zA-Z0-9_:]{1,240}$/.test(key))))throw new Error('Invalid preserved review references.');
  if(value.schemaVersion===2&&['cache','published'].includes(value.mode)){
    if(!record(value.state)||Object.keys(value.state).some(key=>!SAVED_STATE_FIELDS.includes(key)))throw new Error('Invalid saved cache review state.');
    for(const [key,state]of Object.entries(value.state)){
      if(['decisions','planReviews','jobRequests'].includes(key)?!Array.isArray(state):!record(state))throw new Error(`Invalid saved ${key}.`);
    }
  }else{
    if(!['demo','imported','cache','published'].includes(value.mode))throw new Error('Invalid saved workspace mode.');
    validateWorkspace(value.workspace);
  }
  checkWorkspaceSize(JSON.stringify(value));
  return value;
}

export function createWorkspaceStorage({indexedDB:factory=globalThis.indexedDB,legacyStorage,dbName='campaign-studio',storeName='workspaces'}={}){
  let opening,tail=Promise.resolve();
  const legacy=()=>legacyStorage===undefined?globalThis.localStorage:legacyStorage;
  function open(){
    if(!factory)return Promise.reject(new Error('IndexedDB is unavailable. Export your workspace to preserve changes.'));
    if(!opening)opening=new Promise((resolve,reject)=>{
      let request;
      try{request=factory.open(dbName,1);}catch(error){reject(error);return;}
      request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(storeName))request.result.createObjectStore(storeName);};
      request.onerror=()=>reject(new Error(`Cannot open workspace storage: ${request.error?.message||'IndexedDB failed'}.`));
      request.onblocked=()=>reject(new Error('Workspace storage upgrade is blocked by another open tab. Close that tab and reload.'));
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=undefined;};resolve(db);};
    }).catch(error=>{opening=undefined;throw error;});
    return opening;
  }
  function observed(key,value){
    if(value!==undefined)return {key,source:'indexeddb',raw:value};
    const raw=legacy()?.getItem(key)??null;
    return {key,source:raw===null?'missing':'legacy',raw};
  }
  async function transaction(key,value,writing=false,{mirrorKey,entries=[],begin,expected=[]}={}){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let tx,result,failure;
      try{
        tx=db.transaction(storeName,writing?'readwrite':'readonly');
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(failure||new Error(`Workspace ${writing?'save':'read'} failed: ${tx.error?.message||'storage transaction aborted'}. Export a backup; existing legacy storage was preserved.`));
        if(begin&&!begin(()=>{
          try{tx.abort();return true;}catch(error){if(error.name==='InvalidStateError')return false;throw error;}
        }))throw new Error('Workspace switch canceled.');
        const store=tx.objectStore(storeName);
        function schedule(index){
          try{
            const match=expected[index];
            if(match){
              const check=store.get(match.key);
              check.onsuccess=()=>{
                try{
                  const found=recordVersion(observed(match.key,check.result));
                  if(found.source!==match.source||!sameRecordValue(found.raw,match.raw))throw new Error('The saved record changed. Review it again before replacing it.');
                  schedule(index+1);
                }catch(error){failure=error;tx.abort();}
              };
              return;
            }
            const request=writing?store.put(value,key):store.get(key);
            request.onsuccess=()=>{result=request.result;};
            if(writing&&mirrorKey)store.put(value,mirrorKey);
            for(const entry of entries)store.put(entry.payload,entry.key);
          }catch(error){failure=error;tx.abort();}
        }
        schedule(0);
      }catch(error){
        failure=error;
        if(tx)tx.abort();else reject(error);
      }
    });
  }
  function enqueue(operation){const result=tail.then(operation);tail=result.catch(()=>{});return result;}
  function write(key,payload,{mirrorKey,entries=[],begin,expected}={}){
    // Snapshot now, before queued async transactions can observe later mutations.
    let snapshot;
    try{
      validateSavedWorkspace(payload);
      for(const entry of entries)validateSavedWorkspace(entry.payload);
      snapshot=structuredClone(payload);
      entries=structuredClone(entries);
    }catch(error){return Promise.reject(error);}
    return enqueue(async()=>{await transaction(key,snapshot,true,{mirrorKey,entries,begin,expected});return {key,stored:true,backend:'indexeddb'};});
  }
  function inspect(key=LEGACY_STORAGE_KEY){return enqueue(async()=>{
    const snapshot=observed(key,await transaction(key));
    if(snapshot.source==='missing')return {...snapshot,record:null};
    try{
      if(snapshot.source==='legacy')checkWorkspaceSize(snapshot.raw);
      return {...snapshot,record:validateSavedWorkspace(snapshot.source==='legacy'?JSON.parse(snapshot.raw):snapshot.raw)};
    }catch(error){
      const message=snapshot.source==='legacy'?'Legacy workspace was preserved but cannot be migrated: '+error.message:error.message;
      return {...snapshot,record:null,error:message};
    }
  });}
  async function read(key){const snapshot=await inspect(key);if(snapshot.error)throw new Error(snapshot.error);return snapshot.record;}
  return {readSavedWorkspace:read,writeSavedWorkspace:write,inspectSavedWorkspace:inspect};
}
export function recordVersion({key,source,raw}){
  return {key,source,raw};
}
function sameRecordValue(left,right,seen=new WeakMap()){
  if(Object.is(left,right))return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  const prototype=Object.getPrototypeOf(left);
  if(prototype!==Object.getPrototypeOf(right))return false;
  if(prototype!==Object.prototype&&prototype!==Array.prototype&&prototype!==null)return false;
  if(Array.isArray(left)&&left.length!==right.length)return false;
  if(seen.has(left))return seen.get(left)===right;
  seen.set(left,right);
  const keys=Object.keys(left);
  return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&sameRecordValue(left[key],right[key],seen));
}
let defaultStorage;
const storage=()=>defaultStorage||(defaultStorage=createWorkspaceStorage());
export const readSavedWorkspace=(key=LEGACY_STORAGE_KEY)=>storage().readSavedWorkspace(key);
export const writeSavedWorkspace=(key,payload,options)=>storage().writeSavedWorkspace(key,payload,options);
export const inspectSavedWorkspace=(key)=>storage().inspectSavedWorkspace(key);
// A timed-out startup read can leave its open request unresolved. A user retry
// starts a fresh storage connection without treating the old read as a write.
export function restartWorkspaceStorage(){defaultStorage=undefined;}

// Capture each save before the recovery barrier. Keep the barrier outside the
// IndexedDB queue because it can write preserved reviews through that queue.
export function createWorkspacePersistence({key,flushRecovery=()=>{},write=writeSavedWorkspace,onStatus}){
  let tail=Promise.resolve(),latest=0;
  return async function save(payload,{report=true,entries=[],begin,recordKey=key,prepare}={}){
    const revision=report?++latest:latest;
    if(report)onStatus('saving');
    try{
      const snapshot=structuredClone(payload);
      const mirrorKey=snapshot.mode==='cache'?recordKey+'-connected':undefined;
      const attempt=tail.then(async()=>{
        await flushRecovery();
        const prepared=await prepare?.();
        await write(recordKey,snapshot,{mirrorKey,entries:[...entries,...(prepared?.entries||[])],expected:prepared?.expected,begin});
      });
      tail=attempt.catch(()=>{});
      await attempt;
      if(report&&revision===latest)onStatus('saved');
      return true;
    }catch(error){
      if(report&&revision===latest)onStatus('error',error);
      return false;
    }
  };
}
