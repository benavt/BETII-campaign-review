// Source-bound request preparation and presentation. Execution stays in the local server.
import { coverageSummary } from './coverage.mjs';
import { nativeModelHash, scopedMetrics } from './panel.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 12000;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const timestamp = value => text(value) && Number.isFinite(Date.parse(value)) && /(Z|[+-]\d\d:\d\d)$/.test(value);
const finiteCost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const clone = value => structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : record(value) ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const cellKey = row => JSON.stringify([row.candidateId, row.target, row.engine, row.variant]);
const workKey = (kind, item) => ['fold','affinity'].includes(kind) ? JSON.stringify([kind,cellKey(item),item.modelId || null,item.modelSha256 || null]) : canonical(item);
const activeRequest = request => ['requested','approved','running'].includes(request.status);
const priorities = ['high', 'normal', 'low'];
const kinds = ['fold', 'affinity', 'evidence', 'design'];
const operations = ['evidence', 'validation', 'screen', 'filter', 'design_followup'];
export const SCRIPTED_OPERATIONS = Object.freeze([
  {id:'local-integrity-v1',label:'Check saved models and records',description:'Verify cached model files, recorded chains and retained evidence.'},
  {id:'local-coverage-v1',label:'Refresh the model coverage report',description:'Recount recorded and missing comparisons without generating models.'},
  {id:'local-sources-v1',label:'Check retained source files',description:'Verify source files already retained in this workspace; remote sources stay unresolved.'},
  {id:'local-distances-v1',label:'Recheck saved interface distances',description:'Recalculate recorded atom pairs from the selected coordinates.'}
]);

const statuses = ['requested', 'approved', 'running', 'completed', 'failed', 'cancelled'];
const parameterKey = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value) && !value.split('.').some(part => ['__proto__','prototype','constructor'].includes(part));
const scalar = value => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 4000);
const datePrefix = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function sourceRef(source) {
  if (!record(source) || !hash(source.sha256) || !text(source.path || source.sourcePath || source.url)) return null;
  return { label: source.label || source.title || 'Recorded source', path: source.path || source.sourcePath || source.url, sha256: source.sha256.toLowerCase(), ...(text(source.locator) ? { locator: source.locator } : {}) };
}
function sourcesOf(values) {
  const result = new Map();
  for (const source of values.flat().filter(Boolean)) {
    const normalized = sourceRef(source);
    if (normalized) result.set(canonical(normalized), normalized);
  }
  return [...result.values()].sort((a, b) => canonical(a).localeCompare(canonical(b)));
}
function validateSources(sources) {
  assert(Array.isArray(sources) && sources.length <= 1000 && sources.every(source => sourceRef(source)), 'Source references require an exact path/reference and SHA-256.');
}
function campaignSourceRefs(campaign, subject) {
  return sourcesOf([subject?.source, subject?.workflowEvidence?.inventorySource, campaign.foldPlan?.sources || []]);
}
function findSubject(campaign, id) {
  const subject = campaign?.subjects?.find(subject => subject.id === id);
  assert(subject, 'Request refers to an unknown candidate.'); return subject;
}
function sequenceInput(campaign, cell) {
  const subject = findSubject(campaign, cell.candidateId), models = subject.modelCoverage?.models || [];
  const variant = subject.constructVariants?.find(variant => variant.id === cell.variant);
  const planned = campaign.foldPlan?.cells?.find(item => cellKey(item) === cellKey(cell));
  const constructSequences = new Set([variant?.sequence, variant?.tagSequence && subject.sequence ? subject.sequence + variant.tagSequence : null, ...models.filter(model => model.constructVariant === cell.variant).map(model => model.constructSequence)].filter(text));
  if (constructSequences.size === 0 && cell.variant === 'untagged' && text(subject.sequence)) constructSequences.add(subject.sequence);
  const targetSequences = new Set(models.filter(model => model.target === cell.target).map(model => model.targetSequence).filter(text));
  const input = { constructSequence: constructSequences.size === 1 ? [...constructSequences][0] : null, targetSequence: targetSequences.size === 1 ? [...targetSequences][0] : null, constructSequenceSha256: null, targetSequenceSha256: null };
  // Only reuse the documented proposed chain roles; never guess scientific chains.
  if (planned?.input?.chains) input.chains = clone(planned.input.chains);
  return { input, planned, sources: campaignSourceRefs(campaign, subject), subject };
}
function dimensionLabel(subject, dimension, id) {
  const lists = { variant: subject.constructVariants, target: subject.targetIsoforms, engine: subject.foldingEngines };
  return lists[dimension]?.find(item => item.id === id)?.label || id;
}

export function missingFoldCells(campaign) {
  const rows = [];
  for (const subject of campaign?.subjects || []) {
    if (!subject.modelCoverage) continue;
    for (const cell of coverageSummary(subject).rows) if (!cell.modelId) {
      const identity = { candidateId: subject.id, target: cell.target, engine: cell.engine, variant: cell.variant };
      const planned = campaign.foldPlan?.cells?.find(item => cellKey(item) === cellKey(identity));
      const audit = campaign.cacheAudit?.entries?.find(item => cellKey(item) === cellKey(identity));
      rows.push({ ...identity, label: subject.displayName || subject.label || subject.id, sampleCount: planned?.sampleCount ?? null, planStageId: planned?.stageId ?? null, reason: planned?.reason || 'No selected native model is recorded for this exact comparison.', cacheClassification: audit?.classification || 'not_audited' });
    }
  }
  return rows;
}

export function missingAffinityCells(campaign, { metric = 'Kd_nM' } = {}) {
  const rows = [];
  for (const subject of campaign?.subjects || []) for (const model of subject.modelCoverage?.models || []) {
    const modelSha256 = nativeModelHash(model);
    if (!hash(modelSha256)) continue;
    const observations = scopedMetrics(subject, model);
    // A score for another model, construct, engine or null value cannot fill this gap.
    if (observations.some(observation => observation.metric === metric && observation.value !== null && /deltaforge/i.test(observation.method || ''))) continue;
    rows.push({ candidateId: subject.id, target: model.target, engine: model.foldingEngine, variant: model.constructVariant, modelId: model.id, modelSha256, metric, scorer: 'DeltaForge', label: subject.displayName || subject.label || subject.id, reason: 'No saved DeltaForge value bound to these exact native coordinate bytes.' });
  }
  return rows;
}

