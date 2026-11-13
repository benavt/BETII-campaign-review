// Safe presentation of recorded workflow evidence. No source is fetched or run.
const STAGES = [
  { id: 'inputs', label: 'Design inputs', description: 'Recorded origins, conditioning sites and starting molecular context.' },
  { id: 'generated', label: 'Generated model', description: 'The original design output, kept separate from any later refold.' },
  { id: 'sequence', label: 'Exact sequence', description: 'Recorded candidate sequence and construct identity.' },
  { id: 'refold', label: 'Refolded complexes', description: 'Predicted complexes, with species, isoforms and methods kept distinct.' },
  { id: 'checks', label: 'Checks & selection', description: 'Confidence, contacts, affinity predictions, comparisons and selection evidence.' },
  { id: 'review', label: 'Human validation', description: 'Recorded researcher decisions and explicit remaining questions.' },
];
const text = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const privatePath = /(?:\/(?:Users|home|scratch|private|data)\/|[A-Za-z]:\\)/;
const fingerprint = /(?:SHA[- ]?256\s*[:=]?\s*)?\b[0-9a-f]{64}\b/gi;
const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function recordedWorkflowURL(path) {
  if(typeof path!=='string')return null;
  path=path.replace(/^\.\/data\//,'').replace(/^data\//,'');
  if(!/^(?:provenance|assets)\//.test(path)||/[\\%?#:\u0000-\u0020]/.test(path)||path.includes('..'))return null;
  return './data/'+path.split('/').map(encodeURIComponent).join('/');
}

export function foldingSettingsFor(runtime,engine){
  const prefix={'boltz2-exact':'Boltz2_',af3:'AF3_','opendde-exact':'OpenDDE_'}[engine];
  return Object.fromEntries(Object.entries(runtime?.settings||{}).filter(([key])=>! /^(?:Boltz2_|AF3_|OpenDDE_)/.test(key)||(prefix&&key.startsWith(prefix))));
}

function readable(value, fallback = 'Not recorded') {
  if (value === null || value === undefined || value === '') return fallback;
  if(typeof value==='number'&&Number.isFinite(value))return Number.isInteger(value)?String(value):Number(value.toPrecision(4)).toString();
  const rendered = Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (privatePath.test(rendered)) return 'Source details retained in the audit';
  return rendered.replace(fingerprint, 'source identity recorded');
}

function groupFor(id) {
  if (/^review(?:[-_]|$)/.test(id)) return 'review';
  if (/^(?:generated|generation|design-output|diffusion-output)(?:[-_]|$)/.test(id)) return 'generated';
  if (/^(?:sequence|construct-sequence|candidate-sequence)(?:[-_]|$)/.test(id)) return 'sequence';
  if (/^(?:fold|refold|prediction|supplementary)(?:[-_]|$)/.test(id)) return 'refold';
  if (/^(?:origin|parent|design-conditioning|input|inputs|conditioning|hotspot|hotspots|target-input|template-input)(?:[-_]|$)/.test(id)) return 'inputs';
  return 'checks';
}

function validSource(source) {
  return source && typeof source === 'object' && text(source.path) && hash(source.sha256);
}

function validAsset(asset) {
  if (!asset || typeof asset !== 'object' || !['pdb', 'cif', 'mmcif'].includes(asset.format) || !hash(asset.sha256)) return false;
  if (typeof asset.url !== 'string' || !asset.url.startsWith('./data/assets/') || asset.url.includes('..') || /[\\%?#]/.test(asset.url)) return false;
  if (!asset.roles || typeof asset.roles !== 'object' || Array.isArray(asset.roles)) return false;
  const roles = Object.entries(asset.roles);
  if (!roles.length || roles.some(([role, chain]) => !['receptor', 'binder'].includes(role) || !text(chain) || chain.length > 32)) return false;
  if (new Set(roles.map(([, chain]) => chain)).size !== roles.length) return false;
  if (asset.kind !== 'receptor_only' && (!asset.roles.receptor || !asset.roles.binder)) return false;
  if (asset.kind === 'receptor_only' && !asset.roles.receptor) return false;
  return asset.source === undefined || validSource(asset.source);
}

function normalizeStructures(evidence, stageId) {
  const records = evidence?.structures;
  if (!Array.isArray(records)) return [];
  const seen = new Set();
  return records.map(item => {
    assert(item && text(item.id) && !seen.has(item.id) && text(item.label), 'Stage structures need unique identities and labels.');
    seen.add(item.id);
    const generatedIdentity = stageId !== 'generated' || item.modelKind === 'generated';
    const correctStage = (!item.stageId || item.stageId === stageId) && (!item.asset?.stage || item.asset.stage === stageId);
    const sourceBound = validSource(item.asset?.source) || (Array.isArray(evidence.sources) && evidence.sources.some(validSource));
    const available = item.status === 'available' && generatedIdentity && correctStage && validAsset(item.asset) && sourceBound;
    let reason = item.reason || item.description || 'No source-bound structure is attached to this step.';
    if (item.status === 'available' && !generatedIdentity) reason = 'A refold or unspecified model cannot stand in for the original generated design.';
    else if (item.status === 'available' && !correctStage) reason = 'The structure belongs to a different workflow stage.';
    else if (item.status === 'available' && !available) reason = 'The structure reference needs a valid local asset, molecular roles and source identity before inspection.';
    return { ...item, stageId, status: available ? 'available' : 'missing', asset: available ? item.asset : null, reason };
  });
}

export function workflowStages(graph, subject = {}) {
  assert(graph && graph.schemaVersion === 1 && Array.isArray(graph.nodes) && graph.nodes.length <= 1000, 'Expected a version 1 recorded workflow graph.');
  const seen = new Set();
  for (const node of graph.nodes) {
    assert(node && text(node.id) && !seen.has(node.id) && text(node.title) && ['documented', 'unknown'].includes(node.status), 'Workflow nodes need unique identities, titles and explicit evidence status.');
    seen.add(node.id);
  }
  return STAGES.map(definition => {
    const evidence = subject.workflowEvidence?.stages?.[definition.id] || {};
    const structures = normalizeStructures(evidence, definition.id).map(item=>{
      if(definition.id!=='refold'||item.status!=='available')return item;
      // Older compiled graphs retain the exact supplementary model binding in
      // their source audit. Match that identity, never a title or list position.
      const boundNodes=graph.nodes.filter(node=>/^supplementary[-_]/.test(node.id)).filter(node=>{
        const references=(graph.audit?.sources||[]).filter(s=>s.stepId===node.id&&typeof s.reference==='string'&&s.reference.startsWith('Exact supplementary model lineage: '));
        if(references.length!==1)return false;
        try{
          const model=JSON.parse(references[0].reference.slice('Exact supplementary model lineage: '.length));
          return model.id===item.id&&model.modelSha256===item.asset.sha256&&model.molecularModel?.sha256===item.asset.sha256&&model.target===item.asset.species&&model.molecularModel?.roles?.receptor===item.asset.roles.receptor&&model.molecularModel?.roles?.binder===item.asset.roles.binder;
        }catch{return false;}
      }).map(node=>node.id);
      return {...item,nodeIds:[...new Set([...(item.nodeIds||[]),...boundNodes])]};
    });
    const available = structures.some(item => item.status === 'available');
    const recorded = graph.nodes.filter(node => groupFor(node.id) === definition.id);
    const nodes = [...recorded];
    if (!nodes.length) {
      const original = definition.id === 'generated';
      nodes.push({ id: `__${definition.id}__`, title: original ? 'Original generated coordinates' : definition.label, status: original && available ? 'documented' : 'unknown', method: null, input: null, output: original && available ? 'Source-bound original design coordinates are available' : null, dependsOn: [], missingFields: original ? available ? [] : ['original_generated_structure'] : ['step_evidence'], note: original ? 'An original generated model is distinct from a later complex refold. Design-origin metadata does not substitute for its coordinate artifact.' : 'No explicit node is recorded for this stage.', synthetic: true });
    }
    const missingFields = [
      ...(Array.isArray(graph.missingFields) ? graph.missingFields.filter(item => recorded.some(node => node.id === item.stepId)) : []),
      ...(Array.isArray(evidence.gaps) ? evidence.gaps.map(item => ({ ...item })) : []),
    ];
    if (definition.id === 'generated' && !available && !missingFields.some(item=>item.field==='original_generated_structure')) missingFields.push({ stepId: nodes[0].id, field: 'original_generated_structure', reason: 'No verified original design output is attached. Later refolds remain in their own stage.' });
    const status = definition.id === 'generated' && !available ? 'unknown' : nodes.every(node => node.status === 'unknown') ? 'unknown' : nodes.some(node => node.status === 'unknown' || node.missingFields?.length) || missingFields.length ? 'partial' : 'documented';
    return { ...definition, status, nodes, missingFields, structures, summary: evidence.summary || null, parameters: Array.isArray(evidence.parameters) ? evidence.parameters : [], sources: Array.isArray(evidence.sources) ? evidence.sources : [], availability: available ? 'available' : 'unavailable' };
  });
}

function choose(stages, stageId, nodeId) {
  const stage = stages.find(item => item.id === stageId) || stages[0];
  const node = stage.nodes.find(item => item.id === nodeId) || stage.nodes[0];
  return { stage, node };
}

function sourceLabel(source) {
  if (source && typeof source === 'object' && text(source.label)) return readable(source.label);
  const reference = typeof source === 'string' ? source : source?.reference || source?.path || '';
  const first = String(reference).split(' | ')[0].trim();
  if (/^Recorded native parameters:|^Native comparison settings:/i.test(first)) return 'Recorded execution settings';
  const filename = first.split(/[\\/]/).pop();
  return /\.[a-z0-9]{1,8}$/i.test(filename || '') ? readable(filename) : 'Recorded source evidence';
}

export function renderStepDetails(graph, subject, stageId, nodeId = null) {
  const stages = workflowStages(graph, subject), { stage, node } = choose(stages, stageId, nodeId);
  const sources = [...(graph.audit?.sources || []).filter(item => item.stepId === node.id), ...stage.sources];
  const uniqueSourceLabels = [...new Set(sources.map(sourceLabel))];
  const gaps = [...stage.missingFields.filter(item => !item.stepId || item.stepId === node.id), ...(node.missingFields || []).filter(field => !stage.missingFields.some(item => item.stepId === node.id && item.field === field)).map(field => ({ field, reason: 'This evidence is not recorded in the step.' }))];
  const structures = stage.structures;
  const parameters = stage.parameters;
  const missingOriginal = stage.id === 'generated' && stage.availability === 'unavailable';
  const status = missingOriginal ? 'Original structure missing' : node.status === 'unknown' ? 'Evidence not established' : node.missingFields?.length || gaps.length ? 'Recorded with gaps' : 'Recorded step';
  const sourceURL=s=>{const path=s?.assetPath;return typeof path==='string'&&path.startsWith('assets/')&&!path.includes('..')&&!/[\\%?#:]/.test(path)?'./data/'+path.split('/').map(encodeURIComponent).join('/'):null;};
  return `<article class="workflow-step-details" data-workflow-active-stage="${esc(stage.id)}" data-workflow-active-node="${esc(node.id)}"><div class="panel-head"><h3>${esc(readable(node.title))}</h3><span class="badge ${node.status === 'unknown' || missingOriginal ? 'blocked' : 'neutral'}">${esc(status)}</span></div>${stage.summary ? `<p>${esc(readable(stage.summary))}</p>` : ''}<dl class="workflow-step-fields"><dt>Method</dt><dd>${esc(readable(node.method, 'Method not recorded'))}</dd><dt>Input</dt><dd>${esc(readable(node.input, 'Input evidence not recorded'))}</dd><dt>Output</dt><dd>${esc(readable(node.output, 'Output evidence not recorded'))}</dd></dl>${node.note ? `<p class="fine muted">${esc(readable(node.note))}</p>` : ''}${parameters.length ? `<section><h4>Recorded settings</h4><dl>${parameters.map(parameter => `<dt>${esc(readable(parameter.label))}</dt><dd>${esc(readable(parameter.value))}</dd>`).join('')}</dl><p class="fine muted">Recorded settings document the proposal or run; they do not prove successful execution.</p></section>` : ''}${gaps.length ? `<section class="workflow-gaps"><h4>What is still missing</h4><ul>${gaps.map(gap => `<li><strong>${esc(readable(String(gap.field || 'Evidence').replaceAll('_', ' ')))}</strong>: ${esc(readable(gap.reason))}${gap.request&&gap.request!==gap.reason ? `<small>${esc(readable(gap.request))}</small>` : ''}</li>`).join('')}</ul></section>` : ''}<section class="workflow-structure-actions"><h4>Structures from this stage</h4>${structures.length ? structures.map(structure => `<div class="workflow-structure-record"><button type="button" class="button subtle" data-workflow-structure="${esc(structure.id)}" data-workflow-structure-stage="${esc(stage.id)}" ${structure.status === 'available' ? '' : 'disabled'}>${esc(readable(structure.label))}${structure.status === 'available' ? ' · Inspect structure' : ' · Not available'}</button>${structure.description || structure.status === 'missing' ? `<p class="fine muted">${esc(readable(structure.status === 'missing' ? structure.reason : structure.description))}</p>` : ''}</div>`).join('') : `<p class="fine muted">${stage.id === 'generated' ? 'The original generated structure has not been supplied. A refold is not used in its place.' : 'No source-bound molecular structure is attached to this stage.'}</p>`}</section><section><h4>Source records</h4>${uniqueSourceLabels.length ? `<ul>${uniqueSourceLabels.map(label => {const item=sources.find(s=>sourceLabel(s)===label&&sourceURL(s));return `<li>${item?`<a href="${esc(sourceURL(item))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:esc(label)}</li>`;}).join('')}</ul>` : '<p class="fine muted">Source reference not recorded for this step.</p>'}</section>${sources.length || parameters.some(parameter => parameter.source) ? `<details class="audit-details workflow-source-audit"><summary>Source audit details</summary><pre>${esc(JSON.stringify({ sources, parameterSources: parameters.filter(parameter => parameter.source).map(parameter => ({ label: parameter.label, source: parameter.source })) }, null, 2))}</pre></details>` : ''}</article>`;
}

export function renderWorkflow(graph, subject, { activeStage = 'inputs', activeNode = null } = {}) {
  const stages = workflowStages(graph, subject), selected = choose(stages, activeStage, activeNode);
  const statusLabel = stage => stage.status === 'unknown' ? 'Evidence missing' : stage.status === 'partial' ? 'Recorded with gaps' : 'Recorded';
  const nodeButton = (node, stageId, detailed = false) => `<button type="button" class="workflow-node ${node.id === selected.node.id ? 'active' : ''}" data-workflow-node="${esc(node.id)}" data-workflow-node-stage="${esc(stageId)}" aria-pressed="${node.id === selected.node.id}"><span>${esc(readable(node.title))}</span>${detailed ? `<small>${node.status === 'unknown' ? 'Evidence missing' : 'Recorded step'}</small>` : ''}</button>`;
  return `<section class="workflow-summary" aria-label="Recorded candidate workflow"><ol class="workflow-stages">${stages.map((stage, index) => `<li><button type="button" class="workflow-stage ${stage.id === selected.stage.id ? 'active' : ''}" data-workflow-stage="${stage.id}" aria-pressed="${stage.id === selected.stage.id}" aria-controls="workflow-selected-step"><span class="workflow-stage-number">${index + 1}</span><strong>${stage.label}</strong><small>${statusLabel(stage)}</small></button>${index < stages.length - 1 ? '<span class="workflow-arrow" aria-hidden="true">→</span>' : ''}</li>`).join('')}</ol><section id="workflow-selected-step" class="workflow-selected-stage"><div class="panel-head"><h3>${esc(selected.stage.label)}</h3><span class="badge neutral">${esc(statusLabel(selected.stage))}</span></div><p class="fine muted">${esc(selected.stage.description)}</p>${selected.stage.nodes.length>4?`<label class="panel-model-selector">Choose a recorded step<select class="input" aria-label="Recorded step within ${esc(selected.stage.label)}" data-workflow-record-selector="${esc(selected.stage.id)}">${selected.stage.nodes.map(node=>`<option value="${esc(node.id)}" ${node.id===selected.node.id?'selected':''}>${esc(readable(node.title))}</option>`).join('')}</select></label>`:`<div class="workflow-node-list" aria-label="${esc(selected.stage.label)} steps">${selected.stage.nodes.map(node => nodeButton(node, selected.stage.id)).join('')}</div>`}${renderStepDetails(graph, subject, selected.stage.id, selected.node.id)}</section><details class="workflow-full-record"><summary>See all ${graph.nodes.length} recorded steps</summary><p class="fine muted">The complete source graph and its original dependencies remain unchanged in the downloadable Markdown, Mermaid and graph records.</p><div class="workflow-node-list">${graph.nodes.map(node => nodeButton(node, groupFor(node.id), true)).join('')}</div></details></section>`;
}
