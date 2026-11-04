// Presentation only. Reading, restoring and persisting data remain app actions.
import {campaignTitle,orderCampaigns} from './campaign-presentation.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=v=>String(v||'').replace(/[a-f0-9]{64}/gi,'').replace(/\s+/g,' ').trim();
const modeLabel=mode=>mode==='imported'?'Imported workspace':['cache','live'].includes(mode)?'BETII review snapshot':'Demo · example data';
export function formatWorkspaceBytes(bytes){if(!Number.isFinite(bytes)||bytes<0)return 'Size unavailable';if(bytes<1024)return `${Math.round(bytes)} B`;if(bytes<1024**2)return `${(bytes/1024).toFixed(1)} KiB`;return `${(bytes/1024**2).toFixed(1)} MiB`;}
function saveNote(persistence){return persistence==='saving'?'Saving…':persistence==='saved'?'Saved in this browser':'Unsaved · save a backup';}
const campaignName=campaignTitle;
// One list owns view availability and wording; routes and action IDs stay stable.
export function campaignViews(c){
  return [
    ['overview','Overview'],
    ...(c.designInputs?[['inputs','Inputs']]:[]),
    ...(c.candidatePool?[['explorer','Shortlist']]:[]),
    ['subjects','Candidates'],
    ...(c.candidatePool?[['models','Models']]:[]),
    ['review','Final review'],
  ].map(([id,label])=>({id,label,primary:true})).concat([
    ...(c.reviewPlan?[['review-plan','Review coverage']]:[]),
    ['affinity','kD predictions'],
    ...((c.candidatePool||c.subjects||[]).some(s=>s.monomerPlan||s.monomerModels)?[['monomers','Binder alone']]:[]),
    ['evidence','Evidence'],
    ...(c.cacheAudit?[['gaps','Cache gaps']]:[]),
    ...(c.foldPlan?[['fold-plan','Model coverage']]:[]),
    ...(c.openfoldPlan?[['openfold','OpenFold results']]:[]),
    ...(!c.selectionDraft?[['jobs','Jobs & design']]:[]),
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
export function renderSidebar(){return "";}
export function renderTopbar({mode='demo',runtime=null,persistence='saved'}={}){
  const connection='Saved BETII snapshot · reviews stay in this browser';
  return `<header class="topbar shell-topbar"><div class="data-source-chip" data-source-mode="${esc(mode)}" title="${esc(connection)}"><strong>${esc(modeLabel(mode))}</strong><span class="sr-only">${esc(connection)}</span></div><button class="button subtle" data-tab="workspace">Data &amp; backups</button></header>`;
}
function previewCounts(preview){
  const summary=preview.summary||preview.counts||preview;
  const fields=[['campaignCount','Campaigns','campaigns'],['candidateCount','Candidates','candidates'],['decisionCount','Final decisions','decisions'],['draftCount','Shortlist drafts','drafts'],['reviewCount','Candidate reviews','reviews']];
  return fields.flatMap(([key,title,alias])=>{const value=summary[key]??summary[alias];return Number.isInteger(value)&&value>=0?[[title,value]]:[];});
}
export function renderWorkspaceTools({mode='demo',runtime=null,workspaceBytes,reviewBytes,persistence='saved',storageError='',importPreview=null}={}){
  const preview=importPreview,counts=preview?previewCounts(preview):[],fileName=preview?.fileName||preview?.name||'Selected file';
  return `<section class="panel workspace-tools"><div class="panel-head"><div><h1>Data &amp; backups</h1><p class="fine muted"><span data-storage-status>${esc(saveNote(persistence))}</span></p></div>${runtime?.privateWorkspaceAvailable&&mode==='imported'?'<button class="button subtle" data-action="live">Return to connected workspace</button>':''}</div><div class="workspace-backup-actions"><article><h3>Reviews</h3><button class="button primary" data-action="export-reviews">Save review changes</button><small>${esc(formatWorkspaceBytes(reviewBytes))}</small></article><article><h3>Workspace</h3><button class="button subtle" data-action="export">Save workspace backup</button><small>${esc(formatWorkspaceBytes(workspaceBytes))}</small></article></div><section class="workspace-restore" aria-labelledby="restore-title"><h3 id="restore-title">Restore</h3><button class="button subtle" data-action="import">Restore file…</button></section>${storageError||!['saved','saving'].includes(persistence)?`<div class="notice" role="status"><div><strong>Save a file to keep your changes</strong><p>Browser storage is unavailable or full. Your current changes remain open in memory.${storageError?` ${esc(storageError)}`:''}</p></div></div>`:''}${preview?`<section class="workspace-import-preview" aria-labelledby="import-preview-title"><h3 id="import-preview-title">Restore preview</h3><p><strong>${esc(fileName)}</strong> · ${esc(formatWorkspaceBytes(preview.bytes??preview.size))} · ${preview.kind==='reviews'?'Review changes':'Workspace backup'}</p>${counts.length?`<dl>${counts.map(([name,value])=>`<dt>${esc(name)}</dt><dd>${value}</dd>`).join('')}</dl>`:'<p>File summary is being prepared.</p>'}${(preview.warnings||[]).map(w=>`<p class="fine muted">${esc(w)}</p>`).join('')}<p>Restoring changes this browser’s open workspace or review records. It does not replace the Mac server’s source evidence or alter submitted jobs.</p><div class="review-actions"><button class="button primary" data-action="import-confirm">Restore ${preview.kind==='reviews'?'review changes':'workspace'}</button><button class="button subtle" data-action="import-cancel">Cancel</button></div></section>`:''}</section>`;
}
export function renderSourceNotice({mode='demo'}={}){return mode==='demo'?'<div class="notice demo"><span aria-hidden="true">◈</span><div><strong>Illustrative demo</strong> Candidates, scores and review decisions here are examples.</div></div>':'';}
