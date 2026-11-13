// Presentation only: source checks, execution and human review stay distinct.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>String(value??'Not recorded').replaceAll('_',' ');

export function renderCampaignOverview(c,{status={},selected=[]}={}) {
  const verified=c.evidence.filter(e=>e.status==='verified').length;
  const outstanding=c.evidence.filter(e=>e.status!=='verified');
  const next=c.designInputs?['inputs','Inspect inputs']:c.candidatePool?['explorer','Choose candidates']:['subjects','Review candidates'];
  const stages=[['Inputs','Frozen snapshot'],['Execution',pretty(c.run.execution)],['Scientific acceptance',pretty(c.run.acceptance)],['Human review',status.label||'Pending']];
  return `<section class="overview-summary" aria-label="Campaign summary">
    <dl class="overview-counts">
      <div><dt>Candidates</dt><dd>${c.subjects.length}</dd></div>
      <div><dt>Selected</dt><dd>${selected.length}</dd></div>
      <div><dt>Evidence checked</dt><dd>${verified}<span> / ${c.evidence.length}</span></dd></div>
    </dl>
    <button class="button primary" data-tab="${next[0]}">${next[1]} →</button>
  </section>
  <section class="panel overview-priorities">
    <div class="panel-head"><h2>Review</h2><button class="text-button" data-tab="evidence">Evidence →</button></div>
    ${outstanding.length?`<ul class="overview-review-list">${outstanding.map(e=>`<li><button data-tab="evidence">${esc(e.label)}<span aria-hidden="true">→</span></button></li>`).join('')}</ul>`:'<p class="muted">No outstanding evidence checks.</p>'}
    <button class="text-button" data-tab="review">Final review${selected.length?` · ${selected.length} selected`:''} →</button>
  </section>
  <section class="panel overview-record">
    <div class="panel-head"><h2>Snapshot</h2></div>
    <dl class="overview-stages">${stages.map(([name,value])=>`<div><dt>${name}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
    <details><summary>Run details</summary><dl>
      <dt>Objective</dt><dd>${esc(c.objective)}</dd>
      <dt>Recipe</dt><dd>${esc(c.recipe)}</dd>
      <dt>Run</dt><dd class="mono">${esc(c.run.id)}</dd>
      <dt>Workflow revision</dt><dd class="mono">${esc(c.workflowPin)}</dd>
      <dt>Resource telemetry</dt><dd>${esc(pretty(c.run.telemetry))}</dd>
      <dt>Parent runs</dt><dd>${esc(c.run.parentIds?.join(', ')||'No parent recorded')}</dd>
    </dl></details>
  </section>`;
}
