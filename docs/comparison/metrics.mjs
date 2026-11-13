export const metrics = {
  Kd_nM: {label: 'Predicted Kd (nM)', log: true},
  minimumPredictedSelectivity: {label: 'Minimum BRD3 selectivity (×)', log: true},
  BRD2_ratio: {label: 'BRD2 / BRD3 Kd (×)', log: true},
  BRD4_ratio: {label: 'BRD4 / BRD3 Kd (×)', log: true},
  BRDT_ratio: {label: 'BRDT / BRD3 Kd (×)', log: true},
  ipSAE_full: {label: 'Full-chain ipSAE'}, ipSAE_core: {label: 'Core ipSAE'},
  ipTM: {label: 'Native ipTM'}, pTM: {label: 'Native pTM'},
  mean_pLDDT: {label: 'Mean pLDDT (0–100)'}, native_confidence_score: {label: 'Native confidence score'},
  deltaG_kcal_mol: {label: 'Predicted ΔG (kcal/mol)'},
  solubility: {label: 'NetSolP-D solubility'}, usability: {label: 'NetSolP-D usability'},
  length: {label: 'Sequence length (aa)'}, mean_residue_min_A: {label: 'Working pocket distance (Å)'}
};
export const finite = v => typeof v === 'number' && Number.isFinite(v);
export const format = v => finite(v) ? new Intl.NumberFormat('en-US', {maximumSignificantDigits: 4}).format(v) : '—';
export function selectedModel(s, state) {
  const models = s.models.filter(m => m.kind === state.kind && m.foldingEngine === state.engine &&
    (state.kind !== 'complex' || m.target === state.target) && (state.kind !== 'homodimer' || m.nativeRank === state.rank));
  return models.length === 1 ? models[0] : null;
}
export function rowData(s, state) {
  const model = selectedModel(s, state), values = {length: s.sequence.length, ...s.netSolP.scores};
  for (const key of ['ipSAE_full', 'ipSAE_core', 'ipTM', 'pTM', 'mean_pLDDT', 'native_confidence_score', 'Kd_nM', 'deltaG_kcal_mol']) {
    const observations = (model?.observations || []).filter(o => o.metric === key &&
      (!['Kd_nM', 'deltaG_kcal_mol'].includes(key) || o.method === state.scorer));
    if (observations.length === 1) values[key] = observations[0].value;
  }
  if (model?.nativeConfidence) for (const [key, native] of Object.entries({ipTM: 'ipTM', pTM: 'pTM', mean_pLDDT: 'meanPLDDT'})) {
    if (!finite(values[key]) && finite(model.nativeConfidence[native])) values[key] = model.nativeConfidence[native];
  }
  for (const o of s.explorerMetrics || []) if (o.key === 'mean_residue_min_A' && o.modelId === model?.id && o.modelSha256 === model?.modelSha256) values.mean_residue_min_A = o.value;
  const panel = s.panels[state.scorer];
  const compatible = state.kind === 'complex' && state.engine === 'boltz2-exact';
  if (compatible && panel.status === 'complete') {
    values.minimumPredictedSelectivity = panel.minimumPredictedSelectivity;
    for (const target of ['BRD2', 'BRD4', 'BRDT']) values[target + '_ratio'] = panel.ratiosOverBRD3[target];
  }
  return {subject: s, model, values, panel, compatible, limitingIsoform: compatible && panel.status === 'complete' ? panel.limitingIsoform : null};
}
export function sortRows(rows, key, descending = false) {
  return [...rows].sort((a, b) => {
    if (key === 'label' || key === 'group') return (descending ? -1 : 1) * String(a.subject[key]).localeCompare(String(b.subject[key]));
    const x = a.values[key], y = b.values[key];
    if (!finite(x)) return finite(y) ? 1 : a.subject.key.localeCompare(b.subject.key);
    if (!finite(y)) return -1;
    return (descending ? -1 : 1) * (x - y) || a.subject.key.localeCompare(b.subject.key);
  });
}
export function median(values) {
  const sorted = values.filter(finite).sort((a,b) => a-b), n = sorted.length;
  return n ? (sorted[Math.floor((n-1)/2)] + sorted[Math.floor(n/2)]) / 2 : null;
}
export function plotRows(rows, x, y, logX, logY) {
  return rows.filter(r => finite(r.values[x]) && finite(r.values[y]) && (!logX || r.values[x] > 0) && (!logY || r.values[y] > 0));
}
