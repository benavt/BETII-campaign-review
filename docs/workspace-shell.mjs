// Presentation only. Reading, restoring and persisting data remain app actions.
import {campaignTitle,orderCampaigns} from './campaign-presentation.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=v=>String(v||'').replace(/[a-f0-9]{64}/gi,'').replace(/\s+/g,' ').trim();
const modeLabel=mode=>mode==='published'?'Public snapshot':mode==='imported'?'Imported workspace':['cache','live'].includes(mode)?'Private workspace':'Demo · example data';
export function formatWorkspaceBytes(bytes){if(!Number.isFinite(bytes)||bytes<0)return 'Size unavailable';if(bytes<1024)return `${Math.round(bytes)} B`;if(bytes<1024**2)return `${(bytes/1024).toFixed(1)} KiB`;return `${(bytes/1024**2).toFixed(1)} MiB`;}
export function workspaceSaveLabel(persistence){return persistence==='saving'?'Saving…':persistence==='saved'?'Saved in this browser':'Unsaved · save a backup';}
const campaignName=campaignTitle;
// One list owns view availability and wording; routes and action IDs stay stable.
export function campaignViews(c){
  return [
    ['overview','Overview'],
    ...(c.savedResults?[['results','Results']]:[]),
    ...(c.designInputs?[['inputs','Inputs']]:[]),
    ...(c.candidatePool?[['explorer','Shortlist']]:[]),
    ['subjects','Candidates'],
    ...(c.candidatePool?[['models','Models']]:[]),
    ['review','Final review'],
  ].map(([id,label])=>({id,label,primary:true})).concat([
    ...(c.reviewPlan?[['review-plan','Review coverage']]:[]),
    ['affinity','kD predictions'],
    ['hotspot-design','Design from hotspots'],
    ...((c.candidatePool||c.subjects||[]).some(s=>s.monomerPlan||s.monomerModels)?[['monomers','Binder alone']]:[]),
    ['evidence','Evidence'],
    ...(c.cacheAudit?[['gaps','Cache gaps']]:[]),
    ...(c.foldPlan?[['fold-plan','Model coverage']]:[]),
    ...(c.openfoldPlan?[['openfold','OpenFold results']]:[]),
    ...(!c.selectionDraft&&!c.reviewOnly?[['jobs','Jobs & design']]:[]),
    ['colors','Colors'],
  ].map(([id,label])=>({id,label,primary:false})));
}
export function renderCampaignTabs(c,{active='overview',issueCount=0,views=campaignViews(c)}={}){
  const secondary=views.filter(v=>!v.primary),current=secondary.find(v=>v.id===active);
  const button=v=>`<button class="${active===v.id?'active':''}" data-tab="${esc(v.id)}" ${active===v.id?'aria-current="page"':''}>${esc(v.label)}${v.id==='review'&&issueCount?`<span aria-label="${issueCount} review issues">${issueCount}</span>`:''}</button>`;
  return `<nav class="tabs" aria-label="Campaign views">${views.filter(v=>v.primary).map(button).join('')}${secondary.length?`<details class="campaign-more"><summary${current?' class="active"':''}>${esc(current?.label||'More')}</summary><div class="campaign-more-menu">${secondary.map(button).join('')}</div></details>`:''}</nav>`;
}
function shortStatus(c,status){return c.selectionDraft?`${c.selectionDraft.selectedIds?.length||0} shortlisted`:label(status?.label)||'Review pending';}
function versionLabel(c){const revision=String(c.id||'').match(/-r(\d+)$/);return c.supersededBy?(revision?`Revision ${revision[1]}`:'Previous version'):'';}
export function renderSidebar({campaigns=[],current,statuses={},filter='',inbox=false,mode='demo',persistence='saved'}={}){
  const query=String(filter).trim().toLowerCase(),needsReview=c=>!statuses[c.id]||['blocked','ready','stale','changes','pending'].includes(statuses[c.id].key);
  const shown=campaigns.filter(c=>(!inbox||needsReview(c))&&(!query||`${campaignName(c)} ${c.target||''}`.toLowerCase().includes(query)));
  const active=orderCampaigns(shown.filter(c=>!c.supersededBy)),previous=shown.filter(c=>c.supersededBy),open=previous.some(c=>c.id===current)||Boolean(query&&previous.length);
  const currentCount=campaigns.filter(c=>!c.supersededBy).length;
  const cards=items=>items.map(c=>`<button class="campaign-link ${c.id===current?'selected':''}" data-campaign="${esc(c.id)}" ${c.id===current?'aria-current="page"':''}><span><strong>${esc(campaignName(c))}</strong><small>${esc([versionLabel(c),shortStatus(c,statuses[c.id])].filter(Boolean).join(' · '))}</small></span></button>`).join('');
  return `<aside class="sidebar shell-sidebar" id="campaign-navigation" aria-label="Campaign navigation"><button class="mobile-nav-close" data-mobile-nav="close" aria-label="Close campaign navigation">×</button><a class="brand" href="${mode==='demo'?'?demo=1':'./'}" aria-label="Campaign Studio home"><span>Campaign <strong>Studio</strong></span></a><div class="shell-campaign-heading"><h2>Campaigns</h2><span aria-label="${currentCount} current campaigns">${currentCount}</span></div><label class="shell-search"><span class="sr-only">Search campaigns</span><input class="input" id="campaign-search" type="search" placeholder="Find a campaign…" autocomplete="off" value="${esc(filter)}"></label><label class="shell-filter"><span class="sr-only">Filter campaigns</span><select class="input" id="campaign-filter"><option value="all" ${!inbox?'selected':''}>All campaigns</option><option value="review" ${inbox?'selected':''}>Needs review</option></select></label><nav class="campaign-nav" aria-label="Campaigns">${cards(active)}${previous.length?`<details class="previous-campaigns" ${open?'open':''}><summary>Previous versions <span>${previous.length}</span></summary>${cards(previous)}</details>`:''}${!shown.length?'<p class="muted">No matching campaigns.</p>':''}</nav><div class="sidebar-foot"><p><span data-storage-status>${esc(workspaceSaveLabel(persistence))}</span></p></div></aside><button class="mobile-nav-backdrop" data-mobile-nav="close" aria-label="Close campaign navigation" tabindex="-1"></button>`;
}
export function renderTopbar({mode='demo',runtime=null,persistence='saved'}={}){
  const connection=mode==='published'?'Published review snapshot; review edits stay in this browser':mode==='demo'?'Sample data only':mode==='imported'?'Opened from a file':runtime?.privateWorkspaceAvailable?'Private Mac server':runtime?.connected?'Local server available':'Server connection unavailable';
  return `<header class="topbar shell-topbar"><div class="data-source-chip" data-source-mode="${esc(mode)}" title="${esc(connection)}"><strong>${esc(modeLabel(mode))}</strong><span class="sr-only">${esc(connection)}</span></div><button class="button subtle" data-tab="workspace">Data &amp; backups</button></header>`;
}
function previewCounts(preview){
  const summary=preview.summary||preview.counts||preview;
  const fields=[['campaignCount','Campaigns','campaigns'],['candidateCount','Candidates','candidates'],['decisionCount','Final decisions','decisions'],['draftCount','Shortlist drafts','drafts'],['reviewCount','Candidate reviews','reviews']];
  return fields.flatMap(([key,title,alias])=>{const value=summary[key]??summary[alias];return Number.isInteger(value)&&value>=0?[[title,value]]:[];});
}
export function workspaceTransferMessage({phase,error}={}){
  return error||({reading:'Checking the selected file…',restoring:'Restoring the selected file…',reconnecting:'Reopening the connected workspace…',refreshing:'Refreshing connected results…',saving:'Waiting for browser storage…'})[phase]||'';
}
export function confirmWorkspaceAction({title,message,action,download,signal}){
  if(signal?.aborted)return Promise.resolve(false);
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog'),focus=document.activeElement;
    const heading=document.createElement('h2'),body=document.createElement('p'),controls=document.createElement('div');
    heading.id='workspace-choice-title';heading.textContent=title;body.textContent=message;
    dialog.setAttribute('aria-labelledby',heading.id);controls.className='review-actions';
    function button(label,kind,callback){
      const element=document.createElement('button');element.className='button '+kind;element.type='button';
      element.textContent=label;element.onclick=callback;controls.append(element);return element;
    }
    const abort=()=>dialog.close();
    dialog.addEventListener('close',()=>{
      signal?.removeEventListener('abort',abort);
      dialog.remove();if(focus?.isConnected)focus.focus();resolve(dialog.returnValue==='confirm');
    },{once:true});
    signal?.addEventListener('abort',abort,{once:true});
    button(action,'primary',()=>dialog.close('confirm'));
    if(download)button(download.label,'subtle',download.run);
    const cancel=button('Cancel','subtle',abort);
    dialog.append(heading,body,controls);document.body.append(dialog);dialog.showModal();cancel.focus();
  });
}
export function renderWorkspaceTools({mode='demo',runtime=null,workspaceBytes,reviewBytes,persistence='saved',storageError='',transfer={},previousImport=false,savedImport=false,publicationImport=false,emptyImport=false,protection=null}={}){
  const preview=transfer.preview,counts=preview?previewCounts(preview):[],fileName=preview?.fileName||preview?.name||'Selected file';
  const disabled=transfer.busy||protection?' disabled':'';
  const reconnect=runtime?.privateWorkspaceAvailable&&mode==='imported'?`<button class="button subtle" data-action="live"${disabled}>Return to connected workspace</button>`:'';
  const canCancel=transfer.phase==='reading'||(transfer.busy&&transfer.phase!=='saving');
  const restoreStatus=`<p id="workspace-transfer-status" role="status" tabindex="-1">${esc(workspaceTransferMessage(transfer))}</p><button class="button subtle" data-action="import-cancel" data-cancel-transfer data-cancel-file-read${canCancel?'':' hidden'}>${transfer.phase==='reading'?'Cancel file check':'Cancel'}</button>`;
  const replacements=preview?.replacements||[];
  const replacementLabels={subjectReviews:'Candidate notes',candidateReviews:'Candidate reviews',selectionDrafts:'Shortlist drafts',selections:'Selections',viewPreferences:'View preferences',molecularViewDefaults:'Saved views',modelSelections:'Model selections'};
  const replacementCounts=new Map();
  for(const {field} of replacements)replacementCounts.set(field,(replacementCounts.get(field)||0)+1);
  const describe=value=>typeof value?.note==='string'?value.note:JSON.stringify(value);
  const overwriteDetails=replacements.length?`<p>Existing edits to replace</p><ul>${[...replacementCounts].map(([field,count])=>`<li>${esc(replacementLabels[field]||field)} · ${count}</li>`).join('')}</ul><details><summary>Review replacements</summary><ul>${replacements.map(({field,campaign,entry,before,after})=>`<li><strong>${esc([replacementLabels[field]||field,campaign,entry].filter(Boolean).join(' · '))}</strong><p>Current value · ${esc(describe(before))}</p><p>From file · ${esc(describe(after))}</p></li>`).join('')}</ul></details>`:'';
  const unsaved=persistence==='error'||!!storageError;
  const notice=`<div class="notice" role="status" data-workspace-unsaved${unsaved&&!protection&&!emptyImport?'':' hidden'}><div><strong>Save a file to keep your changes</strong><p>Your current changes remain open in memory. <span data-workspace-save-error>${esc(storageError)}</span></p><button class="button subtle" data-action="retry-workspace-save"${transfer.busy||persistence==='saving'||protection?' disabled':''}>Retry save</button></div></div>`;
  const recoveryActions=[
    previousImport&&!emptyImport?`<button class="button subtle" data-action="previous-import"${disabled}>Reopen previous import</button>`:'',
    savedImport?`<button class="button subtle" data-action="saved-publication-import"${disabled}>Reopen saved import</button>`:'',
    publicationImport?`<button class="button subtle" data-action="return-publication"${transfer.busy?' disabled':''}>Return to published snapshot</button>`:'',
  ].join('');
  const backupActions=emptyImport?'<p>No saved backup is available for this import view. Choose a full workspace backup to open it again.</p>':`<div class="workspace-backup-actions">${protection?'':`<article><h3>Reviews</h3><button class="button primary" data-action="export-reviews">Save review changes</button><small>${esc(formatWorkspaceBytes(reviewBytes))}</small></article>`}<article><h3>Workspace</h3><button class="button subtle" data-action="export">${protection?'Download campaign backup (missing browser reviews)':'Save workspace backup'}</button><small>${esc(formatWorkspaceBytes(workspaceBytes))}</small></article></div>`;
  return `<section class="panel workspace-tools"><div class="panel-head"><div><h1>Data &amp; backups</h1><p class="fine muted"><span role="status" data-storage-status>${esc(workspaceSaveLabel(persistence))}</span></p></div>${reconnect}</div>${recoveryActions?`<div class="review-actions">${recoveryActions}</div>`:''}${backupActions}<section class="workspace-restore" aria-labelledby="restore-title"><h3 id="restore-title">Restore</h3><button class="button subtle" data-action="import"${emptyImport&&protection?.retryable?'':disabled}>${emptyImport?'Choose backup…':'Restore file…'}</button>${restoreStatus}</section>${notice}${preview?`<section class="workspace-import-preview" aria-labelledby="import-preview-title"><h3 id="import-preview-title" tabindex="-1">Restore preview</h3><p><strong>${esc(fileName)}</strong> · ${esc(formatWorkspaceBytes(preview.bytes??preview.size))} · ${preview.kind==='reviews'?'Review changes':'Workspace backup'}</p>${counts.length?`<dl>${counts.map(([name,value])=>`<dt>${esc(name)}</dt><dd>${value}</dd>`).join('')}</dl>`:'<p>File summary is being prepared.</p>'}${overwriteDetails}${(preview.warnings||[]).map(w=>`<p class="fine muted">${esc(w)}</p>`).join('')}<p>Restoring changes this browser’s open workspace or review records. It does not replace the Mac server’s source evidence or alter submitted jobs.</p><div class="review-actions"><button class="button primary" data-action="import-confirm"${transfer.phase==='preview'&&!transfer.busy?'':' disabled'}>Restore ${preview.kind==='reviews'?'review changes':'workspace'}</button><button class="button subtle" data-action="import-cancel" data-cancel-preview${disabled}>Cancel</button></div></section>`:''}<details class="workspace-data-explanation"><summary>Backup contents</summary><p>Reviews include shortlist edits, decisions, notes and display preferences. Restore them against matching campaign evidence.</p><p>Workspace backups include campaign metadata, source references and review history. Structure files are referenced, not copied into this JSON backup.</p><p>Restore accepts review or workspace JSON files up to 64 MiB and shows a preview before applying changes.</p><p>The same app opens on a desktop or phone. A private Mac server can provide the saved scientific evidence and selected structure files; the phone does not run folding jobs. Recorded job updates are snapshots with their own observation times.</p><p>Your shortlist and review edits are saved in this browser. They are separate from the server’s source files and from any explicitly saved runner requests. Export a review file to carry these edits to another browser.</p><p>A static preview serves the same interface with illustrative data. An imported workspace contains saved metadata and references; referenced structures may need the original private server to be available.</p></details>${mode==='published'?'':'<details class="workspace-sample"><summary>Demo</summary><a class="text-button" href="?demo=1" target="_blank" rel="noopener noreferrer">Open the illustrative demo ↗</a></details>'}</section>`;
}
export function renderSourceNotice({mode='demo'}={}){return mode==='demo'?'<div class="notice demo"><span aria-hidden="true">◈</span><div><strong>Illustrative demo</strong> Candidates, scores and review decisions here are examples.</div></div>':'';}
