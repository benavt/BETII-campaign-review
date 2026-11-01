// Synthetic coverage fixture only. No sequences, real models or scientific scores.
const targets = ['BRD2 ET', 'BRD3 ET', 'BRD4 ET', 'BRDT ET'];
const engines = ['Boltz2 Exact', 'AlphaFold 3', 'OpenDDE Exact'];
const variants = ['designed-core', 'illustrative-tag'];
const scope = 'Synthetic model inventory for interface testing; no scientific model or measurement exists.';
function modelsFor(candidateId, omitLast = false) {
  const models = [];
  for (const target of targets) for (const foldingEngine of engines) for (const constructVariant of variants) {
    if (omitLast && target === targets.at(-1) && foldingEngine === engines.at(-1) && constructVariant === variants.at(-1)) continue;
    models.push({ id: `${candidateId}-MODEL-${String(models.length + 1).padStart(2, '0')}`, target, foldingEngine, constructVariant, status: 'verified', nativeRank: 1, sampleCount: foldingEngine === 'Boltz2 Exact' ? 1 : 5, scope });
  }
  return models;
}
const evidence = (id, label, status = 'verified', subjectIds) => ({ id, label, status, kind: 'synthetic inventory', source: { label: 'Synthetic BETII-compatible fixture; not scientific evidence' }, note: scope, ...(subjectIds ? { subjectIds } : {}) });

export function betiiDemoCampaign() {
  const ids = ['DEMO-BET-A', 'DEMO-BET-B'];
  const subjects = ids.map((id, i) => ({
    id, label: `Synthetic candidate ${i === 0 ? 'A' : 'B'}`, kind: 'candidate', group: i === 0 ? 'Illustrative complete inventory' : 'Illustrative inventory gap', recommended: i === 0,
    designOrigin: i === 0 ? 'RFD3 (illustrative origin)' : 'AP Novo (illustrative origin)',
    constructVariant: { id: 'designed-core', label: 'Designed core; paired with an illustrative tagged variant' },
    constructVariants: [{ id: 'designed-core', label: 'Designed core (synthetic)' }, { id: 'illustrative-tag', label: 'Tagged construct (synthetic; tag sequence intentionally omitted)' }],
    scope, flags: i === 0 ? ['Synthetic inventory does not establish scientific acceptance.'] : ['One required tagged model is missing in this illustrative inventory.'],
    metrics: { verifiedCells: i === 0 ? 24 : 23, expectedCells: 24 },
    summary: i === 0 ? 'Try comparing design origin with folding engine and reviewing both construct variants.' : 'The BRDT ET × OpenDDE Exact × illustrative-tag cell is absent; required evidence blocks its approval.',
    modelCoverage: { schemaVersion: 1, expectedTargets: [...targets], expectedEngines: [...engines], expectedVariants: [...variants], models: modelsFor(id, i === 1) },
  }));
  return {
    id: 'betii-illustrative', name: 'BETII · synthetic coverage review', target: 'BRD ET panel (illustrative)', recipe: 'Candidate × isoform × folding engine × construct variant',
    objective: 'Exercise model coverage and human review without representing real BETII results.',
    demo: true, observedAt: '2026-10-26T16:00:00-04:00', workflowPin: 'synthetic-betii-coverage-v1', accent: 'purple',
    run: { id: '2026-10-26_betii-synthetic_001', parentIds: [], execution: 'completed', telemetry: 'not_applicable', acceptance: 'verified' },
    cohortMetadata: { id: '2026-10-26_synthetic-two-candidate_001', label: 'Two synthetic candidates; illustrative coverage only', version: 1, subjectIds: [...ids], evidenceCutoff: '2026-10-26T16:00:00-04:00', synthetic: true },
    scope, notes: 'All candidate identities, inventories, native ranks and sample counts are synthetic. This example contains no real sequences, structures, predictions or scientific conclusions.',
    subjects,
    requiredEvidence: ['synthetic-identity', 'synthetic-scope', 'coverage-a', 'coverage-b'],
    evidence: [evidence('synthetic-identity', 'Synthetic candidate and construct identity'), evidence('synthetic-scope', 'Synthetic scope and limitations declared'), evidence('coverage-a', 'Candidate A illustrative inventory complete', 'verified', [ids[0]]), evidence('coverage-b', 'Candidate B missing required tagged-model cell', 'missing', [ids[1]])],
    viewRecipe: { alignment: 'No scientific alignment or structures are supplied.', colors: 'Design origin and folding engine are separate concepts.', numbering: 'No molecular sequences or residue numbering are supplied.' },
  };
}
