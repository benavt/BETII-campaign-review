import {validateDesignInputs} from './campaign-inputs.mjs';
import {validateFoldPlan,validatePlanReviews} from './fold-plan.mjs';
import {validateMonomerModels} from './monomer-models.mjs';
import {validateReviewPlan} from './review-plan.mjs';
import {coverageSummary} from './coverage.mjs';
import {cacheAuditSummary} from './cache-audit.mjs';
import {resolveModel,modelChoices} from './panel.mjs';
import {COLOR_PRESETS, paletteFor, validatePalette, exportPML} from './colors.mjs';
import {validateCameraDefault,displayFrame,rotationMatrix} from './camera.mjs';
import {validateJobRequests} from './jobs.mjs';
import {explorerPool,selectionDraftFor} from './candidate-explorer.mjs';

export const CHECKS = [
  ['identity', 'I checked subject identities, species and constructs.'],
  ['evidence', 'I inspected the required source evidence and structures.'],
  ['interpretation', 'I checked the ranking, metric definitions and scientific interpretation.'],
  ['deliverables', 'I checked the final deliverables and selected subjects.'],
];

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}

export async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export async function candidateReviewDigest(c,subject,modelSelection=null){
  return digest({campaignId:c.id,runId:c.run.id,workflowPin:c.workflowPin,subject,modelSelection});
}
export async function makeCandidateReview(c,subjectId,{outcome,note='',modelSelection=null}){
  const subject=c.subjects.find(s=>s.id===subjectId);
  assert(subject&&['looks_good','follow_up'].includes(outcome),'Choose a known candidate and review action.');
  assert(typeof note==='string'&&note.length<=4000,'Candidate review note is too long.');
  if(outcome==='follow_up')assert(note.trim(),'Describe the follow-up needed.');
  if(subject.modelCoverage){assert(modelSelection,'Review requires an explicit model context.');const model=resolveModel(subject,modelSelection);if(outcome==='looks_good')assert(model.model,'The chosen model is missing; request follow-up instead.');}
  return {schemaVersion:1,campaignId:c.id,runId:c.run.id,subjectId,outcome,note:note.trim(),modelSelection:structuredClone(modelSelection),createdAt:new Date().toISOString(),sourceDigest:await candidateReviewDigest(c,subject,modelSelection),attestation:'Candidate-level browser-local researcher review; no execution or spending approval.'};
}
export async function guidedReviewStatus(c,selectedIds,records={},modelSelections={}){
  const rows=await Promise.all(selectedIds.map(async id=>{
    const subject=c.subjects.find(s=>s.id===id),receipt=records[id];
    if(!subject||!receipt)return {id,status:'pending'};
    const context=subject.modelCoverage?modelChoices(subject,modelSelections[id]||{}).selection:null;
    const fresh=receipt.campaignId===c.id&&receipt.runId===c.run.id&&receipt.subjectId===id&&receipt.sourceDigest===await candidateReviewDigest(c,subject,context);
    return {id,status:!fresh?'stale':receipt.outcome==='looks_good'?'complete':'follow_up',receipt};
  }));
  return {rows,complete:rows.filter(r=>r.status==='complete').length,total:rows.length,ready:rows.length>0&&new Set(selectedIds).size===selectedIds.length&&rows.every(r=>r.status==='complete')};
}

