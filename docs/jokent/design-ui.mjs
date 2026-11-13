// Enhance a local design request form; never submit jobs or change source assets.
import { mountMolecule, molecularAssetURL } from './molecule.mjs';
import { nativeModelHash } from './panel.mjs';
import { expandParameterSweep } from './jobs.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 12000;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const validChain = value => typeof value === 'string' && /^[A-Za-z0-9]{1,8}$/.test(value);
const clone = value => structuredClone(value);
const engineLabel = id => ({ 'boltz2-exact': 'Boltz2 Exact', af3: 'AlphaFold 3', 'opendde-exact': 'OpenDDE Exact' })[id] || id;
function sourceFor(asset) {
  const source = asset?.source;
  if (!text(source?.path) || !hash(source.sha256) || !hash(asset.sha256) || source.sha256.toLowerCase() !== asset.sha256.toLowerCase()) return null;
  return { path: source.path, sha256: source.sha256.toLowerCase(), label: source.title || source.label || 'Selected structure source' };
}
function validAsset(asset) {
  if (!asset || !text(asset.species) || !hash(asset.sha256) || !validChain(asset.roles?.receptor) || !['pdb','cif','mmcif'].includes(asset.format) || !sourceFor(asset)) return false;
  try { molecularAssetURL(asset.url); return true; } catch { return false; }
}
function receptorAsset(asset) {
  // Same bytes, URL and source hash. Only the rendered role mask is narrowed.
  const copy = clone(asset); copy.kind = 'receptor_only'; copy.roles = { receptor: asset.roles.receptor };
  delete copy.hotspots; return copy;
}

export function designTargetChoices(campaign, { focusId } = {}) {
  const ordered = [...(campaign?.subjects || [])].sort((a,b) => Number(b.id === focusId) - Number(a.id === focusId));
  const choices = [], seenInputs = new Set(), seenTargets = new Set();
  for (const subject of ordered) for (const structure of subject.workflowEvidence?.stages?.inputs?.structures || []) {
    const asset = structure.asset;
    if (structure.status !== 'available' || structure.modelKind !== 'input' || asset?.kind !== 'receptor_only' || asset.roles?.binder !== undefined || !validAsset(asset)) continue;
    const identity = JSON.stringify([asset.sha256.toLowerCase(),asset.roles.receptor]);
    if (seenInputs.has(identity)) continue; seenInputs.add(identity);
    const targetSequenceSha256 = hash(structure.targetSequenceSha256) ? structure.targetSequenceSha256.toLowerCase() : hash(asset.targetSequenceSha256) ? asset.targetSequenceSha256.toLowerCase() : null;
    const choice = { id: `input:${asset.sha256.toLowerCase()}:${asset.roles.receptor}`, label: `${asset.species} · retained receptor input`, targetLabel: asset.species, sourceKind: 'original_input', sourceDescription: structure.label || 'Retained receptor-only design input', candidateId: subject.id, chain: asset.roles.receptor, targetSequenceSha256, source: sourceFor(asset), asset: receptorAsset(asset), numberingScheme: `Selected input structure residue numbers (as displayed), chain ${asset.roles.receptor}` };
    choices.push(choice);
    if (targetSequenceSha256) seenTargets.add(JSON.stringify([asset.species,targetSequenceSha256]));
  }
  // Prefer the focused candidate and its declared first variant/engine. Keep
  // different exact target sequence constructs separate, even under one label.
  for (const subject of ordered) {
    const coverage = subject.modelCoverage;
    if (!coverage) continue;
    const models = [...coverage.models].sort((a,b) => coverage.expectedVariants.indexOf(a.constructVariant) - coverage.expectedVariants.indexOf(b.constructVariant) || coverage.expectedEngines.indexOf(a.foldingEngine) - coverage.expectedEngines.indexOf(b.foldingEngine));
    for (const model of models) {
      const asset = model.molecularModel;
      if (!validAsset(asset) || !hash(model.targetSequenceSha256) || nativeModelHash(model) !== asset.sha256.toLowerCase()) continue;
      const identity = JSON.stringify([model.target,model.targetSequenceSha256.toLowerCase()]);
      if (seenTargets.has(identity)) continue; seenTargets.add(identity);
      choices.push({ id: `native:${model.id}:${asset.sha256.toLowerCase()}`, label: `${model.target} · cached complex target`, targetLabel: model.target, sourceKind: 'cached_complex', sourceDescription: `${subject.displayName || subject.label || subject.id} · ${engineLabel(model.foldingEngine)} · ${subject.constructVariants?.find(variant => variant.id === model.constructVariant)?.label || model.constructVariant}. Receptor chain shown; this is a saved bound pose, not an apo input.`, candidateId: subject.id, modelId: model.id, chain: asset.roles.receptor, targetSequenceSha256: model.targetSequenceSha256.toLowerCase(), source: sourceFor(asset), asset: receptorAsset(asset), numberingScheme: `Selected native complex residue numbers (as displayed), receptor chain ${asset.roles.receptor}` });
    }
  }
  return choices;
}

