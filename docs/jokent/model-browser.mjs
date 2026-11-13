// Exact native cell selection; overlay transforms are presentation evidence only.
import {modelChoices,resolveModel,nativeModelHash} from './panel.mjs';
import {displayFrame} from './camera.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export const ISOFORM_COLORS=Object.freeze({BRD3:'#8b5cf6',BRD2:'#2563eb',BRD4:'#ea8a23',BRDT:'#0d9488'});
function variantLabel(subject,id){return id==='untagged'?'Untagged':id==='ctag64'?'64-residue tag':subject.constructVariants?.find(v=>v.id===id)?.label||id;}
function identities(values,known,name){assert(Array.isArray(values)&&new Set(values).size===values.length&&values.every(id=>known.includes(id)),`Choose declared, unique ${name}.`);return [...values];}
function assetIssue(model,asset){
  if(!asset)return 'No browser-ready structure is recorded for this exact combination.';
  if(!/^[a-f0-9]{64}$/i.test(asset.sha256||'')||nativeModelHash(model)!==asset.sha256.toLowerCase())return 'Structure identity does not match this native model.';
  if(typeof asset.url!=='string'||!/^\.\/data\/assets\//.test(asset.url)||/\.\.|[\\%?#:]/.test(asset.url))return 'The recorded structure is not a safe local browser asset.';
  if(!['pdb','cif','mmcif'].includes(asset.format)||!asset.roles?.receptor||!asset.roles?.binder||asset.roles.receptor===asset.roles.binder)return 'Structure format or explicit receptor/binder roles are incomplete.';
  return null;
}
export function modelBrowser(subject,options={}){
  const mode=options.mode||'single';assert(['single','overlay'].includes(mode),'Choose a single model or an isoform overlay.');
  const partial={...options.selection};if(partial.variant==='__both__')delete partial.variant;
  const choices=modelChoices(subject,partial),selection={...choices.selection},knownTargets=choices.targets.map(t=>t.id),knownVariants=choices.variants.map(v=>v.id);
  let variants=options.variants?.length?identities(options.variants,knownVariants,'construct variants'):[selection.variant];
  if(mode==='single')variants=[selection.variant];else if(options.selection?.variant==='__both__')variants=[...knownVariants];
  const targets=mode==='single'?[selection.target]:options.targets===undefined?[...knownTargets]:identities(options.targets,knownTargets,'isoforms');
  if(variants.length===1||!variants.includes(selection.variant))selection.variant=variants[0];
  if(mode==='overlay'&&targets.length&&!targets.includes(selection.target))selection.target=targets[0];
  const rows=targets.flatMap(target=>variants.map(variant=>{
    const cell={target,variant,engine:selection.engine},resolved=resolveModel(subject,cell),issue=resolved.model?assetIssue(resolved.model,resolved.asset):resolved.reason;
    return {selection:cell,model:resolved.model,asset:issue?null:{...structuredClone(resolved.asset),target,constructVariant:variant,displayModelId:resolved.model.id,species:variants.length>1?`${target} · ${variantLabel(subject,variant)}`:target,overlayColor:ISOFORM_COLORS[target]||'#64748b'},status:issue?(resolved.asset?'blocked':'missing'):'available',reason:issue};
  }));
  let frameId=null;
  if(mode==='overlay'){
    for(const row of rows)if(row.asset){
      try{assert(row.asset.displayFrame,'Shared receptor alignment has not been recorded.');row.frameId=displayFrame(row.asset);}
      catch{row.asset=null;row.status='blocked';row.reason='Verified receptor alignment is unavailable for this exact native model.';}
    }
    frameId=(rows.find(r=>r.asset&&r.selection.target===selection.target&&r.selection.variant===selection.variant)||rows.find(r=>r.asset))?.frameId||null;
    for(const row of rows)if(row.asset&&row.frameId!==frameId){row.asset=null;row.status='blocked';row.reason='This model uses a different receptor frame and cannot join this overlay.';}
    if(rows.filter(r=>r.asset).length>8)for(const row of rows)if(row.asset){row.asset=null;row.status='blocked';row.reason='The overlay limit is eight models. Select fewer isoforms or one construct.';}
  }
  const assets=rows.flatMap(r=>r.asset?[r.asset]:[]),anchor=assets.findIndex(a=>a.target===selection.target&&a.constructVariant===selection.variant);
  if(anchor>0)assets.unshift(...assets.splice(anchor,1));
  const missingCount=rows.filter(r=>r.status==='missing').length,blockedCount=rows.filter(r=>r.status==='blocked').length;
  const message=!rows.length?'Choose at least one isoform to inspect.':mode==='single'?(assets.length?(selection.engine==='original-diffused'?'Original diffused model available.':'Exact native model available.'):rows[0].reason):assets.length?`${assets.length} aligned native ${assets.length===1?'model':'models'} available${assets.length===1?'; another model is needed for a comparison':''}.`:missingCount===rows.length?'No native models are recorded for these combinations.':'The recorded models cannot share a verified receptor frame.';
  return {...choices,choices,selection,mode,targets,variants,constructChoice:mode==='overlay'&&variants.length>1?'__both__':variants[0],targetChoices:choices.targets,variantChoices:choices.variants,engineChoices:choices.engines,rows,assets,frameId,expected:rows.length,available:assets.length,missingCount,blockedCount,canCompare:mode==='overlay'&&assets.length>=2,overlayColors:options.overlayColors===true||options.isoformColors===true,isoformColors:options.overlayColors===true||options.isoformColors===true,message};
}
export function renderModelBrowser(subject,options={}, {prefix='viewer'}={}){
  assert(/^[a-z][a-z0-9-]*$/.test(prefix),'Use a safe model-browser prefix.');
  const browser=modelBrowser(subject,options),select=(hook,title,value,choices)=>`<label>${title}<select class="input" data-model-browser-${hook} aria-label="${title}">${choices.map(c=>`<option value="${esc(c.id)}" ${c.id===value?'selected':''}>${esc(c.label)}</option>`).join('')}</select></label>`;
  const variants=browser.variantChoices.map(v=>({id:v.id,label:variantLabel(subject,v.id)}));if(browser.mode==='overlay'&&variants.length>1)variants.push({id:'__both__',label:'Both constructs'});
  const missing=browser.rows.filter(r=>!r.asset);
  return `<section class="model-browser" data-model-browser-prefix="${prefix}" id="${prefix}-model-browser" aria-label="Native model browser"><div class="model-browser-modes" role="group" aria-label="Model comparison mode">${[['single','Single model'],['overlay','Compare isoforms']].map(([id,label])=>`<button type="button" class="button ${browser.mode===id?'primary':'subtle'}" data-model-browser-mode="${id}" aria-pressed="${browser.mode===id}">${label}</button>`).join('')}</div><div class="model-browser-selectors">${select('engine','Folding method',browser.selection.engine,browser.engineChoices)}${select('variant','Construct',browser.constructChoice,variants)}${browser.mode==='single'?select('target','Target isoform',browser.selection.target,browser.targetChoices):''}</div>${browser.mode==='overlay'?`<fieldset class="model-browser-isoforms"><legend>Isoforms in this overlay</legend><div>${browser.targetChoices.map(t=>`<label><input type="checkbox" data-model-browser-isoform="${esc(t.id)}" ${browser.targets.includes(t.id)?'checked':''}>${esc(t.label)}</label>`).join('')}<button type="button" class="text-button" data-model-browser-all>All isoforms</button></div></fieldset><div class="model-browser-legend"><label><input type="checkbox" data-overlay-colors ${browser.overlayColors?'checked':''}> Use isoform colors</label><span class="fine muted" data-overlay-palette-note>${browser.overlayColors?'Key for the enabled isoform palette.':'Enable to color isoforms separately; project palette is unchanged.'}</span><div data-overlay-legend ${browser.overlayColors?'':'hidden'}>${browser.targetChoices.filter(t=>browser.targets.includes(t.id)).map(t=>`<span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="${ISOFORM_COLORS[t.id]||'#64748b'}"/></svg>${esc(t.label)}</span>`).join('')}</div></div>`:''}<p class="fine muted" role="status">${esc(browser.message)} ${browser.available} of ${browser.expected} selected combinations available.${browser.missingCount?` ${browser.missingCount} missing.`:''}${browser.blockedCount?` ${browser.blockedCount} blocked.`:''}</p>${browser.selection.engine==='original-diffused'&&browser.resolved.model?`<p class="fine muted" data-original-model-scope>${esc(browser.resolved.model.scope)}</p>`:''}${missing.length?`<details class="model-browser-gaps"><summary>Unavailable combinations (${missing.length})</summary><ul>${missing.map(r=>`<li><strong>${esc(r.selection.target)} · ${esc(variantLabel(subject,r.selection.variant))}</strong> — ${esc(r.reason)}</li>`).join('')}</ul></details>`:''}</section>`;
}
