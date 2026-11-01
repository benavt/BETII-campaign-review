// Explicit, source-bound stage annotations; no residue-number inference.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const source=value=>value&&typeof value.path==='string'&&value.path.length>0&&hash(value.sha256);
const label=value=>typeof value==='string'&&value.length>0&&value.length<=1000;
function bound(value,asset){assert(value&&label(value.id)&&label(value.label)&&hash(asset.sha256)&&value.modelSha256===asset.sha256&&source(value.source),'Stage overlays require the exact displayed model and a source fingerprint.');}
function selector(value){assert(value&&typeof value.chain==='string'&&value.chain.length>0&&value.chain.length<=32&&Number.isInteger(value.resi)&&Math.abs(value.resi)<100000&&(value.icode===undefined||typeof value.icode==='string'&&value.icode.length<=4)&&(value.atom===undefined||typeof value.atom==='string'&&value.atom.length>0&&value.atom.length<=10),'Stage residue selections need explicit chain and residue identities.');}
const insertion=value=>{const result=typeof value==='string'?value.trim():'';return ['.','?'].includes(result)?'':result;};
// 3Dmol leaves label_seq_id as a string when a CIF has no auth_seq_id.
const residueNumber=value=>typeof value==='string'&&/^-?\d+$/.test(value)?Number(value):value;
const matches=(atom,s)=>atom.chain===s.chain&&residueNumber(atom.resi)===s.resi&&insertion(atom.icode)===insertion(s.icode)&&(!s.atom||atom.atom===s.atom);
export function stageLayers(atoms,asset,layers=[]){
  assert(Array.isArray(layers)&&layers.length<=30,'Too many stage annotation layers.');
  const residueKey=value=>JSON.stringify([value.chain,residueNumber(value.resi),insertion(value.icode)]),residues=new Map();
  for(const atom of atoms){const key=residueKey(atom);if(!residues.has(key))residues.set(key,[]);residues.get(key).push(atom);}
  return layers.map(layer=>{
    bound(layer,asset);assert(['hotspot','flexible','fixed','assessment'].includes(layer.kind)&&/^#[a-f0-9]{6}$/i.test(layer.color)&&Array.isArray(layer.selectors)&&layer.selectors.length>0&&layer.selectors.length<=5000,'Invalid stage annotation.');
    const indices=new Set();
    for(const s of layer.selectors){selector(s);const found=(residues.get(residueKey(s))||[]).filter(a=>matches(a,s));assert(found.length>0,`Recorded stage annotation is absent: ${layer.label} · ${s.chain}:${s.resi}${s.atom?':'+s.atom:''}`);found.forEach(a=>indices.add(a.index));}
    return {...layer,indices:[...indices]};
  });
}
export function stageDistances(atoms,asset,measurements=[]){
  assert(Array.isArray(measurements)&&measurements.length<=30,'Too many stage distance overlays.');
  return measurements.map(m=>{
    bound(m,asset);selector(m.a);selector(m.b);assert(m.a.atom&&m.b.atom&&Number.isFinite(m.cachedDistanceAngstrom)&&m.cachedDistanceAngstrom>=0,'A historical-distance overlay needs explicit atoms and a cached value.');
    const aa=atoms.filter(a=>matches(a,m.a)),bb=atoms.filter(a=>matches(a,m.b));assert(aa.length===1&&bb.length===1,'Stage distance atoms are missing or ambiguous.');
    const a=aa[0],b=bb[0],distanceAngstrom=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    assert(Number.isFinite(distanceAngstrom)&&Math.abs(distanceAngstrom-m.cachedDistanceAngstrom)<=0.03,'Displayed atom pair does not reproduce the cached filter distance.');
    return {...m,a,b,distanceAngstrom};
  });
}
