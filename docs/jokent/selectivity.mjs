// Recorded, coordinate-bound predictions only. Rendering never requests a job.
import { coverageSummary } from './coverage.mjs';
import { scopedMetrics, nativeModelHash, calibrationIdentity, observationVersionLabel } from './panel.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const stable = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value ?? null);
const engineLabel = id => ({ 'boltz2-exact': 'Boltz2 Exact', af3: 'AlphaFold 3', 'opendde-exact': 'OpenDDE Exact', openfold: 'OpenFold', all: 'All recorded methods' })[id] || id;
const variantLabel = (subject, id) => id === 'all' ? 'All construct variants' : subject.modelCoverage?.variantLabels?.[id] || subject.constructVariants?.find(item => item.id === id)?.label?.replace(/; missing unless exactly matched$/, '') || ({ untagged: 'Untagged', ctag64: 'C-terminal 64 aa tag' })[id] || id;
const metricLabel = metric => ({ ipSAE_full: 'Full-chain ipSAE', ipSAE_core: 'Designed-core ipSAE', Kd_nM: 'Predicted Kd' })[metric];
const readable = value => {
  const rendered = typeof value === 'object' && value !== null ? stable(value) : String(value ?? 'Not recorded');
  return /\/(?:Users|home|scratch|private)\//.test(rendered) ? 'Details retained in source audit' : rendered.replace(/\b[0-9a-f]{64}\b/gi, 'identity retained in audit');
};
const number = value => Number(value.toPrecision(3)).toLocaleString('en-US', { maximumSignificantDigits: 3 });

function observationState(observation) {
  if (observation.value === null) return 'not_recorded';
  if (observation.metric === 'Kd_nM') return observation.value <= 0 ? 'nonpositive_kd' : observation.unit && observation.unit !== 'nM' ? 'unsupported_unit' : 'recorded';
  return observation.value < 0 || observation.value > 1 ? 'outside_ipsae_range' : 'recorded';
}

export function selectivityData(subject, options = {}) {
  const coverage = coverageSummary(subject);
  const selection = { view: options.view ?? 'combined', engine: options.engine ?? (coverage.engines.includes('boltz2-exact') ? 'boltz2-exact' : coverage.engines[0]), variant: options.variant ?? (coverage.variants.includes('untagged') ? 'untagged' : coverage.variants[0]), metric: options.metric ?? 'ipSAE_full' };
  if (!['combined', 'confidence', 'affinity'].includes(selection.view) || !['ipSAE_full', 'ipSAE_core'].includes(selection.metric) || !['all', ...coverage.engines].includes(selection.engine) || !['all', ...coverage.variants].includes(selection.variant)) throw new Error('Choose a declared method, construct variant, metric and selectivity view.');
  const orderedTargets = ['BRD3', 'BRD2', 'BRD4', 'BRDT'].filter(id => coverage.targets.includes(id));
  const targets = [...orderedTargets, ...coverage.targets.filter(id => !orderedTargets.includes(id))];
  const allRows = [];
  for (const model of subject.modelCoverage.models) {
    for (const observation of scopedMetrics(subject, model).filter(item => ['ipSAE_full', 'ipSAE_core', 'Kd_nM'].includes(item.metric))) {
      allRows.push({ target: model.target, engine: model.foldingEngine, variant: model.constructVariant, modelId: model.id, modelSha256: nativeModelHash(model), nativeRank: model.nativeRank, sampleCount: model.sampleCount, observationId: observation.id, metric: observation.metric, value: observation.value, unit: observation.metric === 'Kd_nM' ? observation.unit || 'nM' : observation.unit ?? null, method: observation.method || null, scope: observation.scope ?? null, version: observation.version ?? null, versionLabel: observationVersionLabel(observation), calibrationId: calibrationIdentity(observation), source: observation.source ?? null, status: observationState(observation), observation });
    }
  }
  const metrics = selection.view === 'confidence' ? [selection.metric] : selection.view === 'affinity' ? ['Kd_nM'] : [selection.metric, 'Kd_nM'];
  const rows = allRows.filter(row => (selection.engine === 'all' || row.engine === selection.engine) && (selection.variant === 'all' || row.variant === selection.variant) && metrics.includes(row.metric));
  const series = [], seriesByKey = new Map();
  for (const row of rows) {
    const key = stable([row.engine, row.variant, row.metric, row.method, stable(row.scope), row.version, row.calibrationId, row.unit]);
    let group = seriesByKey.get(key);
    if (!group) {
      group = { id: `series-${series.length + 1}`, key, engine: row.engine, variant: row.variant, metric: row.metric, method: row.method, scope: row.scope, version: row.version, versionLabel: row.versionLabel, calibrationId: row.calibrationId, points: [] };
      series.push(group); seriesByKey.set(key, group);
    }
    group.points.push(row);
  }
  const gaps = [];
  for (const engine of selection.engine === 'all' ? coverage.engines : [selection.engine]) for (const variant of selection.variant === 'all' ? coverage.variants : [selection.variant]) for (const target of targets) for (const metric of metrics) {
    const model = subject.modelCoverage.models.find(item => item.target === target && item.foldingEngine === engine && item.constructVariant === variant);
    const observations = rows.filter(row => row.target === target && row.engine === engine && row.variant === variant && row.metric === metric);
    if (!observations.some(row => row.status === 'recorded')) gaps.push({ target, engine, variant, metric, modelId: model?.id ?? null, reason: !model ? 'model_missing' : !observations.length ? 'metric_missing' : observations[0].status, operation: !model ? 'fold' : observations.some(row => !['not_recorded', 'recorded'].includes(row.status)) ? 'review-evidence' : 'score-evidence' });
  }
  return { selection, targets, engines: coverage.engines, variants: coverage.variants, metrics, rows, allRows, series, gaps };
}

