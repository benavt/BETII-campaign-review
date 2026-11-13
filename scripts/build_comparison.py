#!/usr/bin/env python3
"""Build the requested 10 + 10 comparison using public saved evidence only."""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path

from jokent_selectivity import score_calibration

DOCS = Path(__file__).resolve().parents[1] / 'docs'
TARGETS = ['BRD3', 'BRD2', 'BRD4', 'BRDT']
MODIFIED_SHA = 'b83ede742b9e93f06d2ad62e61450a7d2804585aaa16061fafe9d44470cae567'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fasta_records(text):
    records = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('>'):
            records.append([line[1:].split()[0], ''])
        else:
            assert records and set(line) <= set('ACDEFGHIKLMNPQRSTVWY')
            records[-1][1] += line
    assert len(records) == 10 and len({r[0] for r in records}) == 10
    return records


def panel(models, method):
    result = dict(method=method, status='pending', missingTargets=[], Kd_nM={})
    selected = {}
    for target in TARGETS:
        native = [m for m in models if m['kind'] == 'complex' and m['target'] == target and m['foldingEngine'] == 'boltz2-exact']
        assert len(native) == 1
        scores = [o for o in native[0]['observations'] if o['metric'] == 'Kd_nM' and o['method'] == method]
        assert len(scores) <= 1
        if not scores:
            result['missingTargets'].append(target)
            continue
        score = scores[0]
        assert score['unit'] == 'nM' and math.isfinite(score['value']) and score['value'] > 0
        assert score_calibration(score, method), 'Unknown affinity calibration'
        result['Kd_nM'][target] = score['value']
        selected[target] = score
    if result['missingTargets']:
        return result
    if len({score_calibration(o, method) for o in selected.values()}) != 1:
        return dict(result, status='incompatible')
    ratios = {t: result['Kd_nM'][t] / result['Kd_nM']['BRD3'] for t in TARGETS[1:]}
    limiting = min(ratios, key=ratios.get)
    return dict(result, status='complete', ratiosOverBRD3=ratios,
                minimumPredictedSelectivity=ratios[limiting], limitingIsoform=limiting,
                calibrationIdentity=score_calibration(selected['BRD3'], method),
                observationIds={t: o['id'] for t, o in selected.items()})


def subject_record(subject, group, base):
    assert sha(subject['sequence'].encode()) == subject['sequenceSha256']
    models = []
    for kind, source in [('complex', subject['modelCoverage']['models']), ('monomer', subject.get('monomerModels', [])), ('homodimer', subject.get('dimerModels', []))]:
        for model in source:
            if model['constructVariant'] != 'untagged':
                continue
            assert model['status'] == 'verified'
            assert model['constructSequence'] == subject['sequence']
            asset = model['molecularModel']
            coordinate_path = (base / asset['url']).resolve()
            assert coordinate_path.is_relative_to(DOCS.resolve()) and sha(coordinate_path.read_bytes()) == model['modelSha256'] == asset['sha256']
            observations = model.get('observations', [])
            for o in observations:
                assert o['modelId'] == model['id'] and o['modelSha256'] == model['modelSha256']
                assert o['foldingEngine'] == model['foldingEngine'] and o['constructVariant'] == 'untagged'
                if kind == 'complex':
                    assert o['target'] == model['target']
                assert o['source']['sha256'] and math.isfinite(o['value'])
            record = {k: model.get(k) for k in ['id', 'target', 'foldingEngine', 'nativeRank', 'modelSha256', 'scope']}
            record.update(kind=kind, coordinateUrl='../' + str(coordinate_path.relative_to(DOCS.resolve())), observations=observations)
            # Original panel dimers retain source-bound nativeConfidence summaries.
            if kind == 'homodimer' and not observations:
                summary = model['nativeConfidence']
                assert summary['modelSha256'] == model['modelSha256']
                record['nativeConfidence'] = summary
            models.append(record)
    netsolp = subject['netSolP']
    assert netsolp['sequenceSha256'] == subject['sequenceSha256']
    return dict(id=subject['id'], key=group + ':' + subject['id'], label=subject.get('displayName', subject['id']),
                group=group, role='AP2-9 reference' if subject['id'] == 'AP2-9' else 'candidate',
                origin=subject['group'], sequence=subject['sequence'], sequenceSha256=subject['sequenceSha256'],
                netSolP=netsolp, explorerMetrics=subject.get('explorerMetrics', []), models=models,
                panels={method: panel(models, method) for method in ['DeltaForge', 'PCANN']})


