import {renderSavedResults} from './saved-results.mjs';
import {renderHotspotDesign,mountHotspotDesign,hotspotTargets} from './hotspot-design.mjs';
import {settleWithin,setStartupMessage,resolveStartupWorkspace,publicationOptions} from './startup.mjs';
import {renderPublicTabs} from './public-navigation.mjs';
import {renderPymolDownload} from './pymol-download.mjs';
import {publicReadiness,renderPublicOverview} from './public-readiness.mjs';
import {renderDimerModels,dimerModelData} from './dimer-models.mjs';
import {renderJobLaunch,friendlyJobMessage} from './job-launch.mjs';
import {bindCampaignNavigation} from './navigation.mjs';
import {renderSidebar,renderTopbar,renderWorkspaceTools,renderCampaignTabs,campaignViews,workspaceSaveLabel,workspaceTransferMessage,confirmWorkspaceAction} from './workspace-shell.mjs';
import {renderCampaignOverview} from './campaign-overview.mjs';
import {campaignTitle,renderRecordedMetrics} from './campaign-presentation.mjs';
import {renderReviewScatter,renderRefoldFollowup} from './review-scatter.mjs';
import {SAVED_STATE_FIELDS,prepareBackup,createReviewExport} from './workspace-transfer.mjs';
import {createWorkspaceLifecycle} from './workspace-lifecycle.mjs';
import {createWorkspacePersistence,readSavedWorkspace,writeSavedWorkspace,inspectSavedWorkspace,recordVersion,restartWorkspaceStorage} from './workspace-storage.mjs';
import {reconcileConnectedWorkspace,createReviewRecovery} from './connected-workspace.mjs';
import {mountMolecule} from './molecule.mjs';
import {recordedModelAnnotations} from './stage-layers.mjs';
import {modelBrowser,renderModelBrowser} from './model-browser.mjs';
import {monomerBrowser,renderMonomerBrowser} from './monomer-models.mjs';
import {renderModelLibrary,modelLibrary} from './model-library.mjs';
import {renderReviewPlan} from './review-plan.mjs';
import {renderRefoldRegistry} from './refold-registry.mjs';
import {renderAffinityQuote} from './affinity-quote.mjs';
import {renderAffinity,affinitySelection,affinityRequest} from './affinity.mjs';
import {renderDesignInputs,inputSelection} from './campaign-inputs.mjs';
import {candidateExplorerData,renderCandidateExplorer,selectionDraftFor,editSelectionDraft,materializeSelectionDraft} from './candidate-explorer.mjs';
import {renderViewerColorControls,renderViewerColorLegend,renderViewerRepresentationControls} from './viewer-colors.mjs';
import {renderWorkflow,workflowStages,foldingSettingsFor,recordedWorkflowURL} from './workflow.mjs';
import {coverageSummary} from './coverage.mjs';
import {renderSelectivity} from './selectivity.mjs';
import {renderFoldingDashboard,foldingRequest} from './folding-dashboard.mjs';
import {renderOpenFoldResults} from './openfold-results.mjs';
import {prepareJobRequest,upsertJobRequest,renderJobQueue,renderRequestComposer,renderFoldRequestButton,requestOptionsFromForm} from './jobs.mjs';
import {renderGuidedReview,renderCandidateReviewActions} from './review-ui.mjs';
import {enhanceDesignComposer} from './design-ui.mjs';
import {cacheAuditSummary,CACHE_STATES} from './cache-audit.mjs';
import {renderFoldPlan,makePlanReview,planReviewStatus} from './fold-plan.mjs';
import {modelChoices,resolveModel,scopedMetrics,renderModelPanel,nativeModelHash,observationVersionLabel,calibrationIdentity} from './panel.mjs';
import {COLOR_PRESETS,paletteFor,validatePalette,exportPML,swatchFor} from './colors.mjs';
import {demoWorkspace} from './demo.mjs';
import {CHECKS, canonical, makeCandidateReview, guidedReviewStatus, validateWorkspace, blockers, panelBlockers, decisionStatus, makeDecision, safeURL, privateAssetURL} from './model.mjs';

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const forceDemo=false;
const publicationURL=new URL(location.href);
publicationURL.searchParams.delete('demo');
const publicationStorageKey='betii-jokent-41913c685aa990e9f74013b1b57443b33d40de2fb97c66efc0d45680c39120ed';
const publication={
  ...publicationOptions({dataset:document.documentElement.dataset,href:publicationURL.href}),
  storageKey:publicationStorageKey,
  importKey:publicationStorageKey+':import',
  workspacePath:'./data/local-workspace.json',
};
const publishedMode=publication.published;
const dimerSelections=new Map();
const key=forceDemo?'campaign-studio-demo-v1':publication.storageKey||'campaign-studio-v1';
const previousImportKey=key+':previous-import';
const activeKey=mode=>publishedMode&&mode==='imported'?publication.importKey:key;
const publicationRoute=href=>{
  const url=new URL(href);
  url.searchParams.delete('workspace');
  return url.href;
};
let route=location.href,emptyImport=false,previousImport=null,savedPublicationImport=null;
let outgoingLinkImport=null,legacyPublicationImport=null,protection=null,storageAction=false,allowUnload=false;
const isImportRoute=()=>publishedMode&&new URL(route).searchParams.get('workspace')==='import';
const editingProtected=()=>!!protection&&!(forceDemo&&!protection.snapshot);
const recoveryFor=prefix=>createReviewRecovery({prefix,read:name=>settleWithin(()=>readSavedWorkspace(name)),write:writeSavedWorkspace});
const scopeRecovery=recoveryFor(key),importRecovery=publishedMode?recoveryFor(publication.importKey):scopeRecovery;
let reviewRecovery=publication.importView?importRecovery:scopeRecovery;
let persistence='saved',storageError='',lastCampaignTab='overview';
let lateReviewText=null,reviewIssues=[],unsavedRestore=false,renderedWorkspaceIdentity;
let workspace, current, tab='overview', focus, filter='', candidateFilter='', inbox=false, statuses={}, mode='demo';
let toastTimer,disposeNavigation;
let metricView='ipSAE';
let reviewScatterX='TM-score',reviewScatterOrigin='all';
let gapCandidate='all',gapState='unloaded';
let candidateView='structure',advanced=false,jobComposer=null,foldCell=null,runnerRuntime=null,runnerJobs=[],designController=null;
const guidedStates={},selectivityStates=new Map(),jobPreviews=new Map(),jobReports=new Map();
const openFoldSelections=new Map();
const inputViews=new Map();let inputController=null;
const modelBrowserStates=new Map();
const libraryStates=new Map();
const monomerSelections=new Map();
const monomerFocus=new Map();
const monomerPool=c=>(c.candidatePool||c.subjects).filter(s=>s.monomerPlan||s.monomerModels);
const monomerSubject=c=>monomerPool(c).find(s=>s.id===monomerFocus.get(c.id))||monomerPool(c)[0];
const explorerStates=new Map();let explorerController=null,explorerCampaignId=null;
const affinityStates=new Map();
let hotspotController=null;const pendingHotspotTargets=new Map();
const refoldRegistries=new Map(),refoldLoads=new Set();
let pendingPanelView=null;
let viewerEnabled=true,viewerSpecies='Human',viewerController=null,renderVersion=0;
const viewerOptions={colorMode:'project',projectColors:true,representation:'cartoon',sideChains:false,residueColors:false,interface:false};
function applyViewerOptions(controller){controller.setColorMode(viewerOptions.colorMode);controller.setProjectColors(viewerOptions.projectColors);controller.setRepresentation(viewerOptions.representation);controller.setSideChains(viewerOptions.sideChains);controller.setResidueColors(viewerOptions.residueColors);controller.setInterface(viewerOptions.interface);}
function refreshViewerColors(prefix,controller){const info=controller?.getColorInfo();const legend=$(`#${prefix}-color-legend`),select=$(`#${prefix}-color-mode`);if(!info||!legend||!select)return;legend.innerHTML=(info.isoformColors&&info.mode==='project'?'Isoform colors on receptors; binders retain the project palette.':renderViewerColorLegend(info))+(info.loadErrors?.length?`<span class="overlay-load-errors">Could not display: ${info.loadErrors.map(e=>esc(e.species)+' · '+esc(e.message)).join('; ')}.</span>`:'')+(info.models?.length>1?`<span class="overlay-confidence-note"> Applies to all ${info.models.length} displayed models.${info.mode==='plddt'&&info.models.some(m=>!m.confidenceAvailable)?' Models without verified confidence are gray.':''}</span>`:'');const option=select.querySelector('option[value="plddt"]');if(option)option.disabled=!info.confidenceAvailable;select.value=info.mode;}
function bindViewerColors(prefix,controller,{shared=false}={}){const select=$(`#${prefix}-color-mode`);if(select)select.onchange=()=>{const value=select.value;const isoforms=document.querySelector('[data-overlay-colors]');if(isoforms?.checked){isoforms.checked=false;isoforms.onchange?.();}controller.setColorMode(value);if(shared)viewerOptions.colorMode=value;refreshViewerColors(prefix,controller);};refreshViewerColors(prefix,controller);}
function bindViewerRepresentation(prefix,controller){const select=$(`#${prefix}-representation`);if(select){select.value=viewerOptions.representation;select.onchange=()=>{viewerOptions.representation=select.value;controller.setRepresentation(select.value);};}}
function assetLink(a) { const u=privateAssetURL(a.path);return u?`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" ${a.kind==='structure'?'download':''}>${esc(a.label)} ${a.kind==='structure'?'↓':'↗'}</a>`:''; }
function previewAssets(subject) {const a=subject.assets?.find(a=>a.kind==='image'&&/\.(png|jpe?g|webp)$/i.test(a.path)); const u=a&&privateAssetURL(a.path);return u?`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><img class="structure-preview" src="${esc(u)}" alt="Cached structure views for ${esc(subject.label)}" loading="lazy"></a>`:'';}
function displayAxes(c) {if(metricView==='affinity'&&c.subjects.some(s=>Number.isFinite(s.metrics?.Human_Kd_nM)))return {x:{key:'Human_Kd_nM',label:'Human predicted Kd (nM · log scale)',scale:'log10'},y:{key:'Mouse_Kd_nM',label:'Mouse predicted Kd (nM · log scale)',scale:'log10'}};if(metricView==='ph'&&c.subjects.some(s=>Number.isFinite(s.metrics?.Human_acid_delta_model_units)))return {x:{key:'Human_acid_delta_model_units',label:'Human acid Δ (Potts units)'},y:{key:'Mouse_acid_delta_model_units',label:'Mouse acid Δ (Potts units)'}};return c.axes?Object.fromEntries(Object.entries(c.axes).map(([key,axis])=>[key,{...axis,...(/Kd_nM/.test(axis.key)?{scale:'log10'}:{})}])):c.axes;}
const campaignName=campaignTitle;
const pretty = s => String(s).replaceAll('_',' ');
function generationLabel(subject){const g=subject.modelGeneration;if(!g?.engine)return 'Folding engine not documented in the available records';return [g.engine,g.version||'version unrecorded'].join(' ')+(g.mode?` · ${g.mode}`:' · preset not documented');}
const badge = (text, style='') => `<span class="badge ${style}">${esc(text)}</span>`;
function notify(message) { $('#toast').textContent=message; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200); }
function displayCampaign(c){return c.selectionDraft?materializeSelectionDraft(c,workspace.selectionDrafts?.[c.id]):c;}
function selection(c) {if(c.selectionDraft)return selectionDraftFor(c,workspace.selectionDrafts?.[c.id]).selectedIds; return Object.hasOwn(workspace.selections,c.id) ? workspace.selections[c.id] : c.subjects.filter(s=>s.recommended).map(s=>s.id); }
function reportSave(state,error){
  persistence=state;
  if(state==='saved')unsavedRestore=false;
  if(state!=='saving')storageError=[
    error?.message,
    unsavedRestore?'Reload opens the last saved workspace until this restore saves successfully.':null,
  ].filter(Boolean).join(' ');
  document.querySelectorAll('[data-storage-status]').forEach(node=>{node.textContent=workspaceSaveLabel(state);});
  const notice=$('[data-workspace-unsaved]');
  if(notice){
    notice.hidden=state!=='error'&&!storageError;
    const retry=notice.querySelector('[data-action="retry-workspace-save"]');
    if(retry)retry.disabled=state==='saving'||workspaceTransfer.state.busy;
    const detail=notice.querySelector('[data-workspace-save-error]');
    if(detail)detail.textContent=storageError;
  }
  if(state==='error')notify('Changes are available in this tab, but could not be saved. Use Data & backups to download them.');
}
const saveWorkspace=createWorkspacePersistence({key,onStatus:reportSave});
function savedState(source) {
  return Object.fromEntries(SAVED_STATE_FIELDS.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));
}
function snapshotFor({workspace,mode,importInfo}){
  // The previous BETII build reads the same publication key as a cache record.
  if(['cache','published'].includes(mode))return {schemaVersion:2,mode:'cache',state:savedState(workspace)};
  return {workspace,mode,...(mode==='imported'&&importInfo?{importInfo}:{})};
}
const importLabel=record=>record.importInfo?.name||record.workspace.campaigns[0].name||'Saved import';
function downloadImport(record){
  try{download(prepareBackup(record.workspace).text,`${date()}_workspace-backup.json`);}
  catch(error){notify(error.message);}
}
async function inspectRecord(name){
  return settleWithin(()=>inspectSavedWorkspace(name));
}
async function readImportRecord(name){
  let inspected;
  try{inspected=await inspectRecord(name);}
  catch(error){error.importStorageUnavailable=true;throw error;}
  if(inspected.error)throw new Error('The saved import could not be read. Its original record is still retained.');
  if(inspected.record&&inspected.record.mode!=='imported')throw new Error('The saved import has an unexpected format.');
  return inspected;
}
async function loadImportInventory(){
  const previous=readImportRecord(previousImportKey).then(row=>row.record).catch(()=>null);
  const publicationImport=publishedMode?readImportRecord(publication.importKey).then(row=>row.record).catch(()=>null):null;
  [previousImport,savedPublicationImport]=await Promise.all([previous,publicationImport]);
  savedPublicationImport||=legacyPublicationImport?.record||null;
}
function sameImport(left,right){
  if(!left||!right)return false;
  if(left.importInfo?.id&&right.importInfo?.id)return left.importInfo.id===right.importInfo.id;
  return canonical(left.workspace)===canonical(right.workspace);
}
async function archiveImport(outgoing,{source,incoming,signal}={}){
  const observed=await readImportRecord(previousImportKey);
  signal?.throwIfAborted();
  const older=observed.record;
  const swapping=source===previousImportKey&&sameImport(older,incoming);
  if(older&&!sameImport(older,outgoing)&&!swapping){
    const approved=await confirmWorkspaceAction({
      title:'Replace previous import?',message:`This would replace “${importLabel(older)}” in browser recovery.`,
      action:'Replace previous import',download:{label:'Download previous import',run:()=>downloadImport(older)},signal,
    });
    if(!approved)throw new Error('The previous import was kept. Try again when you are ready to replace it.');
  }
  return {entries:[{key:previousImportKey,payload:outgoing}],expected:[recordVersion(observed)]};
}
async function planImportSwitch(at,next,signal,source){
  let outgoing;
  if(at.mode==='imported')outgoing={...snapshotFor(at),preservedReviewKeys:reviewRecovery.keys};
  else if(publishedMode&&next.mode==='imported'&&source!==publication.importKey){
    const saved=await readImportRecord(publication.importKey);
    signal.throwIfAborted();
    outgoing=saved.record||legacyPublicationImport?.record;
    if(outgoing){
      const plan=await archiveImport(outgoing,{source,incoming:next,signal});
      plan.expected.push(recordVersion(saved));
      return plan;
    }
  }
  return outgoing?archiveImport(outgoing,{source,incoming:next,signal}):null;
}
async function prepareImportSwitch(at,next,signal,source){
  try{return await planImportSwitch(at,next,signal,source);}
  catch(error){
    signal.throwIfAborted();
    if(next.mode!=='imported'||!error.importStorageUnavailable)throw error;
    return {deferred:{at,next,source},error:error.message};
  }
}
async function saveSnapshot(next,options={}){
  const payload=snapshotFor(next);
  const recovery=publishedMode&&next.mode==='imported'?importRecovery:scopeRecovery;
  const entries=[...new Map([...recovery.entries,...(options.entries||[])].map(entry=>[entry.key,entry])).values()];
  const references=recovery.referencesFor(options.keys);
  const preservedReviewKeys=[...new Set([...references,...entries.map(entry=>entry.key)])];
  const recordKey=activeKey(next.mode);
  let writtenPlan;
  const saved=await saveWorkspace({...payload,preservedReviewKeys},{
    ...options,entries,recordKey,
    async prepare(){
      options.signal?.throwIfAborted();
      let planned=options.recordPlan;
      if(planned?.deferred){
        if(options.report===false)throw new Error(planned.error);
        const {at,next,source}=planned.deferred;
        planned=await planImportSwitch(at,next,undefined,source);
      }
      const plan={entries:[...(planned?.entries||[])],expected:[...(planned?.expected||[])]};
      if(protection&&protection.key===recordKey){
        if(editingProtected())throw new Error('Resolve the unreadable record before saving.');
        const observed=await inspectRecord(recordKey);
        if(observed.source!=='missing'){
          protection={key:recordKey,snapshot:observed,error:'A saved record already exists. Retry loading before saving.'};
          throw new Error(protection.error);
        }
        plan.expected.push(recordVersion(observed));
      }
      if(next.mode==='cache'&&outgoingLinkImport){
        const guarded=outgoingLinkImport;
        if(guarded.declined&&!options.explicit)throw new Error('Choose Retry save when you are ready to replace the older recovery copy.');
        try{guarded.plan||=await archiveImport(guarded.record,{signal:options.signal});}
        catch(error){guarded.declined=true;throw error;}
        plan.entries.push(...guarded.plan.entries);
        plan.expected.push(recordVersion(guarded),...guarded.plan.expected);
      }
      if(next.mode==='published'&&legacyPublicationImport){
        const saved=await readImportRecord(publication.importKey);
        if(saved.record){
          const archive=await archiveImport(legacyPublicationImport.record,{signal:options.signal});
          plan.entries.push(...archive.entries);plan.expected.push(...archive.expected);
        }else{
          plan.entries.push({key:publication.importKey,payload:legacyPublicationImport.record});
          plan.expected.push(recordVersion(saved));
        }
        plan.expected.push(recordVersion(legacyPublicationImport));
      }
      options.signal?.throwIfAborted();
      writtenPlan=plan;
      return plan;
    },
  });
  if(saved){
    recovery.saved(entries,references);
    if(protection?.key===recordKey&&!editingProtected())protection=null;
    if(next.mode==='cache')outgoingLinkImport=null;
    if(next.mode==='published')legacyPublicationImport=null;
    const archived=writtenPlan?.entries.find(entry=>entry.key===previousImportKey);
    if(archived)previousImport=archived.payload;
    if(recordKey===publication.importKey)savedPublicationImport={...payload,preservedReviewKeys};
    else if(writtenPlan?.entries.some(entry=>entry.key===publication.importKey)){
      savedPublicationImport=writtenPlan.entries.find(entry=>entry.key===publication.importKey).payload;
    }
  }
  return saved;
}
async function loadConnected(state={},signal){
  const response=await fetch(publication.workspacePath||'./data/local-workspace.json',{cache:'no-store',signal});
  if(!response.ok)throw new Error(publishedMode?'The published review snapshot is unavailable.':'The private workspace is unavailable. Check that the Mac service is online.');
  const result=reconcileConnectedWorkspace(await response.json(),state);
  return {...result,workspace:{...result.workspace,selections:result.workspace.selections||{},decisions:result.workspace.decisions||[]}};
}
async function connectAtStartup(state){
  const result=await loadConnected(editingProtected()?{}:state);
  if(result.preservedState){
    reviewIssues=result.issues;
    await reviewRecovery.remember(result.preservedState,result.issues);
    try{await settleWithin(()=>reviewRecovery.flush());}catch(error){
      persistence='error';
      storageError='Saved reviews are preserved in this tab. '+error.message;
    }
  }
  return result.workspace;
}

