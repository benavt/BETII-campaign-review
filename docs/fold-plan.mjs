// Planning and browser-local scope review only. This module has no launch API.
import { cacheAuditSummary } from './cache-audit.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 12000;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const finiteCost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const timestamp = value => text(value) && Number.isFinite(Date.parse(value)) && /(Z|[+-]\d\d:\d\d)$/.test(value);
const key = cell => JSON.stringify([cell.candidateId, cell.target, cell.engine, cell.variant]);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : record(value) ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const https = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };
function assetURL(value) {
  if (typeof value !== 'string' || !value.startsWith('assets/') || value.includes('..') || /[\\%?#:]/.test(value)) return null;
  return './data/' + value.split('/').map(encodeURIComponent).join('/');
}

export function validateFoldPlan(campaign) {
  const plan = campaign?.foldPlan;
  assert(record(plan) && plan.schemaVersion === 1 && text(plan.id), 'Fold plan requires schemaVersion 1 and an identity.');
  assert(timestamp(plan.createdAt), 'Fold plan requires a timestamp with timezone.');
  assert(campaign.cacheAudit && plan.cacheAuditId === campaign.cacheAudit.id, 'Fold plan must refer to the current cache audit.');
  assert(hash(plan.sourceDigest) && text(plan.summary), 'Fold plan requires its recorded source fingerprint and scope summary.');
  assert(Array.isArray(plan.stages) && plan.stages.length > 0 && plan.stages.length <= 30, 'Fold plan requires 1–30 stages.');
  const stageIds = new Set();
  for (const stage of plan.stages) {
    assert(record(stage) && /^[a-z][a-z0-9_-]{0,63}$/.test(stage.id) && !stageIds.has(stage.id), 'Fold plan stage identities must be unique.');
    assert(text(stage.label) && text(stage.gate) && text(stage.description) && Number.isInteger(stage.priority) && stage.priority >= 0, 'Each stage requires a label, gate, description and nonnegative integer priority.');
    stageIds.add(stage.id);
  }
  assert(stageIds.has('initial'), 'Fold plan requires an initial stage.');
  const audit = cacheAuditSummary(campaign), rows = new Map(audit.rows.map(row => [key(row), row]));
  const missing = audit.rows.filter(row => row.classification !== 'loaded');
  assert(Array.isArray(plan.cells) && plan.cells.length === missing.length, 'Fold plan must partition every currently unloaded cell exactly once.');
  const seen = new Set(), cellIds = new Set();
  for (const cell of plan.cells) {
    assert(record(cell) && text(cell.id) && !cellIds.has(cell.id), 'Fold plan cell identities must be unique.');
    const identity = key(cell), row = rows.get(identity);
    assert(row && row.classification !== 'loaded', 'Fold plan cannot contain an unknown or already loaded comparison.');
    assert(!seen.has(identity), 'Fold plan repeats a comparison cell.');
    assert(stageIds.has(cell.stageId) && Number.isInteger(cell.sampleCount) && cell.sampleCount > 0 && cell.sampleCount <= 10000 && text(cell.reason), 'Each planned comparison needs a stage, explicit sample count and reason.');
    if (cell.input !== undefined) {
      const input = cell.input, subject = campaign.subjects.find(subject => subject.id === cell.candidateId);
      const variant = subject.constructVariants?.find(variant => variant.id === cell.variant);
      const construct = variant?.sequence || (variant?.tagSequence && subject.sequence ? subject.sequence + variant.tagSequence : cell.variant === 'untagged' ? subject.sequence : null) || subject.modelCoverage.models.find(model => model.constructVariant === cell.variant && model.constructSequence)?.constructSequence;
      const targets = subject.modelCoverage.models.filter(model => model.target === cell.target && text(model.targetSequence));
      assert(record(input) && text(construct) && input.constructSequence === construct, 'Planned input does not match the recorded construct sequence.');
      assert(targets.length > 0 && new Set(targets.map(model => model.targetSequence)).size === 1 && input.targetSequence === targets[0].targetSequence, 'Planned input does not match an unambiguous recorded target construct.');
      assert(hash(input.constructSequenceSha256) && hash(input.targetSequenceSha256), 'Planned input requires construct and target sequence fingerprints.');
      const constructHash = variant?.sequenceSha256 || subject.modelCoverage.models.find(model => model.constructVariant === cell.variant && model.constructSequence === construct)?.constructSequenceSha256;
      if (constructHash) assert(input.constructSequenceSha256.toLowerCase() === constructHash.toLowerCase(), 'Planned construct fingerprint contradicts recorded evidence.');
      if (targets[0].targetSequenceSha256) assert(input.targetSequenceSha256.toLowerCase() === targets[0].targetSequenceSha256.toLowerCase(), 'Planned target fingerprint contradicts recorded evidence.');
      assert(record(input.chains) && Object.keys(input.chains).length === 2 && Object.keys(input.chains).every(id => /^[A-Za-z0-9]{1,8}$/.test(id)) && Object.values(input.chains).filter(role => role === 'binder').length === 1 && Object.values(input.chains).filter(role => role === 'receptor').length === 1, 'Planned input requires distinct explicit receptor and binder chain roles.');
    }
    if (cell.workflowPin !== undefined) assert(text(cell.workflowPin) && (!campaign.workflowPin || cell.workflowPin === campaign.workflowPin), 'Planned workflow pin contradicts this campaign.');
    cellIds.add(cell.id); seen.add(identity);
  }
  assert(seen.size === missing.length, 'Fold plan has an incomplete unloaded-cell partition.');
  assert(plan.cells.some(cell => cell.stageId === 'initial'), 'The initial proposal must contain at least one comparison.');
  if (plan.scope !== undefined) assert(plan.scope === 'all_missing' && plan.cells.every(cell => cell.stageId === 'initial'), 'A full missing-model scope must include every unloaded cell in the current batch.');
  const engines = new Set(audit.rows.map(row => row.engine));
  assert(record(plan.estimates), 'Fold plan GPU estimates must be an object; unknown estimates can be omitted.');
  for (const [engine, estimate] of Object.entries(plan.estimates)) {
    assert(engines.has(engine) && record(estimate) && text(estimate.basis) && text(estimate.confidence), 'GPU estimates require a declared engine, source basis and confidence statement.');
    assert((estimate.gpuMinutesLow === null && estimate.gpuMinutesHigh === null) || (finiteCost(estimate.gpuMinutesLow) && finiteCost(estimate.gpuMinutesHigh) && estimate.gpuMinutesHigh >= estimate.gpuMinutesLow), 'GPU estimate bounds must be nonnegative, ordered numbers or both null.');
    assert(estimate.unit === undefined || ['per_cell', 'per_sample'].includes(estimate.unit), 'GPU estimate unit must be per_cell or per_sample.');
  }
  const costs = plan.costs;
  assert(record(costs) && (costs.foldCreditsPerJob === null || finiteCost(costs.foldCreditsPerJob)) && text(costs.foldCreditsBasis), 'Folding credit costs require a nonnegative estimate or explicit null and a source basis.');
  assert((costs.scoringCreditsPerCall === null || finiteCost(costs.scoringCreditsPerCall)) && text(costs.scoringCreditsBasis) && costs.scoringIsHistorical === true, 'Scoring rates must be explicitly historical; they are not an approved quote.');
  if (plan.optionalScoring !== undefined) {
    const score = plan.optionalScoring;
    assert(record(score) && score.status === 'excluded' && Number.isInteger(score.calls) && score.calls >= 0 && finiteCost(score.creditsPerCall) && finiteCost(score.credits) && Math.abs(score.credits - score.calls * score.creditsPerCall) < 1e-8 && text(score.basis), 'Optional affinity scoring must be an excluded, internally consistent historical budget.');
  }
  if (plan.reservation !== undefined) assert(record(plan.reservation) && finiteCost(plan.reservation.initialGpuHours) && text(plan.reservation.basis), 'Planning reservation needs nonnegative GPU hours and an explicit non-measured basis.');
  if (plan.observedInitial !== undefined) assert(record(plan.observedInitial) && finiteCost(plan.observedInitial.gpuMinutesLow) && finiteCost(plan.observedInitial.gpuMinutesHigh) && plan.observedInitial.gpuMinutesHigh >= plan.observedInitial.gpuMinutesLow && text(plan.observedInitial.basis), 'Observed timing evidence requires ordered nonnegative minutes and its source basis.');
  assert(Array.isArray(plan.sources) && plan.sources.length > 0 && plan.sources.every(source => record(source) && text(source.label) && (source.url === undefined || https(source.url))), 'Fold plan requires labeled sources with safe optional HTTPS links.');
  assert(Array.isArray(plan.limitations) && plan.limitations.every(text), 'Fold plan limitations must be explicit text entries.');
  assert(plan.assets === undefined || (Array.isArray(plan.assets) && plan.assets.every(asset => record(asset) && text(asset.label) && assetURL(asset.path))), 'Fold plan assets must use safe local asset references.');
  return plan;
}

export function summarizeFoldPlan(campaign) {
  const plan = validateFoldPlan(campaign), audit = cacheAuditSummary(campaign);
  const stageSummary = stage => {
    const cells = plan.cells.filter(cell => cell.stageId === stage.id);
    let low = 0, high = 0, unknownEstimateCount = 0;
    for (const cell of cells) {
      const estimate = plan.estimates[cell.engine];
      if (!estimate || estimate.gpuMinutesLow === null || !estimate.unit) { unknownEstimateCount++; continue; }
      const count = estimate.unit === 'per_sample' ? cell.sampleCount : 1;
      low += estimate.gpuMinutesLow * count; high += estimate.gpuMinutesHigh * count;
    }
    return { ...stage, cells, jobCount: cells.length, sampleCount: cells.reduce((sum, cell) => sum + cell.sampleCount, 0), gpuHoursLow: unknownEstimateCount ? null : low / 60, gpuHoursHigh: unknownEstimateCount ? null : high / 60, unknownEstimateCount, cachedReuseCount: cells.filter(cell => audit.rows.find(row => key(row) === key(cell))?.classification === 'cached_available').length };
  };
  const stages = [...plan.stages].sort((a, b) => a.priority - b.priority).map(stageSummary);
  const initial = stages.find(stage => stage.id === 'initial');
  return { planId: plan.id, missingCount: plan.cells.length, initial, stages, optionalScoring: plan.optionalScoring || null, initialFoldCredits: plan.costs.foldCreditsPerJob === null ? null : initial.jobCount * plan.costs.foldCreditsPerJob, costs: { ...plan.costs }, executionAuthorized: false, spendingAuthorized: false };
}

export function validatePlanReviews(reviews) {
  assert(Array.isArray(reviews) && reviews.length <= 10000, 'Plan reviews must be an array with at most 10,000 receipts.');
  const ids = new Set();
  for (const review of reviews) {
    assert(record(review) && text(review.id) && !ids.has(review.id) && text(review.campaignId) && text(review.planId) && text(review.reviewer) && timestamp(review.createdAt) && hash(review.snapshotDigest), 'Plan review has an invalid or duplicate identity.');
    assert(['scope_endorsed', 'changes_requested'].includes(review.outcome) && typeof review.note === 'string' && review.note.length <= 12000, 'Plan review has an invalid outcome or note.');
    assert(review.executionAuthorized === false && review.spendingAuthorized === false && review.scoringAuthorized === false, 'Plan scope reviews cannot authorize execution, spending or affinity scoring.');
    assert(review.outcome !== 'changes_requested' || review.note.trim(), 'Requested plan changes need an explanation.');
    ids.add(review.id);
  }
  return reviews;
}

async function planDigest(campaign) {
  validateFoldPlan(campaign);
  // Binding the entire source campaign includes sequences/constructs, target
  // identities, native hashes, observations, priorities, source selection and audit.
  const missing = cacheAuditSummary(campaign).rows.filter(row => row.classification !== 'loaded').map(row => [row.candidateId, row.target, row.engine, row.variant, row.classification]);
  const scientificCampaign=JSON.parse(JSON.stringify(campaign));
  delete scientificCampaign.molecularViewPresets;
  for(const subject of scientificCampaign.subjects)for(const model of subject.modelCoverage?.models||[])if(model.molecularModel)delete model.molecularModel.displayFrame;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ campaign:scientificCampaign, currentUnloadedCells: missing })));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function makePlanReview(campaign, { reviewer, note = '', outcome }) {
  validateFoldPlan(campaign);
  assert(text(reviewer) && reviewer.trim().length <= 200, 'Enter the reviewer’s name.');
  assert(typeof note === 'string' && note.length <= 12000 && ['scope_endorsed', 'changes_requested'].includes(outcome), 'Choose a scope review outcome and a valid note.');
  assert(outcome !== 'changes_requested' || note.trim(), 'Explain the requested plan changes.');
  for (const cell of campaign.foldPlan.cells) if (cell.input) {
    for (const role of ['construct', 'target']) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cell.input[`${role}Sequence`]));
      const calculated = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      assert(calculated === cell.input[`${role}SequenceSha256`].toLowerCase(), `Planned ${role} sequence fingerprint does not match its frozen input.`);
    }
  }
  return { id: crypto.randomUUID(), campaignId: campaign.id, planId: campaign.foldPlan.id, createdAt: new Date().toISOString(), reviewer: reviewer.trim(), outcome, note: note.trim(), snapshotDigest: await planDigest(campaign), cacheAuditId: campaign.cacheAudit.id, executionAuthorized: false, spendingAuthorized: false, scoringAuthorized: false, attestation: 'Unsigned browser-local scope review only. This endorses proposal scope, not execution, spending, paid retries, affinity scoring or submission. A separate explicit execution request and any required current provider quote remain necessary.' };
}

