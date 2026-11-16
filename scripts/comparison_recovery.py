"""Bind the saved comparison recovery release to selected models and coordinates."""
from collections import Counter, defaultdict
import hashlib
import math
import re

from verify_dimers import coordinate_sequences

METHODS = {'af3', 'boltz2-exact', 'opendde-exact'}
HASH = re.compile(r'[0-9a-f]{64}').fullmatch
POCKET_SCOPE = ('complex', 'boltz2-exact', 'BRD3')
POCKET_MASK = [27, 31, 33, 34, 37, 41, 42, 43, 48, 49, 50, 53]


def source_ok(source):
    assert HASH(source['sha256']) and (source['path'].startswith('retained-source:') or
           re.fullmatch(r'\.\./(?:jokent/)?data/assets/[0-9a-f]{64}\.cif', source['path']))


def observation_ok(o, model):
    assert (o['modelId'], o['modelSha256']) == (model['id'], model['modelSha256'])
    assert o.get('foldingEngine', model['foldingEngine']) == model['foldingEngine']
    assert o.get('target', model['target']) == model['target']
    assert o.get('constructVariant', 'untagged') == 'untagged'
    assert type(o['value']) in (int, float) and math.isfinite(o['value'])
    source_ok(o['source'])
    for entry in o.get('provenance', {}).values():
        if isinstance(entry, dict) and 'path' in entry:
            source_ok(entry)
    if o['metric'] in ('pTM', 'ipTM', 'ipSAE_full'):
        assert 0 <= o['value'] <= 1
    if o['metric'] == 'mean_pLDDT':
        assert 0 <= o['value'] <= 100


def apply_recovery(docs, records, release):
    assert release['schemaVersion'] == 1 and release['operation'] == 'saved-comparison-metric-recovery'
    validation = release['validation']
    assert validation['newPredictions'] == validation['providerCalls'] == validation['creditsSpent'] == 0
    subjects = {s['key']: s for s in records}
    models = {(s['key'], m['id']): m for s in records for m in s['models']}
    counts = Counter()
    for patch in release['observations']:
        m = models[patch['candidateKey'], patch['modelId']]
        assert m['modelSha256'] == patch['modelSha256']
        metrics = {o['metric'] for o in m['observations']}
        for o in patch['observations']:
            observation_ok(o, m)
            metric = o['metric']
            assert metric not in metrics
            if metric == 'ipSAE_full':
                assert m['foldingEngine'] == 'openfold' and m['kind'] == 'complex'
            elif m['kind'] == 'monomer':
                assert metric == 'mean_pLDDT'
            else:
                assert m['kind'] == 'complex' and m['foldingEngine'] in METHODS
                assert metric in ('pTM', 'ipTM', 'mean_pLDDT', 'native_confidence_score')
            counts[m['kind'], metric] += 1
            metrics.add(metric)
            m['observations'].append(o)

    assert counts == {('complex', 'pTM'):48, ('complex', 'ipTM'):48, ('complex', 'mean_pLDDT'):48,
                      ('complex', 'native_confidence_score'):184, ('monomer', 'mean_pLDDT'):36,
                      ('complex', 'ipSAE_full'):80}
    pocket = set()
    for patch in release['pocketGeometry']:
        s, o = subjects[patch['candidateKey']], patch['metric']
        m = models[s['key'], o['modelId']]
        assert s['group'] == 'modified-adaptyv' and s['key'] not in pocket
        assert (m['kind'], m['foldingEngine'], m['target']) == POCKET_SCOPE
        assert o['key'] == 'mean_residue_min_A' and o['unit'] == 'Å'
        observation_ok({**o, 'metric':'mean_residue_min_A'}, m)
        source = o['source']
        assert (source['path'], source['sha256']) == (m['coordinateUrl'], m['modelSha256'])
        assert source['mask'] == POCKET_MASK and HASH(source['definitionSha256'])
        distances = source['perResidueMinimumDistances_A']
        assert sorted(map(int, distances)) == POCKET_MASK and all(math.isfinite(v) and v >= 0 for v in distances.values())
        assert math.isclose(o['value'], math.fsum(distances.values()) / len(POCKET_MASK), rel_tol=1e-14)
        assert not any(prior['key'] == o['key'] for prior in s['explorerMetrics'])
        s['explorerMetrics'] = [*s['explorerMetrics'], o]
        pocket.add(s['key'])
    assert len(pocket) == 10

    conditions = defaultdict(set)
    for patch in release['dimerModels']:
        s, m = subjects[patch['candidateKey']], patch['model']
        engine, rank, digest = m['foldingEngine'], m['nativeRank'], m['modelSha256']
        assert s['group'] == 'our-panel' and m['kind'] == 'homodimer' and m['target'] is None
        assert engine in METHODS and type(rank) is int and rank in range(1, 6) and HASH(digest)
        assert (s['key'], m['id']) not in models
        assert not any((old['kind'], old['foldingEngine'], old['nativeRank']) == ('homodimer', engine, rank)
                       for old in s['models'])
        assert m['coordinateUrl'] == f'../data/assets/{digest}.cif'
        path = docs / 'data/assets' / f'{digest}.cif'
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
        assert coordinate_sequences(path) == {'A':s['sequence'], 'B':s['sequence']}
        observations = m['observations']
        assert len(observations) == 3 and {o['metric'] for o in observations} == {'pTM','ipTM','mean_pLDDT'}
        summary = m['nativeConfidence']
        assert summary['modelSha256'] == digest and HASH(summary['sourceSha256'])
        for o in observations:
            observation_ok(o, m)
            key = 'meanPLDDT' if o['metric'] == 'mean_pLDDT' else o['metric']
            assert o['value'] == summary[key]
            assert o['source']['sha256'] == (digest if key == 'meanPLDDT' else summary['sourceSha256'])
        models[s['key'], m['id']] = m
        s['models'].append(m)
        conditions[s['key'],engine].add(rank)
    assert len(conditions) == validation['dimerConditions'] == 30
    assert all(ranks == set(range(1, 6)) for ranks in conditions.values())
    assert sum(map(len, conditions.values())) == validation['nativeDimerModels'] == 150
    return dict(nativeConfidenceValues=180, nativeRankingScores=184, openFoldComplexIpSAE=80,
                jokentPocketAssessments=len(pocket), nativeDimerConditions=len(conditions),
                nativeDimerModels=validation['nativeDimerModels'], **{
                    k:validation[k] for k in ('newPredictions','providerCalls','creditsSpent')
                })