export function evidenceFollowups(campaign) {
  const followups = [];
  for (const subject of campaign?.subjects || []) for (const [stage, evidence] of Object.entries(subject.workflowEvidence?.stages || {})) {
    for (const [index, gap] of (evidence.gaps || []).entries()) {
      const question = gap.request || gap.reason || gap.field;
      if (!text(question)) continue;
      followups.push({ id: `${subject.id}::${stage}::${index}`, candidateId: subject.id, stage, operation: 'evidence', question, sources: sourcesOf([evidence.sources || [], subject.workflowEvidence?.inventorySource]), priority: 'high' });
    }
  }
  for (const evidence of campaign.evidence || []) if (evidence.status === 'missing' || evidence.status === 'needs_review') {
    const candidates = evidence.subjectIds?.length ? evidence.subjectIds : [null];
    for (const candidateId of candidates) followups.push({ id: `${evidence.id}::${candidateId || 'campaign'}`, candidateId, stage: 'review', operation: evidence.kind === 'validation' ? 'validation' : 'evidence', question: evidence.summary || evidence.note || evidence.label, sources: sourcesOf([evidence.source]), priority: 'high' });
  }
  return followups;
}

const methodNames = new Map([
  ['Foundry RFD3', { id: 'foundry-rfd3', label: 'Foundry RFD3' }],
  ['AlphaProtein Novo motif scaffolding', { id: 'apnovo', label: 'AP Novo motif scaffolding' }],
  ['AP Novo', { id: 'apnovo', label: 'AP Novo' }],
  ['Historical LigandForge', { id: 'ligandforge', label: 'LigandForge' }],
  ['LigandForge', { id: 'ligandforge', label: 'LigandForge' }],
]);
export function designMethods(campaign) {
  const methods = new Map();
  for (const subject of campaign?.subjects || []) {
    const origin = subject.designOrigin?.method, method = methodNames.get(origin);
    if (!method) continue;
    const entry = methods.get(method.id) || { ...method, originLabels: [], candidateIds: [], sources: [], runnerConfigured: false, settingsValidated: false };
    entry.originLabels = [...new Set([...entry.originLabels, origin])]; entry.candidateIds.push(subject.id);
    entry.sources = sourcesOf([entry.sources, subject.workflowEvidence?.stages?.inputs?.sources || [], subject.source]);
    methods.set(method.id, entry);
  }
  return [...methods.values()];
}

// A sweep is an explicit finite Cartesian product. There are no generated defaults.
export function expandParameterSweep(parameters, sweep) {
  assert(record(parameters) && Object.keys(parameters).length <= 64 && Object.keys(parameters).every(parameterKey), 'Provide at most 64 explicit parameter names.');
  assert(Object.values(parameters).every(value => scalar(value) || (Array.isArray(value) && value.length <= 1000 && value.every(scalar))), 'Parameter values must be finite JSON scalars or bounded lists.');
  assert(record(sweep) && Array.isArray(sweep.axes) && sweep.axes.length <= 6, 'A sweep requires an explicit list of at most six axes.');
  assert(Number.isInteger(sweep.designsPerCombination) && sweep.designsPerCombination > 0 && sweep.designsPerCombination <= 10000, 'Enter an explicit positive design count per combination.');
  const seen = new Set(); let result = [clone(parameters)];
  for (const axis of sweep.axes) {
    assert(record(axis) && parameterKey(axis.parameter) && !seen.has(axis.parameter), 'Sweep parameter names must be valid and unique.');
    assert(Array.isArray(axis.values) && axis.values.length > 0 && axis.values.length <= 100 && axis.values.every(scalar) && new Set(axis.values.map(canonical)).size === axis.values.length, 'Sweep values must be an explicit, unique, bounded list.');
    seen.add(axis.parameter); assert(result.length * axis.values.length <= 256, 'A sweep may contain at most 256 combinations.');
    result = result.flatMap(parameters => axis.values.map(value => ({ ...parameters, [axis.parameter]: value })));
  }
  assert(result.length * sweep.designsPerCombination <= 10000, 'A sweep may request at most 10,000 designs.');
  return result;
}