export async function planReviewStatus(campaign, reviews) {
  validatePlanReviews(reviews);
  const review = [...reviews].reverse().find(item => item.campaignId === campaign.id);
  try { validateFoldPlan(campaign); } catch (error) { return { key: review ? 'stale' : 'needs_revision', label: 'Proposal needs revision against current evidence', review: review || null, reason: error.message }; }
  if (!review) return { key: 'unreviewed', label: 'Scope review pending', review: null };
  if (review.planId !== campaign.foldPlan.id || review.snapshotDigest !== await planDigest(campaign)) return { key: 'stale', label: 'Scope review out of date', review };
  return { key: review.outcome === 'scope_endorsed' ? 'endorsed' : 'changes', label: review.outcome === 'scope_endorsed' ? 'Scope endorsed · execution not authorized' : 'Scope changes requested', review };
}

export function renderFoldPlan(campaign, reviews = [], status = null) {
  validatePlanReviews(reviews);
  let summary;
  try { summary = summarizeFoldPlan(campaign); } catch (error) { return `<section class="panel fold-plan"><h2>Proposal needs revision</h2><p>The plan no longer matches the current model coverage or cache audit. Prepare a new proposal before recording a scope endorsement.</p><p class="fine muted">${esc(error.message)}</p><p>No execution or spending is authorized.</p></section>`; }
  const plan = campaign.foldPlan;
  const initial = summary.initial;
  const candidate = id => { const subject = campaign.subjects.find(subject => subject.id === id); return subject?.displayName || subject?.label || 'Candidate not recorded'; };
  const dimension = (cell, kind) => {
    const subject = campaign.subjects.find(subject => subject.id === cell.candidateId);
    const names = { 'boltz2-exact': 'Boltz2 Exact', af3: 'AlphaFold 3', 'opendde-exact': 'OpenDDE Exact', untagged: 'Untagged', ctag64: '64-aa C-terminal tag' };
    return subject?.modelCoverage?.[`${kind}Labels`]?.[cell[kind]] || names[cell[kind]] || (kind === 'variant' ? subject?.constructVariants?.find(variant => variant.id === cell.variant)?.label : null) || String(cell[kind]).replaceAll('_', ' ').replaceAll('-', ' ');
  };
  const hours = stage => stage.gpuHoursLow === null ? 'Timing reference not recorded' : `${(stage.gpuHoursLow * 60).toLocaleString('en-US',{maximumFractionDigits:1})}–${(stage.gpuHoursHigh * 60).toLocaleString('en-US',{maximumFractionDigits:1})} GPU min`;
  const reservation = plan.reservation, observed = plan.observedInitial;
  const initialTime = reservation ? `${reservation.initialGpuHours.toPrecision(2)} GPU h` : 'Not reserved';
  const stageCard = stage => `<article class="panel"><div class="panel-head"><h3>${esc(stage.label)}</h3><span class="badge ${stage.id === 'initial' ? 'ready' : 'neutral'}">${stage.id === 'initial' ? 'Initial scope' : 'Conditional / deferred'}</span></div><p>${esc(stage.description)}</p><p><strong>${stage.jobCount} proposed comparisons · ${stage.sampleCount} native samples</strong></p><p class="fine muted">GPU planning allowance: ${esc(hours(stage))} · low confidence; excludes CPU feature preparation and queue time.</p><p class="fine muted"><strong>Gate:</strong> ${esc(stage.gate)}</p>${stage.cachedReuseCount ? `<p class="notice">${stage.cachedReuseCount} exact model matches are already recorded in other caches. Import and verify those files before considering a new fold.</p>` : ''}<details ${stage.id === 'initial' ? 'open' : ''}><summary>Inspect ${stage.jobCount} comparison${stage.jobCount === 1 ? '' : 's'} in this stage</summary><div class="table-scroll"><table><thead><tr><th>Candidate</th><th>Construct</th><th>Target</th><th>Folding engine</th><th>Samples</th><th>Why this comparison</th></tr></thead><tbody>${stage.cells.map(cell => `<tr><td>${esc(candidate(cell.candidateId))}</td><td>${esc(dimension(cell, 'variant'))}</td><td>${esc(dimension(cell, 'target'))}</td><td>${esc(dimension(cell, 'engine'))}</td><td class="numeric">${cell.sampleCount}</td><td>${esc(cell.reason)}</td></tr>`).join('')}</tbody></table></div></details></article>`;
  const records = reviews.filter(review => review.campaignId === campaign.id);
  const stateLabel = status?.label || (records.length ? 'Recorded scope review · current snapshot verification pending' : 'Scope review pending');
  const sourceLinks = plan.sources.map(source => source.url ? `<a href="${esc(https(source.url))}" target="_blank" rel="noopener noreferrer">${esc(source.label)} ↗</a>` : `<span>${esc(source.label)}</span>`).join(' · ');
  const scoring = summary.optionalScoring;
  return `<section class="fold-plan"><div class="section-heading"><div><h2>A staged proposal to fill model gaps</h2><p>${esc(plan.summary)}</p></div><span class="badge ${status?.key === 'stale' ? 'blocked' : 'neutral'}">${esc(stateLabel)}</span></div><section class="notice private"><span>◇</span><div><strong>Proposal only · no jobs or paid calls are authorized.</strong> Scope endorsement below does not submit work. Current provider quotes, execution instructions and any paid-batch approvals remain separate.</div></section><div class="review-actions"><a class="button subtle" href="#fold-plan-form">Jump to scope review ↓</a></div><section class="stats"><article><span>Initial comparisons</span><strong>${initial.jobCount}</strong><small>${initial.sampleCount} proposed native samples</small></article><article><span>Initial GPU reservation</span><strong>${esc(initialTime)}</strong><small>Planning allowance: ${esc(hours(initial))}; queue and CPU preparation extra</small></article><article><span>Initial folding credits</span><strong>${summary.initialFoldCredits === null ? 'Not quoted' : esc(summary.initialFoldCredits)}</strong><small>${summary.initialFoldCredits === 0 ? 'Provider credits · existing cluster' : 'Provider estimate only · no charge authorized'}</small></article><article><span>Remaining plan scope</span><strong>${summary.missingCount - initial.jobCount}</strong><small>Conditional or deferred comparisons</small></article></section>${plan.observedInitial?`<p class="fine muted">Historical warm-cache reference: ${plan.observedInitial.gpuMinutesLow.toFixed(2)}–${plan.observedInitial.gpuMinutesHigh.toFixed(2)} GPU minutes for four jobs. ${esc(plan.observedInitial.basis)}</p>`:''}${summary.stages.map(stageCard).join('')}<section class="panel"><h3>Affinity scoring is excluded</h3><p>No folding stage includes affinity-scoring calls or permission to spend credits.</p>${scoring ? `<p>${scoring.calls} possible later calls · ${scoring.credits} historical credits at ${scoring.creditsPerCall} credits/call. <strong>Excluded from this proposal.</strong></p><p class="fine muted">${esc(scoring.basis)}</p>` : '<p class="fine muted">No later scoring batch has been selected or budgeted.</p>'}<p class="fine muted">${esc(plan.costs.scoringCreditsBasis)} A historical rate is not a current provider quote or approval.</p></section><div class="two-columns"><section class="panel"><h3>Estimate sources and limits</h3><p>${sourceLinks}</p><p class="fine muted">${esc(plan.costs.foldCreditsBasis)}</p>${reservation ? `<p class="fine muted"><strong>Planning reservation:</strong> ${esc(reservation.basis)}</p>` : ''}${observed ? `<p class="fine muted"><strong>Observed warm-cache baseline:</strong> ${observed.gpuMinutesLow.toPrecision(2)}–${observed.gpuMinutesHigh.toPrecision(2)} GPU min. ${esc(observed.basis)} This historical evidence is separate from the engineering allowance and reservation.</p>` : ''}<ul>${Object.entries(plan.estimates).map(([engine, estimate]) => `<li><strong>${esc({'boltz2-exact':'Boltz2 Exact',af3:'AlphaFold 3','opendde-exact':'OpenDDE Exact'}[engine]||engine)}</strong>: ${esc(estimate.basis)} · ${esc(estimate.confidence)}${estimate.unit ? ` · ${estimate.unit === 'per_cell' ? 'per proposed comparison' : 'per native sample'}` : ' · estimate unit not recorded'}</li>`).join('')}${plan.limitations.map(item => `<li>${esc(item)}</li>`).join('')}</ul><div class="artifact-links">${(plan.assets || []).map(asset => `<a href="${esc(assetURL(asset.path))}" download>${esc(asset.label)} ↓</a>`).join('')}</div><details class="audit-details"><summary>Proposal and exact cell identities</summary><pre>${esc(JSON.stringify({ planId: plan.id, cacheAuditId: plan.cacheAuditId, sourceDigest: plan.sourceDigest, cells: plan.cells }, null, 2))}</pre></details></section><form id="fold-plan-form" class="panel review-form"><span class="eyebrow">HUMAN PLAN REVIEW</span><h3>Review the initial ${initial.jobCount}-job scope</h3><p class="fine muted">Endorse the initial batch and the proposed priorities. Later stages remain conditional on new results and a separate scope decision.</p><label>Reviewer name<input name="reviewer" class="input" maxlength="200" required autocomplete="name"></label><label>Scope note<textarea name="note" maxlength="12000" rows="4" placeholder="Which comparisons should come first? What should change?"></textarea></label><p class="fine muted">This records an unsigned local scope review bound to the current scientific inputs and cache audit. It never authorizes execution, paid folding, scoring, retries or submission.</p><div class="review-actions"><button type="submit" class="button primary" name="outcome" value="scope_endorsed">Endorse scope only</button><button type="submit" class="button subtle" name="outcome" value="changes_requested">Request scope changes</button></div></form></div>${records.length ? `<section class="panel history"><h3>Recorded plan reviews</h3>${records.slice().reverse().map(review => `<article><strong>${esc(review.outcome === 'scope_endorsed' ? 'Recorded scope endorsement' : 'Recorded change request')}</strong> · ${esc(review.reviewer)}<time>${esc(review.createdAt)}</time><p>${esc(review.note || 'No additional scope note.')}</p><small>Execution: not authorized · Spending: not authorized · Affinity scoring: not authorized</small></article>`).join('')}</section>` : ''}</section>`;
}
