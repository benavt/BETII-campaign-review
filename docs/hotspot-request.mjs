// Portable preparation requests. This module has no job/provider execution route.
export const DESIGN_ENGINES=Object.freeze({
 rfd3:{label:'RFD3',countLabel:'Requested backbones',countKey:'backbones',fields:['lengthMin','lengthMax','count','sequencesPerBackbone','seed']},
 rfd4:{label:'RFD4',countLabel:'Requested designs',countKey:'designs',fields:['lengthMin','lengthMax','count','seed']},
 ligandforge:{label:'LigandForge',countLabel:'Requested sequences',countKey:'sequences',fields:['lengthMin','lengthMax','count']},
});
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export const safeRepository=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(value)&&!value.endsWith('.git');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v,n=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&(n>=4000||!/[\x00-\x1f\x7f]/.test(v));
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
const bounded=(v,lo,hi)=>Number.isSafeInteger(v)&&v>=lo&&v<=hi;
export function validateHotspotBody(b){
 assert(exact(b,['schemaVersion','kind','intent','campaignId','repository','sourceRunId','workflowPin','parentDigest','replicate','goal','target','hotspotSets','combination','constraints','engines','deliverables','executionAuthorized','spendingAuthorized','externalLLMCalls']),'Unexpected or missing request fields.');
 assert(b.schemaVersion===1&&b.kind==='hotspot-design-request'&&['prepare-designs','workflow-test'].includes(b.intent),'Unsupported hotspot request schema.');
 assert(text(b.campaignId)&&safeRepository(b.repository)&&text(b.goal,4000)&&text(b.replicate),'Choose a campaign, owning repository, goal and replicate identity.');
 assert((b.sourceRunId===null||text(b.sourceRunId))&&(b.workflowPin===null||text(b.workflowPin,2000))&&(b.parentDigest===null||hash(b.parentDigest)),'Invalid source or predecessor identity.');
 assert(b.executionAuthorized===false&&b.spendingAuthorized===false&&b.externalLLMCalls===0,'A hotspot request authorizes preparation only.');
 const t=b.target;
 assert(exact(t,['label','sourceStage','url','format','sha256','chains','sequenceSha256'])&&text(t.label)&&['input','reference','generated','refold','cached_complex'].includes(t.sourceStage)&&hash(t.sha256)&&['pdb','cif','mmcif'].includes(t.format),'Choose an exact target source.');
 assert(/^\.\/data\/assets\/[A-Za-z0-9_./-]+$/.test(t.url)&&!t.url.includes('..')&&!t.url.includes('//'),'Target must reference a local scientific asset.');
 assert(Array.isArray(t.chains)&&t.chains.length>0&&t.chains.length<=32&&new Set(t.chains).size===t.chains.length&&t.chains.every(c=>text(c,32)&&/^[A-Za-z0-9_]+$/.test(c))&&(t.sequenceSha256===null||hash(t.sequenceSha256)),'Target chains or sequence identity are invalid.');
 assert(['separate','combined'].includes(b.combination)&&Array.isArray(b.hotspotSets)&&b.hotspotSets.length>0&&b.hotspotSets.length<=12,'Choose named hotspot conditions.');
 const names=new Set();let count=0;
 for(const set of b.hotspotSets){
  assert(exact(set,['name','selectors','sourceLayer'])&&text(set.name,80)&&!names.has(set.name)&&Array.isArray(set.selectors)&&set.selectors.length>0,'Hotspot sets need unique names and selected residues.');names.add(set.name);
  assert(set.sourceLayer===null||exact(set.sourceLayer,['id','modelSha256'])&&text(set.sourceLayer.id)&&set.sourceLayer.modelSha256===t.sha256,'Recorded hotspots belong to a different source.');
  const seen=new Set();
  for(const s of set.selectors){
   assert(exact(s,['chain','resi','icode','resn','atom'])&&t.chains.includes(s.chain)&&bounded(s.resi,-9999,99999)&&typeof s.icode==='string'&&/^[A-Za-z0-9]{0,4}$/.test(s.icode)&&text(s.resn,12)&&(s.atom===null||text(s.atom,12)&&/^[A-Za-z0-9'"*+_-]+$/.test(s.atom)),'Invalid native hotspot identity.');
   const key=canonical(s);assert(!seen.has(key),'Duplicate hotspot.');seen.add(key);count++;
  }
 }
 assert(count<=1000,'Select at most 1,000 hotspots.');
 assert(exact(b.constraints,['context','coordinateFlexibility','note'])&&b.constraints.context==='retain_declared_target_chains'&&['preserve','requires_recipe_review'].includes(b.constraints.coordinateFlexibility)&&typeof b.constraints.note==='string'&&b.constraints.note.length<=4000,'Invalid target constraints.');
 assert(Array.isArray(b.engines)&&b.engines.length>0&&b.engines.length<=3,'Choose at least one design method.');
 const engines=new Set();let total=0;
 for(const e of b.engines){
  assert(exact(e,['id','recipe','settings'])&&DESIGN_ENGINES[e.id]&&!engines.has(e.id),'Choose distinct supported methods.');engines.add(e.id);
  assert(e.recipe===null||exact(e.recipe,['operation','revision'])&&/^[a-z0-9-]+-v[0-9]+$/.test(e.recipe.operation)&&hash(e.recipe.revision),'Recipe must identify a pinned named operation.');
  const f=DESIGN_ENGINES[e.id].fields;assert(exact(e.settings,f),'Unsupported method settings.');
  const p=e.settings;assert(bounded(p.count,1,10000)&&bounded(p.lengthMin,1,1000)&&bounded(p.lengthMax,p.lengthMin,1000),'Enter valid counts and binder lengths.');
  if(f.includes('seed'))assert(p.seed===null||bounded(p.seed,0,2147483647),'Seed must be an integer or explicitly unknown.');
  if(f.includes('sequencesPerBackbone'))assert(p.sequencesPerBackbone===null||bounded(p.sequencesPerBackbone,1,100),'Record sequences per backbone or leave explicitly unresolved.');
  total+=p.count*(b.combination==='separate'?b.hotspotSets.length:1);
 }
 assert(total<=10000,'Request at most 10,000 generation attempts.');
 assert(Array.isArray(b.deliverables)&&b.deliverables.length>0&&new Set(b.deliverables).size===b.deliverables.length&&b.deliverables.every(v=>['native_outputs','sequences','validation_report'].includes(v)),'Choose supported deliverables.');
 return b;
}
export function workUnits(b){validateHotspotBody(b);return b.engines.flatMap(e=>(b.combination==='separate'?b.hotspotSets:[{name:'Combined: '+b.hotspotSets.map(s=>s.name).join(', ')}]).map(s=>({engine:e.id,condition:s.name,count:e.settings.count,unit:DESIGN_ENGINES[e.id].countKey,recipe:e.recipe,status:e.recipe?'requires_native_validation':'requires_adapter_selection'})));}
export async function makeHotspotRequest(body,{createdAt=new Date().toISOString(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}={}){
 validateHotspotBody(body);const requestDigest=await digest(body);
 const request={id:`${date}_hotspot-design_${requestDigest.slice(0,16)}`,createdAt,requestDigest,body:structuredClone(body)};assert(new TextEncoder().encode(canonical(request)).length<=48000,'Request capsule is too large; reduce the request.');return request;
}
export async function validateHotspotRequest(r){
 assert(exact(r,['id','createdAt','requestDigest','body'])&&/^\d{4}-\d{2}-\d{2}_hotspot-design_[a-f0-9]{16}$/.test(r.id)&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(r.createdAt)&&Number.isFinite(Date.parse(r.createdAt)),'Invalid request envelope.');
 assert(new TextEncoder().encode(canonical(r)).length<=48000,'Request capsule is too large; reduce the request.');validateHotspotBody(r.body);assert(await digest(r.body)===r.requestDigest&&r.id.endsWith(r.requestDigest.slice(0,16)),'Request content changed; create a successor revision.');return r;
}
export function issueDocument(r){
 const b=validateHotspotBody(r.body),marker=`<!-- hotspot-design-request:v1:${r.requestDigest} -->`;
 const title=`${r.id.slice(0,10)} ${b.intent==='workflow-test'?'[Workflow test]':'[Design request]'} ${b.target.label} · ${b.engines.map(e=>DESIGN_ENGINES[e.id].label).join(' / ')}`.slice(0,220);
 const summary=[marker,`## ${b.intent==='workflow-test'?'Workflow test — no scientific work requested':'Requested design preparation'}`,b.goal.split('\n').map(line=>'> '+line).join('\n'),'',`Campaign: ${b.campaignId}`,`Target: ${b.target.label} (${b.target.sourceStage}); chains ${b.target.chains.join(', ')}`,`Hotspots: ${b.hotspotSets.map(s=>s.name+': '+s.selectors.map(v=>`${v.chain}:${v.resn}${v.resi}${v.icode}${v.atom?':'+v.atom:''}`).join(', ')).join('; ')}`,`Conditions: ${b.combination}`,'',...workUnits(b).map(u=>`- ${u.engine} · ${u.condition}: ${u.count} requested ${u.unit}; ${u.status}`),'','Next action: validate exact inputs and prepare pinned native operations. Report unresolved settings.','Execution and spending are not authorized. No automatic retries, scoring or external LLM calls.','Project listener or manual agent pickup must validate and prepare this capsule; launch requires separate approval.','','## Validated request capsule','```json',JSON.stringify(r,null,2),'```'].join('\n');
 assert(new TextEncoder().encode(summary).length<=60000,'Issue capsule is too large; reduce the request.');return {title,body:summary};
}
export function owningRepository(c,config={}){const value=c.hotspotDesign?.issueRepository||config.campaigns?.[c.id]||config.defaultRepository;return safeRepository(value)?value:null;}
