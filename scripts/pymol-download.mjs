// A session must match the exact coordinate asset currently selected in the viewer.
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function selectedPymolSession(assets=[]){
 const model=assets[0],session=model?.pymolSession;
 if(!session||!hash(model.sha256)||session.modelSha256!==model.sha256||!hash(session.sha256)||typeof session.url!=='string'||!/^\.\/data\/sessions\/[a-f0-9]{64}\.pse$/.test(session.url))return null;
 return session;
}
export function renderPymolDownload(assets=[]){
 const session=selectedPymolSession(assets);if(!session)return '';
 return `<a class="button subtle" href="${esc(session.url)}" download="${esc(session.filename||'selected-model.pse')}" title="${esc(session.label||'Open the selected structure in PyMOL')}">${assets.length>1?'↓ Selected model PSE':'↓ Download PSE'}</a>`;
}
