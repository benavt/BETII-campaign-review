// Coverage describes one selected native model per target/engine/variant cell.
// It does not infer scientific acceptance from the existence of a model.
const STATUSES = new Set(['verified', 'needs_review']);
function assert(ok, message) { if (!ok) throw new Error(message); }
function text(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 1000; }
function dimension(value, name) {
  assert(Array.isArray(value) && value.length > 0 && value.length <= 64, `modelCoverage.${name} requires 1–64 identities.`);
  assert(value.every(text) && new Set(value).size === value.length, `modelCoverage.${name} requires unique nonempty string identities.`);
  return [...value];
}
function cellKey(target, engine, variant) { return JSON.stringify([target, engine, variant]); }

export function coverageSummary(subject) {
  const c = subject?.modelCoverage;
  assert(c && c.schemaVersion === 1, 'Expected modelCoverage.schemaVersion: 1.');
  const targets = dimension(c.expectedTargets, 'expectedTargets');
  const engines = dimension(c.expectedEngines, 'expectedEngines');
  const variants = dimension(c.expectedVariants, 'expectedVariants');
  const expected = targets.length * engines.length * variants.length;
  assert(expected <= 50000, 'modelCoverage exceeds 50,000 expected cells.');
  assert(Array.isArray(c.models) && c.models.length <= expected, 'modelCoverage.models must contain at most one selected model per expected cell.');
  const cells = new Map(), modelIds = new Set();
  for (const model of c.models) {
    assert(model && text(model.id), 'Each coverage model requires an identity.');
    assert(!modelIds.has(model.id), `Duplicate coverage model identity: ${model.id}.`);
    assert(targets.includes(model.target) && engines.includes(model.foldingEngine) && variants.includes(model.constructVariant), `Coverage model ${model.id} refers to an unexpected target, folding engine or construct variant.`);
    assert(STATUSES.has(model.status), `Coverage model ${model.id} requires status verified or needs_review.`);
    assert(model.nativeRank == null || (Number.isInteger(model.nativeRank) && model.nativeRank > 0), `Coverage model ${model.id} requires a positive nativeRank.`);
    assert(model.sampleCount == null || (Number.isInteger(model.sampleCount) && model.sampleCount > 0 && (model.nativeRank == null || model.nativeRank <= model.sampleCount)), `Coverage model ${model.id} requires sampleCount >= nativeRank.`);
    assert(text(model.scope), `Coverage model ${model.id} requires an explicit scope.`);
    const key = cellKey(model.target, model.foldingEngine, model.constructVariant);
    assert(!cells.has(key), `Duplicate selected coverage cell for ${model.target}, ${model.foldingEngine}, ${model.constructVariant}.`);
    modelIds.add(model.id);
    cells.set(key, model);
  }
  const rows = [];
  for (const target of targets) for (const engine of engines) for (const variant of variants) {
    const model = cells.get(cellKey(target, engine, variant));
    rows.push({ target, engine, variant, status: model?.status || 'missing', modelId: model?.id || null, nativeRank: model?.nativeRank ?? null, sampleCount: model?.sampleCount ?? null });
  }
  return { targets, engines, variants, rows, complete: rows.filter(row => row.status === 'verified').length, expected };
}
