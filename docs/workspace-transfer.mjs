import {canonical, digest, validateWorkspace} from './model.mjs';

export const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
export const REVIEW_KIND = 'campaign-review-changes';
export const REVIEW_STATE_FIELDS = Object.freeze(['decisions','planReviews','candidateReviews','selectionDrafts','selections','subjectReviews','viewPreferences','molecularViewDefaults','modelSelections']);
export const SAVED_STATE_FIELDS = Object.freeze([...REVIEW_STATE_FIELDS, 'jobRequests']);
const arrays = new Set(['decisions','planReviews']);
const nested = new Set(['candidateReviews','subjectReviews','modelSelections','molecularViewDefaults']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };

export function checkWorkspaceSize(text, size) {
  if (typeof text !== 'string') fail('Choose a JSON workspace or review export.');
  if (size !== undefined && (!Number.isSafeInteger(size) || size < 0)) fail('The file byte size is invalid.');
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_WORKSPACE_BYTES || size > MAX_WORKSPACE_BYTES) fail('This file exceeds the 64 MiB workspace limit. Export review changes separately or use a smaller workspace.');
  return bytes;
}

export function prepareBackup(workspace) {
  validateWorkspace(workspace);
  const text = JSON.stringify({...workspace, exportedAt:new Date().toISOString()}, null, 2);
  return {text, bytes:checkWorkspaceSize(text), mime:'application/json'};
}

function parseJSON(text) {
  try { return JSON.parse(text, (key,value) => {
    if (['__proto__','prototype','constructor'].includes(key)) fail('Unsafe object key in JSON.');
    return value;
  }); } catch(error) { throw new Error(`Cannot read this JSON file: ${error.message}`); }
}

function validateReviewBundle(bundle) {
  if (!record(bundle) || bundle.kind !== REVIEW_KIND || bundle.schemaVersion !== 1) fail('Unsupported review export format.');
  if (Object.keys(bundle).some(key=>!['kind','schemaVersion','exportedAt','campaigns','state'].includes(key))) fail('Review exports cannot include source or execution fields.');
  if (!Array.isArray(bundle.campaigns) || !bundle.campaigns.length || bundle.campaigns.length > 1000 || !record(bundle.state)) fail('Review export needs campaign fingerprints and review state.');
  const ids=new Set();
  for(const binding of bundle.campaigns){
    if(!record(binding) || Object.keys(binding).some(key=>!['campaignId','runId','workflowPin','evidenceFingerprint'].includes(key)) || !['campaignId','runId','workflowPin'].every(key=>typeof binding[key]==='string'&&binding[key].length>0) || !/^[a-f0-9]{64}$/.test(binding.evidenceFingerprint) || ids.has(binding.campaignId)) fail('Invalid or duplicate review campaign fingerprint.');
    ids.add(binding.campaignId);
  }
  for(const [field,value] of Object.entries(bundle.state)){
    if(!REVIEW_STATE_FIELDS.includes(field)) fail(`Review export cannot modify ${field}.`);
    if(arrays.has(field)){
      if(!Array.isArray(value) || value.some(item=>!record(item)||!ids.has(item.campaignId))) fail(`${field} refers to an unbound campaign.`);
    } else if(!record(value)||Object.keys(value).some(id=>!ids.has(id))) fail(`${field} refers to an unbound campaign.`);
  }
  return bundle;
}

export function parseWorkspaceFile(text,size) {
  checkWorkspaceSize(text,size);
  const data=parseJSON(text);
  if(data?.kind===REVIEW_KIND) return {kind:'reviews',data:validateReviewBundle(data)};
  return {kind:'workspace',data:validateWorkspace(data)};
}

export async function createReviewExport(workspace) {
  validateWorkspace(workspace);
  const bundle={kind:REVIEW_KIND,schemaVersion:1,exportedAt:new Date().toISOString(),campaigns:await Promise.all(workspace.campaigns.map(async c=>({campaignId:c.id,runId:c.run.id,workflowPin:c.workflowPin,evidenceFingerprint:await digest(c)}))),state:{}};
  for(const field of REVIEW_STATE_FIELDS) if(workspace[field]!==undefined) bundle.state[field]=copy(workspace[field]);
  validateReviewBundle(bundle);
  checkWorkspaceSize(JSON.stringify(bundle));
  return bundle;
}

// Imported maps replace explicitly supplied entries. Unmentioned campaigns and
// subject entries survive; append-only receipt IDs cannot be rewritten.
export async function applyReviewExport(workspace,bundle) {
  validateWorkspace(workspace);
  validateReviewBundle(bundle);
  checkWorkspaceSize(JSON.stringify(bundle));
  for(const binding of bundle.campaigns){
    const c=workspace.campaigns.find(c=>c.id===binding.campaignId);
    if(!c) fail(`Unknown campaign ${binding.campaignId}; import its full workspace first.`);
    if(c.run.id!==binding.runId || c.workflowPin!==binding.workflowPin || await digest(c)!==binding.evidenceFingerprint) fail(`Campaign evidence changed for ${c.name}; review changes cannot be applied to this snapshot.`);
  }
  const merged=copy(workspace);
  for(const [field,incoming] of Object.entries(bundle.state)){
    if(arrays.has(field)){
      const existing=new Map((merged[field]||[]).map(value=>[value.id,value]));
      for(const value of incoming){
        if(existing.has(value.id)&&canonical(existing.get(value.id))!==canonical(value)) fail(`Conflicting ${field} receipt ${value.id}; existing attestations cannot be replaced.`);
        existing.set(value.id,copy(value));
      }
      merged[field]=[...existing.values()];
    }else{
      merged[field]={...(merged[field]||{})};
      for(const [id,value] of Object.entries(incoming)) merged[field][id]=nested.has(field)?{...(merged[field][id]||{}),...copy(value)}:copy(value);
    }
  }
  return validateWorkspace(merged);
}