def build():
    source_paths = ['data/local-workspace.json', 'jokent/data/local-workspace.json', 'comparison/sequences_for_Adaptyv_modified.fa']
    sources = {p: dict(sha256=sha((DOCS / p).read_bytes())) for p in source_paths}
    modified = (DOCS / source_paths[2]).read_bytes()
    assert sha(modified) == MODIFIED_SHA
    original = json.loads((DOCS / source_paths[0]).read_bytes())['campaigns'][0]['subjects']
    jokent = json.loads((DOCS / source_paths[1]).read_bytes())['campaigns'][0]['subjects']
    assert len(original) == 10 and sum(s['id'] == 'AP2-9' for s in original) == 1
    by_id = {s['id']: s for s in jokent}
    records = [subject_record(s, 'our-panel', DOCS) for s in original]
    for candidate_id, sequence in fasta_records(modified.decode()):
        subject = by_id[candidate_id]
        assert subject['sequence'] == sequence, candidate_id
        records.append(subject_record(subject, 'modified-adaptyv', DOCS / 'jokent'))
    triage = json.loads((DOCS / 'data/triage.json').read_bytes())
    for row, reference in zip(records[:10], triage['ranking'][:9] + [triage['control']], strict=True):
        assert row['id'] == reference['id']
        assert row['panels']['DeltaForge']['Kd_nM'] == reference['Kd_nM']
        assert math.isclose(row['panels']['DeltaForge']['minimumPredictedSelectivity'], reference['minimumSelectivity'])
    for method in ['DeltaForge', 'PCANN']:
        assert len({s['panels'][method]['calibrationIdentity'] for s in records if s['panels'][method]['status'] == 'complete'}) == 1, 'Group comparisons require one compatible scorer calibration'
    return dict(schemaVersion=1, title='Our panel + modified Adaptyv sequences', construct='untagged', sources=sources,
                groups=[dict(id='our-panel', label='Our panel + AP2-9', count=10), dict(id='modified-adaptyv', label='Jokent · modified Adaptyv', count=10)],
                subjects=records, scientificJobs=0, providerCalls=0)


def csv_text(data):
    stream = io.StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerow(['group', 'candidate_id', 'sequence', 'sequence_sha256', 'scorer', 'status', 'BRD3_Kd_nM', 'BRD2_Kd_nM', 'BRD4_Kd_nM', 'BRDT_Kd_nM', 'BRD2_over_BRD3', 'BRD4_over_BRD3', 'BRDT_over_BRD3', 'minimum_predicted_selectivity', 'limiting_isoform', 'NetSolP_solubility', 'NetSolP_usability'])
    for s in data['subjects']:
        for method, p in s['panels'].items():
            writer.writerow([s['group'], s['id'], s['sequence'], s['sequenceSha256'], method, p['status'], *[p['Kd_nM'].get(t, '') for t in TARGETS], *[p.get('ratiosOverBRD3', {}).get(t, '') for t in TARGETS[1:]], p.get('minimumPredictedSelectivity', ''), p.get('limitingIsoform', ''), s['netSolP']['scores']['solubility'], s['netSolP']['scores']['usability']])
    return stream.getvalue()


def write_or_check(check=False):
    data = build()
    outputs = {'data.json': json.dumps(data, indent=2) + '\n', 'affinity-selectivity.csv': csv_text(data),
               'twenty-sequences.fasta': ''.join('>' + s['id'] + ' | ' + s['group'] + '\n' + s['sequence'] + '\n' for s in data['subjects'])}
    for path, text in outputs.items():
        path = DOCS / 'comparison' / path
        if check:
            assert path.read_bytes() == text.encode(), path
        else:
            path.write_bytes(text.encode())
    return dict(valid=True, subjects=len(data['subjects']), groups=[g['count'] for g in data['groups']],
                completePanels={method: sum(s['panels'][method]['status'] == 'complete' for s in data['subjects']) for method in ['DeltaForge', 'PCANN']}, providerCalls=0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    print(json.dumps(write_or_check(parser.parse_args().check)))