export const validateSelectivity = (subject, options = {}) => { selectivityData(subject, options); return true; };
const palette = ['#266da5', '#a64989', '#258472', '#b56a20', '#6553a6', '#995045', '#337c8b', '#806d21'];
const gapReason = reason => ({ model_missing: 'Native model not recorded', metric_missing: 'Model-bound score not recorded', not_recorded: 'Value explicitly not recorded', nonpositive_kd: 'Nonpositive Kd cannot appear on a log axis', unsupported_unit: 'Kd unit does not match nM', outside_ipsae_range: 'ipSAE lies outside its expected 0–1 range' })[reason] || 'Evidence requires review';

function renderPlot(subject, data, metric) {
  const groups = data.series.filter(series => series.metric === metric);
  const calibrations = [...new Set(groups.map(group => group.calibrationId).filter(Boolean))];
  const points = groups.flatMap(group => group.points.filter(point => point.status === 'recorded'));
  const log = metric === 'Kd_nM', left = 76, right = 610, top = 40, bottom = 210;
  let minimum = log && points.length ? Math.floor(Math.log10(Math.min(...points.map(point => point.value)))) : 0;
  let maximum = log && points.length ? Math.ceil(Math.log10(Math.max(...points.map(point => point.value)))) : 1;
  if (maximum === minimum) { minimum -= 1; maximum += 1; }
  const y = value => bottom - ((log ? Math.log10(value) : value) - minimum) / (maximum - minimum) * (bottom - top);
  const x = target => left + (data.targets.indexOf(target) + .5) * (right - left) / data.targets.length;
  const tickCount = Math.min(maximum - minimum + 1, 8);
  const ticks = log ? Array.from({ length: tickCount }, (_, index) => minimum + (maximum - minimum) * index / Math.max(1, tickCount - 1)) : [0, .25, .5, .75, 1];
  const title = log ? 'Isoform predicted affinity' : 'Isoform interface confidence';
  const axis = log ? 'Predicted Kd (nM, log scale) · lower predicts tighter binding' : `${metricLabel(metric)} (0–1) · higher predicts a more confident interface`;
  const svgPoints = groups.map((group, groupIndex) => group.points.filter(point => point.status === 'recorded').map((point, index) => {
    const offset = (groupIndex - (groups.length - 1) / 2) * Math.min(9, 40 / Math.max(groups.length, 1)) + index * .6;
    const label = `${point.target}, ${engineLabel(point.engine)}, ${variantLabel(subject, point.variant)}, ${metricLabel(metric)} ${number(point.value)}${log ? ' nM' : ''}, ${readable(point.scope)}`;
    return `<circle cx="${(x(point.target) + offset).toFixed(2)}" cy="${y(point.value).toFixed(2)}" r="6" fill="${palette[groupIndex % palette.length]}" stroke="white" stroke-width="1.5" role="button" tabindex="0" data-selectivity-model="${esc(point.modelId)}" data-selectivity-observation="${esc(point.observationId)}" aria-label="${esc(label)}"><title>${esc(label)}</title></circle>`;
  }).join('')).join('');
  return `<section class="selectivity-plot"><h4>${title}</h4><p class="fine muted">${esc(axis)}</p><svg viewBox="0 0 650 255" width="100%" height="255" role="group" aria-label="${esc(title)}"><line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="currentColor"/><line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="currentColor"/>${ticks.map(tick => `<line x1="${left}" x2="${right}" y1="${y(log ? 10 ** tick : tick)}" y2="${y(log ? 10 ** tick : tick)}" stroke="currentColor" opacity="0.12"/><text x="${left - 10}" y="${y(log ? 10 ** tick : tick) + 4}" text-anchor="end" fill="currentColor" font-size="12">${esc(number(log ? 10 ** tick : tick))}</text>`).join('')}${data.targets.map(target => `<text x="${x(target)}" y="235" text-anchor="middle" fill="currentColor" font-size="13">${esc(target)}</text>`).join('')}${svgPoints}${!points.length ? '<text x="340" y="120" text-anchor="middle" fill="currentColor">No recorded values for this selection</text>' : ''}</svg>${groups.length ? `<ul class="selectivity-legend">${groups.map((group, index) => `<li><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="${palette[index % palette.length]}"/></svg> ${esc(engineLabel(group.engine))} · ${esc(variantLabel(subject, group.variant))} · ${esc(group.method || 'Method not recorded')} · ${esc(group.versionLabel)}<br/><small>${esc(readable(group.scope))}${log ? group.calibrationId ? ` · Calibration group ${calibrations.indexOf(group.calibrationId) + 1}` : ' · Calibration identity not recorded; comparability is uncertain' : ''}</small></li>`).join('')}</ul>` : ''}</section>`;
}

