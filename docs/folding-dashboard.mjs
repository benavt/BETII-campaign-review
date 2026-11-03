// A view of existing model coverage and a request builder. Nothing is submitted.
import { cacheAuditSummary, CACHE_STATES } from './cache-audit.mjs';
import { summarizeFoldPlan } from './fold-plan.mjs';
import { renderNativeProgress } from './native-progress.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const key = cell => JSON.stringify([cell.candidateId, cell.target, cell.engine, cell.variant]);
const engineName = engine => ({'boltz2-exact':'Exact',af3:'AF3','opendde-exact':'OpenDDE'}[engine] || engine);
const variantName = variant => ({untagged:'Untagged',ctag64:'64-aa tag'}[variant] || variant);
const decimal = value => Number(value.toPrecision(3)).toString();
const range = (low, high, unit = 'GPU min') => low == null || high == null ? 'Compute estimate unavailable' : `${decimal(low)}${low === high ? '' : '–' + decimal(high)} ${unit}`;
const presentation = value => String(value ?? '').replace(/scope endorsement/gi, 'request review').replace(/scope_endorsed/gi, 'request_reviewed').replace(/endorse(?:ment)?/gi, 'review');
const safeAsset = path => typeof path === 'string' && path.startsWith('assets/') && !path.includes('..') && !/[\\%?#:]/.test(path) ? './data/' + path.split('/').map(encodeURIComponent).join('/') : null;
const actionFor = classification => classification === 'cached_available' ? 'recover_cached' : classification === 'pending' ? 'reconcile_pending' : classification === 'record_only' ? 'verify_saved_model' : 'prepare_fold';
const requestMessage = state => ({draft:'Request prepared for review; no job has been submitted.',quote_required:'A current quote is needed before this request can proceed.',ready_for_review:'Inputs are ready for review; no execution or spending is authorized.'}[typeof state === 'string' ? state : state?.status] || 'Request prepared for review; no job has been submitted.');

export function foldingDashboard(campaign) {
  const summary = summarizeFoldPlan(campaign), audit = cacheAuditSummary(campaign);
  const planned = new Map(campaign.foldPlan.cells.map(cell => [key(cell), cell]));
  const stages = new Map(summary.stages.map(stage => [stage.id, stage]));
  const rows = audit.rows.map(row => {
    const cell = planned.get(key(row)), subject = campaign.subjects.find(s => s.id === row.candidateId);
    const model = subject.modelCoverage.models.find(m => m.id === row.modelId);
    return {...row, cellId: cell?.id ?? null, stageId: cell?.stageId ?? null,
      pilot: cell?.stageId === 'initial', available: row.classification === 'loaded',
      modelStatus: model?.status ?? null, sampleCount: cell?.sampleCount ?? model?.sampleCount ?? null,
      reason: cell?.reason || row.reason, stageLabel: cell ? stages.get(cell.stageId).label : null};
  });
  return {campaignId: campaign.id, planId: campaign.foldPlan.id, fullScope: campaign.foldPlan.scope === 'all_missing', summary, rows,
    subjects: campaign.subjects.filter(s => s.modelCoverage),
    targets: [...new Set(rows.map(r => r.target))], engines: [...new Set(rows.map(r => r.engine))], variants: [...new Set(rows.map(r => r.variant))],
    availableCount: rows.filter(r => r.available).length, missingCount: summary.missingCount,
    pilotCount: summary.initial.jobCount, conditionalCount: summary.missingCount - summary.initial.jobCount};
}

export function foldingRequest(campaign, selection = 'initial') {
  const dashboard = foldingDashboard(campaign), plan = campaign.foldPlan;
  const cells = selection === 'all' ? plan.cells : selection === 'initial' ? plan.cells.filter(c => c.stageId === 'initial') : plan.cells.filter(c => c.id === selection);
  if (!cells.length) throw new Error('Choose a currently missing model or a nonempty planned batch.');
  const rows = new Map(dashboard.rows.map(row => [key(row), row]));
  let low = 0, high = 0, unknown = 0;
  for (const cell of cells) {
    const estimate = plan.estimates[cell.engine], recover = actionFor(rows.get(key(cell)).classification) !== 'prepare_fold';
    if (recover || !estimate?.unit || estimate.gpuMinutesLow == null) { unknown++; continue; }
    const multiplier = estimate.unit === 'per_sample' ? cell.sampleCount : 1;
    low += estimate.gpuMinutesLow * multiplier; high += estimate.gpuMinutesHigh * multiplier;
  }
  const recoverCount = cells.filter(c => actionFor(rows.get(key(c)).classification) !== 'prepare_fold').length;
  return {schemaVersion: 1, kind: 'folding_request_draft', campaignId: campaign.id, planId: plan.id,
    cacheAuditId: plan.cacheAuditId, sourceDigest: plan.sourceDigest, selection,
    cells: cells.map(cell => ({...structuredClone(cell), requestedOperation: actionFor(rows.get(key(cell)).classification)})),
    jobCount: cells.length, sampleCount: cells.reduce((sum,c) => sum + c.sampleCount, 0), recoveryOrRecheckCount: recoverCount,
    gpuMinutesLow: unknown ? null : low, gpuMinutesHigh: unknown ? null : high, unknownEstimateCount: unknown,
    foldCredits: recoverCount || plan.costs.foldCreditsPerJob == null ? null : cells.length * plan.costs.foldCreditsPerJob,
    quoteStatus: 'estimate_only', requiresCacheRecheck: true,
    executionAuthorized: false, spendingAuthorized: false, scoringAuthorized: false,
    status: 'draft', note: 'Prepared for review; no job, scoring call or paid request has been submitted.'};
}

function estimateDetails(campaign, dashboard) {
  const plan = campaign.foldPlan;
  return `<details class="fold-assumptions"><summary>Compute, credits and scientific assumptions</summary><p>Ranges are planning estimates, not a fixed quote. CPU preparation, queue time and cold compilation are not included unless their source explicitly says so.</p><div class="fold-estimate-list">${Object.entries(plan.estimates).map(([engine, estimate]) => `<article><strong>${esc(engineName(engine))}</strong><span>${range(estimate.gpuMinutesLow,estimate.gpuMinutesHigh)}${estimate.unit ? ' / ' + (estimate.unit === 'per_cell' ? 'comparison' : 'native sample') : ' · unit not recorded'}</span><p>${esc(presentation(estimate.basis))}</p><small>${esc(presentation(estimate.confidence))}</small></article>`).join('')}</div>${plan.reservation ? `<p><strong>Chosen pilot reservation:</strong> ${esc(decimal(plan.reservation.initialGpuHours))} GPU h. ${esc(presentation(plan.reservation.basis))}</p>` : ''}${plan.observedInitial ? `<p><strong>Historical warm-cache baseline:</strong> ${range(plan.observedInitial.gpuMinutesLow,plan.observedInitial.gpuMinutesHigh)}. ${esc(presentation(plan.observedInitial.basis))}</p>` : ''}<p><strong>Folding credits:</strong> ${plan.costs.foldCreditsPerJob == null ? 'Not quoted.' : esc(plan.costs.foldCreditsPerJob) + ' provider credits per comparison.'} ${esc(presentation(plan.costs.foldCreditsBasis))}</p><p><strong>Affinity scoring is excluded.</strong> ${esc(presentation(plan.costs.scoringCreditsBasis))}${plan.optionalScoring ? ` Any later selected batch (${plan.optionalScoring.calls} possible calls; ${plan.optionalScoring.credits} historical credits) needs its own current quote and approval. ${esc(presentation(plan.optionalScoring.basis))}` : ''}</p><ol>${dashboard.summary.stages.map(stage => `<li><strong>${esc(presentation(stage.label))} · ${stage.jobCount} comparisons</strong><p>${esc(presentation(stage.description))}</p><small>${esc(presentation(stage.gate))}</small></li>`).join('')}</ol><ul>${plan.limitations.map(limit => `<li>${esc(presentation(limit))}</li>`).join('')}</ul><ul>${plan.sources.map(source => `<li>${source.url ? `<a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.label)} ↗</a>` : esc(source.label)}</li>`).join('')}</ul><div class="artifact-links">${(plan.assets || []).map(asset => `<a href="${esc(safeAsset(asset.path))}" download>${esc(asset.label)} ↓</a>`).join('')}</div><details class="audit-details"><summary>Exact planned inputs and source identities</summary><pre>${esc(JSON.stringify({planId:plan.id,cacheAuditId:plan.cacheAuditId,sourceDigest:plan.sourceDigest,workflow:plan.workflow,cells:plan.cells},null,2))}</pre></details></details>`;
}

export function renderFoldingDashboard(campaign, {selectedCellId = null, requestState = null} = {}) {
  let dashboard;
  try { dashboard = foldingDashboard(campaign); }
  catch(error) { return `<section class="panel folding-dashboard"><h2>Folding plan needs an update</h2><p>The plan and current model coverage do not match.</p><p class="fine muted">${esc(error.message)}</p><p>No request has been submitted.</p></section>`; }
  const initial = foldingRequest(campaign,'initial'), byKey = new Map(dashboard.rows.map(row => [key(row),row]));
  const chosen = (selectedCellId ? dashboard.rows.find(row => row.cellId === selectedCellId) : null) || dashboard.rows.find(row => row.pilot);
  const selected = chosen ? foldingRequest(campaign,chosen.cellId) : null;
  const label = row => `${row.candidateLabel || row.candidateId}; ${row.target}; ${engineName(row.engine)}; ${variantName(row.variant)}`;
  const cellButton = row => {
    if (!row) return '<span class="fold-cell fold-na" aria-label="Outside this candidate panel">—</span>';
    const state = row.available ? 'available' : row.pilot ? 'pilot' : row.classification === 'cached_available' ? 'cached' : 'missing';
    const title = `${label(row)} · ${row.available ? 'Native model available; scientific review is separate' : row.pilot ? (dashboard.fullScope ? 'Included in full missing-model request' : 'Pilot fold') : CACHE_STATES[row.classification].label}`;
    return `<button type="button" class="fold-cell ${state} ${row.cellId === chosen?.cellId ? 'selected' : ''}" ${row.available ? `data-fold-model="${esc(row.modelId)}" data-fold-candidate="${esc(row.candidateId)}"` : `data-fold-select="${esc(row.cellId)}"`} aria-label="${esc(title)}" title="${esc(title)}"${row.cellId ? ` aria-pressed="${row.cellId === chosen?.cellId}"` : ''}>${row.available ? '✓' : row.pilot ? '★' : state === 'cached' ? '↗' : '+'}</button>`;
  };
  const matrix = `<div class="fold-matrix-scroll" tabindex="0" role="region" aria-label="Model availability by candidate, isoform, method and construct"><table class="fold-matrix"><caption class="sr-only">Each isoform contains one row per method and one column per construct. Available models are separate from scientific acceptance.</caption><thead><tr><th scope="col">Candidate</th>${dashboard.targets.map(target => `<th scope="col">${esc(target)}<span class="fold-construct-head">${dashboard.variants.map(v => `<span>${esc(v === 'untagged' ? 'U' : v === 'ctag64' ? 'Tag' : v)}</span>`).join('')}</span></th>`).join('')}</tr></thead><tbody>${dashboard.subjects.map(subject => `<tr><th scope="row"><span class="fold-candidate-label">${esc(subject.displayName || subject.label || subject.id)}</span><small>${esc(subject.group || '')}</small></th>${dashboard.targets.map(target => `<td><div class="fold-mini-grid" style="--fold-variants:${dashboard.variants.length}">${dashboard.engines.map(engine => `<span class="fold-method-label" title="${esc(engineName(engine))}">${esc(engine === 'boltz2-exact' ? 'E' : engine === 'af3' ? 'A' : engine === 'opendde-exact' ? 'O' : engineName(engine))}</span>${dashboard.variants.map(variant => cellButton(byKey.get(key({candidateId:subject.id,target,engine,variant})))).join('')}`).join('')}</div></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  return `<section class="folding-dashboard"><div class="section-heading"><div><h2>Model coverage</h2></div><span class="badge neutral">${dashboard.availableCount}/${dashboard.rows.length} native models available</span></div>${renderNativeProgress(campaign)}<section class="fold-pilot-card"><div><span class="eyebrow">${dashboard.fullScope ? 'FULL COMPARISON PANEL' : 'RECOMMENDED FIRST'}</span><h3>${dashboard.pilotCount} ${dashboard.fullScope ? 'missing comparisons included' : 'pilot folds'}</h3><p>${initial.sampleCount} native samples · ${range(initial.gpuMinutesLow,initial.gpuMinutesHigh)}</p><small>${initial.foldCredits == null ? 'Provider cost not quoted' : initial.foldCredits + ' provider folding credits; cluster allocation separate'}. Estimate only.</small></div><button type="button" class="button primary" data-fold-request="initial">${dashboard.fullScope ? 'Review full-batch inputs' : 'Prepare pilot request'} →</button></section><div class="fold-dashboard-toolbar"><p>${dashboard.fullScope ? 'All missing comparisons are included; none are deferred. Choose a cell to inspect its inputs.' : `<strong>${dashboard.conditionalCount}</strong> conditional comparisons · choose a cell to review its inputs.`}</p><button type="button" class="button subtle" data-fold-request="all">Run all missing (${dashboard.missingCount})…</button></div><p class="fold-request-caption">Buttons prepare a request for review. Nothing is launched or charged here.</p><div class="fold-matrix-legend"><span><i class="available">✓</i> Native model available</span><span><i class="pilot">★</i> ${dashboard.fullScope ? 'Included in full request' : 'Pilot fold'}</span>${dashboard.conditionalCount ? '<span><i class="missing">+</i> Conditional / deferred</span>' : ''}${dashboard.rows.some(row => row.classification === 'cached_available') ? '<span><i class="cached">↗</i> Recover saved model</span>' : ''}<span>E Exact · A AF3 · O OpenDDE</span><span>U untagged · Tag 64-aa extension</span></div>${matrix}${chosen ? `<section class="panel fold-selected-cell" aria-live="polite"><div><span class="eyebrow">${dashboard.fullScope ? 'INCLUDED COMPARISON' : chosen.pilot ? 'PILOT FOLD' : 'CONDITIONAL COMPARISON'}</span><h3>${esc(chosen.candidateLabel || chosen.candidateId)}</h3><p>${esc(chosen.target)} · ${esc(engineName(chosen.engine))} · ${esc(variantName(chosen.variant))}</p><p class="fine muted">${esc(presentation(chosen.reason))}</p><small>${chosen.sampleCount} native samples · ${range(selected.gpuMinutesLow,selected.gpuMinutesHigh)} · ${selected.foldCredits == null ? 'cost not quoted' : selected.foldCredits + ' provider credits'}</small></div><button type="button" class="button primary" data-fold-request="cell" data-fold-cell="${esc(chosen.cellId)}">${selected.recoveryOrRecheckCount ? 'Prepare cache check' : 'Prepare this fold'} →</button></section>` : ''}${requestState ? `<p class="fold-request-state" role="status">${esc(requestMessage(requestState))}</p>` : ''}${estimateDetails(campaign,dashboard)}</section>`;
}
