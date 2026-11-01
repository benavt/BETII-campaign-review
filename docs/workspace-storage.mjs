import {validateWorkspace} from './model.mjs';
import {checkWorkspaceSize,SAVED_STATE_FIELDS} from './workspace-transfer.mjs';

export const LEGACY_STORAGE_KEY='campaign-studio-v1';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validateSavedWorkspace(value){
  if(!record(value))throw new Error('Saved workspace must be an object.');
  if(value.schemaVersion===2&&value.mode==='cache'){
    if(!record(value.state)||Object.keys(value.state).some(key=>!SAVED_STATE_FIELDS.includes(key)))throw new Error('Invalid saved cache review state.');
    for(const [key,state]of Object.entries(value.state)){
      if(['decisions','planReviews','jobRequests'].includes(key)?!Array.isArray(state):!record(state))throw new Error(`Invalid saved ${key}.`);
    }
  }else{
    if(!['demo','imported','cache'].includes(value.mode))throw new Error('Invalid saved workspace mode.');
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
  async function transaction(key,value,writing=false){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let tx,result;
      try{
        tx=db.transaction(storeName,writing?'readwrite':'readonly');
        const request=writing?tx.objectStore(storeName).put(value,key):tx.objectStore(storeName).get(key);
        request.onsuccess=()=>{result=request.result;};
        request.onerror=()=>{}; // transaction abort/error supplies the durable failure.
      }catch(error){reject(error);return;}
      tx.oncomplete=()=>resolve(result);
      tx.onabort=tx.onerror=()=>reject(new Error(`Workspace ${writing?'save':'read'} failed: ${tx.error?.message||'storage transaction aborted'}. Export a backup; existing legacy storage was preserved.`));
    });
  }
  function enqueue(operation){const result=tail.then(operation);tail=result.catch(()=>{});return result;}
  function write(key,payload){
    // Snapshot now, before queued async transactions can observe later mutations.
    let snapshot;
    try{validateSavedWorkspace(payload);snapshot=structuredClone(payload);}catch(error){return Promise.reject(error);}
    return enqueue(async()=>{await transaction(key,snapshot,true);return {key,stored:true,backend:'indexeddb'};});
  }
  function read(key=LEGACY_STORAGE_KEY){return enqueue(async()=>{
    const current=await transaction(key);
    if(current!==undefined)return validateSavedWorkspace(current);
    let text;
    try{text=legacy()?.getItem(key);}catch(error){throw new Error(`Cannot read legacy workspace storage: ${error.message}`);}
    if(text===null||text===undefined)return null;
    let value;
    try{checkWorkspaceSize(text);value=validateSavedWorkspace(JSON.parse(text));}catch(error){throw new Error(`Legacy workspace was preserved but cannot be migrated: ${error.message}`);}
    await transaction(key,value,true);
    return value; // Legacy key intentionally retained, including after migration.
  });}
  return {readSavedWorkspace:read,writeSavedWorkspace:write};
}
let defaultStorage;
const storage=()=>defaultStorage||(defaultStorage=createWorkspaceStorage());
export const readSavedWorkspace=(key=LEGACY_STORAGE_KEY)=>storage().readSavedWorkspace(key);
export const writeSavedWorkspace=(key,payload)=>storage().writeSavedWorkspace(key,payload);
