// The owned iframe bounds 3Dmol's window listeners and WebGL lifetime.
// All structures and the pinned library stay on this site's own origin.
import { swatchFor } from './colors.mjs';
import {cameraView,displayFrame,alignDisplayAtoms,quaternionFromRotation,matchingCamera,equivalentCamera} from './camera.mjs';
import {stageLayers,stageDistances} from './stage-layers.mjs';
import {confidenceAvailable,residueConfidence,chainbowColors,atomDisplayColor} from './viewer-colors.mjs';
const LIBRARY = new URL('./vendor/3Dmol-min.js', import.meta.url).href;
const FRAME = new URL('./molecule-frame.html', import.meta.url).href;
const ASSETS = new URL('./data/assets/', import.meta.url);
const DEFAULT_PALETTE = { humanReceptor: '#ffcc80', mouseReceptor: '#3380cc', receptor: '#808080', binder: '#00ffff', hotspots: '#FF69B4', d46Dd2: '#ff00ff', d46Dd1: '#00ffff' };

export function molecularAssetURL(value) {
  if (typeof value !== 'string' || /[\\?#]/.test(value)) throw new Error('Model needs a local asset URL without query or fragment.');
  const url = new URL(value, new URL('./', import.meta.url));
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { throw new Error('Invalid model asset path.'); }
  if (url.origin !== ASSETS.origin || !url.pathname.startsWith(ASSETS.pathname) || path.includes('..') || path.includes('\\') || path.includes('%') || url.username || url.password) throw new Error('Models must be local files under data/assets/.');
  return url.href;
}

function color(value, fallback) {
  return swatchFor(value) || swatchFor(fallback) || '#808080';
}
function chain(value) { return typeof value === 'string' && value.length > 0 && value.length <= 32; }
export function validMolecularRoles(asset){
 if(asset.kind==='binder_homodimer')return chain(asset.roles?.binder)&&asset.roles.receptor===undefined&&Array.isArray(asset.binderCopies)&&asset.binderCopies.length===1&&chain(asset.binderCopies[0])&&asset.binderCopies[0]!==asset.roles.binder&&!(asset.contextChains||[]).length;
 return asset.kind==='binder_only'?chain(asset.roles?.binder)&&asset.roles.receptor===undefined:chain(asset.roles?.receptor)&&(asset.kind==='receptor_only'?asset.roles.binder===undefined:chain(asset.roles.binder)&&asset.roles.receptor!==asset.roles.binder);
}
export function receptorChains(asset) {
  const context=asset.contextChains||[];
  if(!Array.isArray(context)||context.length>32||context.some(id=>!chain(id)||id===asset.roles?.receptor||id===asset.roles?.binder)||new Set(context).size!==context.length||asset.kind==='binder_only'&&context.length)throw new Error('Receptor context chains must be explicit, distinct target partners.');
  return [asset.roles?.receptor,...context].filter(chain);
}
export function binderChains(asset) {
  const copies=asset.binderCopies||[];
  if(!Array.isArray(copies)||copies.length>32||copies.some(id=>!chain(id)||id===asset.roles?.binder||id===asset.roles?.receptor||asset.contextChains?.includes(id))||new Set(copies).size!==copies.length||copies.length&&(!chain(asset.roles?.binder)||asset.kind==='binder_only'))throw new Error('Binder copies must be distinct explicit design chains.');
  return [asset.roles?.binder,...copies].filter(chain);
}
export function molecularRegions(atoms,asset){
  const regions=asset.regions||[];
  if(!Array.isArray(regions)||regions.some(r=>!['proteaseLike','apical','helical'].includes(r.role)))throw new Error('Molecular regions need explicit domain roles.');
  const layers=stageLayers(atoms,asset,regions.map(region=>({...region,kind:'fixed'}))),seen=new Set(),byIndex=new Map(atoms.map(a=>[a.index,a])),targets=new Set(receptorChains(asset));
  for(const region of layers)for(const index of region.indices){if(!targets.has(byIndex.get(index).chain)||seen.has(index))throw new Error('Domain colors must select nonoverlapping target residues.');seen.add(index);}
  return layers;
}
export function molecularChainRole(asset, chainId) {
  if (binderChains(asset).includes(chainId)) return {role:'binder',label:'Designed binder'};
  if (chainId === asset.roles?.receptor) return {role:'receptor',label:'Target receptor'};
  if (asset.contextChains?.includes(chainId)) return {role:'receptor_context',label:'Target receptor context'};
  return {role:'unassigned',label:'Unassigned chain'};
}
export function atomIdentityLabel(asset, atom) {
  const role=molecularChainRole(asset,atom.chain);
  return `${role.label} (chain ${atom.chain||'unnamed'}) · ${atom.resn||'residue'} ${atom.resi}${atom.icode||''} · ${asset.species}`;
}
export function fusionSegmentsFor(subject) {
  const segments = subject?.fusionSegments;
  if (segments === undefined) return [];
  const validRange = range => Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] > 0 && range[1] >= range[0] && range[1] - range[0] < 10000;
  if (!segments || !validRange(segments.dd2) || !validRange(segments.dd1) || Math.max(segments.dd2[0], segments.dd1[0]) <= Math.min(segments.dd2[1], segments.dd1[1])) throw new Error('Fusion domains require explicit, nonoverlapping residue ranges.');
  if (!segments.source || typeof segments.source.path !== 'string' || !segments.source.path.trim() || !/^[0-9a-f]{64}$/i.test(segments.source.sha256)) throw new Error('Fusion domain ranges require their recorded source identity.');
  return [{ role: 'd46Dd2', label: 'DD2', range: [...segments.dd2] }, { role: 'd46Dd1', label: 'DD1', range: [...segments.dd1] }];
}

export function nearestInterfaceContacts(atoms, roles, cutoff = 4, limit = 5) {
  if (!Array.isArray(atoms) || !roles || !chain(roles.receptor) || !chain(roles.binder) || roles.receptor === roles.binder || !Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 10 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid geometric interface display settings.');
  const valid = atom => atom && typeof atom.elem === 'string' && atom.elem.trim() && !['H', 'D'].includes(atom.elem.trim().toUpperCase()) && [atom.x, atom.y, atom.z].every(Number.isFinite);
  const grid = new Map(), pairs = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const residue = atom => JSON.stringify([atom.chain, atom.resi, atom.icode || '', atom.resn || '']);
  for (const atom of atoms) if (valid(atom) && atom.chain === roles.receptor) {
    const k = key(Math.floor(atom.x / cutoff), Math.floor(atom.y / cutoff), Math.floor(atom.z / cutoff));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(atom);
  }
  for (const binder of atoms) if (valid(binder) && binder.chain === roles.binder) {
    const x = Math.floor(binder.x / cutoff), y = Math.floor(binder.y / cutoff), z = Math.floor(binder.z / cutoff);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (const receptor of grid.get(key(x + dx, y + dy, z + dz)) || []) {
      const squared = (receptor.x - binder.x) ** 2 + (receptor.y - binder.y) ** 2 + (receptor.z - binder.z) ** 2;
      if (squared > cutoff * cutoff) continue;
      const k = `${residue(receptor)}|${residue(binder)}`;
      if (!pairs.has(k) || squared < pairs.get(k).squared) pairs.set(k, { receptor, binder, squared });
    }
  }
  return [...pairs.values()].sort((a, b) => a.squared - b.squared || residue(a.receptor).localeCompare(residue(b.receptor)) || residue(a.binder).localeCompare(residue(b.binder))).slice(0, limit).map(({ receptor, binder, squared }) => ({ receptor, binder, distance: Math.sqrt(squared) }));
}

export function assemblyInterfaceContacts(atoms,asset){
  return receptorChains(asset).flatMap(receptor=>binderChains(asset).flatMap(binder=>nearestInterfaceContacts(atoms,{receptor,binder}))).sort((a,b)=>a.distance-b.distance).slice(0,5);
}
export function overlayAssets(assets, species) {
  if (!Array.isArray(species) || !species.length || species.length > 8 || new Set(species).size !== species.length) throw new Error('Choose one to eight distinct molecular models.');
  const selected=species.map(label=>{const asset=assets.find(a=>a.species===label);if(!asset)throw new Error(`No local molecular model is available for ${label}.`);return asset;});
  if(selected.length>1){
    const error='Overlay requires source-checked models in the same verified receptor display frame; unaligned models cannot be overlaid.';
    if(selected.some(a=>!a.displayFrame||!/^[a-f0-9]{64}$/i.test(a.sha256||'')))throw new Error(error);
    const id=displayFrame(selected[0]),reference=selected[0].displayFrame.referenceSha256;
    if(!id||selected.some(a=>displayFrame(a)!==id||a.displayFrame.referenceSha256!==reference))throw new Error(error);
  }
  return selected;
}
const targetOf=asset=>asset.target||asset.species;
export const OVERLAY_ISOFORM_COLORS=Object.freeze({BRD3:'#8b5cf6',BRD2:'#2563eb',BRD4:'#ea8a23',BRDT:'#0d9488'});

export function mountMolecule(container, subject, { palette = {}, onStatus = () => {}, onAtomSelected = () => {}, campaignId='', viewDefaults={}, viewPresets={}, startingView=null, annotations=[], annotationsVisible=true, annotationLabels=false, measurements=[], overlaySpecies } = {}) {
  if (!container?.ownerDocument) throw new Error('A molecule container is required.');
  const assets = subject?.molecularModels;
  if (!Array.isArray(assets) || !assets.length) throw new Error('No browser-ready molecular models are available for this subject.');
  const fusionSegments = fusionSegmentsFor(subject);
  const seen = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.species !== 'string' || !asset.species.trim() || seen.has(asset.species)) throw new Error('Each molecular model needs a unique species label.');
    seen.add(asset.species);
    if(asset.target!==undefined&&(typeof asset.target!=='string'||!asset.target.trim()||asset.target.length>1000))throw new Error('A molecular target label must be nonempty text.');
    molecularAssetURL(asset.url);
    if (!['pdb', 'cif', 'mmcif'].includes(asset.format)) throw new Error('Molecular model format must be pdb, cif or mmcif.');
    const validRoles=validMolecularRoles(asset);
    if (!validRoles) throw new Error('Molecular models need distinct explicit receptor and binder chain roles, or an explicit single-role input.');
    receptorChains(asset);
    binderChains(asset);
    if (asset.sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(asset.sha256)) throw new Error('Invalid model SHA-256.');
    if (asset.coordinateFrame !== undefined && (typeof asset.coordinateFrame !== 'string' || !asset.coordinateFrame.trim() || asset.coordinateFrame.length > 1000)) throw new Error('A shared coordinate frame needs an explicit identity.');
    displayFrame(asset);
    if (asset.hotspots !== undefined && (!Array.isArray(asset.hotspots) || !asset.hotspots.every(h => h && chain(h.chain) && Number.isInteger(h.resi)))) throw new Error('Hotspots require explicit chain and integer residue identities.');
  }
  const initialAssets=overlayAssets(assets,overlaySpecies===undefined?[assets[0].species]:overlaySpecies);
  const isoformColor=asset=>color(asset.overlayColor,OVERLAY_ISOFORM_COLORS[targetOf(asset)]||'#64748b');
  let loaded=[],loadErrors=[],isoformColors=false;
  let disposed = false, viewer, current, selectedAtom, initialView, initialFrame, request, generation = 0, representation = 'cartoon', showHotspots = true, projectColors = true, showSideChains = false, showResidueColors = false, showInterface = false;
  let colors = { ...DEFAULT_PALETTE, ...palette };
  let colorMode='project';
  const defaults={...viewDefaults};let automaticView=null;
  let pendingView=startingView;
  let pickedResidues=[];
  const hiddenAnnotationLayers=new Set(annotationsVisible?[]:annotations.map(layer=>layer.id));let showStageDistances=true,selectedStageDistance=measurements[0]?.id||null;
  // 3Dmol 2.5.5 checks instanceof Array in its own iframe realm.
  const applyCamera=view=>viewer.setView(frame.contentWindow.Array.from(cameraView(view)));
  const frame = container.ownerDocument.createElement('iframe');
  frame.title = `Interactive molecular model: ${subject.label || subject.id || 'selected subject'}`;
  frame.setAttribute('aria-label', 'Molecular viewer. Drag to rotate, scroll to zoom; use Reset view to restore the saved target default, or the project starting view.');
  frame.src = FRAME;
  let settleFrame, rejectFrame;
  const frameReady = new Promise((resolve, reject) => { settleFrame = resolve; rejectFrame = reject; });
  let timeout = setTimeout(() => rejectFrame(new Error('The local molecular viewer did not finish loading.')), 25000);
  const report = (message, state = 'ready') => { if (!disposed) onStatus(message, state); };

  frame.addEventListener('load', () => {
    if (disposed) return;
    const doc = frame.contentDocument;
    const script = doc.createElement('script');
    script.src = LIBRARY;
    script.onload = () => {
      if (disposed) return;
      try {
        viewer = frame.contentWindow.$3Dmol.createViewer(doc.getElementById('model'), { backgroundColor: '#f7f9fc', antialias: true });
        clearTimeout(timeout); timeout = null;
        settleFrame();
      } catch { rejectFrame(new Error('WebGL molecular viewing is unavailable in this browser.')); }
    };
    script.onerror = () => rejectFrame(new Error('The bundled molecular library could not be loaded.'));
    doc.head.append(script);
  }, { once: true });
  container.append(frame);

  // Override carbon only; other elements keep the library's element colors.
  function sticks(value, radius = 0.16) {
    return { colorscheme: { prop: 'elem', map: { ...frame.contentWindow.$3Dmol.elementColors.defaultColors, C: value } }, radius };
  }
  function atomRoleColor(atom, entry) {
    const asset=entry.asset;
    if(colorMode!=='project')return atomDisplayColor(colorMode,atom,{confidence:entry.confidence,chainbow:entry.chainbow});
    if (!projectColors) return binderChains(asset).includes(atom.chain) ? '#666666' : '#aaaaaa';
    const region=entry.regionByAtom.get(atom.index);
    if(region&&!isoformColors)return color(colors[region.role],region.color);
    if(asset.contextChains?.includes(atom.chain))return color(asset.contextColor,'#aab8c0');
    if (binderChains(asset).includes(atom.chain)) {
      const segment = fusionSegments.find(s => atom.resi >= s.range[0] && atom.resi <= s.range[1]);
      return segment ? color(colors[segment.role], DEFAULT_PALETTE[segment.role]) : color(colors.ligand||colors.binder, DEFAULT_PALETTE.binder);
    }
    if(isoformColors)return isoformColor(asset);
    const key = /mouse/i.test(targetOf(asset)) ? 'mouseReceptor' : /human/i.test(targetOf(asset)) ? 'humanReceptor' : 'receptor';
    return color(colors[key]||colors.receptor, DEFAULT_PALETTE[key]);
  }
  function restyle() {
    if (!viewer || !current || disposed) return;
    viewer.removeAllShapes();viewer.removeAllLabels();
    for(const entry of loaded){
      const {asset,model,atoms}=entry;
      const addStyle=(selection,style)=>model.setStyle(selection,style,true);
      const roleColor=atom=>atomRoleColor(atom,entry);
      const style=value=>colorMode==='project'?(representation==='sticks'?{stick:sticks(value)}:{cartoon:{color:value}}):representation==='sticks'?{stick:{radius:0.16,colorfunc:atom=>atom.elem==='C'?roleColor(atom):frame.contentWindow.$3Dmol.elementColors.defaultColors[atom.elem]??'#808080'}}:{cartoon:{colorfunc:roleColor}};
      // GLModel methods scope all selections, including duplicate chain/residue IDs.
      model.setStyle({},representation==='backbone'||asset.kind==='receptor_only'?{}:style('#b4bec7'));
      if(representation!=='backbone'){
        for(const id of receptorChains(asset))model.setStyle({chain:id},style(roleColor({chain:id})));
        for(const id of binderChains(asset))model.setStyle({chain:id},style(projectColors?color(colors.ligand||colors.binder,DEFAULT_PALETTE.binder):'#666666'));
        if(projectColors&&colorMode==='project')for(const id of binderChains(asset))for(const segment of fusionSegments)model.setStyle({chain:id,resi:`${segment.range[0]}-${segment.range[1]}`},style(color(colors[segment.role],DEFAULT_PALETTE[segment.role])));
        if(projectColors&&colorMode==='project'&&!isoformColors)for(const region of entry.regionLayers)model.setStyle({index:region.indices},style(color(colors[region.role],region.color)));
      }else{
        const previous=new Map();
        for(const atom of atoms)if((asset.kind!=='receptor_only'||receptorChains(asset).includes(atom.chain))&&atom.atom==='CA'&&[atom.x,atom.y,atom.z].every(Number.isFinite)){
          model.setStyle({index:atom.index},{sphere:{color:roleColor(atom),radius:0.2}});
          const prior=previous.get(atom.chain);
          if(prior&&atom.resi===prior.resi+1&&Math.hypot(atom.x-prior.x,atom.y-prior.y,atom.z-prior.z)<=4.5)viewer.addLine({start:prior,end:atom,color:roleColor(atom),linewidth:2});
          previous.set(atom.chain,atom);
        }
      }
      if(showSideChains&&representation!=='sticks')for(const role of [...receptorChains(asset),...binderChains(asset)]){
        const indices=atoms.filter(a=>a.chain===role&&!['N','CA','C','O','OXT'].includes(a.atom)&&!['H','D'].includes(a.elem)).map(a=>a.index);
        if(indices.length)addStyle({index:indices},{stick:{radius:0.16,colorfunc:atom=>atom.elem==='C'?roleColor(atom):frame.contentWindow.$3Dmol.elementColors.defaultColors[atom.elem]??'#808080'}});
      }
      if(showResidueColors)for(const [resn,value]of [[['HIS'],'#bf00bf'],[['ASP','GLU'],'#0000ff'],[['ARG','LYS'],'#ff0000'],[['NAG'],'#ffff00']])addStyle({resn,...(asset.kind==='receptor_only'?{chain:asset.roles.receptor}:{})},{stick:sticks(value,0.18)});
      if(showHotspots)for(const hotspot of asset.hotspots||[])addStyle({chain:hotspot.chain,resi:hotspot.resi},{stick:sticks(color(colors.hotspots,DEFAULT_PALETTE.hotspots),0.25)});
      for(const layer of [...entry.annotationLayers].sort((a,b)=>Number(a.kind==='hotspot')-Number(b.kind==='hotspot')))if(!hiddenAnnotationLayers.has(layer.id)){
        const atomGuidance=layer.kind==='hotspot'&&layer.selectors.some(s=>s.atom);
        if(atomGuidance){
          const residues=new Set(layer.selectors.map(s=>JSON.stringify([s.chain,Number(s.resi),s.icode||''])));
          const indices=atoms.filter(a=>residues.has(JSON.stringify([a.chain,Number(a.resi),a.icode||'']))).map(a=>a.index);
          addStyle({index:indices},{stick:sticks(layer.color,0.18)});
        }
        addStyle({index:layer.indices},layer.kind==='hotspot'?{stick:sticks(layer.color,0.22),...(atomGuidance?{sphere:{radius:0.30,colorfunc:atom=>atom.elem==='C'?layer.color:frame.contentWindow.$3Dmol.elementColors.defaultColors[atom.elem]??'#808080'}}:{})}:{...(colorMode==='project'?{cartoon:{color:layer.color}}:{}),stick:sticks(layer.color,0.14)});
      }
      if(annotationLabels)for(const layer of entry.annotationLayers)if(layer.kind==='hotspot'&&!hiddenAnnotationLayers.has(layer.id)){
        const residues=new Map();for(const index of layer.indices){const atom=atoms.find(a=>a.index===index);if(atom)residues.set(atom.chain+':'+atom.resi,atom);}
        for(const atom of residues.values())viewer.addLabel(`${atom.chain} · ${atom.resn} ${atom.resi}`,{position:atom,fontSize:12,fontColor:'#25353e',backgroundColor:'#ffffff',backgroundOpacity:0.90,borderThickness:1,borderColor:layer.color,inFront:true});
      }
      for(const selection of pickedResidues)if(selection.species===asset.species){const {species,...selector}=selection;addStyle(selector,{stick:sticks('#FF69B4',0.23)});}
      if(showStageDistances)for(const m of entry.distanceLayers.filter(m=>selectedStageDistance==='all'||m.id===selectedStageDistance)){
        for(const atom of [m.a,m.b])addStyle({chain:atom.chain,resi:atom.resi},{stick:sticks(roleColor(atom),0.18)});
        viewer.addLine({start:m.a,end:m.b,dashed:true,color:'#a34f3d',linewidth:2});
        viewer.addLabel(`${m.distanceAngstrom.toFixed(2)} Å`,{position:{x:(m.a.x+m.b.x)/2,y:(m.a.y+m.b.y)/2,z:(m.a.z+m.b.z)/2},fontSize:13,fontColor:'#7d3b2c',backgroundColor:'#ffffff',backgroundOpacity:0.9,inFront:true});
      }
      if(showInterface&&chain(asset.roles.binder)&&chain(asset.roles.receptor)){
        entry.contacts ||= assemblyInterfaceContacts(atoms,asset);
        for(const contact of entry.contacts){
          viewer.addLine({start:contact.receptor,end:contact.binder,dashed:true,color:'#556575',linewidth:1});
          viewer.addLabel(`${contact.distance.toFixed(2)} Å`,{position:{x:(contact.receptor.x+contact.binder.x)/2,y:(contact.receptor.y+contact.binder.y)/2,z:(contact.receptor.z+contact.binder.z)/2},fontSize:11,fontColor:'#344454',showBackground:false,inFront:true});
        }
      }
      if(selectedAtom?.entry===entry){const atom=selectedAtom.atom;
        addStyle({chain:atom.chain,resi:atom.resi,...(atom.icode?{icode:atom.icode}:{})},{stick:sticks('#ffff00',0.26)});
        viewer.addLabel(atomIdentityLabel(asset,atom),{position:atom,fontSize:13,fontColor:'#17232d',backgroundColor:'#ffffff',backgroundOpacity:0.92,borderThickness:1,borderColor:'#d0d9e2',inFront:true});
      }
    }
    viewer.render();
  }

  async function readAsset(asset,signal){
    const response=await fetch(molecularAssetURL(asset.url),{signal,credentials:'same-origin',redirect:'error'});
    if(!response.ok)throw new Error(`The local model could not be read (${response.status}).`);
    if(Number(response.headers.get('content-length'))>20*1024*1024)throw new Error('Model exceeds this viewer’s 20 MiB limit.');
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength>20*1024*1024)throw new Error('Model exceeds this viewer’s 20 MiB limit.');
    if(asset.sha256){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==asset.sha256.toLowerCase())throw new Error('Model hash does not match the imported evidence.');}
    const data=new TextDecoder().decode(bytes);
    if(/^\s*</.test(data))throw new Error('The model URL returned a web page rather than molecular coordinates.');
    return data;
  }
  async function setVisibleModels(species){
    if(disposed)return false;
    const selected=overlayAssets(assets,species),token=++generation;
    request?.abort();const controller=new AbortController();request=controller;
    report(`Loading ${species.join(' + ')}…`,'loading');
    try{
      await frameReady;if(disposed||token!==generation)return false;
      const previous=current,sharedCamera=current&&displayFrame(current)&&displayFrame(current)===displayFrame(selected[0])?viewer.getView():null;
      selectedAtom=null;pickedResidues=[];current=null;loaded=[];loadErrors=[];viewer.clear();
      const results=await Promise.allSettled(selected.map(asset=>readAsset(asset,controller.signal)));
      if(disposed||token!==generation)return false;
      for(let i=0;i<selected.length;i++){
        const asset=selected[i],result=results[i];let model;
        try{
          if(result.status==='rejected')throw result.reason;
          model=viewer.addModel(result.value,asset.format==='mmcif'?'cif':asset.format);
          const atoms=model.selectedAtoms({});
          if(!atoms.length)throw new Error('No atoms were found in this model.');
          if([...receptorChains(asset),...binderChains(asset)].some(id=>!model.selectedAtoms({chain:id}).length))throw new Error('Recorded receptor or binder chain is absent from this model.');
          if(asset.kind==='binder_homodimer'&&atoms.some(a=>!binderChains(asset).includes(a.chain)))throw new Error('A binder homodimer must contain exactly its two declared binder chains.');
          if(asset.kind==='binder_only'&&atoms.some(a=>a.chain!==asset.roles.binder))throw new Error('A designed-binder monomer must contain only the recorded binder chain.');
          for(const segment of fusionSegments)if(!model.selectedAtoms({chain:asset.roles.binder,resi:`${segment.range[0]}-${segment.range[1]}`}).length)throw new Error(`The documented ${segment.label} domain is absent from this model.`);
          alignDisplayAtoms(atoms,asset);
          const entry={asset,model,atoms,confidence:residueConfidence(asset,atoms),chainbow:chainbowColors(atoms),annotationLayers:stageLayers(atoms,asset,selected.length>1?annotations.filter(a=>a.modelSha256===asset.sha256):annotations),distanceLayers:stageDistances(atoms,asset,selected.length>1?measurements.filter(a=>a.modelSha256===asset.sha256):measurements),contacts:null};
          entry.regionLayers=molecularRegions(atoms,asset);entry.regionByAtom=new Map(entry.regionLayers.flatMap(region=>region.indices.map(index=>[index,region])));
          model.setClickable(asset.kind==='receptor_only'?{chain:receptorChains(asset)}:{},true,atom=>{
            if(disposed||!loaded.includes(entry))return;
            selectedAtom={atom,entry};restyle();
            const confidence=entry.confidence.get(JSON.stringify([atom.chain,atom.resi,atom.icode||'']));
            const role=molecularChainRole(asset,atom.chain);
            report(`${atomIdentityLabel(asset,atom)} · atom ${atom.atom||atom.elem||''}${confidenceAvailable(asset)?` · Cα pLDDT ${Number.isFinite(confidence)?confidence.toFixed(1):'unavailable for this residue'}`:''}`,'ready');
            onAtomSelected({species:asset.species,target:targetOf(asset),modelId:asset.displayModelId||asset.id||asset.species,modelSha256:asset.sha256,chainRole:role.role,chainRoleLabel:role.label,chain:atom.chain,resi:atom.resi,resn:atom.resn,atom:atom.atom,...(atom.icode?{icode:atom.icode}:{})});
          });
          loaded.push(entry);
        }catch(error){if(model)viewer.removeModel(model);loadErrors.push({species:asset.species,target:targetOf(asset),message:error.message||'Model could not be displayed.'});}
      }
      if(!loaded.length)throw new Error(loadErrors.map(e=>`${e.species}: ${e.message}`).join('; '));
      current=loaded[0].asset;
      restyle();applyCamera([0,0,0,0,0,0,0,1]);viewer.zoomTo();viewer.zoom(0.85);automaticView=cameraView(viewer.getView());
      const target=targetOf(current),preset=viewPresets[target],cameraAsset={...current,species:target};
      if(preset&&preset.frameId===displayFrame(current))automaticView.splice(4,4,...quaternionFromRotation(preset.rotation));
      initialView=matchingCamera(defaults[target],cameraAsset)||[...automaticView];initialFrame=displayFrame(current);
      const carriedCamera=(sharedCamera&&displayFrame(selected[0])===initialFrame?sharedCamera:null)||equivalentCamera(pendingView,current);pendingView=null;
      applyCamera(carriedCamera||initialView);viewer.render();
      report(`${current.species}${loaded.length>1?` + ${loaded.length-1} overlays`:''} · ${carriedCamera?'equivalent receptor perspective retained':matchingCamera(defaults[target],cameraAsset)?'your saved target view':preset&&preset.frameId===initialFrame?'recorded project front view':'fitted view'}${current.displayFrame?' · receptor aligned':''} · drag to rotate${current.sha256?' · source file checked':''}${previous&&!sharedCamera&&!current.displayFrame?' · independent view; shared receptor frame unavailable':''}${loadErrors.length?` · ${loadErrors.map(e=>`${e.species}: ${e.message}`).join('; ')}`:''}`,loadErrors.length?'error':'ready');
      return true;
    }catch(error){
      if(disposed||token!==generation||error.name==='AbortError')return false;
      current=null;loaded=[];selectedAtom=null;viewer?.clear();report(error.message||'The models could not be displayed.','error');throw error;
    }
  }
  const setSpecies=species=>setVisibleModels([species]);
  const ready = setVisibleModels(initialAssets.map(a=>a.species));
  // Callers can await ready; this internal handler prevents an unhandled rejection
  // when the caller uses only the status callback.
  ready.catch(() => {});
  return {
    ready, setSpecies, setVisibleModels,
    getVisibleModels() {return loaded.map(entry=>entry.asset.species);},
    setIsoformColors(value) {isoformColors=value===true;restyle();},
    captureView() { return viewer&&current&&!disposed&&displayFrame(current)?{frameId:displayFrame(current),target:targetOf(current),overlayCount:Math.max(0,loaded.length-1),view:cameraView(viewer.getView())}:null; },
    getDefaultViewInfo() { return current&&!disposed?{target:targetOf(current),overlayCount:Math.max(0,loaded.length-1),personal:Boolean(matchingCamera(defaults[targetOf(current)],{...current,species:targetOf(current)}))}:null; },
    setAnnotationVisible(id,visible) { if(!annotations.some(layer=>layer.id===id))throw new Error('Unknown source annotation layer.');if(visible)hiddenAnnotationLayers.delete(id);else hiddenAnnotationLayers.add(id);restyle(); },
    setStageDistances(value) { showStageDistances=value===true;restyle(); },
    setStageDistance(id) { if(id!=='all'&&!measurements.some(m=>m.id===id))throw new Error('Unknown saved atom pair.');selectedStageDistance=id;restyle(); },
    setPickedResidues(selectors) {
      if(!current||!Array.isArray(selectors)||selectors.length>1000)throw new Error('Wait for the target structure to load.');
      pickedResidues=selectors.map(s=>{
        const entry=loaded.find(e=>e.asset.species===(s?.species||current.species));
        if(!s||!entry||s.chain!==entry.asset.roles.receptor||!Number.isInteger(s.resi)||!entry.atoms.some(a=>a.chain===s.chain&&Number(a.resi)===s.resi&&(!s.atom||a.atom===s.atom)))throw new Error('Selected hotspot is absent from this target.');
        return {species:entry.asset.species,chain:s.chain,resi:s.resi,...(s.atom?{atom:s.atom}:{})};
      });selectedAtom=null;restyle();
    },
    reset() { if (viewer && current && !disposed && initialView) { selectedAtom = null; restyle(); applyCamera(initialView); viewer.render(); report(`${current.species}${loaded.length>1?` + ${loaded.length-1} overlays`:''} · ${matchingCamera(defaults[targetOf(current)],{...current,species:targetOf(current)})?'saved target view':'project starting view'} restored`, 'ready'); } },
    fitVisible() {
      if(!viewer||!current||disposed)return;
      const rotation=cameraView(viewer.getView()).slice(4);viewer.zoomTo();viewer.zoom(0.85);
      const fit=cameraView(viewer.getView());fit.splice(4,4,...rotation);applyCamera(fit);viewer.render();
      report(`${loaded.length} selected models fitted · current orientation retained · saved default unchanged`,'ready');
    },
    saveDefaultView() {
      if(!viewer||!current||disposed||!initialFrame)throw new Error('Wait for a model with a verified receptor frame to load.');
      const record={schemaVersion:1,campaignId,target:targetOf(current),frameId:initialFrame,overlayCount:Math.max(0,loaded.length-1),view:cameraView(viewer.getView()),savedAt:new Date().toISOString()};
      defaults[targetOf(current)]=record;initialView=[...record.view];
      report(`${current.species}${loaded.length>1?` + ${loaded.length-1} overlays`:''} · default view saved for this target · Reset returns here`,'ready');return record;
    },
    clearDefaultView() {
      if(!viewer||!current||disposed||!automaticView)throw new Error('Wait for the model to load.');
      delete defaults[targetOf(current)];initialView=[...automaticView];selectedAtom=null;restyle();applyCamera(initialView);viewer.render();
      report(`${current.species} · project starting view restored · personal default removed`,'ready');return targetOf(current);
    },
    setPalette(value = {}) { colors = { ...colors, ...value }; restyle(); },
    setColorMode(value) {if(!['project','chainbow','plddt'].includes(value))throw new Error('Choose project palette, Chainbow or pLDDT.');colorMode=value;restyle();},
    getColorInfo() {
      const models=loaded.map(({asset,confidence,chainbow})=>({species:asset.species,target:targetOf(asset),modelId:asset.displayModelId||asset.id||asset.species,modelSha256:asset.sha256,frameId:displayFrame(asset),confidenceAvailable:confidenceAvailable(asset),scoredResidues:[...confidence.values()].filter(Number.isFinite).length,missingResidues:chainbow.size-[...confidence.values()].filter(Number.isFinite).length,isoformColor:isoformColor(asset)}));
      return {mode:colorMode,isoformColors,confidenceAvailable:models.some(m=>m.confidenceAvailable),scoredResidues:models.reduce((n,m)=>n+m.scoredResidues,0),missingResidues:models.reduce((n,m)=>n+m.missingResidues,0),models,loadErrors:loadErrors.map(e=>({...e}))};
    },
    setAnnotationLabels(value) { annotationLabels=value===true;restyle(); },
    setHotspots(value) { showHotspots = value === true; restyle(); },
    setRepresentation(value) { if (!['cartoon', 'sticks', 'backbone'].includes(value)) throw new Error('Choose cartoon, sticks or backbone.'); representation = value; restyle(); },
    setProjectColors(value) { projectColors = value === true; restyle(); },
    setSideChains(value) { showSideChains = value === true; restyle(); },
    setResidueColors(value) { showResidueColors = value === true; restyle(); },
    setInterface(value) { if(value===true&&current&&!loaded.some(e=>chain(e.asset.roles.binder)&&chain(e.asset.roles.receptor))){report('This is a single-chain structure; no binder–target interface is present.','ready');return;}const changed=showInterface!==(value===true);showInterface=value===true;restyle();if(current&&changed)report(showInterface?`${loaded.length} model(s) · ${loaded.reduce((n,e)=>n+(e.contacts?.length||0),0)} within-model geometric contacts ≤4 Å (up to five per model); distances only`:'Geometric contact display hidden','ready'); },
    getContacts() {
      if(disposed||!showInterface)return [];
      const identity=atom=>({chain:atom.chain,resn:atom.resn,resi:atom.resi,atom:atom.atom,...(atom.icode?{icode:atom.icode}:{})});
      return loaded.flatMap(entry=>(entry.contacts||[]).map(contact=>({species:entry.asset.species,target:targetOf(entry.asset),modelId:entry.asset.displayModelId||entry.asset.id||entry.asset.species,modelSha256:entry.asset.sha256,receptor:identity(contact.receptor),binder:identity(contact.binder),distanceAngstrom:contact.distance})));
    },
    dispose() {
      if (disposed) return;
      disposed = true; generation++; request?.abort(); clearTimeout(timeout);
      rejectFrame(new Error('Molecular viewer disposed.'));
      try {
        viewer?.spin(false); viewer?.stopAnimate(); viewer?.clear();
        const canvas = viewer?.getCanvas();
        const gl = canvas?.getContext('webgl') || canvas?.getContext('experimental-webgl');
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* The owned iframe still releases its entire browsing context. */ }
      viewer = null; current = null; loaded=[]; frame.remove();
    },
  };
}
