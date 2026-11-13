// A selected panel cell is an exact construct/target/engine identity. Missing
// cells and unbound observations never borrow another model's evidence.
import { coverageSummary } from './coverage.mjs';

const fingerprint = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function dimensions(subject) {
  const coverage = coverageSummary(subject);
  return { coverage, variants: coverage.variants, targets: coverage.targets, engines: coverage.engines };
}

export function observationVersionLabel(observation) {
  const version=observation?.version;
  if(!nonempty(version))return 'version not recorded';
  try {const parsed=JSON.parse(version);if(parsed&&typeof parsed==='object')return parsed.affinity_scorer_version||parsed.scorer_version||'Version details attached';}catch{}
  return version.replace(/[a-f0-9]{64}/gi,'fingerprint attached').slice(0,180);
}
export function calibrationIdentity(observation) {
  if(nonempty(observation?.calibrationId))return observation.calibrationId;
  try {const p=JSON.parse(observation?.version);if(p.calibration_head&&p.scaler_sha256&&p.score_model_sha256)return JSON.stringify([p.calibration_head,p.scaler_sha256,p.score_model_sha256]);}catch{}
  return null;
}

function labelFor(subject, kind, id) {
  const explicit = subject.modelCoverage?.[`${kind}Labels`]?.[id];
  if (nonempty(explicit)) return explicit;
  if (kind === 'variant') {
    const variant = subject.constructVariants?.find(item => item.id === id);
    if (nonempty(variant?.label)) return variant.label.replace(/; missing unless exactly matched$/, '').replace('C-terminal64', 'C-terminal 64');
  }
  return kind==='engine'?({'boltz2-exact':'Boltz2 Exact','original-diffused':'Original diffused model','af3':'AlphaFold 3','opendde-exact':'OpenDDE Exact',openfold:'OpenFold'}[id]||id):id;
}

function assertSelection(known, selection) {
  if (!selection || !known.variants.includes(selection.variant) || !known.targets.includes(selection.target) || !known.engines.includes(selection.engine)) throw new Error('Choose an explicitly declared construct variant, target and folding engine.');
}

function resolve(subject, known, selection) {
  assertSelection(known, selection);
  const model = subject.modelCoverage.models.find(item => item.constructVariant === selection.variant && item.target === selection.target && item.foldingEngine === selection.engine) || null;
  const asset = model?.molecularModel || null;
  const selectionCopy = { variant: selection.variant, target: selection.target, engine: selection.engine };
  if (!model) return { selection: selectionCopy, status: 'missing', model: null, asset: null, reason: 'No selected native model is recorded for this exact combination.' };
  return { selection: selectionCopy, status: model.status, model, asset, reason: asset ? null : 'This cell has a model record but no browser-ready structure asset.' };
}

export function resolveModel(subject, selection) {
  return resolve(subject, dimensions(subject), selection);
}

export function modelChoices(subject, partialSelection = {}) {
  const known = dimensions(subject);
  const selection = { variant: partialSelection.variant ?? known.variants[0], target: partialSelection.target ?? known.targets[0], engine: partialSelection.engine ?? known.engines[0] };
  assertSelection(known, selection);
  const models = subject.modelCoverage.models;
  const variants = known.variants.map(id => ({ id, label: labelFor(subject, 'variant', id), available: models.filter(model => model.constructVariant === id).length, total: known.targets.length * known.engines.length }));
  const targets = known.targets.map(id => ({ id, label: labelFor(subject, 'target', id), available: models.filter(model => model.constructVariant === selection.variant && model.target === id).length, total: known.engines.length }));
  const engines = known.engines.map(id => ({ id, label: labelFor(subject, 'engine', id), available: models.filter(model => model.constructVariant === selection.variant && model.target === selection.target && model.foldingEngine === id).length, total: 1 }));
  return { selection, variants, targets, engines, resolved: resolve(subject, known, selection) };
}

export function nativeModelHash(model) {
  const value = model?.modelSha256 ?? model?.molecularModel?.source?.sha256 ?? model?.molecularModel?.sha256;
  return fingerprint(value) ? value.toLowerCase() : null;
}