let lastTransferPreview;
function updateTransferControls(state){
  const status=$('#workspace-transfer-status');
  if(status)status.textContent=workspaceTransferMessage(state);
  document.querySelectorAll('[data-action="import"],[data-action="live"],[data-action="retry-workspace-save"],[data-action="previous-import"],[data-action="saved-publication-import"]').forEach(button=>{button.disabled=state.busy||(editingProtected()&&!(emptyImport&&button.dataset.action==='import'&&!protection.snapshot))||(button.dataset.action==='retry-workspace-save'&&persistence==='saving');});
  const confirm=$('[data-action="import-confirm"]');
  if(confirm)confirm.disabled=state.phase!=='preview';
  const preview=$('.workspace-import-preview');
  if(preview)preview.hidden=!state.preview;
  const cancel=$('[data-cancel-transfer]');
  if(cancel){
    cancel.hidden=(!state.busy&&state.phase!=='reading')||state.phase==='saving';
    cancel.textContent=state.phase==='reading'?'Cancel file check':'Cancel';
  }
  const cancelPreview=$('[data-cancel-preview]');
  if(cancelPreview)cancelPreview.disabled=state.busy;
  if(lastTransferPreview!==state.preview){
    lastTransferPreview=state.preview;
    if(tab==='workspace'&&state.preview&&state.phase!=='reading')void render();
  }
}
const workspaceTransfer=createWorkspaceLifecycle({
  save:saveSnapshot,
  prepareSwitch:prepareImportSwitch,
  canEdit:()=>!editingProtected(),
  async connect(at,signal,{reconnect}){
    const saved=reconnect?await settleWithin(()=>readSavedWorkspace(key+'-connected')):null;
    signal.throwIfAborted();
    const result=await loadConnected(reconnect?saved?.state||{}:savedState(at.workspace),signal);
    const entries=result.preservedState?[await reviewRecovery.stage(result.preservedState,result.issues)]:[];
    return {workspace:result.workspace,entries,keys:saved?.preservedReviewKeys,issues:result.issues};
  },
  onWorkspace(next,kind){
    ({workspace,mode}=next);
    reviewRecovery=publishedMode&&(mode==='imported'||emptyImport)?importRecovery:scopeRecovery;
    if(kind==='workspace'){
      reviewIssues=[];
    }
    if(kind==='workspace'&&publishedMode){
      emptyImport=false;
      if(!isImportRoute()){
        const url=new URL(route);url.searchParams.set('workspace','import');
        url.searchParams.delete('campaign');url.searchParams.delete('view');
        history.pushState(null,'',url);route=url.href;
      }
    }
    if(kind==='edit'||kind==='start'||kind==='refresh'||kind==='reviews')return;
    current=workspace.campaigns[0].id;focus=null;filter='';inbox=false;
    if(kind==='connected')tab='overview';
  },
  onSave(saved){
    unsavedRestore=!saved;
    reportSave(saved?'saved':'error');
  },
  onChange:updateTransferControls,
});
function editWorkspace(change){
  if(editingProtected()){notify('Retry loading saved reviews before editing.');return null;}
  const saving=renderedWorkspaceIdentity===workspaceTransfer.current.identity&&workspaceTransfer.edit(change);
  if(!saving)notify('The workspace switch is finishing. Try the edit again in the intended workspace.');
  return saving;
}
function setWorkspaceEntry(field,campaign,id,value){
  return editWorkspace(target=>{
    target[field]||={};
    target[field][campaign]||={};
    target[field][campaign][id]=value;
  });
}
function setViewPreference(campaign,value){
  return editWorkspace(target=>{target.viewPreferences||={};target.viewPreferences[campaign]=value;});
}
function recoverReviewText(text){
  lateReviewText=text;
  notify('The review was not recorded. Return to the intended workspace and submit it again.');
  void render();
}
async function recordReview(campaignId,inputs,make,apply,text){
  if(editingProtected()){notify('Retry loading saved reviews before editing.');return false;}
  if(renderedWorkspaceIdentity!==workspaceTransfer.current.identity){
    recoverReviewText(text);
    return false;
  }
  const context=target=>{
    const source=target.campaigns.find(c=>c.id===campaignId);
    if(!source)return;
    const campaign=displayCampaign(source);
    return {campaign,inputs:inputs(campaign)};
  };
  if(await workspaceTransfer.review(target=>{
    const value=context(target);
    return value?.inputs;
  },before=>make(context(workspace).campaign,before),apply))return true;
  recoverReviewText(text);
  return false;
}
async function finishWorkspaceTransfer(result){
  if(result?.issues)reviewIssues=result.issues;
  await render();
  if(!result){
    const status=$('#workspace-transfer-status');
    if(status)status.focus({preventScroll:true});
    else if(workspaceTransfer.state.error)notify(workspaceTransfer.state.error);
    return;
  }
  const heading=$('main h1');
  if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  if(result.saved)notify({reviews:'Review changes restored.',workspace:'Backup opened in this browser.',connected:'Private campaign workspace reopened.'}[result.kind]);
}
async function refreshConnectedResults(button,message){
  if(editingProtected()){notify('Retry loading saved reviews before refreshing.');return;}
  const attempt=workspaceTransfer.refresh();
  if(!attempt)return;
  button.disabled=true;
  try{
    const result=await attempt;
    if(!result){notify(workspaceTransfer.state.error||'The open workspace changed. Refresh results again to load them.');return;}
    if(result.issues)reviewIssues=result.issues;
    await render();
    if(message)notify(message);
  }finally{button.disabled=false;}
}

function download(data,name,type='application/json') { const a=document.createElement('a'), url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type})); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
const reviewContext=c=>({viewStandard:workspace.viewPreferences?.[c.id]||{},subjectReviews:workspace.subjectReviews?.[c.id]||{},...(Object.keys(workspace.candidateReviews?.[c.id]||{}).length?{candidateReviews:workspace.candidateReviews[c.id]}:{}),...(c.subjects.some(s=>s.modelCoverage)?{modelSelections:Object.fromEntries(c.subjects.filter(s=>s.modelCoverage).map(s=>[s.id,panelChoice(s,c).selection]))}:{})});
function candidateReviewContext(campaign,id){
  const subject=campaign.subjects.find(row=>row.id===id);
  return {
    runId:campaign.run.id,workflowPin:campaign.workflowPin,subject,
    priorReview:workspace.candidateReviews?.[campaign.id]?.[id],
    modelSelection:subject?.modelCoverage?panelChoice(subject,campaign).selection:null,
  };
}
function refreshCameraInfo(){const node=$('#camera-default-status'),info=viewerController?.getDefaultViewInfo();if(node&&info)node.textContent=(candidateView==='monomer'||tab==='monomers')?'Designed binder alone · Reset returns to the fitted monomer view.':`${info.target} default: ${info.personal?'your saved view':'project starting perspective'}. Reset restores this default.`;}
function refreshContactList(){const node=$('#contact-list');if(!node)return;const contacts=viewerController?.getContacts()||[];node.innerHTML=contacts.length?`<details ${contacts.length<=5?'open':''}><summary>Interface contacts · ${contacts.length} distances · saved-model numbering</summary><ul>${contacts.map(c=>`<li><span>${c.species?esc(c.species)+' · ':''}Receptor ${esc(c.receptor.chain)}:${esc(c.receptor.resn)}${esc(c.receptor.resi)} ${esc(c.receptor.atom)} ↔ binder ${esc(c.binder.chain)}:${esc(c.binder.resn)}${esc(c.binder.resi)} ${esc(c.binder.atom)}</span><strong>${c.distanceAngstrom.toFixed(2)} Å</strong></li>`).join('')}</ul></details>`:'';}
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const external = (url,label) => safeURL(url) ? `<a href="${esc(safeURL(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : `<span>${esc(label)}</span>`;
async function setSelection(c,ids,review=null) {
  const before=selection(c),identity=workspaceTransfer.current.identity;
  let draft;
  if(c.selectionDraft){
    draft=selectionDraftFor(c,workspace.selectionDrafts?.[c.id]);
    for(const id of draft.selectedIds.filter(id=>!ids.includes(id)))draft=editSelectionDraft(c,draft,{candidateId:id,action:'remove'});
    for(const id of ids.filter(id=>!draft.selectedIds.includes(id)))draft=editSelectionDraft(c,draft,{candidateId:id,action:'consider'});
    draft={...draft,selectedIds:[...ids]};
  }
  const saving=editWorkspace(target=>{
    if(review){
      target.subjectReviews||={};
      target.subjectReviews[c.id]||={};
      target.subjectReviews[c.id][review.id]=review.value;
    }
    const notes=target.subjectReviews?.[c.id]||{};
    for(const [id,note] of Object.entries(notes)){
      const disposition=ids.includes(id)&&!before.includes(id)?'include':!ids.includes(id)&&before.includes(id)&&note.disposition==='include'?'exclude':null;
      if(disposition&&disposition!==note.disposition)notes[id]={...note,disposition,updatedAt:new Date().toISOString()};
    }
    if(draft){target.selectionDrafts||={};target.selectionDrafts[c.id]=draft;}
    else target.selections[c.id]=ids;
  });
  if(!saving){if(review)recoverReviewText(review.value.note);return false;}
  const saved=await saving;
  await render();
  if(identity===workspaceTransfer.current.identity&&refoldEnabled(c)&&mode==='cache'){
    try{
      for(const id of before.filter(id=>!ids.includes(id)))await registerRefolds(c,id,'remove');
      for(const id of ids.filter(id=>!before.includes(id)))await registerRefolds(c,id,'consider');
    }catch(error){notify(error.message);}
  }
  return saved;
}

function reviewModelLabel(subject,c){
  if(!subject?.modelCoverage)return '';
  const choice=panelChoice(subject,c),sel=choice.selection;
  return [choice.variants.find(v=>v.id===sel.variant)?.label,sel.target,choice.engines.find(e=>e.id===sel.engine)?.label,choice.resolved.model?'recorded model':'MISSING MODEL'].join(' · ');
}
function panelChoice(subject,c=workspace.campaigns.find(c=>c.id===current)) {
  return modelChoices(subject,workspace.modelSelections?.[c.id]?.[subject.id]||{});
}
function browserOptions(subject,c){return {selection:panelChoice(subject,c).selection,...modelBrowserStates.get(c.id+'::'+subject.id)};}
function browserFor(subject,c){return modelBrowser(subject,browserOptions(subject,c));}
function modelSubject(subject,c) {
  if(!subject)return subject;
  if(tab==='subjects'&&candidateView==='monomer'||tab==='monomers')return {...subject,molecularModels:monomerBrowser(subject,monomerSelections.get(c.id+'::'+subject.id)||{}).molecularModels,assets:[],panelModel:true,monomerModel:true};
  if(!subject?.modelCoverage)return subject;
  const browser=browserFor(subject,c),r=resolveModel(subject,browser.selection);
  return {...subject,molecularModels:browser.assets,assets:r.model?.assets||[],panelSelection:browser.selection,panelModel:true,browser};
}
function updateModelBrowser(subject,c,patch={},selectionPatch={},prefix='viewer'){
  const active=document.activeElement,attribute=['data-model-browser-mode','data-model-browser-engine','data-model-browser-variant','data-model-browser-target','data-model-browser-isoform','data-model-browser-all'].find(name=>active?.hasAttribute(name)),value=attribute?active.getAttribute(attribute):null;
  const id=c.id+'::'+subject.id,state={...(modelBrowserStates.get(id)||{}),...patch};
  const camera=(prefix==='explorer'?explorerController:viewerController)?.captureView()||null;
  if(prefix==='explorer')explorerStates.set(c.id,{...(explorerStates.get(c.id)||{}),startingView:camera});
  else pendingPanelView={campaignId:c.id,subjectId:subject.id,camera};
  modelBrowserStates.set(id,state);
  if(Object.keys(selectionPatch).length){setWorkspaceEntry('modelSelections',c.id,subject.id,{...(prefix==='explorer'?browserOptionsForExplorer(c).selection:panelChoice(subject,c).selection),...selectionPatch});}
  viewerEnabled=true;render().then(()=>{if(attribute)document.querySelector(`#${prefix}-model-browser [${attribute}${value?'="'+CSS.escape(value)+'"':''}]`)?.focus({preventScroll:true});});
}
function bindModelBrowser(subject,c,prefix){
  const host=document.getElementById(prefix+'-model-browser');if(!host||!subject?.modelCoverage)return;
  host.querySelectorAll('[data-model-browser-mode]').forEach(button=>button.onclick=()=>updateModelBrowser(subject,c,{mode:button.dataset.modelBrowserMode},{},prefix));
  const engine=host.querySelector('[data-model-browser-engine]');if(engine)engine.onchange=()=>updateModelBrowser(subject,c,{}, {engine:engine.value},prefix);
  const variant=host.querySelector('[data-model-browser-variant]');if(variant)variant.onchange=()=>{const both=variant.value==='__both__',ids=panelChoice(subject,c).variants.map(v=>v.id);updateModelBrowser(subject,c,{variants:both?ids:[variant.value]},both?{}:{variant:variant.value},prefix);};
  const target=host.querySelector('[data-model-browser-target]');if(target)target.onchange=()=>updateModelBrowser(subject,c,{}, {target:target.value},prefix);
  host.querySelectorAll('[data-model-browser-isoform]').forEach(input=>input.onchange=()=>{const targets=[...host.querySelectorAll('[data-model-browser-isoform]')].filter(i=>i.checked).map(i=>i.dataset.modelBrowserIsoform),primary=panelChoice(subject,c).selection.target;updateModelBrowser(subject,c,{targets},targets.length&&!targets.includes(primary)?{target:targets[0]}:{},prefix);});
  const all=host.querySelector('[data-model-browser-all]');if(all)all.onclick=()=>updateModelBrowser(subject,c,{targets:panelChoice(subject,c).targets.map(t=>t.id)},{},prefix);
  const colors=host.querySelector('[data-overlay-colors]');if(colors)colors.onchange=()=>{const id=c.id+'::'+subject.id;modelBrowserStates.set(id,{...(modelBrowserStates.get(id)||{}),overlayColors:colors.checked});const controller=prefix==='explorer'?explorerController:viewerController;if(colors.checked&&controller){viewerOptions.colorMode='project';viewerOptions.projectColors=true;controller.setColorMode('project');controller.setProjectColors(true);const project=$('#viewer-project');if(project)project.checked=true;}controller?.setIsoformColors(colors.checked);const key=host.querySelector('[data-overlay-legend]');if(key)key.hidden=!colors.checked;const note=host.querySelector('[data-overlay-palette-note]');if(note)note.textContent=colors.checked?'Key for the enabled isoform palette.':'Enable to color isoforms separately; project palette is unchanged.';refreshViewerColors(prefix,controller);};
}

