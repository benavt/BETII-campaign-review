// Semantic molecule colors are campaign-specific. UI swatches approximate named
// PyMOL colors; exported recipes retain the original names exactly.
export const SWATCH_NOTE = 'Named-color swatches are approximate. PyMOL exports use the recorded color names.';
const SWATCHES = Object.freeze({ lightorange:'#FFCC80', skyblue:'#3380CC', cyan:'#00FFFF', magenta:'#FF00FF', gray:'#808080', slate:'#8080FF', hotpink:'#FF0080', green:'#00FF00', orange:'#FF8000', purple:'#BF00BF', blue:'#0000FF', red:'#FF0000', yellow:'#FFFF00', tv_orange:'#FF8C26' });
const atomRoles = [
  { id:'histidine', label:'Histidine carbon atoms', color:'purple', scope:'atom', filter:'resn HIS' },
  { id:'acidic', label:'ASP / GLU carbon atoms', color:'blue', scope:'atom', filter:'resn ASP+GLU' },
  { id:'basic', label:'ARG / LYS carbon atoms', color:'red', scope:'atom', filter:'resn ARG+LYS' },
  { id:'nag', label:'Actual NAG carbon atoms', color:'yellow', scope:'atom', filter:'resn NAG' },
  { id:'originalHotspots', label:'Original target hotspots', color:'green', scope:'atom' },
  { id:'editableHotspots', label:'Editable interface hotspots', color:'tv_orange', scope:'atom' },
];
const cartoon = (id,label,color,filter) => ({id,label,color,scope:'cartoon',...(filter?{filter}:{})});
const presets = {
  tfr1: {label:'TfR1 · Week 4 domains / designed binder',roles:[cartoon('receptor','Other receptor context','#BAC4CF'),cartoon('proteaseLike','Protease-like domain','blue'),cartoon('apical','Apical domain','#29A6AD'),cartoon('helical','Helical domain','slate'),cartoon('binder','Designed binder','magenta'),{id:'originalHotspots',label:'Requested hotspot guidance',color:'#1AE633',scope:'atom'}]},
  betii: {label:'BETII · documented target / binder',roles:[cartoon('receptor','ET target · recorded blue gray','#7594AB'),cartoon('binder','Binder · recorded orange','#F07A21'),{id:'apoHotspots',label:'Hotspots · apo reference only',color:'#FF69B4',scope:'atom'}]},
  neutral: {label:'Neutral · project standard not yet verified',roles:[cartoon('receptor','Receptor (neutral reference)','gray'),cartoon('binder','Binder (neutral reference)','cyan'),...atomRoles]},
  egfr: { label:'EGFR · human / mouse / binder', roles:[
    cartoon('humanReceptor','Human receptor','lightorange'),
    cartoon('mouseReceptor','Mouse receptor','skyblue'),
    cartoon('binder','Binder / DD1','cyan'),
    cartoon('d46Dd1','D46 DD1 · residues 15–91','cyan','resi 15-91'),
    cartoon('d46Dd2','D46 DD2 · residues 1–14','magenta','resi 1-14'),
    ...atomRoles,
  ] },
  tnf: { label:'TNF · two-domain fusion', roles:[
    cartoon('target','Target trimer','gray'), cartoon('nDomain','N-terminal domain','cyan'),
    cartoon('cDomain','C-terminal domain','hotpink'), cartoon('linker','Linker','green'),
    ...atomRoles,
  ] },
  glp1r: { label:'GLP-1R · ligand / conditioning pocket', roles:[
    cartoon('ligand','Ligand','orange'),
    ...atomRoles,
    {id:'conditioningHotspots',label:'Conditioning pocket / hotspots',color:'hotpink',scope:'atom'},
  ] },
  tnfa_species: { label:'TNFα · species / trimer copy reference', roles:[
    cartoon('humanCopy1','Human copy 1','#174A78'), cartoon('humanCopy2','Human copy 2','#397FB7'), cartoon('humanCopy3','Human copy 3','#8BC6E8'),
    cartoon('mouseCopy1','Mouse copy 1','#85451F'), cartoon('mouseCopy2','Mouse copy 2','#C67B35'), cartoon('mouseCopy3','Mouse copy 3','#EAC18B'),
    ...atomRoles.map(r => r.id==='histidine'?{...r,color:'magenta'}:{...r}),
  ] },
};
for (const preset of Object.values(presets)) { preset.roles.forEach(Object.freeze); Object.freeze(preset.roles); Object.freeze(preset); }
export const COLOR_PRESETS = Object.freeze(presets);

