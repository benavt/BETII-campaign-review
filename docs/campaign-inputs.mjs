// Read-only, source-bound design inputs. Runtime atom membership is checked by stageLayers.
import {receptorChains} from './molecule.mjs';
import {renderViewerRepresentationControls,renderViewerColorControls} from './viewer-colors.mjs';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=4000;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const source=value=>value&&text(value.path)&&hash(value.sha256);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATES=Object.freeze({planned:'Planned',preparing:'Preparing',queued:'Queued',running:'Running',completed:'Completed',failed:'Needs attention',blocked:'Blocked',unknown:'Completion unconfirmed'});
const COUNT_LABELS=Object.freeze({requested:'Requested',generated:'Generated',receptorPreserved:'Receptor preserved',refolds:'Refolded models'});
const chain=value=>typeof value==='string'&&value.trim().length>0&&value.length<=32;
function localAsset(value){
 if(typeof value!=='string'||!/^\.\/data\/assets\//.test(value)||/[\\%?#:]|\.\./.test(value.slice(2))||value.slice(2).split('/').some(part=>!part||part==='.'||part==='..'))return null;
 return value;
}
function strings(value,label){assert(Array.isArray(value)&&value.length<=100&&value.every(text),`${label} must be readable text.`);}
function optionalText(value,label){if(value!==undefined)assert(text(value),`${label} must be readable text.`);}
function selector(value){assert(value&&chain(value.chain)&&Number.isInteger(value.resi)&&Math.abs(value.resi)<100000&&(value.icode===undefined||typeof value.icode==='string'&&value.icode.length<=4)&&(value.atom===undefined||typeof value.atom==='string'&&value.atom.trim().length>0&&value.atom.length<=10),'Input annotations need explicit chain, residue and optional atom identities.');}
function model(asset){
 assert(asset&&localAsset(asset.url)&&hash(asset.sha256)&&['pdb','cif','mmcif'].includes(asset.format)&&text(asset.species),'Input structure needs a local browser asset and an exact SHA-256 identity.');
 const roles=asset.roles;
 assert(roles&&chain(roles.receptor)&&(asset.kind==='receptor_only'?roles.binder===undefined:chain(roles.binder)&&roles.binder!==roles.receptor),'Input structure needs explicit target and, where present, binder chain roles.');
 receptorChains(asset);
 if(asset.regions!==undefined){assert(Array.isArray(asset.regions)&&asset.regions.every(region=>['proteaseLike','apical','helical'].includes(region.role)),'Input domains require explicit roles.');layers(asset.regions.map(region=>({...region,kind:'fixed'})),asset);}
 if(asset.hotspots!==undefined){assert(Array.isArray(asset.hotspots)&&asset.hotspots.length<=5000,'Invalid input hotspot selections.');asset.hotspots.forEach(selector);}
}
function layers(value,asset){
 assert(Array.isArray(value)&&value.length<=30,'Input overlays must be an explicit list of annotation layers.');
 const ids=new Set();
 for(const layer of value){
  assert(layer&&text(layer.id)&&!ids.has(layer.id)&&text(layer.label)&&source(layer.source)&&hash(layer.modelSha256)&&layer.modelSha256===asset?.sha256,'Input overlays require unique identities and the exact displayed model/source fingerprint.');ids.add(layer.id);
  assert(['hotspot','flexible','fixed','assessment'].includes(layer.kind)&&/^#[a-f0-9]{6}$/i.test(layer.color)&&Array.isArray(layer.selectors)&&layer.selectors.length>0&&layer.selectors.length<=5000,'Input overlays require a known kind, color and explicit atom or residue selections.');
  layer.selectors.forEach(selector);
 }
}
export function validateDesignInputs(campaign){
 const inputs=campaign?.designInputs;
 if(inputs===undefined)return null;
 assert(inputs&&inputs.schemaVersion===1&&Array.isArray(inputs.views)&&inputs.views.length<=100&&Array.isArray(inputs.runs)&&inputs.runs.length<=200,'Design inputs require a versioned view and run list.');
 const viewIds=new Set();
 for(const view of inputs.views){
  assert(view&&text(view.id)&&!viewIds.has(view.id)&&text(view.label)&&text(view.method)&&source(view.source),'Design input views need unique identities, readable names, methods and hashed sources.');viewIds.add(view.id);
  if(view.stage!==undefined)assert(['input','reference','generated','refold'].includes(view.stage),'Input view needs a known structure stage.');
  for(const field of ['description','hotspotLabel','contextLabel','numberingLabel'])optionalText(view[field],`Input ${field}`);
  if(view.gaps!==undefined)strings(view.gaps,'Input gaps');
  if(view.asset!==undefined)model(view.asset);else assert(view.gaps?.length>0,'An unavailable input structure needs an explicit recorded gap.');
  if(view.annotations!==undefined)layers(view.annotations,view.asset);
 }
 const runIds=new Set();
 for(const run of inputs.runs){
  assert(run&&text(run.id)&&!runIds.has(run.id)&&text(run.label)&&text(run.method)&&Object.hasOwn(STATES,run.state)&&source(run.source),'Input run records require unique identities, a known state and hashed source.');runIds.add(run.id);
  optionalText(run.description,'Run description');
  if(run.gaps!==undefined)strings(run.gaps,'Run gaps');
  if(run.viewIds!==undefined)assert(Array.isArray(run.viewIds)&&run.viewIds.length<=100&&new Set(run.viewIds).size===run.viewIds.length&&run.viewIds.every(id=>viewIds.has(id)),'Run inputs must refer to unique known input views.');
  if(run.counts!==undefined){assert(run.counts&&typeof run.counts==='object'&&!Array.isArray(run.counts),'Run counts must be a record.');for(const [key,value] of Object.entries(run.counts))assert(Object.hasOwn(COUNT_LABELS,key)&&Number.isSafeInteger(value)&&value>=0,'Run counts require known nonnegative integer values; unknown values stay absent.');}
  if(run.cells!==undefined){assert(Array.isArray(run.cells)&&run.cells.length<=100,'Run allocation must be bounded.');for(const cell of run.cells)assert(text(cell.label)&&Number.isSafeInteger(cell.lengthAa)&&cell.lengthAa>0&&Number.isSafeInteger(cell.generated)&&cell.generated>=0,'Run allocation needs a readable cell, length and generated count.');}
  if(run.artifacts!==undefined){assert(Array.isArray(run.artifacts)&&run.artifacts.length<=10,'Run downloads must be bounded.');for(const item of run.artifacts)assert(text(item.label)&&localAsset(item.url)&&/\.(csv|fasta)$/.test(item.url)&&hash(item.sha256),'Run downloads need an exact local sequence artifact.');}
 }
 if(inputs.gaps!==undefined)strings(inputs.gaps,'Campaign input gaps');
 return inputs;
}
export function inputSelection(campaign,viewId){
 const inputs=validateDesignInputs(campaign);
 if(!inputs?.views.length)return null;
 const view=viewId===undefined||viewId===null?inputs.views[0]:inputs.views.find(view=>view.id===viewId);
 assert(view,'Choose an existing design input view.');
 return {view,subject:view.asset?{id:`${campaign.id}:input:${view.id}`,label:view.label,molecularModels:[view.asset]}:null,annotations:view.annotations||[],measurements:[]};
}
const gaps=items=>items?.length?`<ul class="input-gaps">${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:'';
function viewOptions(views,current){
 const groups=new Map();for(const view of views){if(!groups.has(view.method))groups.set(view.method,[]);groups.get(view.method).push(view);}
 return [...groups].map(([method,items])=>`<optgroup label="${esc(method)}">${items.map(view=>`<option value="${esc(view.id)}" ${view.id===current?'selected':''}>${esc(view.label.startsWith(method+' · ')?view.label.slice(method.length+3):view.label)}</option>`).join('')}</optgroup>`).join('');
}
function audit(record,label){return `<details class="audit-details"><summary>${esc(label)}</summary><dl><dt>Source record</dt><dd class="sequence">${esc(record.source.path)}</dd><dt>SHA-256</dt><dd class="sequence">${esc(record.source.sha256)}</dd>${record.asset?`<dt>Structure SHA-256</dt><dd class="sequence">${esc(record.asset.sha256)}</dd>`:''}</dl></details>`;}
function allocation(run){return `${run.cells?.length?`<div class="table-scroll"><table><caption>Generation panel</caption><thead><tr><th>Hotspots</th><th>Length</th><th>Sequences</th></tr></thead><tbody>${run.cells.map(cell=>`<tr><td>${esc(cell.label)}</td><td>${cell.lengthAa} aa</td><td>${cell.generated.toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table></div>`:''}${run.artifacts?.length?`<div class="review-actions">${run.artifacts.map(item=>`<a class="button subtle" href="${esc(localAsset(item.url))}" download>${esc(item.label)} ↓</a>`).join('')}</div>`:''}`;}
function regionLegend(view,campaign){
 const roles=campaign.molecularColorStandard?.legend;if(!roles?.length)return '';
 const present=new Set((view.asset?.regions||[]).map(region=>region.label));if(view.asset?.roles.binder)present.add('Designed binder');if(view.annotations?.some(layer=>layer.kind==='hotspot'))present.add('Hotspot guidance');
 return `<ul class="input-color-legend" aria-label="Molecular colors">${roles.filter(role=>present.has(role.label)).map(role=>`<li><svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="3" fill="${esc(role.color)}"/></svg>${esc(role.label)}</li>`).join('')}</ul>`;
}
export function renderDesignInputs(campaign,viewId){
 const inputs=validateDesignInputs(campaign),selected=inputSelection(campaign,viewId),view=selected?.view;
 if(!inputs)return '<section class="panel campaign-inputs"><h2>Inputs &amp; hotspots</h2><p>No source-backed input views are attached to this campaign yet.</p></section>';
 const controls=selected?.subject?`<div class="workflow-layer-controls">${selected.annotations.map(layer=>`<label><input type="checkbox" data-input-layer="${esc(layer.id)}" checked><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="3" fill="${esc(layer.color)}"/></svg>${esc(layer.label)}</label>`).join('')}<label><input type="checkbox" id="campaign-input-labels" checked> Residue labels</label><label><input type="checkbox" id="campaign-input-sidechains"> All side chains</label><label><input type="checkbox" id="campaign-input-project-colors" checked> Campaign colors</label>${renderViewerRepresentationControls('campaign-input')}${renderViewerColorControls('campaign-input')}<button type="button" class="button subtle" id="campaign-input-reset">Reset view</button></div>`:'';
 const structure=view?`<section class="panel campaign-input-structure"><div class="panel-head"><div><span class="eyebrow">${esc(view.method)} · ${esc({input:'DESIGN INPUT',reference:'RECEPTOR REFERENCE',generated:'GENERATED · UNREVIEWED',refold:'REFOLDED STRUCTURE'}[view.stage||'input'])}</span><h3>${esc(view.label)}</h3></div></div>${view.hotspotLabel||view.contextLabel?`<p class="input-summary">${esc(view.hotspotLabel||'')}${view.contextLabel?`<small>${esc(view.contextLabel)}</small>`:''}</p>`:''}${controls}${regionLegend(view,campaign)}${selected.subject?'<div id="campaign-input-molecule" class="molecule-container"></div><p id="campaign-input-status" class="viewer-status" role="status">Loading the recorded design input…</p>':'<p class="notice private">The source record is available, but this input structure has not been recovered.</p>'}${view.numberingLabel?`<p class="input-numbering"><strong>Residue numbering:</strong> ${esc(view.numberingLabel)}</p>`:''}${view.description?`<p class="fine muted">${esc(view.description)}</p>`:''}${gaps(view.gaps)}${view.asset?`<a class="text-button" href="${esc(localAsset(view.asset.url))}" download>Download this input structure ↓</a>`:''}${audit(view,'Input source details')}</section>`:'<section class="panel"><p>No browser-ready input views have been recovered.</p></section>';
 const runs=inputs.runs.length?`<section class="campaign-input-runs"><div class="section-heading"><div><h3>Runs</h3></div></div><div class="input-run-grid">${inputs.runs.map(run=>`<article class="panel input-run-card"><div class="panel-head"><div><span class="eyebrow">${esc(run.method)}</span><h4>${esc(run.label)}</h4></div><span class="badge state-${esc(run.state)}">${STATES[run.state]}</span></div>${run.description?`<p>${esc(run.description)}</p>`:''}${Object.keys(run.counts||{}).length?`<dl class="input-run-counts">${Object.entries(run.counts).map(([key,value])=>`<div><dt>${COUNT_LABELS[key]}</dt><dd>${value.toLocaleString('en-US')}</dd></div>`).join('')}</dl>`:''}${allocation(run)}${gaps(run.gaps)}${audit(run,'Run source details')}</article>`).join('')}</div><p class="fine muted">Generated and refolded counts describe recorded outputs. Scientific acceptance and final human approval remain separate.</p></section>`:'';
 return `<section class="campaign-inputs"><div class="section-heading"><div><h2>Inputs &amp; hotspots</h2></div><button class="button primary" data-design-from-input>Design against these hotspots</button></div>${inputs.views.length?`<label class="panel-model-selector">Design input view<select id="campaign-input-view" class="input" data-input-view aria-label="Design input view">${viewOptions(inputs.views,view?.id)}</select></label>`:''}${structure}${runs}${inputs.gaps?.length?`<section class="panel"><h3>Still to recover</h3>${gaps(inputs.gaps)}</section>`:''}</section>`;
}