export function normalizeHotspotPick(info, choice, mode = 'residue') {
  assert(choice && info && ['residue','atom'].includes(mode), 'Choose a target and a hotspot selection mode.');
  assert(info.species === choice.asset.species && hash(info.modelSha256) && info.modelSha256.toLowerCase() === choice.asset.sha256.toLowerCase(), 'The clicked atom belongs to a different target source.');
  assert(info.chain === choice.chain, 'Choose an atom on the displayed receptor chain.');
  assert(!String(info.icode ?? '').trim() && !String(info.insertionCode ?? '').trim(), 'Insertion-coded residues need an explicit numbering mapping before selection.');
  const residue = typeof info.resi === 'number' ? info.resi : typeof info.resi === 'string' && /^-?(?:0|[1-9]\d*)$/.test(info.resi) ? Number(info.resi) : NaN;
  assert(Number.isSafeInteger(residue) && residue >= -9999 && residue <= 99999, 'The clicked residue needs a supported native integer residue number.');
  const selector = { chain: choice.chain, resi: residue };
  if (mode === 'atom') { assert(typeof info.atom === 'string' && /^[A-Za-z0-9'"*+_-]{1,12}$/.test(info.atom), 'The clicked atom identity is not supported.'); selector.atom = info.atom; }
  return selector;
}
export function toggleHotspotSelection(selectors, selected) {
  const key = value => JSON.stringify([value.chain,value.resi,value.atom || null]);
  const exact = selectors.some(value => key(value) === key(selected));
  if (exact) return selectors.filter(value => key(value) !== key(selected)).map(clone);
  // Whole-residue and atom-specific picks of the same residue are alternatives.
  const remaining = selectors.filter(value => value.chain !== selected.chain || value.resi !== selected.resi || Boolean(value.atom) === Boolean(selected.atom));
  return [...remaining.map(clone),clone(selected)].sort((a,b) => a.chain.localeCompare(b.chain) || a.resi - b.resi || (a.atom || '').localeCompare(b.atom || ''));
}

function splitValues(raw) {
  assert(typeof raw === 'string' && raw.length <= 12000 && !/[\r\n\u0000]/.test(raw), 'Enter parameter values on one line.');
  const result = []; let value = '', quoted = false, inQuotes = false, afterQuote = false;
  const push = () => { assert(quoted || value.trim(), 'Parameter values cannot contain empty entries.'); result.push({ value: quoted ? value : value.trim(), quoted }); value = ''; quoted = false; afterQuote = false; };
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (inQuotes) {
      if (char === '"') { if (raw[i+1] === '"') { value += '"'; i++; } else { inQuotes = false; afterQuote = true; } }
      else value += char;
    } else if (char === ',') push();
    else if (char === '"') { assert(!value.trim() && !afterQuote, 'Put quotes around the entire comma-containing value.'); value = ''; quoted = true; inQuotes = true; }
    else if (afterQuote) assert(/\s/.test(char), 'Only a comma may follow a quoted value.');
    else value += char;
  }
  assert(!inQuotes, 'Close the double quote around the parameter value.'); push();
  return result.map(({ value, quoted }) => {
    if (quoted) return value;
    if (value === 'true') return true; if (value === 'false') return false; if (value === 'null') return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value)) { const number = Number(value); assert(Number.isFinite(number), 'Numeric parameter values must be finite.'); return number; }
    return value;
  });
}

