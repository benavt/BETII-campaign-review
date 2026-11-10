import {MAX_WORKSPACE_BYTES,applyReviewExport,parseWorkspaceFile,restorePreview} from './workspace-transfer.mjs';
import {canonical} from './model.mjs';

const changed = 'The open workspace changed. Review the file or connection and try again.';
const failure = message => { throw new Error(message); };

export function createWorkspaceLifecycle({save,connect,prepareSwitch=()=>null,canEdit=()=>true,onWorkspace=()=>{},onChange=()=>{},onSave=()=>{}}) {
  let current,dirty=false,latestSave,pending,active,pendingPlan;
  let state={phase:'idle',busy:false,preview:null,error:''};

  function update(phase,error='') {
    state={phase,busy:!!active,preview:pending?.preview||null,error};
    onChange(state);
    return state;
  }
  function open(next,kind,{saved=true}={}) {
    const same=kind==='refresh'||kind==='reviews';
    current={...next,revision:(current?.revision??-1)+1,identity:(current?.identity??0)+(same?0:1)};
    if(kind!=='refresh'||saved)dirty=!saved;
    onWorkspace(current,kind);
  }
  function saveCurrent(explicit=false) {
    if(latestSave?.revision===current.revision)return latestSave.result;
    const attempt={revision:current.revision};
    const recordPlan=pendingPlan;
    latestSave=attempt;
    attempt.result=save(current,recordPlan||explicit?{recordPlan,explicit}:undefined).then(saved=>{
      if(saved&&pendingPlan===recordPlan)pendingPlan=null;
      if(current.revision===attempt.revision)dirty=!saved;
      if(latestSave===attempt)latestSave=null;
      return saved;
    });
    return attempt.result;
  }
  async function preview(message='') {
    const selected=pending;
    const checking=update('reading',message);
    const at=current;
    try {
      const {parsed,file}=selected;
      if(parsed.kind==='reviews')await applyReviewExport(at.workspace,parsed.data);
      if(state!==checking)return;
      pending={...selected,revision:at.revision,preview:restorePreview(file,parsed,at.workspace)};
      update('preview',message);
    } catch(error) {
      if(state!==checking)return;
      pending={...selected,preview:restorePreview(selected.file,selected.parsed)};
      update('blocked',error.message);
    }
  }
  function stop(operation) {
    if(operation.abortWrite&&!operation.abortWrite())return false;
    operation.canceled=true;
    operation.controller.abort();
    if(!operation.final)active=null;
    return true;
  }
  function edit(change) {
    if(!canEdit())return null;
    const interrupted=active;
    if(interrupted&&!interrupted.canceled&&!stop(interrupted))return null;
    let workspace;
    try{workspace=change(current.workspace)??current.workspace;}
    catch(error){
      if(interrupted&&!active)update(pending?'preview':'idle');
      throw error;
    }
    current={...current,workspace,revision:current.revision+1};
    dirty=true;
    onWorkspace(current,'edit');
    const result=saveCurrent();
    if(!active){
      if(pending)void preview(changed);
      else if(state.busy)update('idle',changed);
    }
    return result;
  }
  async function run(phase,operation) {
    const at=current;
    const attempt={controller:new AbortController(),canceled:false,final:false};
    active=attempt;
    const check=()=>{
      if(active!==attempt||attempt.canceled||at.revision!==current.revision)failure(changed);
    };
    const commit=async(next,extra)=>{
      check();
      attempt.final=true;
      update('saving');
      const saved=await save(next,{report:false,...extra,signal:attempt.controller.signal,begin(abort){
        if(active!==attempt||attempt.canceled||current.revision!==at.revision)return false;
        attempt.abortWrite=abort;
        return true;
      }});
      check();
      return saved;
    };
    update(phase);
    try {
      const result=await operation(at,check,commit,attempt.controller.signal);
      // Activation and completion run together, before another edit can enter.
      if(result.kind!=='refresh')pending=null;
      active=null;
      if(result.kind==='workspace'||result.kind==='connected')pendingPlan=result.saved?null:result.recordPlan;
      open(result.next,result.kind,{saved:result.saved});
      if(result.kind!=='refresh'||result.saved)onSave(result.saved);
      if(pending)void preview(changed);
      else update('idle');
      return result;
    } catch(error) {
      if(active!==attempt)return null;
      active=null;
      const message=attempt.canceled?changed:error.message;
      if(pending&&pending.revision!==current.revision)void preview(message);
      else update(pending?'preview':'idle',message);
      return null;
    }
  }
  return {
    get current(){return current;},
    get state(){return state;},
    get dirty(){return dirty;},
    start(next){pendingPlan=null;open(next,'start');},
    edit,
    async review(inputs,prepare,apply){
      if(!canEdit())return false;
      const identity=current.identity;
      const context=inputs(current.workspace);
      if(context===undefined)return false;
      const before=structuredClone(context);
      const receipt=await prepare(before);
      return current.identity===identity&&canonical(inputs(current.workspace))===canonical(before)
        &&!!edit(workspace=>apply(workspace,receipt));
    },
    retrySave(){return active?null:saveCurrent(true);},
    async read(file,{fullOnly=false}={}) {
      if(active)return false;
      pending=null;
      const reading=update('reading');
      try {
        if(file.size>MAX_WORKSPACE_BYTES)failure('This file exceeds the 64 MiB backup limit.');
        const text=await file.text();
        if(state!==reading)return false;
        const parsed=parseWorkspaceFile(text,file.size);
        if(fullOnly&&parsed.kind!=='workspace')failure('Choose a full workspace backup to open this import view.');
        const importInfo=parsed.kind==='workspace'?{id:crypto.randomUUID(),name:file.name}:null;
        pending={file,parsed,importInfo,preview:restorePreview(file,parsed)};
        await preview();
      } catch(error) {
        if(state!==reading)return false;
        update('idle',error.message);
      }
      return true;
    },
    async reopen(record,source){
      if(active||!record||record.mode!=='imported')return false;
      const parsed={kind:'workspace',data:record.workspace};
      const file={name:record.importInfo?.name||record.workspace.campaigns[0].name||'Saved import',size:new TextEncoder().encode(JSON.stringify(record.workspace)).byteLength};
      pending={file,parsed,importInfo:record.importInfo,source,preview:restorePreview(file,parsed)};
      await preview();
      return true;
    },
    cancel() {
      if(active?.final)return false;
      if(active){
        stop(active);
        update(pending?'preview':'idle');
      }else{
        pending=null;
        update('idle');
      }
      return true;
    },
    confirm() {
      if(active||state.phase!=='preview')return null;
      if(pending.revision!==current.revision)return preview(changed);
      const {parsed:{kind,data},importInfo,source}=pending;
      return run('restoring',async(at,check,commit,signal)=>{
        if((dirty||['cache','published'].includes(at.mode))&&!await saveCurrent()){
          failure('The current reviews could not be saved. Save a backup to keep your changes.');
        }
        check();
        const workspace=kind==='reviews'?await applyReviewExport(at.workspace,data):data;
        const next={
          workspace:{...workspace,decisions:workspace.decisions||[],selections:workspace.selections||{}},
          mode:kind==='workspace'?'imported':at.mode,
          importInfo:kind==='workspace'?importInfo:at.importInfo,
        };
        const recordPlan=kind==='workspace'?await prepareSwitch(at,next,signal,source):null;
        const saved=await commit(next,{recordPlan});
        return {kind,saved,next,recordPlan};
      });
    },
    reconnect() {
      if(active||current.mode!=='imported')return null;
      return run('reconnecting',async(at,check,commit,signal)=>{
        if(!await saveCurrent())failure('The imported workspace could not be saved. Save a backup to keep your changes.');
        check();
        const {workspace,...recovery}=await connect(at,signal,{reconnect:true});
        const next={workspace,mode:'cache'};
        check();
        const recordPlan=await prepareSwitch(at,next,signal);
        if(!await commit(next,{...recovery,recordPlan}))failure('The connected workspace could not be saved. Your imported workspace is still open.');
        return {kind:'connected',saved:true,next,issues:recovery.issues};
      });
    },
    refresh() {
      if(active)return null;
      return run('refreshing',async(at,check,commit,signal)=>{
        const {workspace,...recovery}=await connect(at,signal,{reconnect:false});
        check();
        const next={workspace,mode:at.mode,importInfo:at.importInfo};
        const saved=!!recovery.entries?.length;
        if(saved&&!await commit(next,recovery))failure('The prior reviews could not be preserved. Refresh results again after browser storage is available.');
        return {kind:'refresh',saved,next,issues:recovery.issues};
      });
    },
  };
}