export function scopedMetrics(subject, model) {
  if (!model || !nonempty(model.id) || !subject?.modelCoverage?.models) return [];
  const recorded = subject.modelCoverage.models.find(item => item.id === model.id && item.target === model.target && item.foldingEngine === model.foldingEngine && item.constructVariant === model.constructVariant);
  const hash = nativeModelHash(recorded);
  if (!recorded || !hash || nativeModelHash(model) !== hash) return [];
  const observations = [...(Array.isArray(recorded.observations) ? recorded.observations : []), ...(Array.isArray(subject.observations) ? subject.observations : [])];
  const result = [], seen = new Map();
  for (const observation of observations) {
    if (!observation || observation.modelId !== model.id || !fingerprint(observation.modelSha256) || observation.modelSha256.toLowerCase() !== hash) continue;
    if (!nonempty(observation.id) || !nonempty(observation.metric) || !(observation.value === null || (typeof observation.value === 'number' && Number.isFinite(observation.value)))) continue;
    // Optional scope identities, when recorded, must also match the selected cell.
    if ((observation.target !== undefined && observation.target !== model.target) || (observation.foldingEngine !== undefined && observation.foldingEngine !== model.foldingEngine) || (observation.constructVariant !== undefined && observation.constructVariant !== model.constructVariant)) continue;
    const serialized = JSON.stringify(observation);
    if (seen.has(observation.id)) {
      if (seen.get(observation.id) !== serialized) throw new Error(`Conflicting observations share identity ${observation.id}.`);
      continue;
    }
    seen.set(observation.id, serialized);
    result.push({ ...observation });
  }
  return result;
}

function scopeLabel(value) {
  if (nonempty(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.entries(value).filter(([, item]) => ['string', 'number', 'boolean'].includes(typeof item)).map(([key, item]) => `${key}: ${item}`).join(' · ') || 'Scope not recorded';
  return 'Scope not recorded';
}

export function renderModelPanel(subject, selection = {}, {showSelectors=true}={}) {
  const choices = modelChoices(subject, selection);
  const selected = choices.resolved;
  const selector = (key, title, options) => `<label class="panel-model-selector">${esc(title)}<select class="input" data-model-dimension="${key}" aria-label="${esc(title)}">${options.map(option => `<option value="${esc(option.id)}" ${choices.selection[key] === option.id ? 'selected' : ''}>${esc(option.label)} · ${option.available}/${option.total} recorded</option>`).join('')}</select></label>`;
  const selectors = !showSelectors?'':selector('variant', 'Construct variant', choices.variants) + selector('target', 'Target isoform', choices.targets) + selector('engine', 'Folding engine', choices.engines);
  if (!selected.model) return `<section class="model-panel" data-model-panel="${esc(subject.id)}"><div class="model-panel-selectors">${selectors}</div><p class="notice">${esc(selected.reason)} Select another combination to inspect it; the missing cell stays explicit.</p></section>`;
  const model = selected.model, observations = scopedMetrics(subject, model);
  const modelName = model.displayName || model.label || `${labelFor(subject,'target',selected.selection.target)} ET · ${labelFor(subject,'engine',selected.selection.engine)} · ${labelFor(subject,'variant',selected.selection.variant)}`;
  const nativeRank = Number.isInteger(model.nativeRank) ? String(model.nativeRank) : 'Not recorded';
  const sampleCount = Number.isInteger(model.sampleCount) ? String(model.sampleCount) : 'Not recorded';
  const metricRows = observations.map(observation => `<tr><th>${esc(observation.label || observation.metric)}</th><td class="numeric">${observation.value === null ? 'Not recorded' : esc(observation.value.toPrecision(3))}${observation.unit ? ` ${esc(observation.unit)}` : ''}</td><td>${esc(observation.method || 'Method not recorded')} · ${esc(observationVersionLabel(observation))}</td><td>${esc(scopeLabel(observation.scope))}</td></tr>`).join('');
  return `<section class="model-panel" data-model-panel="${esc(subject.id)}"><div class="model-panel-selectors">${selectors}</div><div class="selected-native-model"><h3>${esc(modelName)}</h3><p>Native rank: ${esc(nativeRank)} · Samples: ${esc(sampleCount)} · ${selected.status === 'verified' ? 'Source model recorded' : 'Evidence needs review'}</p><p class="fine muted">${esc(model.scope)}</p><p class="fine muted">Folding runtime version: ${esc(model.engineVersion||'not recorded in this model receipt')}</p>${selected.reason ? `<p class="notice">${esc(selected.reason)}</p>` : ''}<details class="audit-details"><summary>Exact model identity</summary><p class="mono">${esc(model.id)}</p><p class="sequence">${esc(JSON.stringify({nativeModelSha256:nativeModelHash(model),source:model.source,observations:observations.map(o=>({metric:o.metric,version:o.version,source:o.source}))},null,2))}</p></details></div><details class="scoped-metric-details"><summary>Measurements and method details for this model</summary><div class="table-scroll"><table><caption>Metrics bound to this selected native model</caption><thead><tr><th>Metric</th><th>Value</th><th>Method</th><th>Scientific scope</th></tr></thead><tbody>${metricRows || '<tr><td colspan="4">No coordinate-bound metric observations are recorded for this model.</td></tr>'}</tbody></table></div></details></section>`;
}