export function parseParameterRows(rows, designsPerCombination) {
  assert(Array.isArray(rows) && rows.length <= 64, 'Use at most64 parameter rows.');
  const parameters = {}, axes = [], names = new Set();
  for (const row of rows) {
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const raw = typeof row.values === 'string' ? row.values : '';
    if (!name && !raw.trim()) continue;
    assert(name && raw.trim(), 'Each parameter row needs a name and a value.');
    assert(!names.has(name), `Parameter ${name} appears twice.`); names.add(name);
    const values = splitValues(raw);
    if (values.length === 1) Object.defineProperty(parameters,name,{ value: values[0], enumerable: true, writable: true, configurable: true });
    else axes.push({ parameter: name, values });
  }
  const count = typeof designsPerCombination === 'number' ? designsPerCombination : typeof designsPerCombination === 'string' && /^\d+$/.test(designsPerCombination) ? Number(designsPerCombination) : null;
  // expandParameterSweep validates parameter names, duplicate values and bounds.
  // The temporary count only validates combinations, never enters submitted data.
  const combinations = expandParameterSweep(parameters,{ axes, designsPerCombination: count === null ? 1 : count });
  return { parameters, axes, combinationCount: combinations.length, designsPerCombination: count, designCount: count === null ? null : combinations.length * count };
}

function element(doc, tag, className, content) {
  const node = doc.createElement(tag); if (className) node.className = className; if (content !== undefined) node.textContent = content; return node;
}

