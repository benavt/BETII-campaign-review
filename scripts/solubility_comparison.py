"""Sequence-bound saved ProtSATT scores and descriptive predictor comparisons."""
import math


def attach(subjects, release):
    assert release['schemaVersion'] == 1 and release['method'] == 'ProtSATT eSOL'
    assert release['sourceRevision'] == '13f14f18690383a26dfad3d52a53a9d21f289cb8'
    assert release['sourceHashes']['models/eSOL/best_epoch_377_1.pth'] == 'b0073a12395797626c0ebb5251d59ce019af705e7925a805149806434e5aaf24'
    assert release['newPredictions'] == release['providerCalls'] == release['creditsSpent'] == 0
    records = {(r['group'], r['candidateId']): r for r in release['records']}
    assert len(records) == len(release['records']) == len(subjects) == 20
    assert set(records) == {(s['group'], s['id']) for s in subjects}
    for s in subjects:
        r = records[s['group'], s['id']]
        assert r['sequenceSha256'] == s['sequenceSha256']
        assert type(r['value']) in (float, int) and math.isfinite(r['value'])
        s['protSATT'] = dict(method=release['method'], value=r['value'], sequenceSha256=r['sequenceSha256'],
                             source=dict(path='protsatt-scores.json', nativeScoresSha256=release['nativeSources']['scores.csv']['sha256']),
                             runId=release['runId'], checkpointSha256=release['sourceHashes']['models/eSOL/best_epoch_377_1.pth'])


def comparison(subjects, threshold=.5):
    """Ranks use the fixed twenty-sequence population, with average tied ranks."""
    def ranks(values):
        return {key: 1 + sum(v > value for v in values.values()) + (sum(v == value for v in values.values()) - 1) / 2
                for key, value in values.items()}
    net = {s['key']: s['netSolP']['scores']['solubility'] for s in subjects}
    prot = {s['key']: s['protSATT']['value'] for s in subjects}
    nr, pr = ranks(net), ranks(prot)
    rows = []
    for s in subjects:
        key = s['key']; n, p = net[key], prot[key]
        rows.append(dict(group=s['group'], candidate_id=s['id'], sequence_sha256=s['sequenceSha256'],
                         NetSolP_solubility=n, NetSolP_usability=s['netSolP']['scores']['usability'],
                         ProtSATT_eSOL=p, raw_score_difference=p-n, NetSolP_rank=nr[key], ProtSATT_rank=pr[key],
                         rank_shift_toward_ProtSATT=nr[key]-pr[key], reference_threshold=threshold,
                         NetSolP_at_or_above_reference=n>=threshold, ProtSATT_at_or_above_reference=p>=threshold,
                         opposite_sides_of_reference=(n>=threshold)!=(p>=threshold)))
    return dict(referenceThreshold=threshold, rankPopulation=len(subjects),
                oppositeSidesCount=sum(r['opposite_sides_of_reference'] for r in rows),
                definitions=dict(rank='Descending within all 20 sequences; average ranks for ties. Positive rank shift means ProtSATT ranks the sequence higher.',
                                 reference='0.5 is a shared display reference, not a validated common decision boundary.',
                                 scoreDifference='ProtSATT eSOL minus NetSolP-D solubility, in raw score units. Different prediction targets and calibration; the difference is descriptive, not a probability change.',
                                 usability='NetSolP purification usability is retained separately and is not compared to ProtSATT solubility.'),
                rows=rows)
