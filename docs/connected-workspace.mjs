import {canonical,digest,validateWorkspace} from './model.mjs';
import {SAVED_STATE_FIELDS} from './workspace-transfer.mjs';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const arrays=new Set(['decisions','planReviews','jobRequests']);
const nested=new Set(['candidateReviews','subjectReviews','modelSelections','molecularViewDefaults']);

// Server evidence remains authoritative. Saved browser records are applied only
// when their campaign/candidate scope and the existing validators accept them.
export function reconcileConnectedWorkspace(source,state={}){
  let workspace={...validateWorkspace(source)};
  const snapshot=structuredClone(Object.fromEntries(SAVED_STATE_FIELDS.filter(key=>state[key]!==undefined).map(key=>[key,state[key]])));
  const campaigns=new Map(source.campaigns.map(c=>[c.id,c])),issues=[];
  const reject=(field,id,message)=>issues.push({field,id:String(id),message});
  function apply(field,incoming){
    let value;
    if(arrays.has(field)){
      value=[...(workspace[field]||[])];const known=new Map(value.map(item=>[item.id,item]));
      for(const item of incoming){
        if(known.has(item?.id)){
          if(canonical(known.get(item.id))!==canonical(item))throw Error('A saved receipt conflicts with the recorded receipt.');
        }else{value.push(item);known.set(item?.id,item);}
      }
    }else{
      value={...(workspace[field]||{})};
      for(const [id,item]of Object.entries(incoming))value[id]=nested.has(field)&&record(item)?{...(value[id]||{}),...item}:item;
    }
    const next={...workspace,[field]:value};validateWorkspace(next);workspace=next;
  }
  for(const [field,value]of Object.entries(snapshot)){
    if(arrays.has(field)){
      if(!Array.isArray(value)){reject(field,'','Saved records are not a list.');continue;}
      const accepted=value.filter(item=>{if(!campaigns.has(item?.campaignId)){reject(field,item?.id||'','The saved campaign is absent from this workspace.');return false;}return true;});
      try{apply(field,accepted);}catch{for(const item of accepted)try{apply(field,[item]);}catch(error){reject(field,item?.id||'',error.message);}}
      continue;
    }
    if(!record(value)){reject(field,'','Saved records are not a campaign map.');continue;}
    const accepted={};
    for(const [id,item]of Object.entries(value)){
      const c=campaigns.get(id);
      if(!c){reject(field,id,'The saved campaign is absent from this workspace.');continue;}
      if(field==='selectionDrafts'&&!c.selectionDraft){reject(field,id,'This campaign has no editable shortlist.');continue;}
      if(field==='selectionDrafts'&&item?.id!==c.selectionDraft.id){reject(field,id,'The saved draft belongs to an earlier shortlist revision.');continue;}
      // An earlier ordinary selection is never reinterpreted as a draft edit.
      if(field==='selections'&&c.selectionDraft){reject(field,id,'The saved selection uses a different shortlist format.');continue;}
      accepted[id]=item;
    }
    try{apply(field,accepted);}catch{
      for(const [id,item]of Object.entries(accepted))try{apply(field,{[id]:item});}catch(error){
        if(nested.has(field)&&record(item)){
          for(const [child,entry]of Object.entries(item))try{apply(field,{[id]:{[child]:entry}});}catch(childError){reject(field,id+'/'+child,childError.message);}
        }else reject(field,id,error.message);
      }
    }
  }
  return {workspace:validateWorkspace(workspace),issues,preservedState:issues.length?structuredClone(snapshot):null};
}

// Preserve the exact original state before a normal save can replace its key.
// Backup failures leave the pending copy in memory and block primary saves.
export function createReviewRecovery({prefix,read,write,hash=digest}){
  const references=new Set(),pending=new Map();
  const validKey=key=>typeof key==='string'&&key.startsWith(prefix+'-preserved-')&&/^[a-f0-9]{64}$/.test(key.slice((prefix+'-preserved-').length));
  async function stage(state,issues){
    const payload={schemaVersion:2,mode:'cache',state:structuredClone(state)};
    const key=prefix+'-preserved-'+await hash(payload);
    return {key,payload:{...payload,recoveryIssues:structuredClone(issues)}};
  }
  return {
    get keys(){return [...references];},
    get entries(){return [...pending].map(([key,payload])=>({key,payload}));},
    referencesFor(keys=[]){return [...new Set([...references,...keys.filter(validKey)])];},
    addReferences(keys=[]){for(const key of keys)if(validKey(key))references.add(key);},
    stage,
    saved(entries,keys=[]){
      this.addReferences(keys);
      for(const {key} of entries){references.add(key);pending.delete(key);}
    },
    async remember(state,issues){
      const {key,payload}=await stage(state,issues);references.add(key);
      if(!pending.has(key))pending.set(key,payload);
      return key;
    },
    async flush(){for(const [key,payload]of pending){await write(key,payload);pending.delete(key);}},
    async export(){
      const records=[];
      for(const key of references){const payload=pending.get(key)||await read(key);if(!payload)throw Error('A preserved review copy is unavailable in this browser.');records.push({key,payload});}
      return {schemaVersion:1,kind:'campaign-browser-review-recovery',records};
    },
  };
}