export function enhanceDesignComposer(form, campaign, { focusId, palette = {} } = {}) {
  assert(form?.ownerDocument && form.dataset.jobForm === 'design', 'A rendered design request form is required.');
  const doc = form.ownerDocument, EventClass = doc.defaultView?.Event || Event;
  const fields = Object.fromEntries(['targetLabel','targetSource','targetSha256','targetChain','numberingScheme','hotspots','parameters','sweepAxes','designsPerCombination'].map(name => [name,form.elements.namedItem(name)]));
  assert(Object.values(fields).every(Boolean), 'The design form is missing its source/parameter controls.');
  let sequenceField = form.elements.namedItem('targetSequenceSha256');
  if (!sequenceField) { sequenceField = element(doc,'input'); sequenceField.type = 'hidden'; sequenceField.name = 'targetSequenceSha256'; form.append(sequenceField); }
  const choices = designTargetChoices(campaign,{ focusId });
  let disposed = false, current = null, viewer = null, viewerReady = false, selectors = [], generation = 0;
  const listeners = [];
  const on = (node,type,callback,options) => { node.addEventListener(type,callback,options); listeners.push(() => node.removeEventListener(type,callback,options)); };
  form.classList.add('design-enhanced');

  const advanced = element(doc,'details','design-technical'); advanced.append(element(doc,'summary','', 'Technical source and request data'));
  for (const name of ['targetLabel','targetSource','targetSha256','targetChain','numberingScheme','hotspots','parameters','sweepAxes']) {
    const control = fields[name], label = control.closest('label') || control;
    control.readOnly = true; control.required = false; advanced.append(label);
  }
  const actions = form.querySelector('.review-actions'); form.insertBefore(advanced,actions);

  const panel = element(doc,'section','design-visual');
  const targetLabel = element(doc,'label','design-target-select','Design target');
  const select = element(doc,'select','input'); select.name = 'designTargetChoice'; select.required = true;
  if (!choices.length) { const option = element(doc,'option','', 'No source-bound receptor structure is available'); option.value = ''; select.append(option); }
  for (const choice of choices) { const option = element(doc,'option','',choice.label); option.value = choice.id; select.append(option); }
  targetLabel.append(select); panel.append(targetLabel);
  const description = element(doc,'p','fine muted'); panel.append(description);
  const visual = element(doc,'div','design-target-layout'), mount = element(doc,'div','design-target-viewer'); visual.append(mount);
  const picks = element(doc,'section','design-hotspot-panel'); picks.append(element(doc,'h4','', 'Pick target hotspots'));
  picks.append(element(doc,'p','fine muted','Click the receptor to select a residue. Pink marks your proposed selection. Click again to remove it.'));
  const modeLabel = element(doc,'label','', 'Select'); const mode = element(doc,'select','input');
  for (const [value,label] of [['residue','Whole residues'],['atom','Individual atoms']]) { const option = element(doc,'option','',label); option.value = value; mode.append(option); }
  mode.value = 'residue'; modeLabel.append(mode); picks.append(modeLabel);
  const reset = element(doc,'button','button subtle','Reset target view'); reset.type = 'button'; picks.append(reset);
  const chips = element(doc,'div','design-hotspot-chips'); chips.setAttribute('aria-live','polite'); picks.append(chips);
  const clear = element(doc,'button','button subtle','Clear selection'); clear.type = 'button'; picks.append(clear);
  const pickStatus = element(doc,'p','design-pick-status fine muted'); pickStatus.setAttribute('role','status'); picks.append(pickStatus);
  visual.append(picks); panel.append(visual);
  const modelStatus = element(doc,'p','fine muted design-model-status','Choose a retained target structure.'); modelStatus.setAttribute('role','status'); panel.append(modelStatus);
  form.insertBefore(panel,advanced);

  const parameterPanel = element(doc,'section','design-parameter-panel'); parameterPanel.append(element(doc,'h4','', 'Method parameters'));
  parameterPanel.append(element(doc,'p','fine muted','Add explicit settings for the chosen method. One value is fixed; multiple comma-separated values form a sweep. Put a value containing commas in double quotes.'));
  const rows = element(doc,'div','design-parameter-rows'); parameterPanel.append(rows);
  const add = element(doc,'button','button subtle','＋ Add parameter'); add.type = 'button'; parameterPanel.append(add);
  const count = element(doc,'p','design-sweep-count'); count.setAttribute('aria-live','polite'); parameterPanel.append(count);
  const error = element(doc,'p','design-form-error'); error.setAttribute('role','alert'); error.tabIndex = -1; error.hidden = true; parameterPanel.append(error);
  form.insertBefore(parameterPanel,advanced);
  const showError = message => { error.textContent = message; error.hidden = !message; };
  const emit = control => control.dispatchEvent(new EventClass('input',{ bubbles: true }));
  function syncPicks(message = '') {
    fields.hotspots.value = JSON.stringify(selectors); emit(fields.hotspots); chips.replaceChildren();
    if (!selectors.length) chips.append(element(doc,'p','muted','No hotspots selected.'));
    for (const selector of selectors) {
      const chip = element(doc,'button','design-hotspot-chip',`${selector.chain} · ${selector.resi}${selector.atom ? ' · ' + selector.atom : ''} ×`); chip.type = 'button'; chip.setAttribute('aria-label',`Remove hotspot chain ${selector.chain} residue ${selector.resi}${selector.atom ? ' atom ' + selector.atom : ''}`);
      chip.addEventListener('click',() => { if (disposed) return; selectors = toggleHotspotSelection(selectors,selector); syncPicks(); }); chips.append(chip);
    }
    clear.disabled = !selectors.length; pickStatus.textContent = message || `${selectors.length} proposed hotspot selection${selectors.length === 1 ? '' : 's'} · numbering bound to this source`;
    if (viewerReady) viewer?.setPickedResidues?.(clone(selectors));
  }
  function chooseTarget() {
    if (disposed) return;
    const token = ++generation; viewer?.dispose(); viewer = null; viewerReady = false; mount.replaceChildren(); current = choices.find(choice => choice.id === select.value) || null; selectors = []; syncPicks('Target source changed; hotspot selection cleared.');
    if (!current) { description.textContent = 'A source-bound receptor structure is needed before selecting hotspots.'; return; }
    const choice = current;
    fields.targetLabel.value = choice.targetLabel; fields.targetSource.value = choice.source.path; fields.targetSha256.value = choice.source.sha256; fields.targetChain.value = choice.chain; fields.numberingScheme.value = choice.numberingScheme; sequenceField.value = choice.targetSequenceSha256 || '';
    description.textContent = choice.sourceDescription; showError('');
    try {
      viewer = mountMolecule(mount,{ id: `design-target:${choice.id}`, label: choice.label, molecularModels: [clone(choice.asset)] },{ palette, campaignId: campaign.id, onStatus(message,state) { if (!disposed && token === generation) { modelStatus.textContent = message; modelStatus.dataset.state = state; } }, onAtomSelected(info) {
        if (disposed || token !== generation) return;
        try { const selected = normalizeHotspotPick(info,choice,mode.value); selectors = toggleHotspotSelection(selectors,selected); syncPicks(); }
        catch (problem) { pickStatus.textContent = problem.message; }
      } });
      viewer.ready?.then(() => { if (!disposed && token === generation) { viewerReady = true; viewer?.setRepresentation(mode.value === 'atom' ? 'sticks' : 'cartoon'); viewer?.setPickedResidues?.(clone(selectors)); } }).catch(() => {});
    } catch (problem) { modelStatus.textContent = problem.message; modelStatus.dataset.state = 'error'; }
  }
  const readRows = () => [...rows.querySelectorAll('.design-parameter-row')].map(row => ({ name: row.querySelector('[data-design-parameter="name"]').value, values: row.querySelector('[data-design-parameter="values"]').value }));
  function syncParameters(strict = false) {
    try {
      const state = parseParameterRows(readRows(),fields.designsPerCombination.value);
      if (strict) assert(state.designsPerCombination !== null,'Enter the number of designs per combination.');
      fields.parameters.value = JSON.stringify(state.parameters); fields.sweepAxes.value = JSON.stringify(state.axes);
      count.textContent = `${state.combinationCount} combination${state.combinationCount === 1 ? '' : 's'}${state.designCount === null ? ' · choose designs per combination' : ` × ${state.designsPerCombination} designs = ${state.designCount} total`}`;
      count.dataset.state = 'valid'; showError(''); return state;
    } catch (problem) { count.textContent = problem.message; count.dataset.state = 'error'; if (strict) throw problem; return null; }
  }
  function addRow() {
    const row = element(doc,'div','design-parameter-row');
    const nameLabel = element(doc,'label','', 'Parameter name'), name = element(doc,'input','input'); name.placeholder = 'Method parameter'; name.dataset.designParameter = 'name'; nameLabel.append(name); row.append(nameLabel);
    const valuesLabel = element(doc,'label','', 'Value or sweep values'), values = element(doc,'input','input'); values.placeholder = 'Value, another value'; values.dataset.designParameter = 'values'; valuesLabel.append(values); row.append(valuesLabel);
    const remove = element(doc,'button','button subtle','Remove'); remove.type = 'button'; row.append(remove); rows.append(row);
    on(remove,'click',() => { row.remove(); syncParameters(); }); on(name,'input',() => syncParameters()); on(values,'input',() => syncParameters());
    syncParameters(); return name;
  }
  on(select,'change',chooseTarget); on(clear,'click',() => { selectors = []; syncPicks(); }); on(reset,'click',() => viewer?.reset());
  on(mode,'change',() => { viewer?.setRepresentation(mode.value === 'atom' ? 'sticks' : 'cartoon'); pickStatus.textContent = mode.value === 'atom' ? 'Atom mode · click a displayed atom; its exact name will be included.' : 'Residue mode · click the receptor to select a whole residue.'; });
  on(add,'click',() => addRow().focus()); on(fields.designsPerCombination,'input',() => syncParameters());
  on(form,'submit',event => {
    try {
      assert(current,'Choose an available source-bound target structure.'); syncParameters(true);
      assert(fields.targetLabel.value === current.targetLabel && fields.targetSource.value === current.source.path && fields.targetSha256.value === current.source.sha256 && fields.targetChain.value === current.chain && fields.numberingScheme.value === current.numberingScheme && sequenceField.value === (current.targetSequenceSha256 || ''),'Target source details changed; select the target again before saving.');
      fields.hotspots.value = JSON.stringify(selectors);
    } catch (problem) { event.preventDefault(); event.stopImmediatePropagation(); showError(problem.message); error.focus(); }
  },true);
  addRow(); chooseTarget();
  return { dispose() { if (disposed) return; disposed = true; generation++; for (const remove of listeners) remove(); viewer?.dispose(); viewer = null; } };
}