function presetFor(id) { if(!Object.hasOwn(COLOR_PRESETS,id))throw new Error('Unknown campaign color preset.'); return COLOR_PRESETS[id]; }
function record(value) { return value && typeof value==='object' && !Array.isArray(value); }
export function paletteFor(presetId) { return Object.fromEntries(presetFor(presetId).roles.map(r=>[r.id,r.color])); }
export function swatchFor(color) { return typeof color==='string' && /^#[0-9a-f]{6}$/i.test(color)?color:Object.hasOwn(SWATCHES,color)?SWATCHES[color]:null; }
export function validatePalette(presetId,palette) {
  const preset=presetFor(presetId);
  if(!record(palette))throw new Error('A color palette must be an object.');
  const known=new Set(preset.roles.map(r=>r.id));
  for(const [id,color] of Object.entries(palette)) {
    if(!known.has(id))throw new Error('Unknown semantic color role.');
    if(typeof color!=='string'||(!Object.hasOwn(SWATCHES,color)&&!/^#[0-9a-f]{6}$/i.test(color)))throw new Error('Choose a supported PyMOL color name or a six-digit hex color.');
  }
  for(const id of known)if(!Object.hasOwn(palette,id))throw new Error('The palette is missing a semantic color role.');
  return palette;
}

// Small selection grammar: object names, chain/resi/resn/name/elem selectors,
// protein/organic flags, parentheses and and/or/not. No PML commands or quoting.
export function validateBinding(selection) {
  if(typeof selection!=='string'||!selection.trim()||selection.length>500||/[\u0000-\u001f\u007f,;"'`\\:#%\[\]{}]/.test(selection))throw new Error('Use a simple explicit PyMOL selection without commands or quotes.');
  const tokens=selection.trim().match(/[A-Za-z0-9_.+*-]+|[()]/g)||[];
  if(tokens.join('')!==selection.replace(/\s/g,''))throw new Error('Unsupported PyMOL selection syntax.');
  let i=0;
  const identifiers=/^[A-Za-z_][A-Za-z0-9_.-]*$/;
  const selectors={chain:/^[A-Za-z0-9_]+(?:\+[A-Za-z0-9_]+)*$/,resi:/^-?\d+[A-Za-z]?(?:--?\d+[A-Za-z]?)?(?:\+-?\d+[A-Za-z]?(?:--?\d+[A-Za-z]?)?)*$/,resn:/^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/,name:/^[A-Za-z0-9*]+(?:\+[A-Za-z0-9*]+)*$/,elem:/^[A-Za-z]+(?:\+[A-Za-z]+)*$/};
  function term() {
    if(tokens[i]==='not'){i++;return term();}
    if(tokens[i]==='('){i++;expression();if(tokens[i++]!==')')throw new Error('Unbalanced selection parentheses.');return;}
    const token=tokens[i++];
    if(Object.hasOwn(selectors,token)){if(!selectors[token].test(tokens[i++]||''))throw new Error('Invalid selection value.');return;}
    if(!token||['and','or',')'].includes(token)||!identifiers.test(token))throw new Error('Invalid molecule selection.');
  }
  function expression(){term();while(['and','or'].includes(tokens[i])){i++;term();}}
  expression();if(i!==tokens.length)throw new Error('Unsupported PyMOL selection expression.');
  return selection.trim();
}

export function exportPML({presetId,palette=paletteFor(presetId),bindings={}}) {
  const preset=presetFor(presetId);validatePalette(presetId,palette);
  if(!record(bindings))throw new Error('Molecule bindings must be an object.');
  const lines=['# Campaign Studio display recipe; verify molecule identity and numbering before use.',
    '# Display colors only. No load, alignment, scoring, execution, or submission commands.',
    '# Native coordinates and existing source sessions are preserved.',
    '# Named UI swatches are approximate; these named PyMOL colors are authoritative.',
    '# Atom color precedence: base < residue classes < original hotspots < editable hotspots.',
    'set cartoon_smooth_loops, 0', 'set cartoon_fancy_helices, 0'];
  for(const id of Object.keys(bindings))if(!preset.roles.some(r=>r.id===id))lines.push('# Skipped unknown role; no molecule mapping inferred.');
  for(const role of preset.roles) {
    if(!bindings[role.id]){lines.push(`# Unbound ${role.id}; skipped without guessing a chain.`);continue;}
    const binding=validateBinding(bindings[role.id]);
    const selected=`(${binding})${role.filter?` and (${role.filter})`:''}`;
    let color=palette[role.id];
    if(color.startsWith('#')) {
      const name=`campaign_${role.id}`;
      const rgb=[1,3,5].map(i=>+(parseInt(color.slice(i,i+2),16)/255).toFixed(6));
      lines.push(`set_color ${name}, [${rgb.join(', ')}]`);color=name;
    }
    lines.push(`# ${role.label}`);
    if(role.scope==='cartoon')lines.push(`set cartoon_color, ${color}, (${selected})`);
    else lines.push(`show sticks, (${selected})`,`color ${color}, (${selected})`,`util.cnc (${selected})`);
  }
  return lines.join('\n')+'\n';
}