export function safeURL(value) {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

export function privateAssetURL(path) {
  if (typeof path !== 'string' || !path.startsWith('assets/') || path.includes('..') || path.includes('\\') || /[%?#:]/.test(path)) return null;
  return './data/' + path.split('/').map(encodeURIComponent).join('/');
}

function assert(ok, text) { if (!ok) throw new Error(text); }
function str(v) { return typeof v === 'string' && v.trim().length > 0 && v.length <= 4000; }
function unique(items, label) {
  assert(new Set(items.map(x => x.id)).size === items.length, `Duplicate ${label} IDs.`);
}

export function validateWorkspace(data) {
  assert(data && data.schemaVersion === 1, 'Expected schemaVersion: 1.');
  assert(Array.isArray(data.campaigns) && data.campaigns.length > 0 && data.campaigns.length <= 1000, 'Provide 1–1,000 campaigns.');
  unique(data.campaigns, 'campaign');
  for (const c of data.campaigns) {
    for (const k of ['id', 'name', 'target', 'objective', 'recipe', 'workflowPin', 'observedAt']) assert(str(c[k]), `Campaign requires ${k}.`);
    assert(typeof c.demo === 'boolean', `${c.id}: demo must be explicitly true or false.`);
    assert(Number.isFinite(Date.parse(c.observedAt)) && /(Z|[+-]\d\d:\d\d)$/.test(c.observedAt), `${c.id}: observedAt needs an ISO timestamp with timezone.`);
    assert(c.run && str(c.run.id), `${c.id}: run identity required.`);
    assert(c.run.parentIds === undefined || (Array.isArray(c.run.parentIds) && c.run.parentIds.every(str)), `${c.id}: parentIds must be an array.`);
    assert(['not_started','queued','running','completed','failed','unknown'].includes(c.run.execution), `${c.id}: invalid execution state.`);
    for (const k of ['telemetry','acceptance']) assert(['verified','needs_review','missing','not_applicable'].includes(c.run[k]), `${c.id}: invalid ${k} state.`);
    assert(Array.isArray(c.subjects) && c.subjects.length <= 50000, `${c.id}: subjects array required (max 50,000).`);
    assert(Array.isArray(c.evidence) && c.evidence.length <= 10000, `${c.id}: evidence array required.`);
    assert(Array.isArray(c.requiredEvidence) && c.requiredEvidence.length > 0, `${c.id}: at least one required evidence item is needed.`);
    unique(c.subjects, 'subject'); unique(c.evidence, 'evidence');
    if(c.candidatePool!==undefined){assert(Array.isArray(c.candidatePool)&&c.candidatePool.length<=50000,`${c.id}: invalid candidate pool.`);explorerPool(c);}
    if(c.selectionDraft!==undefined){assert(c.candidatePool&&!c.foldPlan&&!c.openfoldPlan,`${c.id}: editable selection requires a separate review-only pool.`);selectionDraftFor(c);}
    for (const s of c.candidatePool?[...c.subjects,...c.candidatePool]:c.subjects) {
      assert(str(s.id) && str(s.label) && str(s.kind), `${c.id}: each subject requires id, label and kind.`);
      if (s.metrics) for (const value of Object.values(s.metrics)) assert(value === null || (typeof value === 'number' && Number.isFinite(value)), `${s.id}: metrics must be finite numbers or null.`);
      assert(s.artifacts === undefined || (Array.isArray(s.artifacts) && s.artifacts.every(a=>a && str(a.label) && typeof a.url === 'string')), `${s.id}: artifacts must be an array of labeled URLs.`);
      assert(s.assets === undefined || (Array.isArray(s.assets) && s.assets.every(a=>a && str(a.label) && privateAssetURL(a.path))), `${s.id}: invalid private assets.`);
      if (s.modelCoverage !== undefined) coverageSummary(s);
      if (s.monomerModels !== undefined || s.monomerPlan !== undefined) validateMonomerModels(s);
      for(const m of s.modelCoverage?.models||[])if(m.molecularModel)displayFrame(m.molecularModel);
      assert(s.flags === undefined || (Array.isArray(s.flags) && s.flags.every(str)), `${s.id}: flags must be text entries.`);
    }
    validateDesignInputs(c);
    if(c.molecularColorStandard!==undefined){
      const standard=c.molecularColorStandard;
      assert(standard?.schemaVersion===1&&str(standard.id)&&Object.hasOwn(COLOR_PRESETS,standard.presetId)&&str(standard.source?.path)&&/^[a-f0-9]{64}$/.test(standard.source?.sha256),'Campaign color standard requires a known preset and hashed source.');
      assert(Array.isArray(standard.legend)&&standard.legend.length<=20&&standard.legend.every(role=>str(role.label)&&/^#[a-f0-9]{6}$/i.test(role.color)),'Campaign color legend requires readable labels and colors.');
      exportPML({presetId:standard.presetId,palette:paletteFor(standard.presetId),bindings:standard.bindings||{}});
    }
    if(c.reviewPlan!==undefined)validateReviewPlan(c);
    if(c.cacheAudit!==undefined)cacheAuditSummary(c);
    if(c.foldPlan!==undefined)validateFoldPlan(c);
    if(c.molecularViewPresets!==undefined){
      assert(c.molecularViewPresets&&typeof c.molecularViewPresets==='object'&&!Array.isArray(c.molecularViewPresets),'Invalid target camera presets.');
      for(const [target,preset]of Object.entries(c.molecularViewPresets)){
        assert(preset?.schemaVersion===1&&str(preset.frameId)&&str(preset.label)&&c.subjects.some(s=>s.modelCoverage?.expectedTargets.includes(target)),'Project camera requires a known target and receptor frame.');
        rotationMatrix(preset.rotation);
      }
    }
    for (const e of c.evidence) {
      assert(str(e.id) && str(e.label) && str(e.kind) && ['verified','needs_review','missing'].includes(e.status) && e.source && str(e.source.label), `${c.id}: evidence needs identity, kind, status and source label.`);
      assert(e.subjectIds === undefined || (Array.isArray(e.subjectIds) && e.subjectIds.every(id=>c.subjects.some(s=>s.id===id)) && new Set(e.subjectIds).size===e.subjectIds.length), `${c.id}: evidence scope must contain known unique subject IDs.`);
      assert(e.assets === undefined || (Array.isArray(e.assets) && e.assets.every(a=>a && str(a.label) && privateAssetURL(a.path))), `${c.id}: invalid evidence assets.`);
    }
    for (const id of c.requiredEvidence) assert(c.evidence.some(e => e.id === id), `${c.id}: required evidence ${id} does not exist.`);
    if (c.axes) for (const a of ['x','y']) assert(c.axes[a] && str(c.axes[a].key) && str(c.axes[a].label), `${c.id}: axes require key and label.`);
  }
  assert(data.selections === undefined || (data.selections && typeof data.selections === 'object' && !Array.isArray(data.selections)), 'selections must be an object.');
  for (const [id, ids] of Object.entries(data.selections || {})) {
    assert(Array.isArray(ids) && ids.every(str) && new Set(ids).size === ids.length, 'Invalid or duplicate selected subject IDs.');
    const c = data.campaigns.find(c => c.id === id);
    assert(c && ids.every(id => explorerPool(c).some(s => s.id === id)), 'Selection refers to unknown campaign or subject.');
  }
  if(data.selectionDrafts!==undefined){assert(data.selectionDrafts&&typeof data.selectionDrafts==='object'&&!Array.isArray(data.selectionDrafts),'Invalid selection drafts.');for(const[id,draft]of Object.entries(data.selectionDrafts)){const c=data.campaigns.find(c=>c.id===id);assert(c?.selectionDraft,'Draft refers to a campaign without an editable shortlist.');selectionDraftFor(c,draft);}}
  for (const field of ['viewPreferences','subjectReviews','modelSelections','candidateReviews']) assert(data[field]===undefined || (data[field] && typeof data[field]==='object' && !Array.isArray(data[field])), `${field} must be an object.`);
  for(const [campaignId,records]of Object.entries(data.candidateReviews||{})){
    const c=data.campaigns.find(c=>c.id===campaignId);assert(c&&records&&typeof records==='object'&&!Array.isArray(records),'Invalid guided candidate reviews.');
    for(const [id,r]of Object.entries(records)){
      const subject=explorerPool(c).find(s=>s.id===id);
      assert(subject&&r?.schemaVersion===1&&r.campaignId===campaignId&&r.subjectId===id&&str(r.runId)&&['looks_good','follow_up'].includes(r.outcome)&&typeof r.note==='string'&&r.note.length<=4000&&/^[a-f0-9]{64}$/.test(r.sourceDigest)&&str(r.createdAt),'Invalid guided candidate receipt.');
      if(subject.modelCoverage)resolveModel(subject,r.modelSelection);
    }
  }
  for (const [id, selections] of Object.entries(data.modelSelections || {})) {
    const c=data.campaigns.find(c=>c.id===id);
    assert(c && selections && typeof selections==='object' && !Array.isArray(selections), 'Invalid model selection map.');
    for(const [subjectId, selection] of Object.entries(selections)) {
      const subject=explorerPool(c).find(s=>s.id===subjectId);
      assert(subject?.modelCoverage, 'Model selection refers to an unknown panel.');
      resolveModel(subject, selection);
    }
  }
  for (const [id, view] of Object.entries(data.viewPreferences || {})) {
    const c=data.campaigns.find(c=>c.id===id);
    assert(c && view && Object.hasOwn(COLOR_PRESETS,view.presetId) && explorerPool(c).some(s=>s.id===view.subjectId), 'Saved view requires a known campaign, preset and subject.');
    validatePalette(view.presetId,view.palette);
    exportPML(view);
  }
  for (const [id, reviews] of Object.entries(data.subjectReviews || {})) {
    const c=data.campaigns.find(c=>c.id===id);
    assert(c && reviews && typeof reviews==='object' && !Array.isArray(reviews), 'Invalid subject review map.');
    for (const [subjectId,r] of Object.entries(reviews)) assert(explorerPool(c).some(s=>s.id===subjectId) && r && ['include','hold','exclude'].includes(r.disposition) && typeof r.note==='string' && r.note.length<=4000 && str(r.updatedAt), 'Invalid candidate review note.');
  }
  // Imported decisions are untrusted historical attestations; validate their shape.
  assert(data.decisions === undefined || (Array.isArray(data.decisions) && data.decisions.length <= 10000), 'decisions must be an array (max 10,000).');
  for (const d of data.decisions || []) {
    assert(d && str(d.id) && str(d.campaignId) && str(d.runId) && str(d.reviewer) && str(d.createdAt) && str(d.snapshotDigest), 'Invalid decision identity.');
    assert(['approved','changes_requested'].includes(d.outcome) && Array.isArray(d.selectedSubjectIds) && d.selectedSubjectIds.every(str), 'Invalid decision outcome or selection.');
    assert(d.checks && typeof d.checks === 'object' && typeof d.note === 'string' && typeof d.demo === 'boolean', 'Invalid decision attestation.');
    assert(d.outcome !== 'approved' || (d.reviewMode==='guided_v1'?d.checks.guided===true&&d.checks.package===true&&d.selectedSubjectIds.every(id=>d.viewContext?.candidateReviews?.[id]?.outcome==='looks_good'):CHECKS.every(([id]) => d.checks[id] === true)), 'Approved decisions require every human check or complete guided candidate reviews.');
  }
  if(data.planReviews!==undefined)validatePlanReviews(data.planReviews);
  if(data.jobRequests!==undefined)validateJobRequests(data.jobRequests,data.campaigns);
  if(data.molecularViewDefaults!==undefined){
    assert(data.molecularViewDefaults&&typeof data.molecularViewDefaults==='object'&&!Array.isArray(data.molecularViewDefaults),'Invalid saved target views.');
    for(const [campaignId,views]of Object.entries(data.molecularViewDefaults)){
      const c=data.campaigns.find(c=>c.id===campaignId);
      assert(c&&views&&typeof views==='object'&&!Array.isArray(views),'Saved views require a known campaign.');
      for(const [target,view]of Object.entries(views)){
        validateCameraDefault(view);
        assert(view.campaignId===campaignId&&view.target===target&&c.subjects.some(s=>s.modelCoverage?.expectedTargets.includes(target)||s.molecularModels?.some(m=>m.species===target)),'Saved view names an unknown target.');
      }
    }
  }
  return data;
}

export function blockers(c, selectedIds, checks = {}) {
  const result = c.requiredEvidence.map(id => c.evidence.find(e => e.id === id)).filter(e => !e.subjectIds?.length || e.subjectIds.some(id => selectedIds.includes(id))).filter(e => e.status === 'missing' || (e.status === 'needs_review' && checks.limitations !== true)).map(e => `${e.label}: ${e.status.replaceAll('_', ' ')}`);
  if (c.run.execution !== 'completed') result.push('Run execution is not complete.');
  if (!['verified','not_applicable'].includes(c.run.telemetry)) result.push('Resource telemetry has not been accepted.');
  if (c.run.acceptance !== 'verified' && !(c.run.acceptance === 'needs_review' && checks.limitations === true)) result.push('Scientific acceptance needs inspection.');
  if (!selectedIds.length) result.push('Select at least one subject for the review package.');
  if (selectedIds.some(id => !c.subjects.some(s => s.id === id))) result.push('Selection contains an unknown subject.');
  if (new Set(selectedIds).size !== selectedIds.length) result.push('Selection contains duplicate subjects.');
  if(c.selectionDraft){const ids=c.selectionDraft.selectedIds;if(JSON.stringify(ids)!==JSON.stringify(selectedIds))result.push('The review selection must match your current ordered shortlist.');}
  return result;
}

export function panelBlockers(c, selectedIds, viewContext={}) {
  const gaps=[];
  for(const id of selectedIds){
    const subject=c.subjects.find(s=>s.id===id);if(!subject?.modelCoverage)continue;
    try {const r=modelChoices(subject,viewContext.modelSelections?.[id]||{}).resolved;if(!r.model)gaps.push(`${subject.displayName||subject.label}: selected construct / isoform / folding-method model is missing.`);}
    catch {gaps.push(`${subject.displayName||subject.label}: reviewed model selection is invalid.`);}
  }
  return gaps;
}

export async function reviewDigest(c, selectedSubjectIds, viewContext = {}) {
  return digest({ campaign: c, selectedSubjectIds, viewContext });
}

export async function decisionStatus(c, selectedIds, decisions, viewContext = {}) {
  const d = [...decisions].reverse().find(x => x.campaignId === c.id);
  if (!d) {
    const hardGaps = [...blockers(c, selectedIds, {limitations:true}),...panelBlockers(c,selectedIds,viewContext)];
    return { label: hardGaps.length ? 'Needs evidence' : 'Ready for your review', key: hardGaps.length ? 'blocked' : 'ready' };
  }
  if (d.snapshotDigest !== await reviewDigest(c, selectedIds, viewContext) || d.runId !== c.run.id || d.demo !== c.demo) return { label: 'Review out of date', key: 'stale', decision: d };
  const completeChecks=d.reviewMode==='guided_v1'?d.checks.guided===true&&d.checks.package===true&&(await guidedReviewStatus(c,selectedIds,viewContext.candidateReviews,viewContext.modelSelections)).ready:CHECKS.every(([id]) => d.checks[id] === true);
  if (d.outcome === 'approved' && (blockers(c, selectedIds, d.checks).length || panelBlockers(c,selectedIds,viewContext).length || !completeChecks || (d.checks.limitations === true && !d.note.trim()))) return {label:'Review out of date', key:'stale', decision:d};
  return { label: d.outcome === 'approved' ? 'Human approved' : 'Changes requested', key: d.outcome === 'approved' ? 'approved' : 'changes', decision: d };
}

export async function makeDecision(c, selectedIds, {reviewer, note, checks, outcome, viewContext = {}}) {
  assert(str(reviewer), 'Enter the reviewer’s name.');
  assert(typeof note === 'string' && note.length <= 12000, 'Review note is too long.');
  assert(['approved','changes_requested'].includes(outcome), 'Unknown review action.');
  if (outcome === 'approved') {
    assert(blockers(c, selectedIds, checks).length === 0 && panelBlockers(c,selectedIds,viewContext).length === 0, 'Resolve the evidence gaps before approval.');
    if(checks.guided===true)assert(checks.package===true&&(await guidedReviewStatus(c,selectedIds,viewContext.candidateReviews,viewContext.modelSelections)).ready,'Review each selected candidate and confirm this package.');
    else assert(CHECKS.every(([id]) => checks[id] === true), 'Complete all four human checks.');
    if (checks.limitations === true) assert(note.trim().length > 0, 'Explain why you accept the recorded limitations for this selection.');
  } else assert(note.trim().length > 0, 'Explain the requested changes.');
  return {
    id: crypto.randomUUID(), campaignId:c.id, runId:c.run.id,
    createdAt:new Date().toISOString(), reviewer:reviewer.trim(), outcome,
    note:note.trim(), checks:{...checks}, selectedSubjectIds:[...selectedIds],...(checks.guided===true?{reviewMode:'guided_v1'}:{}),
    snapshotDigest:await reviewDigest(c, selectedIds, viewContext), demo:c.demo,
    campaignSnapshot:structuredClone(c), viewContext:structuredClone(viewContext),
    attestation:'Browser-local, self-reported review; unsigned and not authenticated. No execution, spending, publication or submission is authorized.',
  };
}
