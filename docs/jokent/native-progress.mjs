// Presentation only: no polling, scheduling or scientific acceptance decisions.
const phases = ['cpu_preparation', 'pilots', 'production', 'collection', 'results_ready', 'needs_attention'];
const labels = { cpu_preparation: 'Preparing model inputs', pilots: 'Checking trial models', production: 'Generating the missing models', collection: 'Collecting model files', results_ready: 'Results await human review', needs_attention: 'This run needs attention' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const humane = value => /\/(?:Users|home|scratch|private|mnt|gpfs)\/|[A-Za-z]:\\/.test(String(value)) ? 'Details retained in the source audit.' : String(value).replace(/\b[0-9a-f]{64}\b/gi, 'source identity retained in audit');

export function renderNativeProgress(campaign) {
  const status = campaign?.nativeRunStatus, plan = campaign?.foldPlan;
  if (!status || status.schemaVersion !== 1 || !plan || plan.scope !== 'all_missing' || !hash(plan.requestManifestSha256) || status.requestManifestSha256 !== plan.requestManifestSha256) return '';
  if (!phases.includes(status.phase) || typeof status.runId !== 'string' || !/^\d{4}-\d{2}-\d{2}_[A-Za-z0-9_.-]+$/.test(status.runId)) return '';
  if (typeof status.observedAt !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(status.observedAt) || !Number.isFinite(Date.parse(status.observedAt))) return '';
  const cells = plan.cells;
  if (!Array.isArray(cells) || !cells.length || !cells.every(cell => cell && typeof cell.id === 'string' && Number.isSafeInteger(cell.sampleCount) && cell.sampleCount > 0) || new Set(cells.map(cell => cell.id)).size !== cells.length) return '';
  const samples = cells.reduce((sum, cell) => sum + cell.sampleCount, 0);
  if (status.modelComparisons !== cells.length || status.nativeSamples !== samples || !Number.isSafeInteger(samples)) return '';
  if (!Array.isArray(status.jobs) || !status.jobs.length || status.jobs.length > 1000 || !status.jobs.every(job => job && typeof job.label === 'string' && job.label.length > 0 && job.label.length <= 300 && ['cpu', 'gpu'].includes(job.device) && ['pending', 'running', 'completed', 'unknown'].includes(job.state) && job.receiptVerified === true && ['string', 'number'].includes(typeof job.jobId) && /^[1-9]\d{0,19}$/.test(String(job.jobId)))) return '';
  if (new Set(status.jobs.map(job => String(job.jobId))).size !== status.jobs.length || status.note !== undefined && (typeof status.note !== 'string' || status.note.length > 4000)) return '';
  const index = status.phase === 'needs_attention' ? -1 : Math.min(phases.indexOf(status.phase), 3);
  const steps = ['Prepare inputs', 'Check trial models', 'Generate models', 'Review results'];
  const counts = Object.fromEntries(['pending', 'running', 'completed', 'unknown'].map(state => [state, status.jobs.filter(job => job.state === state).length]));
  const summary = Object.entries(counts).filter(([, count]) => count).map(([state, count]) => `${count} ${state}`).join(' · ');
  const observed = new Intl.DateTimeFormat(undefined, {dateStyle:'medium', timeStyle:'short'}).format(new Date(status.observedAt));
  return `<section class="panel native-progress" aria-label="Recorded native folding progress"><div class="panel-head"><div><h3>${labels[status.phase]}</h3><p class="fine muted">${status.modelComparisons} model comparisons · ${status.nativeSamples} native samples · full missing grid</p></div><span class="badge ${status.phase === 'needs_attention' ? 'blocked' : 'neutral'}">${status.phase === 'results_ready' ? 'Awaiting review' : 'Recorded progress'}</span></div><ol class="job-progress" aria-label="Native run stages">${steps.map((step, position) => `<li${position === index ? ' aria-current="step"' : ''} class="${position === index ? 'active' : position < index ? 'completed' : 'pending'}">${step}</li>`).join('')}</ol><p class="fine muted">Last checked <time datetime="${esc(status.observedAt)}">${esc(observed)}</time>. ${status.phase === 'results_ready' ? 'Outputs are available for inspection; scientific acceptance requires human review.' : 'This records operational progress; it does not establish scientific acceptance.'}</p>${status.note ? `<p>${esc(humane(status.note))}</p>` : ''}<details><summary>Scheduler jobs · ${esc(summary)}</summary><ul>${status.jobs.map(job => `<li>${esc(humane(job.label))} · ${esc(job.device.toUpperCase())} · job ${esc(job.jobId)} · ${esc(job.state)}</li>`).join('')}</ul></details></section>`;
}