export function renderSelectivity(subject, options = {}) {
  const data = selectivityData(subject, options);
  const control = (key, label, choices, getLabel) => `<label>${label}<select class="input" data-selectivity-control="${key}" aria-label="${label}">${choices.map(id => `<option value="${esc(id)}" ${data.selection[key] === id ? 'selected' : ''}>${esc(getLabel(id))}</option>`).join('')}</select></label>`;
  const controls = control('engine', 'Folding method', ['all', ...data.engines], engineLabel) + control('variant', 'Construct', ['all', ...data.variants], id => variantLabel(subject, id)) + (data.selection.view !== 'affinity' ? control('metric', 'Interface score scope', ['ipSAE_full', 'ipSAE_core'], metricLabel) : '');
  const title = data.selection.view === 'confidence' ? 'Isoform interface confidence' : data.selection.view === 'affinity' ? 'Isoform predicted affinity' : 'Four-isoform selectivity';
  const missing = data.gaps.map(gap => `<tr><th>${esc(gap.target)}</th><td>${esc(engineLabel(gap.engine))} · ${esc(variantLabel(subject, gap.variant))}</td><td>${esc(metricLabel(gap.metric))}</td><td>${esc(gapReason(gap.reason))}</td><td><button type="button" class="button subtle" data-selectivity-request="${esc(subject.id)}" data-selectivity-target="${esc(gap.target)}" data-selectivity-engine="${esc(gap.engine)}" data-selectivity-variant="${esc(gap.variant)}" data-selectivity-metric="${esc(gap.metric)}" data-selectivity-reason="${esc(gap.reason)}" data-selectivity-operation="${esc(gap.operation)}">Request evidence</button></td></tr>`).join('');
  const table = data.allRows.map(row => `<tr><th>${esc(row.target)}</th><td>${esc(engineLabel(row.engine))} · ${esc(variantLabel(subject, row.variant))}</td><td>${esc(metricLabel(row.metric))}</td><td>${row.value === null ? 'Not recorded' : esc(number(row.value))}${row.unit ? ` ${esc(row.unit)}` : ''}${row.status !== 'recorded' ? ` · ${esc(gapReason(row.status))}` : ''}</td><td>${esc(row.method || 'Not recorded')} · ${esc(row.versionLabel)}<br/><small>${esc(readable(row.scope))}</small></td><td><button type="button" class="button subtle" data-selectivity-model="${esc(row.modelId)}" data-selectivity-observation="${esc(row.observationId)}">Inspect native model</button></td></tr>`).join('');
  return `<section class="selectivity-panel" data-selectivity-panel="${esc(subject.id)}"><h3>${title}</h3><p class="fine muted">Scientific predictions, not measured binding. Every point retains its exact native model, construct, method and scoring scope. Full-chain and designed-core ipSAE are separate; Kd values are never inferred or averaged.</p><div class="model-panel-selectors">${controls}</div>${data.metrics.map(metric => renderPlot(subject, data, metric)).join('')}<p class="fine muted">Select a point to inspect its exact native model. Separate legend entries retain different scopes, versions or calibrations; equal colors do not establish scientific comparability.</p>${missing ? `<details class="selectivity-gaps" ${data.gaps.length <= 8 ? 'open' : ''}><summary>${data.gaps.length} missing or invalid prediction cells</summary><p class="fine muted">Requests collect follow-up evidence only. No job runs or credits are spent here.</p><div class="table-scroll"><table><thead><tr><th>Isoform</th><th>Method / construct</th><th>Metric</th><th>Evidence gap</th><th>Follow-up</th></tr></thead><tbody>${missing}</tbody></table></div></details>` : '<p class="fine muted">All selected isoforms have recorded model-bound values for the displayed metrics.</p>'}<details><summary>All ${data.allRows.length} recorded model-bound values for this candidate</summary><div class="table-scroll"><table><thead><tr><th>Isoform</th><th>Method / construct</th><th>Metric</th><th>Recorded value</th><th>Method / scope</th><th>Structure</th></tr></thead><tbody>${table || '<tr><td colspan="6">No model-bound values recorded.</td></tr>'}</tbody></table></div></details><details class="audit-details"><summary>Prediction source identities</summary><pre>${esc(JSON.stringify(data.allRows.map(({ target, engine, variant, modelId, modelSha256, observationId, metric, calibrationId, version, source }) => ({ target, engine, variant, modelId, modelSha256, observationId, metric, calibrationId, version, source })), null, 2))}</pre></details></section>`;
}