function validateDesign(design) {
  assert(record(design) && text(design.method), 'A design request needs an explicitly selected method origin.');
  assert(record(design.target) && text(design.target.label), 'Name the exact target construct for a design request.');
  validateSources(design.sources);
  if (design.target.structure !== null) assert(sourceRef(design.target.structure), 'Target structure must carry its exact source identity and SHA-256.');
  if (design.target.sequenceSha256 !== null) assert(hash(design.target.sequenceSha256), 'Target sequence requires its exact SHA-256.');
  assert(record(design.numbering) && ['user_specified', 'source_recorded', 'unresolved'].includes(design.numbering.status), 'Hotspot numbering needs an explicit mapping status.');
  assert(typeof design.numbering.scheme === 'string' && typeof design.numbering.chain === 'string', 'Describe hotspot numbering and its target chain explicitly.');
  if (design.numbering.status === 'source_recorded') assert(sourceRef(design.numbering.source) && design.target.structure && design.numbering.modelSha256 === design.target.structure.sha256, 'Source-recorded numbering must bind the target structure SHA and evidence.');
  assert(Array.isArray(design.hotspots) && design.hotspots.length <= 1000, 'Hotspots must be a bounded explicit selection.');
  for (const hotspot of design.hotspots) {
    assert(record(hotspot) && text(hotspot.chain) && /^[A-Za-z0-9]{1,8}$/.test(hotspot.chain) && Number.isInteger(hotspot.resi) && hotspot.resi >= -9999 && hotspot.resi <= 99999, 'Hotspots need an explicit chain and native residue number.');
    assert(hotspot.atom === undefined || (text(hotspot.atom) && /^[A-Za-z0-9'"*+_-]{1,12}$/.test(hotspot.atom)), 'Invalid hotspot atom identity.');
    assert(!design.numbering.chain || hotspot.chain === design.numbering.chain, 'Hotspot chain contradicts the declared numbering chain.');
  }
  assert(design.hotspots.length === 0 || (text(design.numbering.scheme) && text(design.numbering.chain) && design.target.structure), 'Explicit hotspots require the target structure, numbering convention and target chain.');
  const combinations = expandParameterSweep(design.parameters, design.sweep);
  assert(design.combinationCount === combinations.length && design.designCount === combinations.length * design.sweep.designsPerCombination, 'Stored design sweep counts are inconsistent.');
  assert(typeof design.settingsNote === 'string' && design.settingsNote.length <= 12000 && design.settingsValidated === false, 'New settings are proposals pending method-specific validation.');
}

function selectionRows(rows, options) {
  if (options.allMissing) return rows;
  const requested = options.cells || (options.selection && options.candidateId ? [{ candidateId: options.candidateId, ...options.selection }] : []);
  assert(Array.isArray(requested) && requested.length > 0, 'Choose a missing comparison or all missing comparisons.');
  const indexed = new Map(rows.map(row => [cellKey(row), row])), seen = new Set();
  return requested.map(selection => { const key = cellKey(selection), row = indexed.get(key); assert(row, 'The requested comparison is unknown, already available or no longer missing.'); assert(!seen.has(key), 'Request repeats a comparison.'); seen.add(key); return row; });
}

export async function prepareJobRequest(campaign, options) {
  assert(record(campaign) && text(campaign.id) && campaign.run && text(campaign.run.id), 'A request requires a recorded campaign/run.');
  assert(record(options) && kinds.includes(options.kind), 'Choose fold, affinity, evidence or design.');
  const kind = options.kind, priority = options.priority || 'normal', createdAt = options.createdAt || new Date().toISOString();
  assert(priorities.includes(priority) && timestamp(createdAt), 'Request priority or timestamp is invalid.');
  assert(text(options.projectId) && text(options.runId), 'Name the project and new request run explicitly.');
  assert(options.runnerId == null || text(options.runnerId), 'Runner identity must be explicit or null.');
  let items = [];
  if (kind === 'fold') {
    const rows = selectionRows(missingFoldCells(campaign), options);
    for (const row of rows) {
      const { input, planned, sources } = sequenceInput(campaign, row);
      for (const role of ['construct', 'target']) if (input[`${role}Sequence`]) input[`${role}SequenceSha256`] = await digestString(input[`${role}Sequence`]);
      if (planned?.input) for (const role of ['construct', 'target']) if (planned.input[`${role}SequenceSha256`]) assert(input[`${role}SequenceSha256`] === planned.input[`${role}SequenceSha256`].toLowerCase(), 'Frozen planned sequence fingerprint contradicts this request.');
      const recipe = sourceRef(options.recipes?.[row.engine]) || null;
      const sampleCount = options.sampleCount ?? row.sampleCount;
      assert(sampleCount === null || (Number.isInteger(sampleCount) && sampleCount > 0 && sampleCount <= 10000), 'Sample count must be explicit positive integer or unknown (null).');
      items.push({ ...row, operation: 'fold', calls: 1, input, sampleCount, recipe, sources, modelId: null, modelSha256: null });
    }
  } else if (kind === 'affinity') {
    for (const row of selectionRows(missingAffinityCells(campaign, { metric: options.metric || 'Kd_nM' }), options)) {
      const subject = findSubject(campaign, row.candidateId), model = subject.modelCoverage.models.find(model => model.id === row.modelId);
      items.push({ ...row, operation: 'affinity', calls: 1, sources: sourcesOf([model.source, model.molecularModel?.source, campaignSourceRefs(campaign, subject)]), scorerRecipe: sourceRef(options.scorerRecipe) || null });
    }
  } else if (kind === 'evidence') {
    const available = evidenceFollowups(campaign), ids = options.followupIds;
    if (options.allMissing) items = available.map(item => ({ ...item, ...(text(options.question)?{requestNote:options.question.trim()}:{}), calls: null }));
    else if (Array.isArray(ids) && ids.length) {
      assert(new Set(ids).size === ids.length, 'Follow-up request repeats an identity.');
      items = ids.map(id => { const item = available.find(item => item.id === id); assert(item, 'Unknown evidence follow-up.'); return { ...item, calls: null }; });
    } else {
      assert(text(options.question) && operations.includes(options.operation || 'evidence'), 'Describe the requested evidence, validation, screen or filter.');
      if (options.candidateId != null) findSubject(campaign, options.candidateId);
      const sources = sourcesOf(options.sources || []);
      items = [{ id: 'custom-followup', candidateId: options.candidateId || null, stage: options.stage || 'review', operation: options.operation || 'evidence', question: options.question.trim(), sources, calls: null }];
    }
  } else {
    const choice = designMethods(campaign).find(method => method.id === options.design?.method);
    assert(choice, 'The chosen method is not documented among this campaign’s design origins.');
    const d = options.design;
    const combinations = expandParameterSweep(d.parameters, d.sweep);
    const design = { method: choice.id, methodLabel: choice.label, target: { label: d.target?.label || '', structure: sourceRef(d.target?.structure), sequenceSha256: d.target?.sequenceSha256 || null }, numbering: clone(d.numbering || { status: 'unresolved', scheme: '', chain: '' }), hotspots: clone(d.hotspots || []), parameters: clone(d.parameters), sweep: clone(d.sweep), combinationCount: combinations.length, designCount: combinations.length * d.sweep.designsPerCombination, sources: sourcesOf([choice.sources, d.sources || []]), settingsNote: d.settingsNote || '', settingsValidated: false };
    validateDesign(design);
    // Different services batch designs differently; design count is not a priced call count.
    items = [{ operation: 'design', candidateId: null, calls: null, design }];
  }
  if(kind==='evidence'&&options.runnerOperation){assert(SCRIPTED_OPERATIONS.some(row=>row.id===options.runnerOperation),'Choose a supported scripted check.');items=items.map(item=>({...item,runnerOperation:options.runnerOperation}));}
  if (options.existingRequests !== undefined) {
    validateJobRequests(options.existingRequests);
    if(['fold','affinity'].includes(kind)){const queued=new Set(options.existingRequests.filter(request=>activeRequest(request)&&request.campaignId===campaign.id&&request.sourceRunId===campaign.run.id&&request.projectId===options.projectId.trim()&&request.kind===kind).flatMap(request=>request.items.map(canonical)));items=items.filter(item=>!queued.has(canonical(item)));}
    const active = options.existingRequests.filter(request => activeRequest(request) && request.campaignId === campaign.id && request.projectId === options.projectId.trim() && request.runId === options.runId.trim() && request.kind === kind);
    const previous = new Map(active.flatMap(request => request.items.map(item => [workKey(kind,item),item])));
    items = items.filter(item => {
      const old = previous.get(workKey(kind,item));
      if (!old) return true;
      assert(canonical(old) === canonical(item), 'This comparison already has different requested inputs/settings in the same run. Reconcile it or choose a new immutable run.');
      return false;
    });
  }
  assert(items.length > 0 && items.length <= 50000, 'No new requests remain: the selected work is already requested, no longer missing or exceeds the request limit.');
  items.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  const body = { schemaVersion: 1, kind, campaignId: campaign.id, projectId: options.projectId.trim(), runId: options.runId.trim(), sourceRunId: campaign.run.id, workflowPin: campaign.workflowPin || null, sourceSnapshot: { cacheAuditId: campaign.cacheAudit?.id || null, foldPlanId: campaign.foldPlan?.id || null }, runnerId: options.runnerId || null, items };
  const requestDigest = await digest(body);
  const request = { ...body, id: `${datePrefix(createdAt)}_${kind}-request_${requestDigest.slice(0, 16)}`, createdAt, updatedAt: createdAt, priority, title: options.title?.trim() || ({ fold: `Prepare ${items.length} missing folding comparison${items.length === 1 ? '' : 's'}`, affinity: `Request ${items.length} missing affinity score${items.length === 1 ? '' : 's'}`, evidence: `Follow up ${items.length} evidence gap${items.length === 1 ? '' : 's'}`, design: `Prepare ${items[0]?.design?.designCount} proposed designs` })[kind], requestDigest, idempotencyKey: requestDigest, status: 'requested', quote: null, approval: null, execution: { state: 'not_started', runnerId: null, receipt: null }, completion: null, attestation: 'Unsigned browser-local request metadata. Preparation does not launch work or authorize spending.' };
  validateJobRequests([request], [campaign]); return request;
}
async function digestString(value) { const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join(''); }

function requestBody(request) {
  return Object.fromEntries(['schemaVersion','kind','campaignId','projectId','runId','sourceRunId','workflowPin','sourceSnapshot','runnerId','items'].map(key => [key, request[key]]));
}
export async function requestFingerprintValid(request) {
  return hash(request?.requestDigest) && request.requestDigest === await digest(requestBody(request)) && request.idempotencyKey === request.requestDigest;
}

export function validateJobRequests(requests, campaigns) {
  assert(Array.isArray(requests) && requests.length <= 10000, 'jobRequests requires an array of at most10,000 requests.');
  const ids = new Set(), keys = new Set(), activeWork = new Set();
  for (const request of requests) {
    assert(record(request) && request.schemaVersion === 1 && kinds.includes(request.kind) && text(request.id) && !ids.has(request.id) && hash(request.requestDigest) && request.idempotencyKey === request.requestDigest && !keys.has(request.idempotencyKey), 'Invalid or duplicate job request identity.');
    ids.add(request.id); keys.add(request.idempotencyKey);
    assert(['campaignId','projectId','runId','sourceRunId','title'].every(key => text(request[key])) && timestamp(request.createdAt) && timestamp(request.updatedAt), 'Request needs exact campaign/project/run identities and timestamps.');
    assert(priorities.includes(request.priority) && statuses.includes(request.status) && (request.runnerId === null || text(request.runnerId)), 'Invalid job request state or runner.');
    assert(record(request.sourceSnapshot) && Array.isArray(request.items) && request.items.length > 0 && request.items.length <= 50000, 'Request needs source snapshot and bounded items.');
    const campaign = campaigns?.find(campaign => campaign.id === request.campaignId);
    if (campaigns) assert(campaign && campaign.run, 'Request refers to an unknown campaign.');
    const seen = new Set();
    for (const item of request.items) {
      assert(record(item), 'Invalid request item.');
      if (activeRequest(request)) {
        const identity = canonical([request.campaignId,request.projectId,request.runId,request.kind,workKey(request.kind,item)]);
        assert(!activeWork.has(identity), 'The same exact work appears in overlapping active request groups.'); activeWork.add(identity);
      }
      if (request.kind === 'fold' || request.kind === 'affinity') {
        assert(['candidateId','target','engine','variant'].every(key => text(item[key])) && item.operation === request.kind && item.calls === 1 && !seen.has(cellKey(item)), 'Each scientific request needs a unique exact comparison identity.'); seen.add(cellKey(item));
        validateSources(item.sources);assert(item.runnerOperation===undefined||SCRIPTED_OPERATIONS.some(row=>row.id===item.runnerOperation),'Unknown scripted follow-up operation.');
        if (campaign) {
          const subject = findSubject(campaign, item.candidateId), coverage = coverageSummary(subject);
          assert(coverage.targets.includes(item.target) && coverage.engines.includes(item.engine) && coverage.variants.includes(item.variant), 'Request uses an undeclared target, construct variant or folding method.');
        }
        if (request.kind === 'fold') {
          assert(record(item.input) && (item.sampleCount === null || Number.isInteger(item.sampleCount) && item.sampleCount > 0 && item.sampleCount <= 10000), 'Fold request requires pinned inputs and explicit/unknown sample count.');
          for (const role of ['construct','target']) assert((item.input[`${role}Sequence`] === null && item.input[`${role}SequenceSha256`] === null) || (text(item.input[`${role}Sequence`]) && hash(item.input[`${role}SequenceSha256`])), 'Fold sequences must be paired with their fingerprints or explicit nulls.');
          assert(item.modelId === null && item.modelSha256 === null && (item.recipe === null || sourceRef(item.recipe)), 'A missing fold cannot claim an existing native model or unbound recipe.');
        } else {
          assert(text(item.modelId) && hash(item.modelSha256) && item.scorer === 'DeltaForge' && text(item.metric) && (item.scorerRecipe === null || sourceRef(item.scorerRecipe)), 'Affinity request needs the exact native model hash and scorer identity.');
          if (campaign) {
            const model = findSubject(campaign, item.candidateId).modelCoverage.models.find(model => model.id === item.modelId);
            // Historical requests can remain after a source changes. The readiness
            // check, rather than deleting history, detects the current-source mismatch.
            assert(model || request.sourceRunId !== campaign.run.id, 'Affinity request model is absent from its stated source run.');
          }
        }
      } else if (request.kind === 'evidence') {
        assert(operations.includes(item.operation) && text(item.question) && text(item.stage) && item.calls === null && (item.candidateId === null || text(item.candidateId)), 'Evidence follow-up requires a question, stage and explicit operation.'); validateSources(item.sources);assert(item.runnerOperation===undefined||SCRIPTED_OPERATIONS.some(row=>row.id===item.runnerOperation),'Unknown scripted follow-up operation.');
        if (campaign && item.candidateId) findSubject(campaign, item.candidateId);
      } else { assert(item.operation === 'design' && item.calls === null, 'Design operations need an explicit quote before assigning billable calls.'); validateDesign(item.design); }
    }
    assert(record(request.execution) && ['not_started','running','completed','failed'].includes(request.execution.state), 'Execution state must be separate from the request status.');
    if (request.quote !== null) validateQuote(request, request.quote);
    if (request.approval !== null) validateApproval(request, request.approval);
    assert(request.status !== 'approved' || request.approval !== null, 'Approved request needs a matching approval record.');
    assert(request.status !== 'requested' || request.approval === null, 'Requested status cannot silently carry an execution approval.');
    if (['running','completed','failed'].includes(request.status)) {
      assert(request.approval !== null && request.execution.state === request.status && text(request.execution.runnerId) && sourceRef(request.execution.receipt), 'Execution states require an explicit runner receipt and prior approval.');
      assert(request.execution.runnerId === request.runnerId, 'Execution receipt names a different runner.');
      if (request.status === 'completed') assert(record(request.completion) && sourceRef(request.completion.receipt), 'Completed work needs its source-bound completion receipt.');
    } else assert(request.execution.state === 'not_started', 'A request/approval cannot imply a running or completed job.');
  }
  return requests;
}

function validateQuote(request, quote) {
  assert(record(quote) && text(quote.id) && quote.requestDigest === request.requestDigest && quote.projectId === request.projectId && quote.runId === request.runId && quote.operation === request.kind, 'Quote must bind the exact request, project, run and operation.');
  assert(text(quote.provider) && ['current_quote','historical_estimate'].includes(quote.status) && timestamp(quote.createdAt) && (quote.expiresAt === null || timestamp(quote.expiresAt)), 'Quote needs provider, rate status and timestamps.');
  assert(Number.isInteger(quote.callCount) && quote.callCount > 0 && quote.callCount <= 10000000 && finiteCost(quote.creditsPerCall) && finiteCost(quote.totalCredits) && Math.abs(quote.totalCredits - quote.callCount * quote.creditsPerCall) < 1e-8, 'Quote call count and total credits must be explicit and consistent.');
  if (['fold','affinity'].includes(request.kind)) assert(quote.callCount === request.items.reduce((sum, item) => sum + item.calls, 0), 'Quote call count differs from the selected comparisons.');
  assert(sourceRef(quote.source) && hash(quote.quoteDigest), 'Quote requires a source fingerprint and its own digest.');
}
function quoteBody(quote) { const value = clone(quote); delete value.quoteDigest; return value; }
export async function makeJobQuote(request, options) {
  validateJobRequests([request]); assert(await requestFingerprintValid(request), 'Request inputs changed; prepare a new immutable request.');
  const createdAt = options.createdAt || new Date().toISOString();
  const quote = { id: options.id, provider: options.provider, operation: request.kind, projectId: request.projectId, runId: request.runId, requestDigest: request.requestDigest, status: options.status, createdAt, expiresAt: options.expiresAt || null, callCount: options.callCount, creditsPerCall: options.creditsPerCall, totalCredits: options.totalCredits, source: sourceRef(options.source), quoteDigest: '0'.repeat(64) };
  validateQuote(request, quote); quote.quoteDigest = await digest(quoteBody(quote)); return quote;
}
export function attachJobQuote(request, quote) {
  assert(request.status === 'requested', 'A new quote needs a requested item; preserve an already approved request.');
  validateQuote(request, quote); return { ...clone(request), quote: clone(quote), updatedAt: new Date().toISOString() };
}
function validateApproval(request, approval) {
  assert(record(approval) && request.quote?.status === 'current_quote' && approval.requestDigest === request.requestDigest && approval.quoteDigest === request.quote.quoteDigest && approval.projectId === request.projectId && approval.runId === request.runId && approval.callCount === request.quote.callCount && approval.maximumCredits === request.quote.totalCredits, 'Approval must bind the exact current quote, request, call count, spend ceiling, project and run.');
  assert(text(approval.reviewer) && timestamp(approval.createdAt) && approval.executionRequested === true && approval.spendingApproved === true && approval.unsignedBrowserReceipt === true, 'Approval needs an explicit human attestation; it is not an authenticated runner receipt.');
  assert(Date.parse(approval.createdAt) >= Date.parse(request.quote.createdAt) && (!request.quote.expiresAt || Date.parse(approval.createdAt) <= Date.parse(request.quote.expiresAt)), 'Approval must occur during the quoted validity period.');
}
export async function approveJobRequest(request, { reviewer, executionRequested, spendingApproved, maximumCredits, callCount, quoteDigest, createdAt = new Date().toISOString() }) {
  validateJobRequests([request]); assert(request.status === 'requested' && await requestFingerprintValid(request), 'Prepare a fresh request before approval.');
  const quote = request.quote; assert(quote && quote.status === 'current_quote', 'A source-bound current quote is required; a historical estimate cannot authorize spending.');
  assert(quote.quoteDigest === await digest(quoteBody(quote)), 'Quote changed after it was recorded.');
  assert(quoteDigest === quote.quoteDigest && maximumCredits === quote.totalCredits && callCount === quote.callCount, 'Approve exactly the displayed calls and total credits.');
  assert(timestamp(createdAt) && (!quote.expiresAt || Date.parse(quote.expiresAt) >= Date.parse(createdAt)), 'The quote has expired.');
  assert(text(reviewer) && reviewer.trim().length <= 200 && executionRequested === true && spendingApproved === true, 'Explicit named approval of this execution request and quoted spend is required.');
  const approval = { reviewer: reviewer.trim(), createdAt, projectId: request.projectId, runId: request.runId, requestDigest: request.requestDigest, quoteDigest: quote.quoteDigest, callCount, maximumCredits, executionRequested: true, spendingApproved: true, unsignedBrowserReceipt: true, attestation: 'Unsigned browser-local approval of the exact quoted request. No submission occurred; a configured runner must independently enforce authorization and idempotency.' };
  const next = { ...clone(request), approval, status: 'approved', updatedAt: createdAt }; validateJobRequests([next]); return next;
}

export function upsertJobRequest(workspace, request) {
  validateJobRequests([request], workspace.campaigns);
  const requests = workspace.jobRequests || []; validateJobRequests(requests, workspace.campaigns);
  const existing = requests.find(item => item.idempotencyKey === request.idempotencyKey);
  if (existing) {
    assert(canonical(requestBody(existing)) === canonical(requestBody(request)), 'Idempotency identity collides with different inputs.');
    // Preparing the same batch twice never clears a quote, approval or execution.
    const next = priorities.indexOf(request.priority) < priorities.indexOf(existing.priority) ? { ...clone(existing), priority: request.priority, updatedAt: request.updatedAt } : existing;
    return { ...workspace, jobRequests: requests.map(item => item.id === existing.id ? next : item) };
  }
  assert(!requests.some(item => item.id === request.id), 'Request ID already belongs to different scientific inputs.');
  const overlapping = requests.filter(item => activeRequest(item) && item.kind === request.kind && item.campaignId === request.campaignId && item.projectId === request.projectId && item.runId === request.runId).flatMap(item => item.items.map(value => workKey(item.kind,value)));
  assert(!request.items.some(item => overlapping.includes(workKey(request.kind,item))), 'Some exact work is already requested in this run. Reuse it or prepare only the remaining comparisons.');
  return { ...workspace, jobRequests: [...requests, clone(request)] };
}
// State changes use this separate replacement path; preparation always deduplicates.
export function replaceJobRequest(workspace, request) {
  validateJobRequests([request], workspace.campaigns);
  const existing = workspace.jobRequests?.find(item => item.id === request.id);
  assert(existing && existing.idempotencyKey === request.idempotencyKey && canonical(requestBody(existing)) === canonical(requestBody(request)), 'Replacing a request cannot change its frozen inputs.');
  const jobRequests = workspace.jobRequests.map(item => item.id === request.id ? clone(request) : item); validateJobRequests(jobRequests, workspace.campaigns);
  return { ...workspace, jobRequests };
}

export async function jobReadiness(request, campaign, { now = new Date().toISOString() } = {}) {
  validateJobRequests([request]); const blockers = [];
  if (!await requestFingerprintValid(request)) blockers.push('Frozen request fingerprint no longer matches its inputs.');
  if (!campaign || campaign.id !== request.campaignId || campaign.run.id !== request.sourceRunId) blockers.push('Source campaign/run changed; reconcile before execution.');
  if (campaign && (request.sourceSnapshot.cacheAuditId !== (campaign.cacheAudit?.id || null) || request.sourceSnapshot.foldPlanId !== (campaign.foldPlan?.id || null))) blockers.push('Cache audit or proposed fold plan changed; reconcile before execution.');
  if (!request.runnerId) blockers.push('Choose and configure a runner.');
  if (request.kind === 'fold') for (const item of request.items) {
    if (!item.input.constructSequenceSha256 || !item.input.targetSequenceSha256 || !item.sampleCount || !item.recipe || !item.input.chains) blockers.push(`${item.candidateId} / ${item.target}: input, samples, chain roles or pinned recipe still needed.`);
    for (const role of ['construct','target']) if (item.input[`${role}Sequence`] && await digestString(item.input[`${role}Sequence`]) !== item.input[`${role}SequenceSha256`]) blockers.push('A frozen sequence does not match its fingerprint.');
    if (campaign?.id === request.campaignId) {
      try {
        const current = sequenceInput(campaign, item).input;
        for (const role of ['construct','target']) if (current[`${role}Sequence`] !== item.input[`${role}Sequence`]) blockers.push('The exact current construct or target sequence changed.');
      } catch { blockers.push('The original candidate/construct/target is no longer resolvable.'); }
    }
    if (campaign?.id === request.campaignId && !missingFoldCells(campaign).some(row => cellKey(row) === cellKey(item))) blockers.push('A requested fold is now available or its comparison changed; reconcile cached results first.');
    if (campaign?.cacheAudit?.entries?.some(row => cellKey(row) === cellKey(item) && row.classification === 'cached_available')) blockers.push('A matching cached model is already available; import and inspect it before requesting a new fold.');
  }
  if (request.kind === 'affinity') for (const item of request.items) {
    const subject = campaign?.subjects?.find(subject => subject.id === item.candidateId), model = subject?.modelCoverage?.models?.find(model => model.id === item.modelId);
    if (!model || nativeModelHash(model) !== item.modelSha256 || model.target !== item.target || model.foldingEngine !== item.engine || model.constructVariant !== item.variant) blockers.push('The affinity model identity/coordinate bytes changed.');
    if (!item.scorerRecipe) blockers.push('Pin the scorer version/settings and calibration source.');
    if (campaign && !missingAffinityCells(campaign, { metric: item.metric }).some(row => row.modelId === item.modelId && row.modelSha256 === item.modelSha256)) blockers.push('An exact-model affinity result is now available or its scientific identity changed; reconcile saved results first.');
  }
  if (request.kind === 'design') blockers.push('New hotspot mappings, method parameters and sweep require method-specific validation.');
  if (!request.quote || request.quote.status !== 'current_quote') blockers.push('Obtain a current source-bound quote for this exact batch.');
  else if (request.quote.quoteDigest !== await digest(quoteBody(request.quote)) || (request.quote.expiresAt && Date.parse(request.quote.expiresAt) < Date.parse(now))) blockers.push('The quote changed or expired.');
  if (!request.approval) blockers.push('Explicit approval of the exact request, calls and credits is pending.');
  return { requestId: request.id, metadataReady: blockers.length === 0, executionAvailable: false, canLaunch: false, blockers: [...new Set(blockers)], reason: 'This interface prepares request metadata. No configured execution adapter is implemented in this module.' };
}

export function jobQueueSummary(campaign, requests = []) {
  validateJobRequests(requests);
  const selected = requests.filter(request => request.campaignId === campaign.id);
  return { requests: selected, counts: Object.fromEntries(statuses.map(status => [status, selected.filter(request => request.status === status).length])), missingFolds: missingFoldCells(campaign).length, missingAffinity: missingAffinityCells(campaign).length, evidenceFollowups: evidenceFollowups(campaign).length };
}
function prioritySelect(value = 'normal') { return `<label>Priority<select class="input" name="priority">${priorities.map(priority => `<option value="${priority}" ${priority === value ? 'selected' : ''}>${priority === 'high' ? 'High · review blocker' : priority[0].toUpperCase() + priority.slice(1)}</option>`).join('')}</select></label>`; }

export function renderFoldRequestButton(campaign, candidateId, selection) {
  const row = missingFoldCells(campaign).find(row => cellKey(row) === cellKey({ candidateId, ...selection }));
  if (!row) return '';
  return `<button type="button" class="button subtle" data-job-action="prepare-cell" data-job-kind="fold" data-candidate-id="${esc(candidateId)}" data-target="${esc(row.target)}" data-engine="${esc(row.engine)}" data-variant="${esc(row.variant)}">＋ Request this missing model</button>`;
}
export function renderJobQueue(campaign, requests = [], handoffs = []) {
  const summary = jobQueueSummary(campaign, requests);
  const rows = [...summary.requests].sort((a, b) => priorities.indexOf(a.priority) - priorities.indexOf(b.priority) || b.createdAt.localeCompare(a.createdAt));
  const observed=rows.map(request=>handoffs.find(row=>row.requestDigest===request.requestDigest)?.execution?.state||request.status);
  const counts={pending:observed.filter(state=>['not_started','requested','approved','queued'].includes(state)).length,completed:observed.filter(state=>state==='completed').length,running:observed.filter(state=>state==='running').length};
  const stateLabel={not_started:'Request saved',requested:'Request saved',approved:'Approved',queued:'Waiting',running:'Running',completed:'Finished',failed:'Stopped with an error',ambiguous:'Needs inspection'};
  const cards = rows.map(request => {
    const handoff=handoffs.find(row=>row.requestDigest===request.requestDigest);
    const scripted=request.kind==='evidence'&&request.items.every(item=>SCRIPTED_OPERATIONS.some(row=>row.id===item.runnerOperation));
    const actualState=handoff?.execution?.state||request.status;
    const active = actualState === 'failed' ? 'running' : ['running','completed'].includes(actualState) ? actualState : request.approval ? 'approved' : 'requested';
    const progress = ['requested','approved','running','completed'].map((stage, index, stages) => `<li class="${index <= stages.indexOf(active) ? 'active' : ''}" ${stage === active ? 'aria-current="step"' : ''}>${esc(stage[0].toUpperCase() + stage.slice(1))}</li>`).join('');
    const credits = scripted?'Local CPU check · no provider calls or credits':request.quote ? `${request.quote.callCount} calls · ${request.quote.totalCredits} credits${request.quote.status === 'historical_estimate' ? ' · historical estimate' : ''}` : 'Calls/credits await a current quote';
    const delivery=handoff?`<div class="job-delivery"><strong>Saved by local runner · ${esc(handoff.execution?.state==='not_started'?'not started':handoff.execution?.state||'not started')}</strong><ul>${(handoff.readiness?.blockedReasons||[]).map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul><button type="button" class="button subtle" ${handoff.execution?.state&&handoff.execution.state!=='not_started'?'hidden':''} data-job-action="readiness" data-job-request-id="${esc(request.id)}">${scripted?'Preview scripted check':'Check launch readiness'}</button></div>`:`<p class="fine muted">Browser draft · not yet saved by the local runner</p><button class="button subtle" data-job-action="retain" data-job-request-id="${esc(request.id)}">Save to local runner</button>`;
    return `<article class="job-card" data-job-request-id="${esc(request.id)}"><div class="section-heading"><strong>${esc(request.title)}</strong><span class="badge neutral">${esc(stateLabel[actualState]||actualState)} · ${esc(request.priority)} priority</span></div><ol class="job-progress" aria-label="Request progress">${progress}</ol>${delivery}<p>${esc(credits)} · ${esc(scripted?'Scripted local check':request.runnerId || 'Native runner not configured')}</p><p class="fine muted">${request.items.length} selected item${request.items.length === 1 ? '' : 's'}</p><p class="fine muted audit-details">${esc(request.projectId)} / ${esc(request.runId)}</p><details><summary>Exact requested inputs</summary><ul>${request.items.map(item => `<li>${esc(item.candidateId ? [campaign.subjects.find(s=>s.id===item.candidateId)?.displayName||campaign.subjects.find(s=>s.id===item.candidateId)?.label||item.candidateId,item.variant&&dimensionLabel(findSubject(campaign,item.candidateId),'variant',item.variant),item.target,item.engine&&dimensionLabel(findSubject(campaign,item.candidateId),'engine',item.engine)].filter(Boolean).join(' · ') : item.design ? `${item.design.methodLabel} · ${item.design.designCount} designs` : 'Campaign evidence')} ${item.question ? '— ' + esc(item.question) : ''}</li>`).join('')}</ul><p class="fine muted audit-details">${esc(request.requestDigest)}</p></details><button class="button subtle" type="button" data-job-action="inspect" data-job-request-id="${esc(request.id)}">Review request</button><button class="button subtle" type="button" data-job-action="export" data-job-request-id="${esc(request.id)}">Export request</button><button class="button primary" type="button" ${scripted?'hidden':''} disabled title="No execution adapter is configured">Execution unavailable</button></article>`;
  }).join('');
  return `<section class="job-queue" data-job-queue="${esc(campaign.id)}"><div class="section-heading"><h2>Requests</h2><span class="badge neutral">${counts.pending} pending · ${counts.running} running · ${counts.completed} finished</span></div><div class="review-actions"><button class="button subtle" type="button" data-job-action="prepare-all" data-job-kind="fold" ${summary.missingFolds ? '' : 'disabled'}>＋ All ${summary.missingFolds} missing models</button><button class="button subtle" type="button" data-job-action="prepare-all" data-job-kind="affinity" ${summary.missingAffinity ? '' : 'disabled'}>＋ ${summary.missingAffinity} missing affinity scores</button><button class="button subtle" type="button" data-job-action="prepare-all" data-job-kind="evidence" ${summary.evidenceFollowups ? '' : 'disabled'}>＋ High-priority evidence (${summary.evidenceFollowups})</button><button class="button subtle" type="button" data-job-action="compose" data-job-kind="design">＋ New design / sweep</button></div>${cards || '<p class="muted">No requests yet. Add one comparison, all remaining models, or a focused evidence follow-up.</p>'}<p class="fine muted">Local scripted checks run after preview and confirmation. Native folding, scoring and design use separate adapters and approvals.</p></section>`;
}

export function renderRequestComposer(campaign, { kind = 'fold', candidateId = '', selection = {}, priority = 'normal' } = {}) {
  assert(kinds.includes(kind), 'Unknown composer kind.');
  const common = `<details class="audit-details"><summary>Project and immutable run</summary><div class="two-columns"><label>Project<input class="input" name="projectId" value="${esc(campaign.id)}" required></label><label>New request run<input class="input" name="runId" placeholder="YYYY-MM-DD_request_001" required></label></div></details>${prioritySelect(kind === 'evidence' ? 'high' : priority)}`;
  let fields;
  if (kind === 'fold' || kind === 'affinity') {
    const rows = kind === 'fold' ? missingFoldCells(campaign) : missingAffinityCells(campaign);
    const selected = rows.find(row => cellKey(row) === cellKey({ candidateId, ...selection }));
    fields = `<label>Comparisons<select class="input" name="scope"><option value="all">All ${rows.length} missing ${kind === 'fold' ? 'models' : 'scores'}</option>${rows.map((row, index) => `<option value="${index}" ${row === selected ? 'selected' : ''}>${esc(row.label)} · ${esc(dimensionLabel(findSubject(campaign,row.candidateId),'variant',row.variant))} · ${esc(row.target)} · ${esc(row.engine)}</option>`).join('')}</select></label>${kind === 'fold' ? '<p class="fine muted">Uses the documented proposed sample count where available; unknown settings stay unresolved. Pin recipes before execution.</p>' : '<p class="fine muted">Each score stays bound to one native model hash. Folding requests do not include affinity scoring.</p>'}`;
  } else if (kind === 'evidence') fields = `<label>Scripted operation<select class="input" name="runnerOperation"><option value="">Record a request for a future adapter</option>${SCRIPTED_OPERATIONS.map(row=>`<option value="${row.id}">${esc(row.label)}</option>`).join('')}</select></label><p class="fine muted">Choose a check to run automatically after reviewing its preview. Notes describe your request; scripts do not interpret notes as commands.</p><details class="audit-details"><summary>Follow-up category</summary><label>Follow-up type<select class="input" name="operation">${operations.map(operation => `<option value="${operation}">${esc(operation.replaceAll('_',' '))}</option>`).join('')}</select></label></details><label>Candidate (optional)<select class="input" name="candidateId"><option value="">Whole campaign</option>${campaign.subjects.map(subject => `<option value="${esc(subject.id)}">${esc(subject.displayName || subject.label)}</option>`).join('')}</select></label><label>Evidence or validation needed<textarea class="input" name="question" rows="3" placeholder="What should be recovered or checked?" required></textarea></label>`;
  else fields = `<label>Design method<select class="input" name="method" required><option value="">Choose a documented origin</option>${designMethods(campaign).map(method => `<option value="${esc(method.id)}">${esc(method.label)}</option>`).join('')}</select></label><label>Exact target construct<input class="input" name="targetLabel" required></label><div class="two-columns"><label>Target structure source<input class="input" name="targetSource" placeholder="Exact retained structure reference" required></label><label>Target structure SHA-256<input class="input mono" name="targetSha256" pattern="[a-fA-F0-9]{64}" required></label></div><div class="two-columns"><label>Residue numbering convention<input class="input" name="numberingScheme" placeholder="Native input PDB author numbering" required></label><label>Target chain<input class="input" name="targetChain" required></label></div><label>Hotspots (JSON selectors)<textarea class="input mono" name="hotspots" rows="2" placeholder='[{"chain":"A","resi":29,"atom":"OG"}]'>[]</textarea></label><label>Method parameters (JSON)<textarea class="input mono" name="parameters" rows="3" placeholder='Explicit proposed settings only'>{}</textarea></label><label>Sweep axes (JSON)<textarea class="input mono" name="sweepAxes" rows="2" placeholder='[{"parameter":"seed","values":[101,102]}]'>[]</textarea></label><label>Designs per combination<input class="input" name="designsPerCombination" type="number" min="1" max="10000" required></label><label>Scientific purpose / settings note<textarea class="input" name="settingsNote" rows="2"></textarea></label><p class="fine muted">No method defaults are preselected. Numbering and new parameters are proposals until source/method validation; AP Novo motif constraints remain distinct from direct hotspots. Maximum256 combinations /10,000 designs.</p>`;
  return `<form class="job-composer panel" data-job-form="${kind}" data-job-kind="${kind}"><h3>${kind === 'design' ? 'New design / parameter sweep' : kind === 'evidence' ? 'Request evidence or validation' : `Prepare missing ${kind === 'fold' ? 'models' : 'affinity scores'}`}</h3>${common}${fields}<div class="review-actions"><button class="button primary" type="submit">Save request</button><button class="button subtle" type="button" data-job-action="close-composer">Cancel</button></div><p class="fine muted">This saves a local request. It does not start jobs or approve charges.</p></form>`;
}

// Accept plain values from Object.fromEntries(new FormData(form)); no DOM dependency.
export function requestOptionsFromForm(campaign, values, { runnerId = null } = {}) {
  assert(record(values) && kinds.includes(values.kind), 'Request form needs its operation kind.');
  const options = { kind: values.kind, projectId: values.projectId, runId: values.runId, priority: values.priority || 'normal', runnerId };
  if (values.kind === 'fold' || values.kind === 'affinity') {
    const rows = values.kind === 'fold' ? missingFoldCells(campaign) : missingAffinityCells(campaign);
    if (values.scope === 'all') options.allMissing = true;
    else {
      assert(typeof values.scope === 'string' && /^\d+$/.test(values.scope) && rows[Number(values.scope)], 'Choose a current missing comparison.');
      const row = rows[Number(values.scope)];
      options.cells = [{ candidateId: row.candidateId, target: row.target, engine: row.engine, variant: row.variant }];
    }
  } else if (values.kind === 'evidence') Object.assign(options, { operation: values.operation || 'evidence', candidateId: values.candidateId || null, question: values.question, stage: values.stage || 'review',runnerOperation:values.runnerOperation||null });
  else {
    const parse = (value, name) => { try { return JSON.parse(value); } catch { throw new Error(`${name} must be valid JSON.`); } };
    assert(typeof values.designsPerCombination === 'string' && /^\d+$/.test(values.designsPerCombination), 'Enter the number of designs per combination.');
    options.design = { method: values.method, target: { label: values.targetLabel, structure: { path: values.targetSource, sha256: values.targetSha256, label: 'User-selected target structure source' }, sequenceSha256: values.targetSequenceSha256 || null }, numbering: { status: 'user_specified', scheme: values.numberingScheme || '', chain: values.targetChain || '' }, hotspots: parse(values.hotspots, 'Hotspots'), parameters: parse(values.parameters, 'Parameters'), sweep: { axes: parse(values.sweepAxes, 'Sweep axes'), designsPerCombination: Number(values.designsPerCombination) }, settingsNote: values.settingsNote || '' };
  }
  if(options.runnerOperation)options.title=SCRIPTED_OPERATIONS.find(row=>row.id===options.runnerOperation)?.label;
  return options;
}
