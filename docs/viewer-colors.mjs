// https://www.alphafold.ebi.ac.uk/faq (confidence semantics and interpretation).
// https://github.com/molstar/molstar/blob/master/packages/extensions/model-archive/src/quality-assessment/plddt-bands.ts
// https://github.com/schrodinger/pymol-open-source/blob/master/modules/pymol/util.py
// PyMOL util.chainbow: spectrum('count', 'rainbow', byres=1), restarted per chain.
export const MISSING_CONFIDENCE_COLOR='#aaaaaa';
export const PLDDT_BANDS=Object.freeze([
  {label:'Very high · >90',above:90,color:'#0053d6'},
  {label:'Confident · >70–90',above:70,color:'#65cbf3'},
  {label:'Low · >50–70',above:50,color:'#ffdb13'},
  {label:'Very low · 0–50',above:-Infinity,color:'#ff7d45'},
]);
const SHA=/^[0-9a-f]{64}$/i;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function plddtColor(score){return Number.isFinite(score)&&score>=0&&score<=100?PLDDT_BANDS.find(b=>score>b.above).color:MISSING_CONFIDENCE_COLOR;}
export function confidenceAvailable(asset){const c=asset?.confidence;return Boolean(c?.kind==='plddt'&&c.source==='bfactor'&&SHA.test(asset.sha256)&&SHA.test(c.modelSha256)&&c.modelSha256.toLowerCase()===asset.sha256.toLowerCase());}
const residueKey=a=>JSON.stringify([a.chain,a.resi,a.icode||'']);
const polymer=a=>a&&a.hetflag!==true&&(a.atom==='CA'||a.atom==='P');
export function residueConfidence(asset,atoms=[]){
  const scores=new Map();
  if(!confidenceAvailable(asset))return scores;
  // Protein C-alpha confidence is used for the whole observed residue; no averaging.
  for(const atom of atoms)if(polymer(atom))scores.set(residueKey(atom),Number.isFinite(atom.b)&&atom.b>=0&&atom.b<=100?atom.b:null);
  return scores;
}
const RAINBOW=[[0,0,255],[0,255,255],[0,255,0],[255,255,0],[255,128,0],[255,0,0]];
export function chainbowColors(atoms=[]){
  const chains=new Map(),result=new Map();
  for(const atom of atoms)if(polymer(atom)){const k=residueKey(atom);if(!chains.has(atom.chain))chains.set(atom.chain,[]);const rows=chains.get(atom.chain);if(!rows.includes(k))rows.push(k);}
  for(const rows of chains.values())rows.forEach((key,i)=>{const t=rows.length>1?i/(rows.length-1)*5:0,j=Math.min(4,Math.floor(t)),f=t-j;result.set(key,'#'+RAINBOW[j].map((n,k)=>Math.round(n+(RAINBOW[j+1][k]-n)*f).toString(16).padStart(2,'0')).join(''));});
  return result;
}
export function atomDisplayColor(mode,atom,{confidence=new Map(),chainbow=new Map(),fallback=MISSING_CONFIDENCE_COLOR}={}){
  if(mode==='plddt')return plddtColor(confidence.get(residueKey(atom)));
  if(mode==='chainbow')return chainbow.get(residueKey(atom))||fallback;
  return fallback;
}
const swatch=(color,label)=>`<span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" rx="2" fill="${color}"/></svg> ${esc(label)}</span>`;
export function renderViewerColorControls(prefix,mode='project'){
  if(!/^[a-z][a-z0-9-]*$/.test(prefix))throw new Error('Invalid viewer control prefix.');
  return `<label class="viewer-representation">Color by<select id="${prefix}-color-mode" class="input" aria-label="Structure color mode">${[['project','Project palette'],['chainbow','Chainbow · N→C'],['plddt','pLDDT confidence']].map(([v,label])=>`<option value="${v}" ${mode===v?'selected':''}>${label}</option>`).join('')}</select></label><div id="${prefix}-color-legend" class="fine muted" role="status"></div>`;
}
export function renderViewerColorLegend({mode='project',confidenceAvailable:available=false,scoredResidues=0,missingResidues=0}={}){
  if(mode==='chainbow')return `<span class="confidence-swatches">${swatch('#0000ff','N terminus')}${swatch('#00ffff','')}${swatch('#00ff00','')}${swatch('#ffff00','')}${swatch('#ff8000','')}${swatch('#ff0000','C terminus')}</span> Rainbow restarts for each observed polymer chain.`;
  if(mode==='plddt')return available?`<span class="confidence-swatches">${PLDDT_BANDS.map(b=>swatch(b.color,b.label)).join('')}${missingResidues?swatch(MISSING_CONFIDENCE_COLOR,`${missingResidues} residues without valid scores`):''}</span> Cα pLDDT per residue · 0–100 · ${scoredResidues} scored residues. Local prediction confidence; does not establish interface accuracy.`:'pLDDT unavailable: this exact structure has no verified confidence-field declaration. B-factors have not been interpreted as confidence.';
  return `Project palette; residue and source annotation overlays remain available.${available?'':' pLDDT is not documented for this exact structure.'}`;
}
