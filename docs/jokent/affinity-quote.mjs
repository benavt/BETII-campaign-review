// Display a server-recorded scientific quote. This module cannot approve or spend.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderAffinityQuote(campaign){
 const q=campaign.affinityQuote;if(!q)return '';
 const source=v=>typeof v?.path==='string'&&/^[a-f0-9]{64}$/.test(v?.sha256||'');
 const timestamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&/(Z|[+-]\d\d:\d\d)$/.test(v);
 const statuses=['awaiting_approval','approved','running','stopped','completed'];
 const approved=q.status!=='awaiting_approval';
 const active=['running','stopped','completed'].includes(q.status),x=q.execution;
 const executionValid=!active||(source(x?.statusSource)&&timestamp(x?.observedAt)
  &&Number.isInteger(x?.attemptedCalls)&&x.attemptedCalls>=0&&x.attemptedCalls<=q.callCount
  &&Number.isInteger(x?.usableResults)&&x.usableResults>=0&&x.usableResults<=x.attemptedCalls
  &&((Number.isInteger(x?.chargedCredits)&&x.chargedCredits>=0&&x.chargedCredits<=q.creditCeiling)
   ||(x?.chargedCredits===null&&x.creditReconciliationPending===true))
  &&(q.status!=='completed'||x.attemptedCalls===q.callCount));
 const valid=q.schemaVersion===1&&statuses.includes(q.status)&&q.operation==='DeltaForge Kd'&&q.projectId==='BETII'
  &&Number.isInteger(q.callCount)&&q.callCount>0&&q.callCount<=10000&&Number.isInteger(q.unitCredits)&&q.unitCredits>0
  &&q.expectedCredits===q.callCount*q.unitCredits&&q.creditCeiling===q.expectedCredits&&q.automaticPaidRetries===false
  &&source(q.source)&&typeof q.id==='string'&&q.runId===q.id&&timestamp(q.observedAt)
  &&(!approved||(source(q.approval?.source)&&timestamp(q.approval?.recordedAt)))&&executionValid;
 if(!valid)return '<section class="panel"><h3>Affinity scoring quote needs attention</h3><p>Refresh the current quote before approving any paid scoring.</p></section>';
 const number=n=>n.toLocaleString('en-US');
 const label={awaiting_approval:'approval needed',approved:'approved · preparing',running:'in progress',stopped:'paused · needs attention',completed:'finished'}[q.status];
 const progress=active?`<p>${number(x.usableResults)} usable results · ${number(x.attemptedCalls)} of ${number(q.callCount)} attempted · ${x.chargedCredits===null?'Credit reconciliation pending':`${number(x.chargedCredits)} credits charged`}.</p><p class="fine muted">Last recorded update <time datetime="${esc(x.observedAt)}">${esc(new Date(x.observedAt).toLocaleString())}</time>. ${q.status==='stopped'?'Further calls are stopped. Review the saved result before authorizing any new batch.':''}</p>`:'';
 const state={awaiting_approval:'This quote has not been submitted.',approved:'Your approval is recorded. Submission waits for the final price and input checks.',running:'The approved batch is running.',stopped:'The batch stopped and preserved its saved results.',completed:'The batch has finished; scientific review remains separate.'}[q.status];
 return `<section class="panel affinity-quote" aria-label="Affinity scoring quote"><div class="panel-head"><h3>Affinity scoring · ${label}</h3><strong>${number(q.expectedCredits)} credits maximum</strong></div><p>${number(q.callCount)} ${active?'approved':'unattempted'} structures × ${number(q.unitCredits)} credits per structure.</p>${progress}<p class="fine muted">DeltaForge predicted Kd. The earlier unusable response stays excluded. No automatic paid retries. ${state}</p><p class="fine muted">Price evidence recorded <time datetime="${esc(q.observedAt)}">${esc(new Date(q.observedAt).toLocaleString())}</time>. Approval ceiling: ${number(q.creditCeiling)} credits.</p><details class="audit-details"><summary>Quote record</summary><pre class="sequence">${esc(JSON.stringify(q,null,2))}</pre></details></section>`;
}
