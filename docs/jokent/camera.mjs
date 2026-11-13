// Display-only transforms. Native structure files and scientific scores stay intact.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e7;
export function cameraView(value){
  assert(Array.isArray(value)&&value.length===8&&value.every(finite),'A saved view needs eight finite camera values.');
  const norm=Math.hypot(...value.slice(4));
  assert(norm>0.999&&norm<1.001,'A saved camera needs a unit rotation.');
  return [...value];
}
export function rotationMatrix(value){
  assert(Array.isArray(value)&&value.length===3&&value.every(row=>Array.isArray(row)&&row.length===3&&row.every(finite)),'Display rotation must be a finite 3×3 matrix.');
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert(Math.abs(value[i].reduce((sum,x,k)=>sum+x*value[j][k],0)-(i===j?1:0))<1e-5,'Display rotation must preserve distances.');
  const [a,b,c]=value,det=a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0]);
  assert(Math.abs(det-1)<1e-5,'Display rotation cannot reflect a molecule.');
  return value.map(row=>[...row]);
}
export function quaternionFromRotation(value){
  const m=rotationMatrix(value),trace=m[0][0]+m[1][1]+m[2][2];let x,y,z,w,s;
  if(trace>0){s=Math.sqrt(trace+1)*2;w=s/4;x=(m[2][1]-m[1][2])/s;y=(m[0][2]-m[2][0])/s;z=(m[1][0]-m[0][1])/s;}
  else if(m[0][0]>m[1][1]&&m[0][0]>m[2][2]){s=Math.sqrt(1+m[0][0]-m[1][1]-m[2][2])*2;w=(m[2][1]-m[1][2])/s;x=s/4;y=(m[0][1]+m[1][0])/s;z=(m[0][2]+m[2][0])/s;}
  else if(m[1][1]>m[2][2]){s=Math.sqrt(1+m[1][1]-m[0][0]-m[2][2])*2;w=(m[0][2]-m[2][0])/s;x=(m[0][1]+m[1][0])/s;y=s/4;z=(m[1][2]+m[2][1])/s;}
  else{s=Math.sqrt(1+m[2][2]-m[0][0]-m[1][1])*2;w=(m[1][0]-m[0][1])/s;x=(m[0][2]+m[2][0])/s;y=(m[1][2]+m[2][1])/s;z=s/4;}
  const norm=Math.hypot(x,y,z,w);return [x/norm,y/norm,z/norm,w/norm];
}
export function displayFrame(asset){
  const f=asset.displayFrame;if(!f)return asset.coordinateFrame||null;
  assert(f.schemaVersion===1&&typeof f.id==='string'&&f.id.length>0&&f.id.length<=1000,'Display frame identity is required.');
  assert(f.nativeSha256===asset.sha256&&/^[a-f0-9]{64}$/.test(f.referenceSha256),'Display transform must bind the native model and receptor reference.');
  rotationMatrix(f.rotation);
  assert(Array.isArray(f.translation)&&f.translation.length===3&&f.translation.every(finite),'Display translation must be finite.');
  assert(Number.isInteger(f.matchedCA)&&f.matchedCA>=20&&finite(f.rmsdAngstrom)&&f.rmsdAngstrom>=0&&f.rmsdAngstrom<=3,'Receptor display alignment needs at least 20 matched Cα atoms with RMSD ≤3 Å.');
  return f.id;
}
export function alignDisplayAtoms(atoms,asset){
  displayFrame(asset);const f=asset.displayFrame;if(!f)return;
  // Row-vector convention matches the frozen NumPy/SVD presentation receipt.
  for(const atom of atoms){const p=[atom.x,atom.y,atom.z];if(!p.every(finite))throw new Error('Cannot align nonfinite model coordinates.');
    [atom.x,atom.y,atom.z]=f.translation.map((t,j)=>t+p.reduce((sum,x,i)=>sum+x*f.rotation[i][j],0));}
}
export function validateCameraDefault(value){
  assert(value&&value.schemaVersion===1&&typeof value.campaignId==='string'&&value.campaignId&&typeof value.target==='string'&&value.target&&typeof value.frameId==='string'&&value.frameId.length>0&&value.frameId.length<=1000,'Saved target view requires a campaign, target and receptor frame.');
  assert(typeof value.savedAt==='string'&&Number.isFinite(Date.parse(value.savedAt))&&/(Z|[+-]\d\d:\d\d)$/.test(value.savedAt),'Saved target view needs a timestamp with timezone.');
  cameraView(value.view);return value;
}
export function matchingCamera(value,asset){
  if(!value)return null;validateCameraDefault(value);
  return value.target===asset.species&&value.frameId===displayFrame(asset)?cameraView(value.view):null;
}
export function equivalentCamera(value,asset){
  if(!value||value.frameId!==displayFrame(asset))return null;
  return cameraView(value.view);
}