function scopeText(scope) {return typeof scope==='string'?scope:scope&&typeof scope==='object'?Object.entries(scope).map(([k,v])=>`${k}: ${v}`).join(' · '):'Scope not recorded';}
function isoformComparison(subject,c) {
  if(!subject.modelCoverage)return '';
  const choices=panelChoice(subject,c),sel=choices.selection;
  const rows=choices.targets.map(t=>{const r=resolveModel(subject,{...sel,target:t.id});return {target:t.label,...r,observations:scopedMetrics(subject,r.model)};});
  const groups=new Map();
  for(const row of rows)for(const o of row.observations){const key=JSON.stringify([o.metric,o.unit||'',o.method||'',o.version||'',scopeText(o.scope),calibrationIdentity(o)||'']);if(!groups.has(key))groups.set(key,{observation:o,key});}
  return `<section class="panel isoform-panel"><div class="panel-head"><div><h2>Target comparison</h2><p class="fine muted">${esc(sel.variant)} · ${esc(sel.engine)} only. Rows group recorded metric methods and scope; unrecorded versions or calibration leave comparability unverified.</p></div></div><div class="table-scroll"><table><thead><tr><th>Measurement / scope</th>${rows.map(r=>`<th>${esc(r.target)}</th>`).join('')}</tr></thead><tbody><tr><th>Selected model</th>${rows.map(r=>`<td>${r.model?badge('File recorded','approved'):badge('Missing','blocked')}</td>`).join('')}</tr>${[...groups.values()].map(({observation:o,key})=>`<tr><th>${esc(o.label||o.metric)}${o.unit?` · ${esc(o.unit)}`:''}<small class="metric-scope">${esc(o.method||'Method not recorded')} · ${esc(observationVersionLabel(o))}<br>${esc(scopeText(o.scope))}${!o.version||!calibrationIdentity(o)?'<br>Calibration comparability not established':''}</small></th>${rows.map(r=>{const value=r.observations.find(x=>JSON.stringify([x.metric,x.unit||'',x.method||'',x.version||'',scopeText(x.scope),calibrationIdentity(x)||''])===key)?.value;return `<td class="numeric">${Number.isFinite(value)?value.toPrecision(3):'Not recorded'}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div><p class="fine muted">Computational predictions. Predicted differences between target conditions require experimental validation. Missing values are never replaced by a different construct or method.</p></section>`;
}
function panelSummary(subject,c){
  if(!subject.modelCoverage)return '';
  const choice=panelChoice(subject,c),r=choice.resolved,observations=scopedMetrics(subject,r.model);
  return `${renderModelPanel(subject,choice.selection,{showSelectors:false})}${!r.model&&!c.selectionDraft?renderFoldRequestButton(c,subject.id,choice.selection):''}${cacheCellNote(c,subject,choice.selection)}${r.asset&&privateAssetURL(r.asset.url?.replace(/^\.\/data\//,''))?`<div class="artifact-links"><a href="${esc(privateAssetURL(r.asset.url.replace(/^\.\/data\//,'')))}" download>↓ Selected structure file</a></div>`:''}${observations.length?`<div class="candidate-metrics">${observations.slice(0,4).map(o=>`<div><small>${esc(o.label||o.metric)}</small><strong>${Number.isFinite(o.value)?o.value.toPrecision(3):'Not recorded'}</strong><span>${esc(o.unit||'')} · ${esc(scopeText(o.scope))}</span></div>`).join('')}</div>`:''}`;
}

async function render() {
  const version=++renderVersion,identity=workspaceTransfer.current.identity;
  const displayed=workspace.campaigns.map(displayCampaign);
  for(const c of displayed) statuses[c.id]=await decisionStatus(c,selection(c),workspace.decisions,reviewContext(c));
  await Promise.all(displayed.map(async c=>{guidedStates[c.id]=await guidedReviewStatus(c,c.subjects.map(s=>s.id),workspace.candidateReviews?.[c.id],workspace.modelSelections?.[c.id]);}));
  const c=displayed.find(c=>c.id===current) || displayed[0];current=c.id;
  const betiiSnapshot=c.id===document.documentElement.dataset.publicationId;
  if(tab==='dimers'&&!betiiSnapshot)tab='overview';
  if(tab==='inputs'&&!c.designInputs)tab='overview';
  if(c.selectionDraft&&tab==='jobs')tab='explorer';if(tab==='explorer'&&!c.candidatePool)tab='overview';
  if(c.reviewOnly&&!betiiSnapshot&&tab!=='workspace'&&!campaignViews(c).some(v=>v.id===tab))tab=c.candidatePool?'explorer':'overview';
  document.title=campaignName(c)+' · Campaign Studio';

  const foldPlanStatus=c.foldPlan?await planReviewStatus(c,workspace.planReviews||[]):null;
  document.body.dataset.campaignTheme=/BETII|BRD/i.test(c.target)?'betii':/KRAS|pMHC/i.test(c.target)?'pmhc':/EGFR/i.test(c.target)?'egfr':'neutral';document.body.dataset.advanced=String(advanced);
  const s=statuses[c.id],selected=selection(c),issues=[...blockers(c,selected),...panelBlockers(c,selected,reviewContext(c))];
  const workspaceBackupBytes=tab==='workspace'?new TextEncoder().encode(JSON.stringify(workspace,null,2)).byteLength:null;
  let reviewBackupBytes=null;if(tab==='workspace'){try{reviewBackupBytes=new TextEncoder().encode(JSON.stringify(await createReviewExport(workspace),null,2)).byteLength;}catch{}}
  if(version!==renderVersion||identity!==workspaceTransfer.current.identity)return;if(explorerController){explorerStates.set(explorerCampaignId,{...(explorerStates.get(explorerCampaignId)||{}),startingView:explorerController.captureView()});explorerController.dispose();explorerController=null;}hotspotController?.dispose();hotspotController=null;inputController?.dispose();inputController=null;viewerController?.dispose();viewerController=null;workflowController?.dispose();workflowController=null;designController?.dispose();designController=null;
  const tools=()=>renderWorkspaceTools({
    mode,runtime:runnerRuntime,workspaceBytes:workspaceBackupBytes,reviewBytes:reviewBackupBytes,persistence,storageError,
    transfer:workspaceTransfer.state,previousImport:!!previousImport,savedImport:publishedMode&&mode==='published'&&!!savedPublicationImport,
    publicationImport:isImportRoute(),emptyImport,protection:editingProtected()?{retryable:!protection.snapshot}:null,
  });
  if(emptyImport){
    $('#app').innerHTML=`<div class="workspace"><main>${renderStorageProtection()}${tools()}</main></div>`;
    renderedWorkspaceIdentity=identity;
    bind(c);
    updateTransferControls(workspaceTransfer.state);
    return;
  }
  const navWasOpen=document.body.dataset.navOpen==='true';disposeNavigation?.();
  $('#app').innerHTML=`

  <div class="workspace">
    ${renderTopbar({mode,runtime:runnerRuntime,persistence})}
    <main>
      ${renderStorageProtection()}
      ${lateReviewText!==null?`<section class="notice" aria-label="Review text"><div><strong>Review was not recorded</strong><p>Copy your text and submit it again in the intended workspace.</p><textarea readonly data-late-review-text aria-label="Unrecorded review text">${esc(lateReviewText)}</textarea><div class="review-actions"><button class="button subtle" data-action="copy-late-review">Copy text</button><button class="button subtle" data-action="dismiss-late-review">Dismiss</button></div></div></section>`:''}
      ${reviewRecovery.keys.length?`<div class="notice" role="status"><div>Saved reviews that do not match this workspace were preserved separately. <button class="text-button" data-export-preserved-reviews>Save preserved reviews</button>${reviewIssues.length?`<details><summary>Reviews that could not be carried forward</summary><ul>${reviewIssues.map(({field,id,message})=>`<li>${esc([field,id,message].filter(Boolean).join(' · '))}</li>`).join('')}</ul></details>`:''}</div></div>`:''}
      ${tab==='workspace'?`<button class="text-button workspace-back" data-tab="${esc(lastCampaignTab)}">← Back to ${esc(campaignName(c))}</button>${tools()}`:`<div class="title-row"><div><h1>${esc(campaignName(c))}</h1></div>${badge(s.label,s.key)}</div>

      ${c.supersededBy?`<div class="notice private"><span>↗</span><div>Previous selection. <button class="text-button" data-campaign="${esc(c.supersededBy)}">Current shortlist →</button></div></div>`:''}${betiiSnapshot?renderPublicTabs(c,{active:tab,issueCount:issues.length}):renderCampaignTabs(c,{active:tab,issueCount:issues.length})}
      ${tab==='overview'?(betiiSnapshot?renderPublicOverview(c):renderCampaignOverview(c,{status:s,selected})):tab==='dimers'?renderDimerModels(c,dimerSelections.get(c.id)||{}):tab==='results'?renderSavedResults(c):tab==='hotspot-design'?renderHotspotDesign():tab==='affinity'?renderAffinity(c,affinityStates.get(c.id)||{}):tab==='inputs'?renderDesignInputs(c,inputViews.get(c.id)?.id):tab==='review-plan'?renderAffinityQuote(c)+renderReviewPlan(c,{selectedIds:selected})+refoldRegistrySection(c):tab==='explorer'?renderCandidateExplorer(c,{...explorerStates.get(c.id),draft:workspace.selectionDrafts?.[c.id],browserOptions:browserOptionsForExplorer(c)})+refoldRegistrySection(c):tab==='subjects'?subjects(c,selected):tab==='models'?renderModelLibrary(c,{...libraryStates.get(c.id),selectedIds:selected}):tab==='monomers'?monomerPage(c):tab==='evidence'?evidence(c):tab==='gaps'?cacheGaps(c):tab==='fold-plan'?renderFoldingDashboard(c,{selectedCellId:foldCell}):tab==='openfold'?renderOpenFoldResults(c,{selection:openFoldSelections.get(c.id)||{}}):tab==='jobs'?jobsPage(c):tab==='colors'?colorStandards(c):review(c,s,selected,issues)}`}
      <footer class="page-foot"><span>Snapshot · ${esc(c.observedAt.slice(0,10))}</span><span><button class="text-button" data-toggle-advanced>${advanced?'Close details':'Technical details'}</button></span></footer>
    </main>
  </div>`;
  disposeNavigation=bindCampaignNavigation(document,{initialOpen:navWasOpen});
  const brand=$('.brand');
  if(brand)brand.onclick=event=>{
    if(!workspaceTransfer.dirty||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    void leaveWorkspace(brand.href);
  };
  renderedWorkspaceIdentity=identity;
  bind(c);
  updateTransferControls(workspaceTransfer.state);
  if(tab==='dimers'){const d=dimerModelData(c,dimerSelections.get(c.id)||{});document.querySelectorAll('[data-dimer-candidate],[data-dimer-variant],[data-dimer-engine],[data-dimer-rank]').forEach(n=>n.onchange=()=>{dimerSelections.set(c.id,{candidateId:document.querySelector('[data-dimer-candidate]').value,variant:document.querySelector('[data-dimer-variant]').value,engine:document.querySelector('[data-dimer-engine]').value,rank:Number(document.querySelector('[data-dimer-rank]')?.value||1)});render();});if(d.assets.length)viewerController=mountMolecule(document.getElementById('dimer-molecule'),{...d.subject,molecularModels:d.assets},{campaignId:c.id,palette:{binder:'#F07A21'},onStatus:t=>{const n=document.getElementById('dimer-status');if(version===renderVersion&&n)n.textContent=t;}});}
  const campaignTabs=$('nav.tabs'),activeTab=campaignTabs?.querySelector('[aria-current="page"]');
  if(activeTab&&campaignTabs.scrollWidth>campaignTabs.clientWidth){
    const frame=campaignTabs.getBoundingClientRect(),active=activeTab.getBoundingClientRect();
    if(active.left<frame.left)campaignTabs.scrollLeft+=active.left-frame.left-8;
    else if(active.right>frame.right)campaignTabs.scrollLeft+=active.right-frame.right+8;
  }
  if(tab==='subjects'){const subject=c.subjects.find(s=>s.id===focus);if(candidateView==='provenance'&&subject?.provenance)loadProvenance(subject,version);}
  if(tab==='hotspot-design')mountHotspotPage(c,version);
  if(tab==='inputs')mountInputs(c,version);
  if(tab==='explorer')mountExplorer(c,version);
  if(['explorer','review-plan'].includes(tab)&&refoldEnabled(c)&&!refoldRegistries.has(c.id))loadRefolds(c);
  if(tab==='subjects'&&candidateView==='structure'){const subject=c.subjects.find(s=>s.id===focus);if(subject?.modelCoverage)bindModelBrowser(subject,c,'viewer');}
  if(tab==='monomers'||tab==='subjects'&&candidateView==='monomer'){
    document.querySelectorAll('[data-monomer-engine],[data-monomer-variant]').forEach(control=>control.onchange=()=>{
      const id=c.id+'::'+(tab==='monomers'?monomerSubject(c).id:focus),dimension=control.hasAttribute('data-monomer-engine')?'engine':'variant',value=control.value;
      monomerSelections.set(id,{...(monomerSelections.get(id)||{}),[dimension]:value});pendingPanelView=null;viewerEnabled=true;
      render().then(()=>document.querySelector(`[data-monomer-${dimension}]`)?.focus({preventScroll:true}));
    });
  }
  if((tab==='subjects'||tab==='monomers')&&viewerEnabled){const sourceSubject=tab==='monomers'?monomerSubject(c):c.subjects.find(s=>s.id===focus),subject=modelSubject(sourceSubject,c),host=$('#molecule-container');if(host&&subject?.molecularModels?.length){try{const palette=standardFor(c).palette,startingView=pendingPanelView?.campaignId===c.id&&pendingPanelView.subjectId===sourceSubject.id?pendingPanelView.camera:null;pendingPanelView=null;viewerController=mountMolecule(host,subject,{palette,campaignId:c.id,viewDefaults:workspace.molecularViewDefaults?.[c.id]||{},viewPresets:c.molecularViewPresets||{},startingView,overlaySpecies:subject.browser?.mode==='overlay'?subject.molecularModels.map(a=>a.species):undefined,annotations:recordedModelAnnotations(sourceSubject,subject.molecularModels).annotations,annotationsVisible:recordedModelAnnotations(sourceSubject,subject.molecularModels).visible,onStatus:message=>{if(version===renderVersion&&$('#molecule-status')){$('#molecule-status').textContent=message;refreshContactList();refreshCameraInfo();refreshViewerColors('viewer',viewerController);}}});const controller=viewerController;controller.ready.then(()=>{if(version!==renderVersion)return;applyViewerOptions(controller);if(subject.browser)controller.setIsoformColors(subject.browser.overlayColors);bindViewerColors('viewer',controller,{shared:true});document.querySelectorAll('[data-action="viewer-save-default"],[data-action="viewer-project-view"]').forEach(b=>b.disabled=!subject.molecularModels.some(m=>m.displayFrame||m.coordinateFrame&&!m.coordinateFrame.startsWith('native:')));if(sourceSubject.modelCoverage||subject.monomerModel){viewerSpecies=subject.molecularModels[0].species;}else if(subject.molecularModels.some(m=>m.species===viewerSpecies)&&viewerSpecies!==subject.molecularModels[0].species)return controller.setSpecies(viewerSpecies);}).catch(error=>notify(error.message));}catch(error){$('#molecule-status').textContent=error.message;}}}
}

async function mountHotspotPage(c,version){
 let config={};try{const response=await fetch('./design-issue-config.json',{cache:'no-store'});if(response.ok)config=await response.json();}catch{}
 if(version!==renderVersion)return;
 const owner=workspace;
 hotspotController=mountHotspotDesign(document.getElementById('hotspot-design-root'),c,{
  config,startingTarget:pendingHotspotTargets.get(c.id),
  state:owner.hotspotDesignDrafts?.[c.id],records:owner.hotspotDesignRequests?.[c.id]||[],
  onSave(state){
   if(workspace!==owner)return;
   editWorkspace(target=>{target.hotspotDesignDrafts||={};target.hotspotDesignDrafts[c.id]=state;});
  },
  onRecord(record){
   if(workspace!==owner)return;
   if(owner.hotspotDesignRequests?.[c.id]?.some(r=>r?.request?.requestDigest===record.request.requestDigest))return;
   editWorkspace(target=>{
    target.hotspotDesignRequests||={};
    (target.hotspotDesignRequests[c.id]||=[]).push(record);
   });
  },
  preview:null,
  publish:null,
 });
 pendingHotspotTargets.delete(c.id);
}
function mountInputs(c,version){
  const selected=inputSelection(c,inputViews.get(c.id)?.id),host=$('#campaign-input-molecule');
  const picker=$('#campaign-input-view');
  if(picker)picker.onchange=()=>{inputViews.set(c.id,{id:picker.value,camera:inputController?.captureView()});render().then(()=>$('#campaign-input-view')?.focus({preventScroll:true}));};
  if(!host||!selected?.subject)return;
  try{
    const controller=mountMolecule(host,selected.subject,{palette:standardFor(c).palette,campaignId:c.id,startingView:inputViews.get(c.id)?.camera,annotations:selected.annotations,annotationLabels:true,onStatus:message=>{if(version===renderVersion&&$('#campaign-input-status'))$('#campaign-input-status').textContent=message;}});
    inputController=controller;
    controller.ready.then(()=>{if(version!==renderVersion||inputController!==controller)return;
      controller.setRepresentation(viewerOptions.representation);controller.setColorMode(viewerOptions.colorMode);bindViewerColors('campaign-input',controller,{shared:true});bindViewerRepresentation('campaign-input',controller);
      document.querySelectorAll('[data-input-layer]').forEach(control=>control.onchange=()=>controller.setAnnotationVisible(control.dataset.inputLayer,control.checked));
      $('#campaign-input-labels').onchange=e=>controller.setAnnotationLabels(e.target.checked);
      $('#campaign-input-sidechains').onchange=e=>controller.setSideChains(e.target.checked);
      $('#campaign-input-project-colors').onchange=e=>controller.setProjectColors(e.target.checked);
      $('#campaign-input-reset').onclick=()=>controller.reset();
    }).catch(error=>{if(version===renderVersion&&$('#campaign-input-status'))$('#campaign-input-status').textContent=error.message;});
  }catch(error){$('#campaign-input-status').textContent=error.message;}
}

function browserOptionsForExplorer(c){const state=explorerStates.get(c.id)||{},data=candidateExplorerData(c,state),row=data.candidates.find(r=>r.id===state.selectedCandidateId)||data.candidates[0];if(!row?.subject.modelCoverage)return {};const options=browserOptions(row.subject,c);if(data.preset&&!workspace.modelSelections?.[c.id]?.[row.id]&&!modelBrowserStates.get(c.id+'::'+row.id)?.selection)options.selection={engine:data.engine,target:data.target,variant:data.variant};return options;}
function mountExplorer(c,version){
  const state=explorerStates.get(c.id)||{},data=candidateExplorerData(c,state),selected=data.candidates.find(row=>row.id===state.selectedCandidateId)||data.candidates[0],host=$('#candidate-explorer-molecule');
  if(!selected?.subject.modelCoverage)return;bindModelBrowser(selected.subject,c,'explorer');
  const browser=modelBrowser(selected.subject,browserOptionsForExplorer(c));if(!host||!browser.assets.length)return;
  try{
    const annotationView=recordedModelAnnotations(selected.subject,browser.assets),annotations=annotationView.annotations;
    let controller;controller=mountMolecule(host,{...selected.subject,molecularModels:browser.assets},{palette:standardFor(c).palette,campaignId:c.id,viewDefaults:workspace.molecularViewDefaults?.[c.id]||{},viewPresets:c.molecularViewPresets||{},startingView:state.startingView,overlaySpecies:browser.mode==='overlay'?browser.assets.map(a=>a.species):undefined,annotationsVisible:annotationView.visible,annotations,onStatus:message=>{if(version===renderVersion&&explorerController===controller&&$('#candidate-explorer-status'))$('#candidate-explorer-status').textContent=message;}});
    explorerController=controller;explorerCampaignId=c.id;
    controller.ready.then(()=>{if(version!==renderVersion||explorerController!==controller)return;const pocket=$('#explorer-pocket');if(pocket)pocket.onchange=()=>{for(const layer of annotations)controller.setAnnotationVisible(layer.id,pocket.checked);};applyViewerOptions(controller);controller.setIsoformColors(browser.overlayColors);bindViewerColors('explorer',controller,{shared:true});const sidechains=$('#explorer-sidechains');if(sidechains){sidechains.checked=viewerOptions.sideChains;sidechains.onchange=()=>{viewerOptions.sideChains=sidechains.checked;controller.setSideChains(sidechains.checked);};}const representation=$('#explorer-representation');if(representation){representation.value=viewerOptions.representation;representation.onchange=()=>{viewerOptions.representation=representation.value;controller.setRepresentation(representation.value);};}const contacts=$('#explorer-interface');if(contacts){contacts.checked=viewerOptions.interface;contacts.onchange=()=>{viewerOptions.interface=contacts.checked;controller.setInterface(contacts.checked);};}}).catch(error=>{if(version===renderVersion&&$('#candidate-explorer-status'))$('#candidate-explorer-status').textContent=error.message;});
  }catch(error){$('#candidate-explorer-status').textContent=error.message;}
}


function plot(c,rows) {
  if(!c.axes) return '<div class="empty-state"><span>◇</span><h3>Review the recorded evidence</h3><p>This recipe has no paired numeric axes. Open a subject to inspect its identity and source artifacts.</p></div>';
  const {x,y}=c.axes,points=rows.filter(s=>Number.isFinite(s.metrics?.[x.key])&&Number.isFinite(s.metrics?.[y.key])&&(x.scale!=='log10'||s.metrics[x.key]>0)&&(y.scale!=='log10'||s.metrics[y.key]>0));
  if(!points.length) return '<div class="empty-state"><h3>No comparable measurements</h3><p>Missing values are retained as missing; they are never plotted as zero.</p></div>';
  const transform=(v,a)=>a.scale==='log10'?Math.log10(v):v;const format=(v,a)=>(a.scale==='log10'?10**v:v).toPrecision(3);const vals=a=>points.map(s=>transform(s.metrics[a.key],a)), extent=(a,axis)=>{let lo=Math.min(...a),hi=Math.max(...a);const pad=(hi-lo||Math.abs(hi)*.1||1)*.15;return /ipSAE/i.test(axis.label)?[Math.max(0,lo-pad),Math.min(1,hi+pad)]:[lo-pad,hi+pad];};
  const [xmin,xmax]=extent(vals(x),x),[ymin,ymax]=extent(vals(y),y);
  const px=v=>70+(transform(v,x)-xmin)/(xmax-xmin)*470,py=v=>270-(transform(v,y)-ymin)/(ymax-ymin)*225;
  const ticks=Array.from({length:5},(_,i)=>i/4);
  return `<div class="scatter-frame"><div class="scatter-layout"><span class="scatter-title scatter-title-y" aria-hidden="true">${esc(y.label)}</span><svg class="scatter" viewBox="-24 0 624 306" role="group" aria-label="${esc(x.label)} versus ${esc(y.label)}. Select a point to inspect its subject.">${ticks.map(t=>`<line x1="70" x2="540" y1="${45+t*225}" y2="${45+t*225}" stroke="#e4e9e5"/><text class="scatter-tick" x="57" y="${49+t*225}" text-anchor="end">${format(ymax-t*(ymax-ymin),y)}</text><text class="scatter-tick" x="${70+t*470}" y="290" text-anchor="middle">${format(xmin+t*(xmax-xmin),x)}</text>`).join('')}${points.map(s=>`<circle class="plot-point ${s.id===focus?'focused':''}" cx="${px(s.metrics[x.key])}" cy="${py(s.metrics[y.key])}" r="${s.id===focus?8:6}" fill="${s.recommended?'#255d50':'#9aa8a3'}" tabindex="0" role="button" data-focus="${esc(s.id)}" aria-label="Inspect ${esc(readableSubject(s))}; ${esc(x.label)} ${s.metrics[x.key]}; ${esc(y.label)} ${s.metrics[y.key]}"><title>${esc(readableSubject(s))}</title></circle>`).join('')}</svg><span class="scatter-title scatter-title-x" aria-hidden="true">${esc(x.label)}</span></div></div><p class="plot-caption">${c.demo?'Illustrative values':'Saved measurements'} · ${points.length} of ${rows.length} subjects have both measurements. Select a point to inspect it.</p>`;
}

function readableSubject(subject) {
  return subject.displayName || subject.label.replace(/^Human_EGFR_Human_EGFR_(\d+)_model_(\d+)$/, 'Foundry $1 · model $2').replaceAll('_',' ');
}
function originLabel(subject) { const o=subject.designOrigin;return typeof o==='string'?o:o?.method||o?.label||'Not recorded'; }
function groupLabel(group) {return ({strict_all_four_pkas:'Within original screen',authorized_near_pka_match:'Reviewed exception',mandatory_Figure1_fusion_exception:'Required control'})[group]||pretty(group||'Retained');}
function metricCards(subject) {
  if(subject.metricSummary)return renderRecordedMetrics(subject.metricSummary);
  const m=subject.metrics||{};
  if(['ipSAE','TM-score','DockQ'].every(k=>Object.hasOwn(m,k)))return `<div class="candidate-metrics">${[['ipSAE','Binder–receptor confidence'],['TM-score','Binder fold similarity'],['DockQ','Original design ↔ Exact refold']].map(([key,label])=>`<div><small>${esc(key)}</small><strong>${Number.isFinite(m[key])?m[key].toFixed(3):'Pending'}</strong><span>${label}</span></div>`).join('')}</div>${subject.metricEvidence?`<details class="metric-definitions"><summary>Metric scope and source</summary><p>${esc(subject.metricEvidence.scope)}</p><p class="mono">SHA256 ${esc(subject.metricEvidence.sha256)}</p></details>`:''}`;
  if(!Number.isFinite(m.Human_ipSAE))return '';
  const pose=subject.poseComparison||{},dq=pose.dockQ??m.HumanMouse_DockQ,tm=pose.tmScore??m.HumanMouse_TMscore;
  return `<div class="candidate-metrics"><div><small>Cross-species ipSAE</small><strong>${m.Human_ipSAE.toFixed(3)} <em>/</em> ${Number.isFinite(m.Mouse_ipSAE)?m.Mouse_ipSAE.toFixed(3):'—'}</strong><span>Human / mouse</span></div><div><small>Predicted affinity · nM</small><strong>${Number.isFinite(m.Human_Kd_nM)?m.Human_Kd_nM.toPrecision(3):'—'} <em>/</em> ${Number.isFinite(m.Mouse_Kd_nM)?m.Mouse_Kd_nM.toPrecision(3):'—'}</strong><span>Human / mouse · lower is stronger</span></div><div><small>Human–mouse pose · DockQ</small><strong>${Number.isFinite(dq)?dq.toFixed(3):'Not available'}</strong><span>Mouse prediction vs human prediction</span></div><div><small>Human–mouse structural TM-score</small><strong>${Number.isFinite(tm)?tm.toFixed(3):'Not available'}</strong><span>Whole-complex best-fit similarity</span></div></div><details class="metric-definitions"><summary>What do these comparisons mean?</summary><p><strong>DockQ:</strong> how similarly the binder docks to the receptor. The mouse predicted complex is compared with the human prediction as reference. Scores range from 0 to 1; higher means more similar docking.</p><p><strong>TM-score:</strong> how similar the complete protein complexes are after a best-fit superposition of matched residues. Scores range from 0 to 1. The receptor contributes to the score, so inspect the binder placement too.</p><p>Both structures are predictions. These comparisons cover protein atoms; glycan contacts are excluded.</p><details><summary>Calculation details</summary><p>${esc(pose.dockQDefinition||'A source-bound DockQ calculation is not available for this entry.')}</p><p>${esc(pose.tmDefinition||'A source-bound TM-score calculation is not available for this entry.')}</p><p>${esc(pose.version||'Method version not recorded')}</p></details></details><div class="model-generation-summary"><span>MODEL GENERATION</span><strong>${esc(generationLabel(subject))}</strong></div>`;
}
function molecularTargetButtons(subject){
  if(subject.panelSelection&&subject.modelCoverage){return subject.modelCoverage.expectedTargets.map(target=>{const available=resolveModel(subject,{...subject.panelSelection,target}).asset;return `<button class="${subject.panelSelection.target===target?'active':''}" data-view-target="${esc(target)}" aria-label="View ${esc(target)} in 3D" ${available?'':'disabled title="No cached model for this construct and method"'}>${esc(target)}</button>`;}).join('');}
  const activeSpecies=subject.molecularModels.some(m=>m.species===viewerSpecies)?viewerSpecies:subject.molecularModels[0]?.species;
  return subject.molecularModels.map(m=>`<button class="${activeSpecies===m.species?'active':''}" data-species="${esc(m.species)}">${esc(m.species)}</button>`).join('');
}
function moleculePanel(subject) {
  const session=subject.assets?.find(a=>a.kind==='structure'),monomer=subject.monomerModel===true;
  return `<div class="model-access"><div class="model-buttons">${subject.molecularModels?.length?`<button class="button primary" data-action="viewer">${viewerEnabled?(subject.panelModel||!subject.assets?.some(a=>a.kind==='image')?'Close 3D view':'Show original picture'):'Explore in 3D'} ◇</button>`:''}${renderPymolDownload(subject.molecularModels)}<button class="button subtle" ${tab==='monomers'?'data-monomer-step':'data-focus-step'}="-1" aria-label="Previous candidate">←</button><button class="button subtle" ${tab==='monomers'?'data-monomer-step':'data-focus-step'}="1" aria-label="Next candidate">→</button></div>${viewerEnabled&&subject.molecularModels?.length?`<div class="molecule-tools"><div class="species-switch">${subject.panelModel?'':molecularTargetButtons(subject)}</div><div class="camera-actions"><button class="text-button" data-action="viewer-reset">Reset view</button>${subject.browser?.mode==='overlay'?'<button class="text-button" data-action="viewer-fit">Fit all models</button>':''}${monomer?'':'<button class="button subtle" data-action="viewer-save-default" disabled>Save as default view</button><button class="text-button" data-action="viewer-project-view" disabled>Use project view</button>'}</div></div><div class="viewer-options"><label><input type="checkbox" id="viewer-project" ${viewerOptions.projectColors?'checked':''}> Project colors</label><label><input type="checkbox" id="viewer-sticks" ${viewerOptions.sideChains?'checked':''}> Side chains</label><label><input type="checkbox" id="viewer-residue" ${viewerOptions.residueColors?'checked':''}> Residue class highlights</label>${monomer?'':`<label><input type="checkbox" id="viewer-interface" ${viewerOptions.interface?'checked':''}> Close contacts</label>`}${renderViewerRepresentationControls('viewer',viewerOptions.representation)}${renderViewerColorControls('viewer',viewerOptions.colorMode)}</div><div id="molecule-container" class="molecule-container"></div><p id="molecule-status" class="viewer-status" role="status">Loading the selected structure…</p><p id="camera-default-status" class="fine muted">Loading target view…</p><div id="contact-list" class="contact-list"></div>${monomer?'<p class="fine muted">Designed binder alone. Drag to rotate · pinch or scroll to zoom · tap a residue to identify it. Reset restores the fitted monomer view.</p>':`<p class="fine muted">Drag to rotate · pinch or scroll to zoom · tap a residue to identify it. Save as default view remembers the angle, position and zoom for this target in this browser. Switching aligned isoforms keeps your current perspective. Reset returns to this isoform’s saved default; Use project view restores the common project perspective. Close contacts show up to five heavy-atom distances ≤4 Å; these are geometric contacts.</p>`}`:previewAssets(subject)}</div>`;
}
function monomerPage(c){
  const pool=monomerPool(c),subject=monomerSubject(c);
  if(!subject)return '<section class="panel"><h2>Binder monomers</h2><p>No monomer calculations are recorded for this campaign.</p></section>';
  const counts=pool.map(s=>monomerBrowser(s)),available=counts.reduce((n,b)=>n+b.available,0),expected=counts.reduce((n,b)=>n+b.expected,0);
  return `<section class="panel"><div class="panel-head"><div><h2>Binder alone</h2>${mode==='cache'?'<button class="text-button" data-refresh-monomers>Refresh results ↻</button>':''}<p class="fine muted">Inspect the design without its target receptor. ${pool.length} designs · ${available} of ${expected} native models imported.</p></div><label>Design<select class="input" id="monomer-candidate" aria-label="Design for monomer review">${pool.map(s=>`<option value="${esc(s.id)}" ${s.id===subject.id?'selected':''}>${esc(readableSubject(s))}</option>`).join('')}</select></label></div><h3>${esc(readableSubject(subject))}</h3>${renderMonomerBrowser(subject,monomerSelections.get(c.id+'::'+subject.id)||{})}${moleculePanel(modelSubject(subject,c))}</section>`;
}

function subjectDetail(subject,c,selected,metricKeys) {
  if(!subject)return '<p>No candidates recorded.</p>';
  if(c.reviewScatter&&subject.metricEvidence)subject={...subject,summary:(subject.summary||'').replace('Scores pending.','Source-bound scores recorded; population scoring may still be incomplete.')};
  const subjectReview=workspace.subjectReviews?.[c.id]?.[subject.id];
  return `<div class="panel-head"><span class="eyebrow">CANDIDATE ${subject.rank?String(subject.rank).padStart(2,'0'):''}</span>${badge(groupLabel(subject.group),'neutral')}</div>${subject.modelCoverage?renderModelBrowser(subject,browserOptions(subject,c)):''}${moleculePanel(modelSubject(subject,c))}${subject.modelCoverage&&browserFor(subject,c).mode==='overlay'?`<p class="fine muted">Metrics below refer to ${esc(panelChoice(subject,c).selection.target)} · ${esc(panelChoice(subject,c).selection.variant)} · ${esc(panelChoice(subject,c).selection.engine)}. Each overlaid model keeps its own measurements.</p>`:''}${panelSummary(subject,c)}${metricCards(subject)}<label class="select-subject"><input type="checkbox" data-select="${esc(subject.id)}" ${selected.includes(subject.id)?'checked':''}> Include in final review</label><details class="selection-note"><summary>Selection & saved notes</summary><form id="subject-review-form" class="candidate-note"><label>My candidate decision<select name="disposition" class="input"><option value="include" ${subjectReview?.disposition==='include'?'selected':''}>Keep in selection</option><option value="hold" ${subjectReview?.disposition==='hold'?'selected':''}>Hold for follow-up</option><option value="exclude" ${subjectReview?.disposition==='exclude'?'selected':''}>Exclude from selection</option></select></label>${subjectReview?.modelSelection?`<p class="fine muted">Saved note context: ${esc(subjectReview.modelSelection.variant)} · ${esc(subjectReview.modelSelection.target)} · ${esc(subjectReview.modelSelection.engine)}</p>`:''}<label>Review note<textarea name="note" rows="2" maxlength="4000" placeholder="A brief reason or question…">${esc(subjectReview?.note||'')}</textarea></label><button type="submit" class="text-button">Save candidate note →</button></form></details>${subject.flags?.length?`<div class="subject-flags">${subject.flags.map(f=>`<p>! ${esc(f)}</p>`).join('')}</div>`:''}<details><summary>Sequence, origin & frozen-roster measurements</summary><dl><dt>Design origin</dt><dd>${esc(originLabel(subject))}</dd><dt>Parent</dt><dd>${esc(subject.parentId||'Not recorded')}</dd>${Object.entries(subject.metrics||{}).map(([k,v])=>`<dt>${esc(pretty(k))}</dt><dd>${Number.isFinite(v)?v.toPrecision(3):'Not measured'}</dd>`).join('')}</dl>${subject.sequence?`${subject.modelCoverage?'<p class="fine muted">Frozen base sequence; tagged constructs are separate variants above.</p>':''}<p class="sequence">${esc(subject.sequence)}</p>`:''}<p class="fine muted">${esc(subject.summary||'')}</p></details><details class="audit-details"><summary>Audit details</summary><dl><dt>Exact candidate ID</dt><dd class="mono">${esc(subject.id)}</dd><dt>Sequence fingerprint</dt><dd class="mono">${esc(subject.sequenceHash||subject.sequenceSha256||'Not recorded')}</dd></dl>${subject.modelGeneration?`<details><summary>Native folding records</summary><p class="sequence">${esc(JSON.stringify(subject.modelGeneration,null,2))}</p></details>`:''}<div class="artifact-links">${(subject.assets||[]).map(assetLink).join('')}${(subject.artifacts||[]).map(a=>external(a.url,a.label)).join('')}</div></details>`;
}
function cacheStateBadge(state){const value=CACHE_STATES[state];return badge(value.label,value.tone);}
function cacheEntry(c,subject,selection){return cacheAuditSummary(c).rows.find(r=>r.candidateId===subject.id&&r.target===selection.target&&r.engine===selection.engine&&r.variant===selection.variant);}
function cacheCellNote(c,subject,selection){
 if(!c.cacheAudit)return '';
 const r=cacheEntry(c,subject,selection);if(!r||r.classification==='loaded')return '';
 return `<div class="cache-cell-note">${cacheStateBadge(r.classification)}<p class="fine muted">${esc(r.reason)}</p><button class="text-button" data-audit-candidate="${esc(subject.id)}">Inspect cache search evidence →</button></div>`;
}
function cacheGaps(c){
 const audit=cacheAuditSummary(c),a=audit.audit,counts=audit.counts;
 if(!a)return '<section class="panel"><h2>No wider cache audit is attached</h2><p>Unloaded combinations have not yet been established as missing.</p></section>';
 const knownSubjects=c.subjects.filter(s=>s.modelCoverage);
 const pairs=[...new Map(knownSubjects.flatMap(s=>{const p=coverageSummary(s);return p.variants.flatMap(variant=>p.engines.map(engine=>[JSON.stringify([variant,engine]),{variant,engine}]))})).values()];
 if(gapCandidate!=='all'&&!knownSubjects.some(s=>s.id===gapCandidate))gapCandidate='all';
 const engineLabel=id=>({'boltz2-exact':'Boltz2 Exact',af3:'AlphaFold 3','opendde-exact':'OpenDDE Exact'}[id]||id);
 const variantLabel=id=>id==='ctag64'?'64-aa C-terminal tag':id==='untagged'?'Untagged':id;
 const matrix=(subject,p)=>{const rows=audit.rows.filter(r=>r.candidateId===subject.id&&r.variant===p.variant&&r.engine===p.engine),groups=Object.entries(CACHE_STATES).filter(([state])=>rows.some(r=>r.classification===state));return groups.map(([state,style])=>`<span class="audit-matrix-state ${esc(state)}">${rows.filter(r=>r.classification===state).length} ${esc(state==='loaded'?'loaded':state==='cached_available'?'cached':state==='not_found'?'not found':state==='referenced_missing'?'absent file':state==='identity_mismatch'?'different construct':state==='pending'?'no output':state==='unresolved'?'unresolved':state==='record_only'?'record only':'unchecked')}</span>`).join('');};
 const rows=audit.rows.filter(r=>(gapCandidate==='all'||r.candidateId===gapCandidate)&&(gapState==='all'||gapState==='unloaded'?gapState==='all'||r.classification!=='loaded':r.classification===gapState));
 return `<div class="section-heading"><div><h2>Which models are actually available?</h2><p>Read-only search of saved results. Availability does not establish scientific acceptance.</p></div>${c.foldPlan?'<button class="button primary" data-tab="fold-plan">Review proposed folds →</button>':''}<button class="button subtle" data-action="gap-export">↓ Export cache audit</button></div>
 <section class="stats audit-stats"><article><span>In this interface</span><strong>${counts.loaded}</strong><small>Previously verified native models</small></article><article><span>Found elsewhere</span><strong>${counts.cached_available}</strong><small>Exact identities verified; not yet imported</small></article><article><span>No exact model found</span><strong>${counts.not_found+counts.referenced_missing}</strong><small>${counts.referenced_missing} recorded paths absent · ${counts.not_found} search misses</small></article><article><span>Needs reconciliation</span><strong>${counts.unresolved+counts.identity_mismatch+counts.not_searched+counts.pending+counts.record_only}</strong><small>Different identity, unclear method, pending or unchecked</small></article></section>
 ${(a.externalChecks||[]).map(check=>`<section class="notice ${check.status==='checked'?'private':'demo'} audit-external"><span>${check.status==='checked'?'✓':'!'}</span><div><strong>${esc(check.host)} ${check.status==='checked'?'reference check completed.':'availability remains unresolved.'}</strong> ${esc(check.reason)}${check.status!=='checked'&&check.referencedPathCount?` ${esc(check.referencedPathCount)} referenced paths are not verified as absent.`:''}</div></section>`).join('')}
 <section class="notice private"><span>⌕</span><div><strong>“Not found” is limited to the searched caches.</strong> It does not prove a model was never generated. Different tags, receptor constructs, Fast folds and unverified method labels cannot fill these exact comparison slots.</div></section>
 <section class="panel audit-scope"><div class="panel-head"><h2>Search scope and limits</h2><span class="fine muted">Checked ${esc(a.observedAt.slice(0,10))}</span></div><p>${esc(a.scope.methodSummary||'Exact construct, receptor and folding-method identities were checked against retained records.')}</p><details><summary>${a.scope.roots.length} searched locations${a.scope.limitations.length?` · ${a.scope.limitations.length} limitations`:''}</summary><ul>${a.scope.roots.map(root=>`<li>${esc(root)}</li>`).join('')}</ul>${a.scope.limitations.length?`<h3>What this search cannot establish</h3><ul>${a.scope.limitations.map(limit=>`<li>${esc(limit)}</li>`).join('')}</ul>`:''}</details><div class="artifact-links">${(a.assets||[]).map(assetLink).join('')}</div></section>
 ${a.nearMatches?.length?`<section class="panel audit-near-matches"><div class="panel-head"><h2>Other saved models that do not fill these gaps</h2><span>${a.nearMatches.length} records</span></div><p class="fine muted">These remain useful historical evidence. Their construct, target or folding method differs from the requested comparison.</p><div class="table-scroll"><table><thead><tr><th>Candidate / target</th><th>Saved method / construct</th><th>Why it stays separate</th></tr></thead><tbody>${a.nearMatches.map(r=>`<tr><td>${esc(c.subjects.find(s=>s.id===r.candidateId)?readableSubject(c.subjects.find(s=>s.id===r.candidateId)):r.candidateId)}<small class="metric-scope">${esc(r.target)}</small></td><td>${esc(r.engine==='boltz2-fast'?'Boltz2 Fast':r.engine)}<small class="metric-scope">${esc(variantLabel(r.variant))}</small></td><td class="audit-reason">${esc(r.reason)}${r.evidence?.length?`<details class="audit-details"><summary>Source evidence</summary><pre>${esc(JSON.stringify(r.evidence,null,2))}</pre></details>`:''}</td></tr>`).join('')}</tbody></table></div></section>`:''}
 <section class="panel audit-matrix"><div class="panel-head"><h2>Coverage by candidate and construct</h2><span>Each box groups that candidate’s target isoforms</span></div><div class="table-scroll"><table><thead><tr><th>Candidate</th>${pairs.map(p=>`<th>${esc(variantLabel(p.variant))}<small>${esc(engineLabel(p.engine))}</small></th>`).join('')}</tr></thead><tbody>${knownSubjects.map(subject=>`<tr><th><button class="row-button" data-audit-candidate="${esc(subject.id)}">${esc(readableSubject(subject))}</button></th>${pairs.map(p=>`<td>${matrix(subject,p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
 <section class="panel"><div class="panel-head"><h2>Inspect individual combinations · ${rows.length}</h2></div><div class="audit-filters"><label>Candidate<select id="gap-candidate" class="input" aria-label="Candidate for cache audit">${[['all','All candidates'],...knownSubjects.map(s=>[s.id,readableSubject(s)])].map(([id,label])=>`<option value="${esc(id)}" ${id===gapCandidate?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label>Availability<select id="gap-state" class="input" aria-label="Cache availability">${[['unloaded','Not in the interface'],['all','All combinations'],...Object.entries(CACHE_STATES).map(([id,s])=>[id,s.label])].map(([id,label])=>`<option value="${esc(id)}" ${id===gapState?'selected':''}>${esc(label)}</option>`).join('')}</select></label></div><div class="table-scroll"><table><thead><tr><th>Candidate / construct</th><th>Target / method</th><th>Cache finding</th><th>Evidence and next step</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.candidateLabel)}<small class="metric-scope">${esc(variantLabel(r.variant))}</small></td><td>${esc(r.target)}<small class="metric-scope">${esc(engineLabel(r.engine))}</small></td><td>${cacheStateBadge(r.classification)}</td><td class="audit-reason"><p>${esc(r.reason)}</p>${r.nextStep?`<p class="fine muted">${esc(r.nextStep)}</p>`:''}${r.evidence?.length||r.matches?.length?`<details class="audit-details"><summary>Source evidence</summary><pre>${esc(JSON.stringify({evidence:r.evidence,matches:r.matches},null,2))}</pre></details>`:''}<button class="text-button" data-audit-inspect="${esc(r.candidateId)}" data-audit-target="${esc(r.target)}" data-audit-engine="${esc(r.engine)}" data-audit-variant="${esc(r.variant)}">Open this comparison →</button></td></tr>`).join('')||'<tr><td colspan="4">No combinations match these filters.</td></tr>'}</tbody></table></div></section>`;
}

function coverageNotice(c){
 const panels=c.subjects.filter(s=>s.modelCoverage).map(coverageSummary);if(!panels.length)return '';
 const recorded=panels.reduce((n,p)=>n+p.rows.filter(r=>r.modelId).length,0),expected=panels.reduce((n,p)=>n+p.expected,0);
 return `<div class="notice private"><span>◇</span><div><strong>${recorded} of ${expected} model combinations recorded</strong> across ${panels.length} candidates. Construct × isoform × folding method remain separate. ${expected-recorded} combinations are gaps in this cache, rather than negative scientific results. ${c.cacheAudit?'<button class="text-button" data-tab="gaps">See wider cache audit →</button>':''}</div></div>`;
}
function candidateRoster(c,selected){
  if(c.reviewScatter)return renderReviewScatter(c,{selected:focus,query:candidateFilter,origin:reviewScatterOrigin,x:reviewScatterX});
  const rows=c.subjects.filter(s=>`${readableSubject(s)} ${s.id} ${s.group||''}`.toLowerCase().includes(candidateFilter.toLowerCase()));
  return `<section class="panel candidate-roster"><div class="panel-head"><h2>All candidates <span class="count">${c.subjects.length}</span></h2><input id="subject-search" class="input" placeholder="Find a candidate…" aria-label="Filter subjects" value="${esc(candidateFilter)}"><select id="candidate-picker" class="input" aria-label="Jump to candidate">${c.subjects.map(s=>`<option value="${esc(s.id)}" ${s.id===focus?'selected':''}>${s.rank?`${s.rank}. `:''}${esc(readableSubject(s))}</option>`).join('')}</select></div><details class="roster-browser" ${matchMedia('(min-width:601px)').matches?'open':''}><summary>Browse all candidates</summary><div class="roster-grid">${rows.map(subject=>{const state=guidedStates[c.id]?.rows.find(r=>r.id===subject.id)?.status||'pending';return `<button class="roster-candidate ${subject.id===focus?'active':''}" data-focus="${esc(subject.id)}"><strong>${esc(readableSubject(subject))}</strong><small>${esc(originLabel(subject))}</small><span class="roster-review ${state}">${state==='complete'?'✓ Looks good':state==='follow_up'?'↗ Follow-up':state==='stale'?'↻ Review again':'○ Needs review'}${selected.includes(subject.id)?' · selected':''}</span></button>`;}).join('')||'<p>No matching candidates.</p>'}</div></details></section>`;
}
function selectivityOptions(subject,c,view='combined'){
  const key=c.id+'::'+subject.id,choice=subject.modelCoverage?panelChoice(subject,c).selection:{};
  return {view,engine:subject.modelCoverage?.expectedEngines.includes('boltz2-exact')?'boltz2-exact':choice.engine,variant:choice.variant,...selectivityStates.get(key),view};
}
function subjects(c,selected) {
  const subject=c.subjects.find(s=>s.id===focus)||(c.reviewScatter?c.subjects.find(s=>s.kind!=='planning record'):null)||c.subjects[0];if(subject)focus=subject.id;
  if(!subject)return '<p>No candidates available.</p>';
  if(candidateView==='monomer'&&!subject.monomerPlan&&!subject.monomerModels)candidateView='structure';
  const metricKeys=c.axes?[c.axes.x,c.axes.y]:[];
  return `<div class="section-heading"><div><h2>Candidates</h2></div><button class="button subtle" data-action="csv">↓ Export selection</button></div>${candidateRoster(c,selected)}<section class="candidate-workbench"><div class="panel-head workbench-heading"><h2>${esc(readableSubject(subject))}</h2><div class="model-buttons"><button class="button subtle" data-focus-step="-1" aria-label="Previous candidate">←</button><button class="button subtle" data-focus-step="1" aria-label="Next candidate">→</button></div></div><nav class="candidate-views" aria-label="Candidate inspection">${[['structure','Model & metrics'],...(subject.modelCoverage?[['selectivity','Isoform selectivity']]:[]),...((subject.monomerPlan||subject.monomerModels)?[['monomer','Binder alone']]:[]),...(subject.modelCoverage?[['coverage','Model coverage']]:[])].map(([id,label])=>`<button data-candidate-view="${id}" class="${candidateView===id?'active':''}">${label}</button>`).join('')}</nav>${renderCandidateReviewActions(subject,{reviewStatus:guidedStates[c.id]})}${candidateView==='structure'?`<section class="panel subject-detail">${subjectDetail(subject,c,selected,metricKeys)}</section>`:candidateView==='monomer'?`<section class="panel">${renderMonomerBrowser(subject,monomerSelections.get(c.id+'::'+subject.id)||{})}${moleculePanel(modelSubject(subject,c))}</section>`:candidateView==='selectivity'&&subject.modelCoverage?`<section class="panel">${renderSelectivity(subject,selectivityOptions(subject,c))}</section>`:candidateView==='provenance'?provenancePanel(subject):candidateView==='coverage'&&subject.modelCoverage?`${c.foldPlan?`<div class="review-actions"><button class="button primary" data-job-action="prepare-candidate" data-job-kind="fold" data-candidate-id="${esc(subject.id)}">Run missing models for this candidate</button><button class="button subtle" data-job-action="prepare-all" data-job-kind="fold">Run all missing models</button><button class="button subtle" data-tab="fold-plan">Full coverage map ↗</button></div>`:''}${coverageTable(subject)}`:''}</section>`;
}

function viewRecipe(c) {return c.viewRecipe?`<section class="view-recipe"><span class="recipe-icon">◈</span><div><h3>Saved molecular-view recipe</h3><p>${esc(c.viewRecipe.alignment)}<br>${esc(c.viewRecipe.colors)}<br>${esc(c.viewRecipe.numbering)}</p></div><span class="muted">Native coordinates remain the scoring source.</span></section>`:'';}

function evidenceCard(c,e) {
  const subject=e.subjectIds?.length===1?c.subjects.find(s=>s.id===e.subjectIds[0]):null;
  const labels={'frozen-selection':'The 20-candidate selection is intact','report-cache':'The saved report is available','scientific-review':'Your scientific review is still needed','eligibility':'Confirm eligibility before submission','d46-exception':'D46 fusion needs a specific decision'};
  const title=e.kind==='candidate_cache'&&subject?readableSubject(subject):labels[e.id]||e.source.title||e.label;
  const summaries={'frozen-selection':'The saved candidate order and exact sequences match the frozen selection.','report-cache':'The frozen report matches its saved record. Later cached reports are available separately.','scientific-review':'Inspect the structures, metric scope and final selection before recording your decision.','eligibility':'The cache preserves lineage information. Competition eligibility has not been independently confirmed.','d46-exception':'One mouse histidine estimate is missing, and the mouse acid-response score is negative. Inspect this candidate before including it.'};
  const summary=e.kind==='candidate_cache'?(e.note||'Its sequence, saved measurements and structure files match the cached selection.'):summaries[e.id]||e.note||'Source evidence is available for inspection.';
  return `<article class="panel evidence-card"><div class="panel-head">${badge(e.kind==='candidate_cache'?'Candidate files':e.kind==='cache_integrity'?'Selection files':pretty(e.kind),'neutral')}${badge(e.status==='verified'?'Files checked':e.status==='missing'?'Missing evidence':'Needs your review',e.status==='verified'?'approved':'blocked')}</div><h3>${esc(title)}</h3><p>${esc(summary)}</p>${subject?`<button class="text-button" data-evidence-subject="${esc(subject.id)}">Inspect this candidate →</button>`:''}${e.assets?`<div class="artifact-links">${e.assets.map(a=>assetLink({...a,label:a.kind==='report'?'Read the saved report':a.label})).join('')}</div>`:''}<details class="audit-details"><summary>Audit details</summary><p>${esc(e.note||'')}</p><div class="evidence-source"><span>SOURCE RECORD</span><div>${external(e.source.url,e.source.label)}</div></div></details><small>${c.requiredEvidence.includes(e.id)?'Part of the approval package':'Supporting evidence'}</small></article>`;
}
function evidence(c) {
  const global=c.evidence.filter(e=>e.kind!=='candidate_cache'),candidate=c.evidence.filter(e=>e.kind==='candidate_cache');
  return `<div class="section-heading"><div><h2>Evidence</h2></div></div><div class="evidence-grid">${global.map(e=>evidenceCard(c,e)).join('')}</div>${candidate.length?`<div class="section-heading evidence-section-heading"><div><h2>Candidate files · ${candidate.length} checked</h2><p>Sequences, model identities and saved measurements are linked for each candidate.</p></div></div><details class="candidate-evidence-group"><summary>Inspect individual candidate checks</summary><div class="evidence-grid">${candidate.map(e=>evidenceCard(c,e)).join('')}</div></details>`:''}${viewRecipe(c)}`;
}

function review(c,s,selected,issues) {
  return renderGuidedReview(c,{selected,reviewStatus:guidedStates[c.id],subjectReviews:workspace.subjectReviews?.[c.id]||{},issues,hardIssues:[...publicReadiness(c),...blockers(c,selected,{limitations:true}),...panelBlockers(c,selected,reviewContext(c))],status:s,decisions:workspace.decisions});
}

const provenanceCache=new Map();
const workflowStates=new Map();let workflowController=null;
function renderWorkflowPanel(graph,subject,version){
  if(version!==renderVersion)return;
  const host=$('#provenance-map'),campaign=workspace.campaigns.find(c=>c.id===current);if(!host||!campaign)return;
  if(!subject.workflowEvidence&&subject.molecularModels?.length)subject={...subject,workflowEvidence:{stages:{refold:{summary:'Retained refold inspection copies; display alignment is separate from the source scientific coordinates.',structures:subject.molecularModels.map(asset=>({id:'refold-'+asset.species.toLowerCase(),label:asset.species+' retained refold · display copy',status:'available',modelKind:'refold',asset,nodeIds:['fold-'+asset.species.toLowerCase()],description:'Cached inspection copy with source identity and display alignment retained; no refolding is performed.'}))}}}};
  const key=campaign.id+'::'+subject.id,state=workflowStates.get(key)||{stage:'inputs',node:null,structure:null,interacted:false};workflowStates.set(key,state);
  const startingView=workflowController?.captureView();workflowController?.dispose();workflowController=null;
  if(state.stage==='checks'&&subject.modelCoverage){if(!state.node)state.node='selectivity';if(/^confidence-brd/.test(state.node))state.node='isoform-confidence';if(/^affinity-brd/.test(state.node))state.node='isoform-affinity';}
  const stages=workflowStages(graph,subject),stage=stages.find(s=>s.id===state.stage)||stages[0];
  host.innerHTML=renderWorkflow(graph,subject,{activeStage:stage.id,activeNode:state.node});
  if(stage.id==='checks'&&subject.modelCoverage){
    const selector=host.querySelector('[data-workflow-record-selector="checks"]');
    if(selector){const other=stage.nodes.filter(n=>!/^confidence-brd|^affinity-brd/.test(n.id));const menu=[{id:'isoform-confidence',title:'Isoform interface confidence'},{id:'isoform-affinity',title:'Isoform predicted affinity'},...other];selector.innerHTML=menu.map(n=>`<option value="${esc(n.id)}" ${n.id===state.node?'selected':''}>${esc(n.title)}</option>`).join('');}
  }

  const selectedSection=host.querySelector('#workflow-selected-step'),structurePanel=document.createElement('section');structurePanel.id='workflow-structure';structurePanel.className='workflow-structure-panel';selectedSection.insertBefore(structurePanel,selectedSection.querySelector('.workflow-step-details'));
  const update=(stageId,nodeId=null,structureId=null)=>{state.stage=stageId;state.node=nodeId;state.structure=structureId;state.interacted=true;renderWorkflowPanel(graph,subject,version);$('#workflow-selected-step')?.scrollIntoView({block:'nearest',behavior:'smooth'});};
  host.querySelectorAll('[data-workflow-stage]').forEach(button=>button.onclick=()=>update(button.dataset.workflowStage));
  host.querySelectorAll('[data-workflow-node]').forEach(button=>button.onclick=()=>update(button.dataset.workflowNodeStage,button.dataset.workflowNode));
  host.querySelectorAll('[data-workflow-record-selector]').forEach(select=>select.onchange=()=>update(select.dataset.workflowRecordSelector,select.value));
  host.querySelectorAll('[data-workflow-structure]').forEach(button=>button.onclick=()=>{const selected=stages.find(s=>s.id===button.dataset.workflowStructureStage)?.structures.find(s=>s.id===button.dataset.workflowStructure);update(button.dataset.workflowStructureStage,selected?.nodeIds?.find(id=>graph.nodes.some(n=>n.id===id))||null,button.dataset.workflowStructure);});
  const available=stage.structures.filter(s=>s.status==='available');
  let structure=state.structure?available.find(s=>s.id===state.structure):state.node?available.find(s=>s.nodeIds?.includes(state.node)):available[0];
  if(!structure&&state.node&&stage.id==='checks'&&subject.modelCoverage){
    const target=state.node.match(/^(?:affinity|confidence)-(brd2|brd3|brd4|brdt)$/)?.[1]?.toUpperCase();
    const model=target&&subject.modelCoverage.models.find(m=>m.target===target&&m.constructVariant==='untagged'&&m.foldingEngine==='boltz2-exact');
    if(model&&(graph.audit?.sources||[]).some(s=>s.stepId===state.node&&s.reference?.includes(model.modelSha256)))structure={id:'step-'+state.node,label:target+' · exact native model for this assessment',asset:model.molecularModel,description:'This is the exact untagged Boltz2 Exact model referenced by this step. Other isoforms, constructs and folding methods are separate.'};
  }
  const panel=$('#workflow-structure');
  if(stage.id==='checks'&&subject.modelCoverage&&['selectivity','isoform-confidence','isoform-affinity'].includes(state.node)){
    const view=state.node==='isoform-confidence'?'confidence':state.node==='isoform-affinity'?'affinity':'combined';
    panel.innerHTML=renderSelectivity(subject,selectivityOptions(subject,campaign,view));host.querySelector('.workflow-step-details')?.remove();
    bindSelectivity(panel,subject,campaign,model=>update('refold',null,model.id),()=>renderWorkflowPanel(graph,subject,version));return;
  }
  if(stage.id==='review'){panel.innerHTML='<button class="button primary" id="workflow-final-review">Open final human review →</button>';$('#workflow-final-review').onclick=()=>{tab='review';render();};return;}
  if(!state.interacted){panel.innerHTML='<p class="fine muted">Select a workflow step or a structure above to open its 3D evidence.</p>';return;}
  if(!structure&&stage.id==='sequence'){panel.innerHTML='';return;}
  if(!structure){panel.innerHTML='<div class="notice demo"><span>◌</span><div>No verified structure is linked to this exact step. Its source records and missing evidence are shown below.</div></div>';return;}
  const asset=structure.asset,annotations=structure.annotations||[],measurements=structure.measurements||[],url=privateAssetURL(asset.url.replace(/^\.\/data\//,''));
  const comparisonModel=subject.modelCoverage?.models.find(m=>m.modelSha256===asset.sha256);
  const exactEngine=comparisonModel?.foldingEngine;
  if(state.structure&&!structure.nodeIds?.length){const detail=host.querySelector('.workflow-step-details');detail.innerHTML=`<h3>Selected source artifact</h3><p>${esc(structure.label)}</p><p class="fine muted">This artifact has its own construct, target and folding method. The primary Exact workflow step and its scores are not substituted for it.</p><details class="audit-details"><summary>Source identity</summary><pre>${esc(JSON.stringify(asset.source,null,2))}</pre></details>`;host.querySelectorAll('.workflow-node.active').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false');});}
  panel.innerHTML=`<div class="panel-head"><div><span class="eyebrow">${esc(stage.label.toUpperCase())} · STRUCTURE EVIDENCE</span><h3>${esc(structure.label)}</h3></div><button class="button subtle" id="workflow-reset-view">Reset stage view</button></div><p class="fine muted">${esc(structure.description||'Source-bound coordinates for this workflow step.')}</p>${comparisonModel?'<button class="button subtle" id="workflow-compare-models">Compare isoforms & constructs →</button>':''}${available.length>1&&available.some(s=>s.id===structure.id)?`<label class="panel-model-selector">Stage structure<select id="workflow-structure-picker" class="input" aria-label="Structure for this workflow stage">${available.map(s=>`<option value="${esc(s.id)}" ${s.id===structure.id?'selected':''}>${esc(s.label)}</option>`).join('')}</select></label>`:''}<div class="workflow-layer-controls">${annotations.map(layer=>`<label><input type="checkbox" data-workflow-layer="${esc(layer.id)}" checked><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="3" fill="${esc(layer.color)}"/></svg>${esc(layer.label)}</label>`).join('')}${measurements.length?'<label><input type="checkbox" id="workflow-distances" checked> Cached filter distances</label>':''}<label><input type="checkbox" id="workflow-sidechains"> All side chains</label>${renderViewerRepresentationControls('workflow',viewerOptions.representation)}${renderViewerColorControls('workflow',viewerOptions.colorMode)}</div>${measurements.length?`<label class="panel-model-selector">Saved interface measurement<select id="workflow-distance-picker" class="input" aria-label="Saved interface measurement">${measurements.map(m=>`<option value="${esc(m.id)}">Receptor ${esc(m.a.chain)}:${m.a.resi}:${esc(m.a.atom)} ↔ binder ${esc(m.b.chain)}:${m.b.resi}:${esc(m.b.atom)} · ${m.cachedDistanceAngstrom.toFixed(2)} Å</option>`).join('')}<option value="all">Show all ${measurements.length} saved pairs</option></select></label>`:''}<div id="workflow-molecule" class="molecule-container"></div><p id="workflow-molecule-status" class="viewer-status" role="status">Loading the exact stage structure…</p>${url?`<a class="text-button" href="${esc(url)}" download>Download this stage’s structure ↓</a>`:''}${measurements.length?'<p class="fine muted">These atom pairs come from saved filter evidence and reproduce its distances on the exact native model (within 0.03 Å). The browser’s optional nearest-contact display is separate.</p>':''}${structure.runtimeEvidence?`<details><summary>Recovered model-specific folding recipe</summary><p class="fine muted">${esc(structure.runtimeEvidence.status)}</p><p class="fine muted">Selected settings for this folding method. The original recipe also retains shared-run context.</p><dl>${Object.entries(foldingSettingsFor(structure.runtimeEvidence,exactEngine)).map(([key,value])=>`<dt>${esc(key.replaceAll('_',' '))}</dt><dd>${esc(typeof value==='object'?JSON.stringify(value):value)}</dd>`).join('')}</dl>${(structure.runtimeEvidence.sources||[]).filter(source=>source.assetPath&&privateAssetURL(source.assetPath)).map(source=>`<a class="text-button" href="${esc(privateAssetURL(source.assetPath))}" target="_blank" rel="noopener noreferrer">${esc(source.label||'Original folding recipe')} ↗</a>`).join('')}<details class="audit-details"><summary>Recipe and execution source records</summary><pre>${esc(JSON.stringify(structure.runtimeEvidence.sources,null,2))}</pre></details></details>`:''}`;
  try{
    let controller;controller=mountMolecule($('#workflow-molecule'),{id:subject.id,label:structure.label,molecularModels:[asset]},{palette:standardFor(campaign).palette,campaignId:campaign.id,viewDefaults:workspace.molecularViewDefaults?.[campaign.id]||{},viewPresets:campaign.molecularViewPresets||{},startingView,annotations,measurements,onStatus:message=>{if(version===renderVersion&&workflowController===controller&&$('#workflow-molecule-status'))$('#workflow-molecule-status').textContent=message;}});
    workflowController=controller;
    controller.ready.then(()=>{if(version===renderVersion&&workflowController===controller){controller.setRepresentation(viewerOptions.representation);controller.setColorMode(viewerOptions.colorMode);bindViewerColors('workflow',controller,{shared:true});bindViewerRepresentation('workflow',controller);}}).catch(error=>{if(version===renderVersion&&$('#workflow-molecule-status'))$('#workflow-molecule-status').textContent=error.message;});
    $('#workflow-reset-view').onclick=()=>controller.reset();
    const compare=$('#workflow-compare-models');if(compare)compare.onclick=()=>{setWorkspaceEntry('modelSelections',campaign.id,subject.id,{variant:comparisonModel.constructVariant,target:comparisonModel.target,engine:comparisonModel.foldingEngine});modelBrowserStates.set(campaign.id+'::'+subject.id,{mode:'overlay',variants:[comparisonModel.constructVariant]});pendingPanelView={campaignId:campaign.id,subjectId:subject.id,camera:controller.captureView()};focus=subject.id;tab='subjects';candidateView='structure';viewerEnabled=true;render().then(()=>document.querySelector('.candidate-workbench')?.scrollIntoView({block:'start'}));};
    const picker=$('#workflow-structure-picker');if(picker)picker.onchange=()=>{const selected=available.find(s=>s.id===picker.value);update(stage.id,selected.nodeIds?.find(id=>graph.nodes.some(n=>n.id===id))||null,selected.id);};
    host.querySelectorAll('[data-workflow-layer]').forEach(input=>input.onchange=()=>{try{controller.setAnnotationVisible(input.dataset.workflowLayer,input.checked);}catch(error){notify(error.message);}});
    const distances=$('#workflow-distances');if(distances)distances.onchange=()=>controller.setStageDistances(distances.checked);
    const distancePicker=$('#workflow-distance-picker');if(distancePicker)distancePicker.onchange=()=>controller.setStageDistance(distancePicker.value);
    $('#workflow-sidechains').onchange=e=>controller.setSideChains(e.target.checked);
  }catch(error){$('#workflow-molecule-status').textContent=error.message;}
}
const provenanceURL=recordedWorkflowURL;
function provenancePanel(subject) {
  const ref=subject.provenance;
  return `<section class="panel provenance-panel"><div class="panel-head"><div><h2>How ${esc(readableSubject(subject))} got here</h2><p class="fine muted">Choose a step to inspect its records, structure and annotations. Missing history stays explicit.</p></div>${ref?`<div class="provenance-downloads">${[['markdownPath','Markdown'],['mermaidPath','Mermaid']].map(([key,label])=>{const url=provenanceURL(ref[key]);return url?`<a class="button subtle" href="${esc(url)}" download>↓ ${label}</a>`:'';}).join('')}</div>`:badge('Missing history','blocked')}</div><div id="provenance-map">${ref?'Loading the recorded workflow…':'No source-backed history is attached to this entry yet. The design, folding and selection history still need to be reconstructed.'}</div></section>`;
}
async function loadProvenance(subject,version) {
  const ref=subject.provenance,url=provenanceURL(ref?.graphPath),host=$('#provenance-map');if(!url||!host)return;
  try{
    const key=url+'#'+(ref.graphSha256||'');let graph=provenanceCache.get(key);
    if(!graph){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('The attached provenance file is unavailable.');const bytes=await r.arrayBuffer();if(bytes.byteLength>2*1024*1024)throw new Error('Provenance graph exceeds the review limit.');if(ref.graphSha256){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==ref.graphSha256)throw new Error('The provenance file changed. Recompile a new snapshot before review.');}graph=JSON.parse(new TextDecoder().decode(bytes));provenanceCache.set(key,graph);}
    if(graph.candidateId!==subject.id)throw new Error('The provenance file names a different candidate.');
    if(version===renderVersion&&$('#provenance-map'))renderWorkflowPanel(graph,subject,version);
  }catch(error){if(version===renderVersion&&$('#provenance-map'))$('#provenance-map').textContent=error.message;}
}

function coverageTable(subject) {
  const v=coverageSummary(subject);
  return `<section class="panel coverage-panel"><div class="panel-head"><h2>Model coverage · ${esc(subject.label)}</h2>${badge(`${v.complete} / ${v.expected} verified cells`,v.complete===v.expected?'approved':'blocked')}</div><p class="muted fine">Design origin: ${esc(originLabel(subject))}. Folding engines and construct variants are recorded separately. Each row identifies the selected native model; presence alone does not establish scientific validity.</p><div class="table-scroll"><table><thead><tr><th>Target</th><th>Folding engine</th><th>Construct</th><th>Coverage</th><th>Native rank / samples</th><th>Selected model</th></tr></thead><tbody>${v.rows.map(r=>`<tr><td>${esc(r.target)}</td><td>${esc(r.engine)}</td><td>${esc(r.variant)}</td><td>${badge(pretty(r.status),r.status==='verified'?'approved':'blocked')}</td><td>${r.nativeRank??'Unknown'} / ${r.sampleCount??'unknown'}</td><td><button class="text-button" data-coverage-target="${esc(r.target)}" data-coverage-engine="${esc(r.engine)}" data-coverage-variant="${esc(r.variant)}">${r.modelId?'Inspect model →':'Inspect gap →'}</button>${!r.modelId&&!workspace.campaigns.find(c=>c.id===current)?.selectionDraft?renderFoldRequestButton(workspace.campaigns.find(c=>c.id===current),subject.id,{target:r.target,engine:r.engine,variant:r.variant}):''}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function standardFor(c) {
  const saved=workspace.viewPreferences?.[c.id];
  if(saved) return saved;
  const presetId=c.molecularColorStandard?.presetId||(/KRAS|pMHC/i.test(c.target)?'pmhc':/EGFR/i.test(c.target)?'egfr':/TNF/i.test(c.target)?'tnf':/GLP/i.test(c.target)?'glp1r':/BRD|BETII/i.test(c.target)?'betii':'neutral');
  const subject=c.subjects.find(s=>s.id===focus)||c.subjects[0];
  const roles=subject?.modelCoverage?panelChoice(subject,c).resolved.asset?.roles:null;
  const bindings=c.molecularColorStandard?.bindings||(roles?{receptor:`chain ${roles.receptor}`,binder:`chain ${roles.binder}`}:(subject?.modelCoverage?{}:subject?.viewBindings||{}));
  return {presetId,palette:paletteFor(presetId),bindings,subjectId:subject?.id||'',savedAt:null};
}

function colorStandards(c) {
  const view=standardFor(c),preset=COLOR_PRESETS[view.presetId],subject=c.subjects.find(s=>s.id===view.subjectId);
  const availablePresets=Object.entries(COLOR_PRESETS).filter(([id])=>!/KRAS|pMHC/i.test(c.target)||['pmhc','neutral',view.presetId].includes(id));
  const names=['lightorange','skyblue','cyan','magenta','gray','hotpink','green','orange','purple','blue','red','yellow','tv_orange'];
  return `<div class="section-heading"><div><h2>One visual language for this campaign</h2><p>Assign colors to molecule roles. Preserve the documented project palette and atom-color priority.</p></div><button class="button subtle" data-action="palette-export">↓ Export PyMOL recipe</button></div><section class="notice private"><span>◈</span><div>Cached structure pictures retain their original rendering. These controls save a proposed view standard and export a display recipe for PyMOL; the selected native structures keep their recorded coordinates.</div></section><form id="color-form" class="panel color-form"><div class="color-toolbar"><label>Project standard<select id="color-preset" name="presetId" class="input">${Object.entries(COLOR_PRESETS).map(([id,p])=>`<option value="${id}" ${id===view.presetId?'selected':''}>${esc(p.label)}</option>`).join('')}</select></label><label>Bind to a review subject<select id="color-subject" class="input" name="subjectId">${c.subjects.map(s=>`<option value="${esc(s.id)}" ${s.id===view.subjectId?'selected':''}>${esc(s.label)}</option>`).join('')}</select></label></div><p class="fine muted">Role bindings come from source metadata when available. Empty bindings stay empty. Hex swatches preserve recorded RGB values; exported named colors use their exact PyMOL names. A saved change makes an existing package review out of date.</p><div class="color-roles">${preset.roles.map(role=>`<div class="color-role"><svg width="25" height="25" aria-hidden="true"><rect width="25" height="25" rx="7" fill="${esc(swatchFor(view.palette[role.id])||'#888888')}"></rect></svg><div class="color-role-label"><strong>${esc(role.label)}</strong><small>${role.scope==='cartoon'?'Cartoon · independent of atoms':'Atom annotation · element colors preserved'}</small></div><label><span class="sr-only">Color for ${esc(role.label)}</span><select class="input" name="color:${role.id}">${[...new Set([...names,view.palette[role.id]])].map(name=>`<option value="${esc(name)}" ${name===view.palette[role.id]?'selected':''}>${esc(name)}</option>`).join('')}</select></label><label class="binding-label"><span class="sr-only">Molecule selection for ${esc(role.label)}</span><input class="input mono" name="binding:${role.id}" value="${esc(view.bindings[role.id]||'')}" placeholder="Explicit object / chain selection" maxlength="500"></label></div>`).join('')}</div><div class="color-actions"><button class="button primary" type="submit">Save view standard</button><button class="button subtle" type="button" data-action="palette-reset">Restore documented palette</button><span class="muted fine">${view.savedAt?`Saved ${esc(view.savedAt)}`:'Using project defaults'}</span></div></form>${view.presetId==='betii'?'<section class="panel"><h2>Recorded BETII rendering convention</h2><p class="fine muted">ET target: blue gray (#7594AB). Binder: orange (#F07A21). Hotspots: pink (#FF69B4), mapped onto the ET target in every bound structure. These RGB values come from the saved final-report rendering code and atlas manifest. Mesh color (#D1D9DE) belongs to the source rendering and is not added by the browser viewer.</p></section>':''}${subject?`<section class="panel original-view"><h2>Original cached view · ${esc(subject.label)}</h2>${previewAssets(subject)}</section>`:''}`;
}

function jobsPage(c){
  const connected=runnerRuntime?.fleet||runnerRuntime?.capabilities||runnerRuntime;
  return `<div class="section-heading"><div><h2>Jobs & design</h2><p>Fill an evidence gap, request follow-up, or prepare a new design sweep.</p></div><button class="button subtle" data-refresh-runtime>Refresh runner connection</button></div><section class="panel runner-summary"><strong>${runnerRuntime?.connected?'Fleet / research-workflows bridge connected':'Connecting to Fleet / research-workflows'}</strong><p class="fine muted">${esc(runnerRuntime?.connected?'Named local checks run from a preview with your confirmation. Folding and design need validated native adapters; paid scoring also needs a current quote.': 'Connect the local Fleet bridge to save durable requests.')}</p>${runnerRuntime?'<details class="audit-details"><summary>Runner capabilities</summary><pre>'+esc(JSON.stringify(connected,null,2))+'</pre></details>':''}</section>${jobComposer?renderRequestComposer(c,jobComposer):''}${renderJobQueue(c,workspace.jobRequests||[],runnerJobs)}`;
}
function newRequestRun(c,kind){const prefix=date()+'_'+c.id.replace(/[^A-Za-z0-9_-]/g,'-')+'_'+kind+'-request_';const used=new Set((workspace.jobRequests||[]).map(r=>r.runId));let n=1;while(used.has(prefix+String(n).padStart(3,'0')))n++;return prefix+String(n).padStart(3,'0');}
function openJobComposer(c,options){if(c.selectionDraft){notify('This shortlist is for review only. Submitted runs keep their original inputs.');return;}jobComposer={priority:'high',...options};tab='jobs';render().then(()=>document.querySelector('.job-composer')?.scrollIntoView({block:'start',behavior:'smooth'}));}
async function runtimeInfo(){
  try{const response=await fetch('./api/runtime',{cache:'no-store'});if(!response.ok)return null;const info=await response.json();return info;}
  catch{return null;}
}
const refoldEnabled=c=>false;
function refoldRegistrySection(c){return refoldEnabled(c)?`<div id="refold-registry-host">${renderRefoldRegistry(c,mode==='cache'?refoldRegistries.get(c.id):{unavailable:true,message:'Automatic model requests are available in the connected private campaign.'})}</div>`:'';}
function bindRefoldActions(c,host=document){const button=host.querySelector('[data-refold-refresh]');if(button)button.onclick=()=>loadRefolds(c,true);const retry=host.querySelector('[data-refold-retry]');if(retry)retry.onclick=async()=>{retry.disabled=true;try{await registerRefolds(c,retry.dataset.refoldRetry,'consider');}catch(error){notify(error.message);}};}
function refreshRefoldSection(c){const host=$('#refold-registry-host');if(current===c.id&&host){host.innerHTML=renderRefoldRegistry(c,refoldRegistries.get(c.id));bindRefoldActions(c,host);}}
async function loadRefolds(c,force=false){
  if(mode!=='cache'||refoldLoads.has(c.id)||!refoldEnabled(c))return;
  if(!force&&refoldRegistries.has(c.id))return;
  refoldLoads.add(c.id);refoldRegistries.set(c.id,{loading:true});refreshRefoldSection(c);
  try{const response=await fetch('./api/refolds?campaign='+encodeURIComponent(c.id),{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.reason||'The model request registry is unavailable.');refoldRegistries.set(c.id,data);}
  catch(error){refoldRegistries.set(c.id,{error:error.message});}
  finally{refoldLoads.delete(c.id);refreshRefoldSection(c);}
}
async function registerRefolds(c,candidateId,action){
  try{
    runnerRuntime=await runtimeInfo()||runnerRuntime;
    if(!runnerRuntime?.csrfToken)throw new Error('Reconnect the local service to submit its missing models.');
    const response=await fetch('./api/refolds/register',{method:'POST',headers:{'Content-Type':'application/json','X-Campaign-CSRF':runnerRuntime.csrfToken},body:JSON.stringify({campaignId:c.id,candidateId,action})});
    const result=await response.json();if(!response.ok)throw new Error(result.reason||'The model request could not be registered.');
    refoldRegistries.set(c.id,result.registry);refreshRefoldSection(c);notify(result.message);
  }catch(error){refoldRegistries.set(c.id,{error:'Shortlist saved; model request needs attention. '+error.message,...(action==='consider'?{retryCandidateId:candidateId}: {})});refreshRefoldSection(c);throw new Error('Shortlist saved; model request needs attention. '+error.message);}
}
async function runnerPost(request,action,body){
 if(!runnerRuntime?.csrfToken||!request)throw new Error('Reconnect the local runner first.');
 const response=await fetch('./api/jobs/'+encodeURIComponent(request.requestDigest)+'/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Campaign-CSRF':runnerRuntime.csrfToken},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(result.message||result.reason||result.error||'The runner could not complete this request.');return result;
}
async function refreshRunnerJobs(){const response=await fetch('./api/jobs',{cache:'no-store'});if(!response.ok)throw new Error('The job queue is unavailable.');runnerJobs=(await response.json()).jobs||[];}
async function saveJobRequest(c,options){
  if(c.selectionDraft)throw new Error('This shortlist is for review only. Existing submitted runs retain their original inputs.');
  options={projectId:c.id,runId:newRequestRun(c,options.kind),runnerId:null,...options,existingRequests:workspace.jobRequests||[]};
  const identity=workspaceTransfer.current.identity;
  const request=await prepareJobRequest(c,options);
  const changed='The open workspace changed. Prepare the request again in the intended workspace.';
  if(identity!==workspaceTransfer.current.identity)throw new Error(changed);
  const next=upsertJobRequest(workspace,request);
  if(!editWorkspace(()=>next))throw new Error(changed);
  if(runnerRuntime){
    try{
      const headers={'Content-Type':'application/json'};if(runnerRuntime.csrfToken)headers['X-Campaign-CSRF']=runnerRuntime.csrfToken;
      const response=await fetch('./api/jobs',{method:'POST',headers,body:JSON.stringify({request})});const result=await response.json();
      if(!response.ok)throw new Error(result.error||result.message||'Fleet queue rejected the request.');
      if(result.job)runnerJobs=[...runnerJobs.filter(j=>j.requestDigest!==result.job.requestDigest),result.job];notify('Request saved to the Fleet handoff queue. No compute has started.');
    }catch(error){notify('Saved in this browser; Fleet handoff needs attention: '+error.message);}
  }else notify('Request saved locally; runner connection is unavailable.');
  return request;
}
function bindSelectivity(host,subject,c,onModel=null,onRerender=null){
  const key=c.id+'::'+subject.id;
  host.querySelectorAll('[data-selectivity-control]').forEach(control=>control.onchange=()=>{selectivityStates.set(key,{...(selectivityStates.get(key)||{}),[control.dataset.selectivityControl]:control.value});onRerender?onRerender():render();});
  host.querySelectorAll('[data-selectivity-model]').forEach(button=>{const choose=()=>{const model=subject.modelCoverage.models.find(m=>m.id===button.dataset.selectivityModel);if(!model)return;if(onModel)return onModel(model);setWorkspaceEntry('modelSelections',c.id,subject.id,{target:model.target,engine:model.foldingEngine,variant:model.constructVariant});focus=subject.id;candidateView='structure';viewerEnabled=true;render();};button.onclick=choose;button.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};});
  host.querySelectorAll('[data-selectivity-request]').forEach(button=>button.onclick=()=>{
    const d=button.dataset,kind=d.selectivityOperation==='fold'?'fold':d.selectivityMetric==='Kd_nM'&&d.selectivityOperation==='score-evidence'?'affinity':'evidence';
    openJobComposer(c,{kind,candidateId:subject.id,selection:{target:d.selectivityTarget,engine:d.selectivityEngine,variant:d.selectivityVariant},followupQuestion:kind==='evidence'?`Recover or validate ${d.selectivityMetric} for ${readableSubject(subject)} · ${d.selectivityTarget} · ${d.selectivityEngine} · ${d.selectivityVariant}`:null});
  });
}

function bind(c) {
  document.querySelectorAll('[data-export-preserved-reviews]').forEach(button=>button.onclick=async()=>{try{download(await reviewRecovery.export(),`${date()}_preserved-browser-reviews.json`);}catch(error){notify(error.message);}});
  document.querySelectorAll('[data-design-from-input]').forEach(button=>button.onclick=()=>{const selected=inputSelection(c,inputViews.get(c.id)?.id),target=hotspotTargets(c).find(t=>t.asset.sha256===selected?.view?.asset?.sha256&&t.asset.url===selected?.view?.asset?.url);if(target)pendingHotspotTargets.set(c.id,target.id);tab='hotspot-design';render();});
  const libraryUpdate=patch=>{const active=document.activeElement,attribute=['data-library-scope','data-library-candidate','data-library-variant'].find(a=>active?.hasAttribute(a)),value=attribute?active.getAttribute(attribute):null;libraryStates.set(c.id,{...(libraryStates.get(c.id)||{}),...patch});render().then(()=>{if(attribute)document.querySelector(`[${attribute}${value?'="'+CSS.escape(value)+'"':''}]`)?.focus({preventScroll:true});});};
  const libraryScope=$('select[data-library-scope]');if(libraryScope)libraryScope.onchange=()=>libraryUpdate({scope:libraryScope.value,candidateId:null});
  const libraryCandidate=$('select[data-library-candidate]');if(libraryCandidate)libraryCandidate.onchange=()=>libraryUpdate({candidateId:libraryCandidate.value});
  document.querySelectorAll('button[data-library-variant]:not([data-library-model])').forEach(button=>button.onclick=()=>libraryUpdate({variant:button.dataset.libraryVariant}));
  document.querySelectorAll('button[data-library-model]').forEach(button=>button.onclick=()=>{
    const library=modelLibrary(c,{...libraryStates.get(c.id),selectedIds:selection(c)}),cell=library.rows.flatMap(row=>row.cells).find(cell=>cell.status==='available'&&cell.model.id===button.dataset.libraryModel);
    if(!cell)return;
    if(cell.kind==='monomer'){
      monomerFocus.set(c.id,cell.candidateId);monomerSelections.set(c.id+'::'+cell.candidateId,{engine:cell.engine,variant:cell.variant});pendingPanelView=null;tab='monomers';
    }else{
      setWorkspaceEntry('modelSelections',c.id,cell.candidateId,{engine:cell.engine,variant:cell.variant,target:cell.target});
      modelBrowserStates.set(c.id+'::'+cell.candidateId,{mode:'single',variants:[cell.variant],targets:[cell.target]});
      explorerStates.set(c.id,{...(explorerStates.get(c.id)||{}),origin:'all',selectedCandidateId:cell.candidateId,startingView:null});tab='explorer';
    }
    viewerEnabled=true;render().then(()=>document.querySelector('#candidate-explorer-molecule, #molecule-container')?.scrollIntoView({block:'center',behavior:'smooth'}));
  });
  const affinityUpdate=patch=>{const active=document.activeElement,select=active?.dataset.affinitySelect,filter=active?.dataset.affinityFilter;affinityStates.set(c.id,{...(affinityStates.get(c.id)||{}),...patch});render().then(()=>{[...document.querySelectorAll('[data-affinity-select],[data-affinity-filter]')].find(el=>select?el.dataset.affinitySelect===select:filter&&el.dataset.affinityFilter===filter)?.focus({preventScroll:true});});};
  document.querySelectorAll('[data-affinity-filter]').forEach(control=>control.onchange=()=>affinityUpdate({[control.dataset.affinityFilter]:control.value,selectedIds:[],page:0}));
  document.querySelectorAll('[data-affinity-select]').forEach(control=>control.onchange=()=>{const ids=new Set(affinityStates.get(c.id)?.selectedIds||[]);if(control.checked)ids.add(control.dataset.affinitySelect);else ids.delete(control.dataset.affinitySelect);affinityUpdate({selectedIds:[...ids]});});
  document.querySelectorAll('[data-affinity-page]').forEach(control=>control.onclick=()=>affinityUpdate({page:Number(control.dataset.affinityPage)}));
  const affinityExport=$('[data-affinity-export]');if(affinityExport)affinityExport.onclick=()=>{try{const state=affinityStates.get(c.id)||{};download(affinitySelection(c,state,state.selectedIds),`${date()}_affinity-selection.json`);}catch(error){notify(error.message);}};
  document.querySelectorAll('[data-affinity-request]').forEach(control=>control.onclick=()=>{try{const state=affinityStates.get(c.id)||{},operation=control.dataset.affinityRequest;download(affinityRequest(c,operation,state,state.selectedIds),`${date()}_${operation==='pcann-predict-v1'?'pcann':'deltaforge'}-request.json`);}catch(error){notify(error.message);}});
  const refreshScores=$('#review-refresh-scores');if(refreshScores)refreshScores.onclick=()=>refreshConnectedResults(refreshScores);
  const rx=$('#review-scatter-x'),ro=$('#review-scatter-origin');
  if(rx)rx.onchange=()=>{reviewScatterX=rx.value;render();};
  if(ro)ro.onchange=()=>{reviewScatterOrigin=ro.value;render();};
  const rf=$('#review-refold-form');if(rf)rf.onsubmit=async event=>{
    event.preventDefault();const status=$('#review-refold-status'),button=rf.querySelector('button[type=submit]');button.disabled=true;
    try{if(!runnerRuntime?.csrfToken)throw new Error('Reconnect the local session before saving.');
      const values=Object.fromEntries(new FormData(rf));
      const response=await fetch('./api/review-refold-requests',{method:'POST',headers:{'Content-Type':'application/json','X-Campaign-CSRF':runnerRuntime.csrfToken},body:JSON.stringify({campaignId:c.id,candidateId:rf.dataset.candidateId,...values})});
      const result=await response.json();if(!response.ok)throw new Error(result.reason||result.error);
      status.textContent=`${result.created?'Saved':'Existing request reused'}: ${result.request.id}. Awaiting native adapter review; no job launched.`;
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  }
  const explorerUpdate=patch=>{explorerStates.set(c.id,{...(explorerStates.get(c.id)||{}),...patch});render();};
  document.querySelectorAll('[data-explorer-point],[data-explorer-inspect]').forEach(point=>{const choose=()=>explorerUpdate({selectedCandidateId:point.dataset.explorerPoint||point.dataset.explorerInspect});point.onclick=choose;point.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}};});
  const color=$('[data-explorer-color]');if(color)color.onchange=()=>explorerUpdate({colorBy:color.value});
  bindRefoldActions(c);
  const comparison=$('[data-explorer-comparison]');if(comparison)comparison.onchange=()=>{
    const data=candidateExplorerData(c,{...(explorerStates.get(c.id)||{}),plotPreset:comparison.value,target:null,engine:null,variant:null}),row=data.candidates.find(r=>r.id===explorerStates.get(c.id)?.selectedCandidateId)||data.candidates[0];
    if(row?.model){setWorkspaceEntry('modelSelections',c.id,row.id,{engine:data.engine,target:data.target,variant:data.variant});modelBrowserStates.set(c.id+'::'+row.id,{mode:'single'});}
    explorerUpdate({plotPreset:comparison.value,target:null,engine:null,variant:null,xAxis:null,yAxis:null,startingView:null});
  };
  const origin=$('[data-explorer-origin]');if(origin)origin.onchange=()=>explorerUpdate({origin:origin.value,selectedCandidateId:null});
  const explorerCandidate=$('[data-explorer-candidate]');if(explorerCandidate)explorerCandidate.onchange=()=>explorerUpdate({selectedCandidateId:explorerCandidate.value});
  document.querySelectorAll('[data-explorer-axis]').forEach(input=>input.onchange=()=>explorerUpdate({[input.dataset.explorerAxis==='x'?'xAxis':'yAxis']:input.value}));
  const calibration=$('[data-explorer-calibration]');if(calibration)calibration.onchange=()=>explorerUpdate({calibrationId:calibration.value});
  document.querySelectorAll('[data-explorer-shortlist]').forEach(button=>button.onclick=async()=>{try{
    const candidateId=button.dataset.explorerCandidateId,action=button.dataset.explorerShortlist;
    const identity=workspaceTransfer.current.identity;
    const draft=editSelectionDraft(c,workspace.selectionDrafts?.[c.id],{candidateId,action});
    const saving=editWorkspace(target=>{target.selectionDrafts||={};target.selectionDrafts[c.id]=draft;});
    if(!saving)return;
    await saving;await render();
    if(identity!==workspaceTransfer.current.identity)return;
    if(refoldEnabled(c)&&mode==='cache')await registerRefolds(c,candidateId,action);
    else notify(action==='remove'?'Removed from shortlist.':'Added to shortlist. Final review is still required.');
  }catch(error){notify(error.message);}});
  const explorerReset=$('[data-explorer-reset]');if(explorerReset)explorerReset.onclick=()=>explorerController?.reset();
  const explorerFit=$('[data-explorer-fit]');if(explorerFit)explorerFit.onclick=()=>explorerController?.fitVisible();
  document.querySelectorAll('[data-toggle-advanced]').forEach(button=>button.onclick=()=>{advanced=!advanced;document.body.dataset.advanced=String(advanced);button.textContent=advanced?'Close advanced settings':'Advanced settings';});
  document.querySelectorAll('[data-candidate-view]').forEach(button=>button.onclick=()=>{candidateView=button.dataset.candidateView;render();});
  document.querySelectorAll('[data-guided-open]').forEach(button=>button.onclick=()=>{focus=button.dataset.guidedOpen;candidateView=button.dataset.guidedStep==='selectivity'&&!c.subjects.find(s=>s.id===focus)?.modelCoverage?'structure':button.dataset.guidedStep;tab='subjects';viewerEnabled=true;render().then(()=>document.querySelector('.candidate-workbench')?.scrollIntoView({block:'start',behavior:'smooth'}));});
  async function recordCandidateReview(id,outcome,note){
    if(await recordReview(c.id,campaign=>candidateReviewContext(campaign,id),(campaign,context)=>makeCandidateReview(campaign,id,{outcome,note,modelSelection:context.modelSelection}),(target,receipt)=>{
      target.candidateReviews||={};
      (target.candidateReviews[c.id]||={})[id]=receipt;
    },note)){
      await render();
      notify(outcome==='looks_good'?'Candidate marked Looks good for this exact evidence and model context.':'Follow-up note saved for this draft; no job was requested.');
    }
  }
  const candidateNote=id=>document.querySelector(`[data-review-candidate-note="${CSS.escape(id)}"]`)?.value||'';
  document.querySelectorAll('[data-review-good]').forEach(button=>button.onclick=async()=>{
    const id=button.dataset.reviewGood;
    try{
      if(button.getAttribute('aria-pressed')==='true'){
        editWorkspace(target=>{delete target.candidateReviews?.[c.id]?.[id];});
        await render();notify('Looks good cleared. You can review this design again.');return;
      }
      await recordCandidateReview(id,'looks_good',candidateNote(id));
    }catch(error){notify(error.message);}
  });
  document.querySelectorAll('[data-review-followup]').forEach(button=>button.onclick=async()=>{
    const id=button.dataset.reviewFollowup,note=candidateNote(id);
    if(c.selectionDraft){
      try{await recordCandidateReview(id,'follow_up',note);}catch(error){notify(error.message);}
      return;
    }
    openJobComposer(c,{kind:'evidence',candidateId:id,followupCandidateId:id,followupQuestion:note||`Follow up ${readableSubject(c.subjects.find(s=>s.id===id))}: `,priority:'high'});
  });
  document.querySelectorAll('[data-review-clear]').forEach(button=>button.onclick=async()=>{
    if(editingProtected())return;
    editWorkspace(target=>{delete target.candidateReviews?.[c.id]?.[button.dataset.reviewClear];});
    await render();notify('Review cleared.');
  });
  document.querySelectorAll('[data-approve-check]').forEach(b=>b.onclick=()=>{notify('Review every design and resolve required model gaps before confirming the package.');document.querySelector('.guided-shortlist [data-review-good][aria-pressed="false"]')?.focus();});
  document.querySelectorAll('[data-request-evidence]').forEach(button=>button.onclick=()=>openJobComposer(c,{kind:'evidence',priority:'high',followupQuestion:JSON.parse(button.dataset.evidenceIssues||'[]').join('\n')}));
  document.querySelectorAll('[data-refresh-runtime]').forEach(button=>button.onclick=async()=>{runnerRuntime=await runtimeInfo();render();});
  document.querySelectorAll('[data-openfold-filter]').forEach(control=>control.onchange=()=>{openFoldSelections.set(c.id,{candidateId:control.value});render();});
  document.querySelectorAll('[data-openfold-select]').forEach(button=>button.onclick=()=>{openFoldSelections.set(c.id,{...(openFoldSelections.get(c.id)||{}),comparisonId:button.dataset.openfoldSelect});render();});
  document.querySelectorAll('.job-card[data-job-request-id]').forEach(card=>{const request=workspace.jobRequests?.find(r=>r.id===card.dataset.jobRequestId);if(request)card.insertAdjacentHTML('beforeend',renderJobLaunch(request,jobPreviews.get(request.id),runnerJobs.find(j=>j.requestDigest===request.requestDigest),jobReports.get(request.id),c));});
  document.querySelectorAll('[data-job-action]').forEach(button=>button.onclick=async()=>{
    const d=button.dataset;
    if(d.jobAction==='close-composer'){jobComposer=null;render();return;}
    if(d.jobAction==='export'){const request=workspace.jobRequests?.find(r=>r.id===d.jobRequestId);if(request)download(request,request.id+'.json');return;}
    if(d.jobAction==='retain'){try{const request=workspace.jobRequests.find(r=>r.id===d.jobRequestId);if(!runnerRuntime?.csrfToken)throw new Error('Reconnect the local runner first.');const response=await fetch('./api/jobs',{method:'POST',headers:{'Content-Type':'application/json','X-Campaign-CSRF':runnerRuntime.csrfToken},body:JSON.stringify({request})});const result=await response.json();if(!response.ok)throw new Error(result.reason||result.error||'The saved draft needs attention.');await refreshRunnerJobs();await render();notify('Request saved by the local runner. Nothing has launched.');}catch(error){notify(friendlyJobMessage(error.message));}return;}
    if(d.jobAction==='dismiss-preview'){jobPreviews.delete(d.jobRequestId);render();return;}
    if(d.jobAction==='report'){try{const request=workspace.jobRequests.find(r=>r.id===d.jobRequestId);const response=await fetch('./api/jobs/'+encodeURIComponent(request.requestDigest)+'/report',{headers:{'X-Campaign-CSRF':runnerRuntime.csrfToken},cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.message||result.error||'The saved report is unavailable.');jobReports.set(request.id,result);render();}catch(error){notify(friendlyJobMessage(error.message));}return;}
    if(d.jobAction==='readiness'){try{const request=workspace.jobRequests?.find(r=>r.id===d.jobRequestId);jobPreviews.set(request.id,await runnerPost(request,'preview',{}));await render();document.querySelector('[data-launch-job]')?.scrollIntoView({block:'center',behavior:'smooth'});notify('Preview checked. Review the exact operation before launch.');}catch(error){notify(friendlyJobMessage(error.message));}return;}
    if(d.jobAction==='inspect'){const request=workspace.jobRequests?.find(r=>r.id===d.jobRequestId);if(request){notify('Frozen request inputs are shown in the request card.');button.closest('.job-card')?.querySelector('details')?.setAttribute('open','');}return;}
    if(d.jobKind==='design'){tab='hotspot-design';render();return;}
    openJobComposer(c,{kind:d.jobKind||'evidence',candidateId:d.candidateId||'',selection:{target:d.target,engine:d.engine,variant:d.variant},candidateOnly:d.jobAction==='prepare-candidate',allMissing:d.jobAction==='prepare-all'});
  });
  document.querySelectorAll('[data-fold-select]').forEach(button=>button.onclick=()=>{foldCell=button.dataset.foldSelect;render();});
  document.querySelectorAll('[data-fold-request]').forEach(button=>button.onclick=()=>{try{const draft=foldingRequest(c,button.dataset.foldRequest==='cell'?button.dataset.foldCell:button.dataset.foldRequest);openJobComposer(c,{kind:'fold',directCells:draft.cells,allMissing:button.dataset.foldRequest==='all'});}catch(error){notify(error.message);}});
  document.querySelectorAll('[data-fold-model]').forEach(button=>button.onclick=()=>{focus=button.dataset.foldCandidate;const subject=c.subjects.find(s=>s.id===focus),model=subject?.modelCoverage.models.find(m=>m.id===button.dataset.foldModel);if(model){setWorkspaceEntry('modelSelections',c.id,focus,{target:model.target,engine:model.foldingEngine,variant:model.constructVariant});candidateView='structure';tab='subjects';render();}});
  document.querySelectorAll('[data-job-form]').forEach(form=>{
    form.elements.runId.value=newRequestRun(c,form.dataset.jobForm);
    if(jobComposer?.directCells||jobComposer?.candidateOnly){const cells=jobComposer.directCells||c.foldPlan.cells.filter(cell=>cell.candidateId===jobComposer.candidateId);form.elements.scope.closest('label').hidden=true;const summary=document.createElement('div');summary.className='source-batch-summary';summary.textContent=cells.length+' missing model comparisons selected · '+[...new Set(cells.map(cell=>cell.target))].join(', ');form.querySelector('h3').after(summary);}
    if(jobComposer?.allMissing&&form.elements.question&&!jobComposer.followupQuestion)form.elements.question.value='Recover the recorded missing evidence and validate outstanding campaign results.';
    if(jobComposer?.candidateId&&form.elements.candidateId)form.elements.candidateId.value=jobComposer.candidateId;
    if(jobComposer?.followupQuestion&&form.elements.question)form.elements.question.value=jobComposer.followupQuestion;
    const submit=form.querySelector('[type=submit]');submit.textContent=runnerRuntime?'Submit to Fleet queue':'Save request';
    if(form.dataset.jobForm==='design')designController=enhanceDesignComposer(form,c,{focusId:focus,palette:standardFor(c).palette});
    form.onsubmit=async event=>{event.preventDefault();try{const values={...Object.fromEntries(new FormData(form)),kind:form.dataset.jobForm};const options=requestOptionsFromForm(c,values,{runnerId:null});if(jobComposer?.allMissing&&values.kind==='evidence'&&!values.candidateId)options.allMissing=true;if(jobComposer?.directCells)options.cells=jobComposer.directCells,options.allMissing=false;if(jobComposer?.candidateOnly){options.cells=c.foldPlan.cells.filter(cell=>cell.candidateId===jobComposer.candidateId);options.allMissing=false;}const context=jobComposer;
      if(context?.followupCandidateId){
        const id=context.followupCandidateId;
        await recordReview(c.id,campaign=>candidateReviewContext(campaign,id),async(campaign,inputs)=>{
          await saveJobRequest(c,options);
          return makeCandidateReview(campaign,id,{outcome:'follow_up',note:values.question,modelSelection:inputs.modelSelection});
        },(target,receipt)=>{
          target.candidateReviews||={};
          (target.candidateReviews[c.id]||={})[id]=receipt;
        },values.question);
      }else await saveJobRequest(c,options);jobComposer=null;await render();}catch(error){notify(error.message);}};
  });
  document.querySelectorAll('[data-launch-job]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const request=workspace.jobRequests.find(r=>r.id===form.dataset.launchJob),preview=jobPreviews.get(request.id),fields=new FormData(form),submit=form.querySelector('[type="submit"]');try{if(!fields.has('confirmed')||!String(fields.get('reviewer')||'').trim())throw new Error('Confirm the preview and enter your name.');submit.disabled=true;const result=await runnerPost(request,'dispatch',{previewDigest:preview.previewDigest,launchToken:preview.launchToken,approval:{confirmed:true,reviewer:String(fields.get('reviewer')).trim()}});jobPreviews.delete(request.id);await refreshRunnerJobs();await render();notify(result.status==='completed'?'Script finished. Open its results to inspect any gaps.':'Script status: '+result.status);}catch(error){submit.disabled=false;jobPreviews.delete(request.id);notify(friendlyJobMessage(error.message));}});
  document.querySelectorAll('[data-resume-jobs]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();if(!new FormData(form).has('confirmed'))return;try{const response=await fetch('./api/jobs/resume-approved',{method:'POST',headers:{'Content-Type':'application/json','X-Campaign-CSRF':runnerRuntime.csrfToken},body:JSON.stringify({confirmed:true})});const result=await response.json();if(!response.ok)throw new Error(result.reason||'The approved queue could not resume.');runnerJobs=result.jobs||[];await render();notify('Approved local queue checked. Interrupted executions were not retried.');}catch(error){notify(friendlyJobMessage(error.message));}});
  document.querySelectorAll('[data-refresh-jobs]').forEach(button=>button.onclick=async()=>{await refreshRunnerJobs();render();});
  if(tab==='subjects'&&candidateView==='selectivity'){const subject=c.subjects.find(s=>s.id===focus);if(subject?.modelCoverage)bindSelectivity(document.querySelector('.candidate-workbench'),subject,c);}

  document.querySelectorAll('[data-open-workflow]').forEach(button=>button.onclick=()=>{candidateView='provenance';render();});
  const gapPicker=$('#gap-candidate');if(gapPicker)gapPicker.onchange=()=>{gapCandidate=gapPicker.value;render();};
  const gapStatus=$('#gap-state');if(gapStatus)gapStatus.onchange=()=>{gapState=gapStatus.value;render();};
  document.querySelectorAll('[data-audit-candidate]').forEach(b=>b.onclick=()=>{gapCandidate=b.dataset.auditCandidate;gapState='all';tab='gaps';render();});
  document.querySelectorAll('[data-audit-inspect]').forEach(b=>b.onclick=()=>{focus=b.dataset.auditInspect;setWorkspaceEntry('modelSelections',c.id,focus,{variant:b.dataset.auditVariant,target:b.dataset.auditTarget,engine:b.dataset.auditEngine});candidateView='structure';tab='subjects';render();});

  const choosePanel=next=>{const subject=c.subjects.find(s=>s.id===focus),previous=panelChoice(subject,c).selection;pendingPanelView={campaignId:c.id,subjectId:focus,camera:viewerController?.captureView()||null};setWorkspaceEntry('modelSelections',c.id,focus,next);render();};
  document.querySelectorAll('[data-view-target]').forEach(button=>button.onclick=()=>{const subject=c.subjects.find(s=>s.id===focus);choosePanel({...panelChoice(subject,c).selection,target:button.dataset.viewTarget});});
  document.querySelectorAll('[data-model-dimension]').forEach(input=>input.onchange=()=>{const subject=c.subjects.find(s=>s.id===focus);choosePanel({...panelChoice(subject,c).selection,[input.dataset.modelDimension]:input.value});});
  document.querySelectorAll('[data-coverage-target]').forEach(button=>button.onclick=()=>{choosePanel({variant:button.dataset.coverageVariant,target:button.dataset.coverageTarget,engine:button.dataset.coverageEngine});document.querySelector('.subject-detail')?.scrollIntoView({behavior:'smooth',block:'start'});});

  document.querySelectorAll('[data-evidence-subject]').forEach(b=>b.onclick=()=>{focus=b.dataset.evidenceSubject;tab='subjects';render();});
  document.querySelectorAll('[data-monomer-step]').forEach(button=>button.onclick=()=>{const pool=monomerPool(c),i=pool.findIndex(s=>s.id===monomerSubject(c).id);monomerFocus.set(c.id,pool[(i+Number(button.dataset.monomerStep)+pool.length)%pool.length].id);render();});
  document.querySelectorAll('[data-refresh-monomers]').forEach(button=>button.onclick=()=>refreshConnectedResults(button,'Latest monomer results loaded.'));
  const monomerPicker=$('#monomer-candidate');if(monomerPicker)monomerPicker.onchange=()=>{monomerFocus.set(c.id,monomerPicker.value);pendingPanelView=null;viewerEnabled=true;render();};
  const picker=$('#candidate-picker');if(picker)picker.onchange=()=>{focus=picker.value;render().then(()=>document.querySelector('.candidate-workbench')?.scrollIntoView({block:'start',behavior:'smooth'}));};
  document.querySelectorAll('[data-review-plan-candidate]').forEach(button=>button.onclick=()=>{const id=button.dataset.reviewPlanCandidate;if(c.subjects.some(s=>s.id===id)){focus=id;candidateView='structure';tab='subjects';}else{explorerStates.set(c.id,{...(explorerStates.get(c.id)||{}),selectedCandidateId:id});tab='explorer';}viewerEnabled=true;render().then(()=>document.querySelector('.candidate-workbench, .candidate-explorer-detail')?.scrollIntoView({block:'start'}));});
  document.querySelectorAll('[data-focus-step]').forEach(b=>b.onclick=()=>{const i=c.subjects.findIndex(s=>s.id===focus);focus=c.subjects[(i+Number(b.dataset.focusStep)+c.subjects.length)%c.subjects.length].id;render();});
  const subjectForm=$('#subject-review-form');
  if(subjectForm)subjectForm.onsubmit=async e=>{
    e.preventDefault();
    const form=new FormData(subjectForm),disposition=form.get('disposition'),note=form.get('note').trim();
    if(disposition!=='include'&&!note){notify('Add a short reason for holding or excluding this candidate.');return;}
    const subject=c.subjects.find(row=>row.id===focus),ids=selection(c);
    const value={disposition,note,updatedAt:new Date().toISOString(),...(subject?.modelCoverage?{modelSelection:panelChoice(subject,c).selection}:{})};
    if(await setSelection(c,disposition==='include'?[...new Set([...ids,focus])]:ids.filter(id=>id!==focus),{id:focus,value})){
      notify('Candidate note saved with your review package.');
    }
  };
  document.querySelectorAll('[data-species]').forEach(b=>b.onclick=async()=>{try{viewerSpecies=b.dataset.species;await viewerController?.setSpecies(viewerSpecies);refreshViewerColors('viewer',viewerController);document.querySelectorAll('[data-species]').forEach(x=>x.classList.toggle('active',x.dataset.species===viewerSpecies));}catch(error){notify(error.message);}});
  const viewerBindings=[['#viewer-project','projectColors','setProjectColors'],['#viewer-sticks','sideChains','setSideChains'],['#viewer-residue','residueColors','setResidueColors'],['#viewer-interface','interface','setInterface']];for(const [selector,key,method]of viewerBindings){const input=$(selector);if(input)input.onchange=()=>{viewerOptions[key]=input.checked;viewerController?.[method](input.checked);};}const representation=$('#viewer-representation');if(representation)representation.onchange=()=>{viewerOptions.representation=representation.value;viewerController?.setRepresentation(representation.value);};
  const preset=$('#color-preset');if(preset)preset.onchange=()=>{const id=preset.value;setViewPreference(c.id,{presetId:id,palette:paletteFor(id),bindings:{},subjectId:c.subjects[0]?.id||'',savedAt:new Date().toISOString()});render();};
  const colorSubject=$('#color-subject');if(colorSubject)colorSubject.onchange=()=>{const v=standardFor(c),subject=c.subjects.find(s=>s.id===colorSubject.value);setViewPreference(c.id,{...v,subjectId:subject.id,bindings:subject.viewBindings||{},savedAt:new Date().toISOString()});render();};
  const colors=$('#color-form');if(colors)colors.onsubmit=e=>{e.preventDefault();const f=new FormData(colors),id=f.get('presetId'),palette={},bindings={};for(const role of COLOR_PRESETS[id].roles){palette[role.id]=f.get(`color:${role.id}`);const b=f.get(`binding:${role.id}`).trim();if(b)bindings[role.id]=b;}try{validatePalette(id,palette);exportPML({presetId:id,palette,bindings});setViewPreference(c.id,{presetId:id,palette,bindings,subjectId:f.get('subjectId'),savedAt:new Date().toISOString()});render();notify('View standard saved. Cached pictures remain unchanged.');}catch(error){notify(error.message);}};
  const metric=$('#metric-view');if(metric)metric.onchange=()=>{metricView=metric.value;render();};
  document.querySelectorAll('[data-results-candidate]').forEach(b=>b.onclick=()=>{focus=b.dataset.resultsCandidate;setWorkspaceEntry('modelSelections',c.id,focus,{variant:b.dataset.resultsVariant,target:c.savedResults.referenceTarget,engine:c.savedResults.foldingEngine});selectivityStates.set(c.id+'::'+focus,{engine:c.savedResults.foldingEngine,variant:b.dataset.resultsVariant});candidateView='selectivity';tab='subjects';render();});
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.tab==='workspace'&&tab!=='workspace')lastCampaignTab=tab;tab=b.dataset.tab;render().then(()=>{const heading=document.querySelector('main h1, main h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}window.scrollTo(0,0);});});
  document.querySelectorAll('[data-campaign]').forEach(b=>b.onclick=()=>{document.body.dataset.navOpen='false';current=b.dataset.campaign;if(tab==='workspace')tab=lastCampaignTab;focus=null;candidateFilter='';gapCandidate='all';gapState='unloaded';if((tab==='review-plan'&&!workspace.campaigns.find(c=>c.id===current)?.reviewPlan)||(tab==='gaps'&&!workspace.campaigns.find(c=>c.id===current)?.cacheAudit)||(tab==='fold-plan'&&!workspace.campaigns.find(c=>c.id===current)?.foldPlan)||(tab==='openfold'&&!workspace.campaigns.find(c=>c.id===current)?.openfoldPlan))tab='overview';render().then(()=>{const heading=document.querySelector('main h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}window.scrollTo(0,0);});});
  document.querySelectorAll('[data-focus]').forEach(b=>{b.onclick=()=>{focus=b.dataset.focus;candidateView='structure';viewerEnabled=true;render().then(()=>document.querySelector('.candidate-workbench')?.scrollIntoView({block:'start',behavior:'smooth'}));};b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focus=b.dataset.focus;candidateView='structure';viewerEnabled=true;render();}};});
  document.querySelectorAll('[data-select]').forEach(b=>b.onchange=()=>{const ids=selection(c);setSelection(c,b.checked?[...ids,b.dataset.select]:ids.filter(id=>id!==b.dataset.select));});
  document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>setSelection(c,selection(c).filter(id=>id!==b.dataset.remove)));
  document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>{const ids=[...selection(c)],i=ids.indexOf(b.dataset.move),j=i+Number(b.dataset.direction);if(j>=0&&j<ids.length){[ids[i],ids[j]]=[ids[j],ids[i]];setSelection(c,ids);}});
  const search=(selector,update)=>{const input=$(selector);if(input)input.oninput=async()=>{const pos=input.selectionStart;update(input.value);await render();const next=$(selector);next?.focus();next?.setSelectionRange(pos,pos);};};
  search('#campaign-search',v=>filter=v);search('#subject-search',v=>candidateFilter=v);
  const campaignFilter=$('#campaign-filter');if(campaignFilter)campaignFilter.onchange=()=>{inbox=campaignFilter.value==='review';render();};
  document.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{
    const a=b.dataset.action;
    if(a==='viewer'){viewerEnabled=!viewerEnabled;render();}
    if(a==='viewer-reset')viewerController?.reset();
    if(a==='viewer-fit')viewerController?.fitVisible();
    if(a==='viewer-save-default'){try{const view=viewerController.saveDefaultView();setWorkspaceEntry('molecularViewDefaults',c.id,view.target,view);notify(`${view.target} default saved. New 3D views and Reset use this perspective.`);}catch(error){notify(error.message);}}
    if(a==='viewer-project-view'){try{const target=viewerController.clearDefaultView();if(workspace.molecularViewDefaults?.[c.id])editWorkspace(value=>{delete value.molecularViewDefaults[c.id][target];});notify(`${target} project starting view restored.`);}catch(error){notify(error.message);}}
    if(a==='import')$('#import-file').click();
    if(a==='retry-workspace-save')await workspaceTransfer.retrySave();
    if(a==='return-publication')await leaveWorkspace(publicationRoute(route));
    if(a==='retry-loading')await runStorageAction(recoverStorage);
    if(a==='download-original')downloadProtectedRecord();
    if(a==='replace-record')await runStorageAction(replaceProtectedRecord);
    if(a==='previous-import'||a==='saved-publication-import'){
      const source=a==='previous-import'?previousImportKey:publication.importKey;
      try{
        const {record}=await readImportRecord(source);
        const selected=record||(a==='saved-publication-import'?legacyPublicationImport?.record:null);
        if(await workspaceTransfer.reopen(selected,source)){
          await render();$('#import-preview-title')?.focus({preventScroll:true});
        }
      }catch(error){notify(error.message);}
    }
    if(a==='copy-late-review'){try{await navigator.clipboard.writeText(lateReviewText);notify('Review text copied.');}catch{$('[data-late-review-text]')?.select();}}
    if(a==='dismiss-late-review'){lateReviewText=null;await render();}
    if(a==='palette-export'){try{const v=standardFor(c);download(exportPML(v),`${date()}_campaign-view-standard.pml`,'text/plain');}catch(error){notify(error.message);}}
    if(a==='palette-reset'){const v=standardFor(c);setViewPreference(c.id,{...v,palette:paletteFor(v.presetId),savedAt:new Date().toISOString()});render();notify('Documented project colors restored.');}
    if(a==='export'){try{const backup=prepareBackup(workspace);download(backup.text,`${date()}_campaign-workspace.json`);notify('Workspace backup downloaded. Model files stay on their existing server.');}catch(error){notify(error.message);}}
    if(a==='export-reviews'){try{const bundle=await createReviewExport(workspace);download(bundle,`${date()}_campaign-review-changes.json`);notify('Review changes downloaded. Restore this file against the same campaign evidence.');}catch(error){notify(error.message);}}
    if(a==='live'||a==='import-confirm'){
      const attempt=a==='live'?workspaceTransfer.reconnect():workspaceTransfer.confirm();
      if(attempt){$('#workspace-transfer-status')?.focus({preventScroll:true});await finishWorkspaceTransfer(await attempt);}
    }
    if(a==='import-cancel'&&workspaceTransfer.cancel()){
      await render();
      $('[data-action="import"]')?.focus({preventScroll:true});
    }
    if(a==='receipt'){const d=statuses[c.id].decision;download({schemaVersion:1,decision:d,campaignSnapshot:d.campaignSnapshot||c,currentCampaignSnapshot:c,currentSelection:selection(c),currentStatus:statuses[c.id].label},`${date()}_review-receipt.json`);}
    if(a==='gap-export'){download({campaignId:c.id,campaignRun:c.run.id,cacheAudit:c.cacheAudit,coverage:cacheAuditSummary(c)},`${date()}_cache-gap-audit.json`);}
    if(a==='csv'){const ids=selection(c),axes=c.axes?[c.axes.x,c.axes.y]:[],quote=v=>{let t=String(v??'');if(/^[=+@\-\t\r]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';};const rows=[['rank','campaign','run','subject','kind','selected construct','selected isoform','selected folding method','selected model ID','native model SHA-256','selected model scoped metrics',...axes.map(a=>'Frozen roster: '+a.label)],...ids.map((id,i)=>{const s=c.subjects.find(s=>s.id===id),r=s.modelCoverage?panelChoice(s,c).resolved:null;return [i+1,c.id,c.run.id,id,s.kind,r?.selection.variant||'',r?.selection.target||'',r?.selection.engine||'',r?.model?.id||'',nativeModelHash(r?.model)||'',r?JSON.stringify(scopedMetrics(s,r.model)):'',...axes.map(a=>s.metrics?.[a.key]??'')];})];download(rows.map(r=>r.map(quote).join(',')).join('\r\n'),`${date()}_review-selection.csv`,'text/csv');}
  });
  const planForm=$('#fold-plan-form');
  if(planForm)planForm.onsubmit=async e=>{
    e.preventDefault();
    const form=new FormData(planForm),note=form.get('note');
    if(e.submitter?.disabled)return;
    try{
      const recorded=await recordReview(c.id,campaign=>campaign,campaign=>makePlanReview(campaign,{reviewer:form.get('reviewer'),note,outcome:e.submitter?.value}),(target,receipt)=>{
        (target.planReviews||=[]).push(receipt);
      },note);
      if(recorded){await render();notify('Plan review saved locally. Execution and spending remain unauthorized.');}
    }catch(error){notify(error.message);}
  };
  const form=$('#review-form');
  if(form)form.onsubmit=async e=>{
    e.preventDefault();
    const button=e.submitter,values=new FormData(form),note=values.get('note');
    if(button?.disabled)return;
    try{
      const recorded=await recordReview(c.id,campaign=>({campaign,ids:selection(campaign),context:reviewContext(campaign)}),(_,{campaign,ids,context})=>makeDecision(campaign,ids,{
        reviewer:values.get('reviewer'),note,outcome:button?.value,viewContext:context,
        checks:{guided:true,package:values.has('package'),limitations:values.has('package')&&blockers(campaign,ids).length>0},
      }),(target,receipt)=>{target.decisions.push(receipt);},note);
      if(recorded){await render();notify(button?.value==='approved'?'Decision recorded against this exact package.':'Requested changes recorded.');}
    }catch(error){notify(error.message);}
  };
  if(editingProtected()){
    const forms=['#subject-review-form','#review-form','#fold-plan-form','#review-refold-form','#color-form','[data-job-form]','[data-launch-job]','[data-resume-jobs]'];
    for(const selector of forms)$(selector)?.querySelectorAll('input,select,textarea,button').forEach(control=>{control.disabled=true;});
    document.querySelectorAll('[data-review-good],[data-review-followup],[data-explorer-shortlist],[data-select],[data-remove],[data-move],[data-job-action],[data-refold-retry],[data-action="viewer-save-default"],[data-action="viewer-project-view"],[data-action="palette-reset"],[data-refresh-monomers],#review-refresh-scores,#color-preset,#color-subject').forEach(control=>{control.disabled=true;});
  }

}

$('#import-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';
  if(!file||!await workspaceTransfer.read(file,{fullOnly:emptyImport}))return;
  await render();
  const target=workspaceTransfer.state.phase==='preview'?'#import-preview-title':'#workspace-transfer-status';
  $(target)?.focus({preventScroll:true});
};


function stateFrom(record){
  return record?.state||record?.workspace||{};
}
async function readForStartup(name){
  try{
    const observed=await inspectRecord(name);
    if(observed.error){
      protection||={key:name,snapshot:observed,error:observed.error};
      return null;
    }
    return observed;
  }catch(error){
    protection||={key:name,error:error.message};
    return null;
  }finally{
    if(protection){persistence='error';storageError=protection.error;}
  }
}
function downloadProtectedRecord(){
  try{
    const {snapshot}=protection;
    const text=snapshot.source==='legacy'?snapshot.raw:JSON.stringify(snapshot.raw,null,2);
    download(text,`${date()}_original-browser-record.json`);
  }catch(error){notify(error.message);}
}
function renderStorageProtection(){
  if(!protection)return '';
  const known=!!protection.snapshot;
  return `<section class="notice" aria-label="Saved reviews"><div><strong>${editingProtected()?'Saved reviews could not be loaded. Review editing is paused.':'Saved workspace could not be loaded'}</strong><p>${esc(protection.error)}</p><div class="review-actions"><button class="button subtle" data-action="retry-loading"${storageAction?' disabled':''}>Retry loading</button>${known?`<button class="button subtle" data-action="download-original">Download original record</button>${!emptyImport&&protection.snapshot.error?`<button class="button subtle" data-action="replace-record"${storageAction?' disabled':''}>Replace saved record</button>`:''}`:''}</div></div></section>`;
}
async function checkConnectedSibling(name){
  if(mode!=='cache')return true;
  const sibling=name===key?key+'-connected':key;
  try{
    const observed=await inspectRecord(sibling);
    if(!observed.error)return true;
    protection={key:sibling,snapshot:observed,error:observed.error};
  }catch(error){protection={key:sibling,error:error.message};}
  return false;
}
async function recoverStorage(){
  const name=protection.key;
  let observed;
  try{
    observed=await inspectRecord(name);
    if(observed.error){protection={key:name,snapshot:observed,error:observed.error};return;}
    const found=observed.record;
    if(name===publication.importKey&&found&&found.mode!=='imported'){
      const error='The saved import has an unexpected format.';
      protection={key:name,snapshot:{...observed,error},error};
      return;
    }
    let next={workspace,mode,importInfo:workspaceTransfer.current.importInfo};
    if(mode==='cache'||mode==='published'){
      let overlay=found;
      if(found?.mode==='imported'){
        if(mode==='published'){legacyPublicationImport=observed;overlay=null;}
        else{
          outgoingLinkImport=observed;
          const mirror=await inspectRecord(key+'-connected');
          if(mirror.error){protection={key:mirror.key,snapshot:mirror,error:mirror.error};return;}
          overlay=mirror.record;
        }
      }
      const result=await loadConnected(stateFrom(overlay));
      const references=reviewRecovery.referencesFor(overlay?.preservedReviewKeys);
      if(result.preservedState){
        const archive=await reviewRecovery.stage(result.preservedState,result.issues);
        // A recovered import remains protected until a connected save can archive it.
        const recoveryKey=found?.mode==='imported'&&mode==='cache'?key+'-connected':name;
        const compare=recoveryKey===name?observed:await inspectRecord(recoveryKey);
        if(compare.error)throw new Error(compare.error);
        await writeSavedWorkspace(recoveryKey,{
          ...snapshotFor({mode,workspace:result.workspace}),preservedReviewKeys:[...new Set([...references,archive.key])],
        },{entries:[archive],expected:[recordVersion(compare)]});
        reviewRecovery.saved([archive],references);
      }else reviewRecovery.addReferences(references);
      reviewIssues=result.issues;
      next={workspace:result.workspace,mode};
    }else if(found?.workspace){
      next={workspace:found.workspace,mode:found.mode,importInfo:found.importInfo};
      reviewRecovery.addReferences(found.preservedReviewKeys);
      emptyImport=false;
    }
    next.workspace={...next.workspace,selections:next.workspace.selections||{},decisions:next.workspace.decisions||[]};
    const wasDirty=workspaceTransfer.dirty;
    if(wasDirty&&found)throw new Error('Save a backup of the open workspace before loading the recovered record.');
    if(!wasDirty)workspaceTransfer.start(next);
    if(!await checkConnectedSibling(name))return;
    protection=null;
    if(!wasDirty)reportSave('saved');
  }catch(error){
    protection={key:name,error:error.message};
  }
}
async function replaceProtectedRecord(){
  const guarded=protection,version=recordVersion(guarded.snapshot);
  const approved=await confirmWorkspaceAction({
    title:'Replace saved record?',message:`Replace the unreadable browser record “${guarded.key}” with the campaign now on screen. Other browser records stay intact.`,
    action:'Replace saved record',download:{label:'Download original record',run:downloadProtectedRecord},
  });
  if(!approved)return;
  try{
    const source=mode==='cache'||mode==='published'?(await loadConnected()).workspace:workspace;
    await writeSavedWorkspace(guarded.key,{...snapshotFor({workspace:source,mode,importInfo:workspaceTransfer.current.importInfo}),preservedReviewKeys:reviewRecovery.keys},{
      expected:[version],
    });
    if(await checkConnectedSibling(guarded.key)){
      protection=null;
      reportSave('saved');
    }
  }catch(error){
    if(error.message.includes('record changed'))await recoverStorage();
    else protection={...guarded,error:error.message};
  }
}
async function runStorageAction(action){
  if(storageAction||!protection||workspaceTransfer.state.busy)return;
  storageAction=true;
  if(action===recoverStorage&&!protection.snapshot)restartWorkspaceStorage();
  try{await action();}
  catch(error){notify(error.message);}
  finally{storageAction=false;await render();}
}
async function leaveWorkspace(target,{replace=false}={}){
  if(workspaceTransfer.state.busy){notify('Wait for the workspace operation to finish before leaving.');return;}
  if(workspaceTransfer.dirty){
    const approved=await confirmWorkspaceAction({
      title:'Save before leaving?',message:'Save the open workspace before continuing, or download a backup and stay here.',
      action:'Save and continue',download:{label:'Download backup',run:()=>downloadImport({workspace})},
    });
    if(!approved||!await workspaceTransfer.retrySave()||workspaceTransfer.dirty)return;
  }
  allowUnload=true;
  if(replace)location.replace(target);else location.assign(target);
}
window.addEventListener('beforeunload',event=>{
  if(!allowUnload&&workspaceTransfer.dirty){event.preventDefault();event.returnValue=true;}
});
window.addEventListener('popstate',()=>{
  if(!publishedMode||location.href===route)return;
  const target=location.href;
  if(workspaceTransfer.dirty||workspaceTransfer.state.busy)history.pushState(null,'',route);
  void leaveWorkspace(target,{replace:true});
});

async function start() {
  setStartupMessage(document,'Loading saved review changes…');
  const routeImport=publication.importView;
  const observed=await readForStartup(routeImport?publication.importKey:key);
  let saved=observed?.record||null;
  if(routeImport&&saved&&saved.mode!=='imported'){
    const error='The saved import has an unexpected format.';
    protection={key:publication.importKey,snapshot:{...observed,error},error};
    saved=null;
  }
  if(routeImport&&!saved&&!protection){
    const legacy=await inspectRecord(key).catch(()=>null);
    if(legacy?.record?.mode==='imported')saved=legacy.record;
  }
  if(publishedMode&&!routeImport&&saved?.mode==='imported'){
    legacyPublicationImport=observed;
    saved=null;
  }
  let stored=stateFrom(saved),checkedMirror=false;
  reviewRecovery.addReferences(saved?.preservedReviewKeys);
  mode=saved?.mode||'demo';
  setStartupMessage(document,publishedMode?'Opening the published review snapshot…':'Connecting to the private campaign service…');
  runnerRuntime=forceDemo?null:publishedMode?{publishedWorkspaceAvailable:true,connected:false}:await runtimeInfo();
  const requestedId=new URL(location.href).searchParams.get('campaign');
  if(!forceDemo&&!publishedMode&&((mode==='demo'&&saved&&runnerRuntime?.privateWorkspaceAvailable)||(mode==='imported'&&requestedId))){
    const connected=await readForStartup(key+'-connected');
    checkedMirror=true;
    reviewRecovery.addReferences(connected?.record?.preservedReviewKeys);
    stored=stateFrom(connected?.record);
    if(mode==='imported')outgoingLinkImport=observed;
    else if(!protection){
      try{await settleWithin(()=>writeSavedWorkspace(key+'-previous-demo',saved));}
      catch(error){persistence='error';storageError=error.message;}
    }
  }
  setStartupMessage(document,'Loading campaign data and models…');
  if(routeImport){
    emptyImport=!saved;
    workspace=saved?.workspace||demoWorkspace();
    mode=saved?'imported':'demo';
  }else try{
    ({workspace,mode}=await resolveStartupWorkspace({href:publicationURL.href,saved,runtime:runnerRuntime,stored,connect:connectAtStartup,demo:demoWorkspace,published:publishedMode}));
  }catch(error){
    if(requestedId&&saved?.mode==='imported'){
      error.message=`Requested campaign “${requestedId}”. ${error.message}`;
      error.openSavedImport=()=>{
        const url=new URL(location.href);url.searchParams.delete('campaign');url.searchParams.delete('view');
        location.assign(url);
      };
    }
    throw error;
  }
  if(mode==='cache'&&!protection&&!checkedMirror)await readForStartup(key+'-connected');
  setStartupMessage(document,'Preparing the candidate view…');
  workspace.selections||={};workspace.decisions||=[];
  if(runnerRuntime&&!publishedMode&&!editingProtected()){try{const response=await fetch('./api/jobs',{cache:'no-store'});if(response.ok){runnerJobs=(await response.json()).jobs||[];for(const job of runnerJobs)if(workspace.campaigns.some(c=>c.id===job.request?.campaignId))workspace=upsertJobRequest(workspace,job.request);}}catch(error){notify('Saved job requests need attention: '+error.message);}}
  workspaceTransfer.start({workspace,mode,importInfo:saved?.importInfo});
  void loadImportInventory().then(()=>{if(tab==='workspace')void render();});
  const requested=new URL(location.href).searchParams;current=workspace.campaigns.find(c=>c.id===requested.get('campaign'))?.id||workspace.campaigns[0].id;
  if(['choose-candidates','explorer'].includes(requested.get('view'))&&workspace.campaigns.find(c=>c.id===current)?.candidatePool)tab='explorer';else if(requested.get('view')==='candidates')tab='subjects';else if(requested.get('view')==='cache-gaps')tab='gaps';else if(requested.get('view')==='fold-plan')tab='fold-plan';else if(requested.get('view')==='jobs')tab='jobs';else if(requested.get('view')==='openfold'&&workspace.campaigns.find(c=>c.id===current)?.openfoldPlan)tab='openfold';else if(['results','affinity','hotspot-design','overview','inputs','review-plan','evidence','review','colors','workspace','monomers','models','dimers'].includes(requested.get('view')))tab=requested.get('view');if(tab==='review-plan'&&!workspace.campaigns.find(c=>c.id===current)?.reviewPlan)tab='overview';if(emptyImport)tab='workspace';await render();
}

export const ready=start().then(()=>{document.getElementById('app').removeAttribute('aria-busy');});
