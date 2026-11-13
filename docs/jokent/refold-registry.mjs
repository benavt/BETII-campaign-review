// Presentation only. Registration, reuse and dispatch belong to the scripted API.
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const METHODS={'boltz2-exact':'Boltz2 Exact',af3:'AlphaFold 3','opendde-exact':'OpenDDE Exact',openfold:'OpenFold'};
const COUNTS={available:'Available',active:'Already active',requested:'Requested',preparing:'Preparing',queued:'Queued',running:'Running',blocked:'Blocked',failed:'Failed'};
const STATES={available:'Available',reuse:'Available',active:'Already active',already_active:'Already active',requested:'Requested',preparing:'Preparing inputs',queued:'Queued',running:'Running',blocked:'Blocked',failed:'Failed',needs_attention:'Needs attention',completed:'Calculation complete',withdrawn:'Removed from shortlist'};
const REQUEST_STATES={requested:'Request prepared',preparing:'Preparing inputs',queued:'Queued',running:'Generating models',completed:'Calculations complete',needs_attention:'Needs attention',blocked:'Blocked',failed:'Failed',withdrawn:'Removed from shortlist'};
const scopes=[['monomer','binder','Binder alone'],['complex','BRD3','BRD3'],['complex','BRD2','BRD2'],['complex','BRD4','BRD4'],['complex','BRDT','BRDT']];
const text=value=>typeof value==='string'&&value.trim()?value.trim():'';
const technical=value=>/[a-f0-9]{40,64}|\/(?:Users|home|scratch|gpfs|mnt|private)\/|Traceback|FileNotFoundError|subprocess\./i.test(value);
function humanMessage(value,fallback){const message=text(value);return message&&!technical(message)?message.slice(0,800):fallback;}
const variant=id=>id==='untagged'?'untagged':['tagged','ctag64'].includes(id)?'tagged':null;
const tone=status=>['available','reuse','completed'].includes(status)?'neutral':['failed','blocked','needs_attention'].includes(status)?'blocked':'neutral';
function time(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return '';return `<time datetime="${esc(value)}">${esc(new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}</time>`;}
function totals(request){const counts=request?.counts;if(!counts||Object.keys(COUNTS).some(key=>!Number.isInteger(counts[key])||counts[key]<0))return null;return counts;}
function countsHTML(counts){return counts?`<div class="review-plan-state-list">${Object.entries(COUNTS).filter(([key])=>counts[key]>0).map(([key,label])=>`<span class="review-plan-state state-${key==='available'?'reuse':key}"><strong>${counts[key]}</strong> ${label.toLowerCase()}</span>`).join('')||'<span class="fine muted">No model counts reported</span>'}</div>`:'<p class="fine warning">Coverage counts need attention. Refresh to load a current record.</p>';}
const target=cell=>cell.kind==='monomer'&&cell.target==null?'binder':cell.target;
function cellKey(cell){return JSON.stringify([cell.kind,cell.engine,variant(cell.variant),target(cell)]);}
function modelDetails(request){
 const cells=Array.isArray(request.cells)?request.cells:[],records=new Map();let invalid=0;
 for(const cell of cells){
  if(!cell||!Object.hasOwn(METHODS,cell.engine)||!variant(cell.variant)||!scopes.some(([kind,id])=>kind===cell.kind&&id===target(cell))){invalid++;continue;}
  const key=cellKey(cell);if(records.has(key)){records.set(key,null);invalid++;}else records.set(key,cell);
 }
 const entry=(kind,target,engine,construct)=>{
  const key=cellKey({kind,target,engine,variant:construct});if(!records.has(key))return '<span class="fine muted">Not reported</span>';
  const cell=records.get(key);if(!cell)return '<span class="fine warning">Conflicting records</span>';
  const known=Object.hasOwn(STATES,cell.status),label=known?STATES[cell.status]:'Status unknown';
  const reason=cell.reason?humanMessage(cell.reason,'The runner needs a source or preparation check before this model can proceed.'):'';
  return `<span class="badge ${known?tone(cell.status):'blocked'}">${esc(label)}</span>${reason?`<small>${esc(reason)}</small>`:''}`;
 };
 return `<details class="refold-model-details"><summary>Models by method and construct${cells.length?` · ${cells.length} records`:''}</summary>${invalid?'<p class="fine warning">Some model records conflict or use an unknown scope. Refresh before relying on these counts.</p>':''}<div class="review-plan-methods">${Object.entries(METHODS).map(([engine,label])=>`<section class="refold-method"><h4>${label}</h4><div class="table-scroll"><table><caption class="sr-only">${label} model requests</caption><thead><tr><th scope="col">Model</th><th scope="col">Untagged</th><th scope="col">Tagged</th></tr></thead><tbody>${scopes.map(([kind,target,label])=>`<tr><th scope="row">${label}</th><td>${entry(kind,target,engine,'untagged')}</td><td>${entry(kind,target,engine,'tagged')}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div></details>`;
}
function requestCard(campaign,request,index){
 const pool=campaign.candidatePool||campaign.subjects||[],subject=pool.find(s=>s.id===request.candidateId);
 const label=text(subject?.displayName)||text(request.candidateLabel)||text(subject?.label)||`Design ${index+1}`,counts=totals(request);
 const noNew=counts&&counts.available+counts.active>0&&['requested','preparing','queued','running','blocked','failed'].every(key=>counts[key]===0);
 const status=Object.hasOwn(REQUEST_STATES,request.status)?REQUEST_STATES[request.status]:'Status needs attention';
 const sourceTimes=(request.cells||[]).map(c=>c.sourceObservedAt).filter(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))).sort((a,b)=>Date.parse(b)-Date.parse(a));
 const observation=sourceTimes.length?`<p class="fine muted">Latest recorded job observation ${time(sourceTimes[0])}</p>`:!noNew?'<p class="fine muted">A native job observation time has not been recorded yet.</p>':'';
 const removed=request.status==='withdrawn'||request.shortlisted===false;
 const message=noNew&&!['failed','blocked','needs_attention'].includes(request.status)?'Models already available or active. No duplicate folds are needed.':humanMessage(request.message,['failed','blocked','needs_attention'].includes(request.status)?'Preparation needs attention before more models can run. Check the model details and refresh after the recorded issue is resolved.':'Missing models enter input preparation, then native trial predictions before the remaining GPU work.');
 const removal=removed?'<p class="fine muted">Removed from the shortlist. Any jobs already submitted continue; removing a design does not cancel them.</p>':'';
 return `<article class="panel refold-request"><div class="panel-head"><h3>${esc(label)}</h3><span class="badge ${tone(request.status)}">${esc(status)}</span></div>${countsHTML(counts)}${removal}<p class="fine ${['failed','blocked','needs_attention'].includes(request.status)?'warning':'muted'}">${esc(message)}</p>${time(request.createdAt)?`<p class="fine muted">Registered ${time(request.createdAt)}</p>`:''}${observation}${modelDetails(request)}</article>`;
}
export function renderRefoldRegistry(campaign,registry){
 const header='<div class="section-heading"><div><h2>Additional models</h2><p>Missing models for added shortlist designs. Available models and active work are reused.</p></div><button type="button" class="button subtle" data-refold-refresh>Refresh</button></div>';
 let body;
 if(registry?.loading===true)body='<p class="fine muted" role="status">Loading model requests…</p>';
 else if(registry?.error||registry?.unavailable===true||registry?.available===false)body=`<div class="notice" role="status"><div><strong>Model requests are temporarily unavailable</strong><p>${esc(humanMessage(registry.error||registry.message,'Check the private server connection, then refresh. Existing jobs continue independently.'))}</p></div></div>`;
 else if(!registry)body='<p class="fine muted" role="status">Connect to the private campaign server and refresh to see additional model requests.</p>';
 else if(registry.schemaVersion!==1||registry.campaignId!==campaign.id||!Array.isArray(registry.requests))body='<p class="fine warning" role="status">These model requests could not be matched to this campaign. Refresh to load the correct registry.</p>';
 else{
  const automatic=registry.automatic===true?'<p class="fine muted">New requests proceed automatically through input preparation and validated native folding. Scientific review stays separate.</p>':'<p class="fine warning">Automatic preparation is paused. Existing requests remain listed.</p>';
  body=automatic+(registry.requests.length?registry.requests.map((request,index)=>request&&typeof request==='object'?requestCard(campaign,request,index):'<p class="fine warning">A model request could not be read. Refresh the registry.</p>').join(''):`<div class="panel"><p class="muted">${registry.automatic===true?'Add a design to the shortlist to prepare its missing models automatically.':'No additional model requests are recorded. Automatic preparation is paused.'}</p></div>`)+(time(registry.updatedAt)?`<p class="fine muted">Registry updated ${time(registry.updatedAt)}</p>`:'');
 }
 if(registry?.error&&typeof registry.retryCandidateId==='string'&&(campaign.candidatePool||[]).some(s=>s.id===registry.retryCandidateId))body+=`<button type="button" class="button primary" data-refold-retry="${esc(registry.retryCandidateId)}">Retry model request</button><p class="fine muted">The server reuses any request already recorded; retrying this registration does not duplicate a submitted job.</p>`;
 return `<section class="refold-registry" aria-label="Additional model request registry">${header}${body}</section>`;
}
