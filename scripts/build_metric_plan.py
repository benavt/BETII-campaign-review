#!/usr/bin/env python3
"""Describe gaps in the selected 20-sequence comparison; never execute science."""
import argparse
import csv
import hashlib
import html
import io
import json
from pathlib import Path

DOCS=Path(__file__).resolve().parents[1]/'docs'
FOLDER=DOCS/'comparison'
ENGINES=['boltz2-exact','af3','opendde-exact','openfold']
NAMES={'boltz2-exact':'Boltz2 Exact','af3':'AlphaFold 3','opendde-exact':'OpenDDE Exact','openfold':'OpenFold'}

def present(model,metric,method=None):
    observations=[o for o in model['observations'] if o['metric']==metric and (method is None or o['method']==method)]
    assert len(observations)<=1
    if observations:return True
    key={'ipTM':'ipTM','pTM':'pTM','mean_pLDDT':'meanPLDDT'}.get(metric)
    return key is not None and model.get('nativeConfidence',{}).get(key) is not None

def build():
    raw=(FOLDER/'data.json').read_bytes();data=json.loads(raw);matrix=[];gaps=[];missing_models=[]
    for group in data['groups']:
        subjects=[s for s in data['subjects'] if s['group']==group['id']]
        for kind,metric_names in [('complex',['ipSAE_full','ipSAE_core','ipTM','pTM','mean_pLDDT','native_confidence_score']),('monomer',['pTM','mean_pLDDT']),('homodimer',['ipTM','pTM','mean_pLDDT'])]:
            for engine in ENGINES:
                models=[m for s in subjects for m in s['models'] if m['kind']==kind and m['foldingEngine']==engine]
                expected=10*{'complex':4,'monomer':1,'homodimer':5}[kind]
                for metric in metric_names:
                    available=sum(present(m,metric) for m in models)
                    matrix.append(dict(group=group['id'],kind=kind,engine=engine,metric=metric,available=available,modelsPresent=len(models),expectedModels=expected,missingValues=len(models)-available,missingModels=expected-len(models),classification='scope-specific' if metric=='ipSAE_core' else 'engine-specific optional' if metric=='native_confidence_score' else 'common metric'))
                    for s in subjects:
                        for m in s['models']:
                            if m['kind']==kind and m['foldingEngine']==engine and not present(m,metric):
                                gaps.append(dict(group=group['id'],candidateId=s['id'],kind=kind,engine=engine,target=m['target'],nativeRank=m['nativeRank'],modelId=m['id'],modelSha256=m['modelSha256'],metric=metric))
                if len(models)<expected:
                    for s in subjects:
                        own=[m for m in s['models'] if m['kind']==kind and m['foldingEngine']==engine]
                        if not own:missing_models.append(dict(group=group['id'],candidateId=s['id'],kind=kind,engine=engine,missingNativeModels={'complex':4,'monomer':1,'homodimer':5}[kind]))
        for method in ['DeltaForge','PCANN']:
            for metric in ['Kd_nM','deltaG_kcal_mol']:
                models=[m for s in subjects for m in s['models'] if m['kind']=='complex' and m['foldingEngine']=='boltz2-exact'];available=sum(present(m,metric,method) for m in models)
                matrix.append(dict(group=group['id'],kind='complex',engine='boltz2-exact',metric=method+' '+metric,available=available,modelsPresent=40,expectedModels=40,missingValues=40-available,missingModels=0,classification='Exact affinity'))
        for key in ['solubility','usability']:
            count=sum(s.get('netSolP',{}).get('scores',{}).get(key) is not None for s in subjects)
            matrix.append(dict(group=group['id'],kind='sequence',engine='NetSolP-D',metric=key,available=count,modelsPresent=10,expectedModels=10,missingValues=10-count,missingModels=0,classification='sequence metric'))
        count=sum(s.get('protSATT',{}).get('value') is not None for s in subjects)
        matrix.append(dict(group=group['id'],kind='sequence',engine='ProtSATT eSOL',metric='relative solubility',available=count,modelsPresent=10,expectedModels=10,missingValues=10-count,missingModels=0,classification='sequence metric'))
        pocket=sum(any(o['key']=='mean_residue_min_A' for o in s['explorerMetrics']) for s in subjects)
        matrix.append(dict(group=group['id'],kind='complex',engine='boltz2-exact',metric='BRD3 working pocket distance',available=pocket,modelsPresent=10,expectedModels=10,missingValues=10-pocket,missingModels=0,classification='BRD3 geometry'))
    scalar=[g for g in gaps if g['metric'] in ['ipTM','pTM','mean_pLDDT']]
    ipsae=[g for g in gaps if g['kind']=='complex' and g['metric']=='ipSAE_full']
    pending=[dict(candidateId=s['id'],missingIsoforms=s['panels']['DeltaForge']['missingTargets']) for s in data['subjects'] if s['panels']['DeltaForge']['status']!='complete']
    counts=dict(nativeConfidenceValues=len(scalar),openfoldComplexIpSAE=len(ipsae),jokentPocketAssessments=sum(r['missingValues'] for r in matrix if r['metric']=='BRD3 working pocket distance'),missingDimerConditions=len(missing_models),missingDimerModels=sum(r['missingNativeModels'] for r in missing_models),pendingDeltaForgeKd=sum(len(p['missingIsoforms']) for p in pending))
    return dict(schemaVersion=1,scope='Exactly 20 untagged sequences on the comparison page. Each complex engine has 40 cells per group; each monomer engine has 10; each homodimer engine has 50 native-rank slots.',
        comparisonSha256=hashlib.sha256(raw).hexdigest(),groups=data['groups'],matrix=matrix,gapsOnExistingModels=gaps,
        missingModelConditions=missing_models,pendingDeltaForge=pending,counts=counts,
        completedThisUpdate=data['savedEvidenceRecovery'])


def outputs(data):
    fields=['group','kind','engine','metric','available','modelsPresent','expectedModels','missingValues','missingModels','classification']
    stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fields,lineterminator='\n')
    writer.writeheader();writer.writerows(data['matrix'])
    esc=html.escape
    rows=''.join('<tr>'+''.join('<td>'+esc(str(r[k]))+'</td>' for k in fields)+'</tr>' for r in data['matrix'])
    released=data['completedThisUpdate']
    pending=', '.join(esc(p['candidateId'])+' ('+esc(', '.join(p['missingIsoforms']))+')' for p in data['pendingDeltaForge'])
    page=f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Metric coverage · BETII</title><link rel="stylesheet" href="./style.css"></head>
<body><header><nav><a href="./">← Twenty-sequence comparison</a><a href="./?scorer=PCANN">PCANN selectivity</a></nav>
<h1>Metric coverage</h1>
<p class="intro">The comparison shows a metric only when all 20 sequences have values for the selected model kind, folding method, isoform, dimer rank and scorer. Group and search filters only change which rows are visible.</p>
<div class="downloads"><a href="./metric-gap-audit.json" download>Full coverage audit JSON ↓</a><a href="./metric-gap-matrix.csv" download>Coverage matrix CSV ↓</a><a href="./recovered-evidence.json" download>Recovered metric and model sources ↓</a></div></header>
<main><section class="panel"><h2>Recovered from saved outputs</h2>
<ul><li>{released['nativeConfidenceValues']} native pTM, ipTM and mean pLDDT values, and {released['nativeRankingScores']} native complex ranking scores.</li>
<li>{released['openFoldComplexIpSAE']} OpenFold full-chain ipSAE values covering all four isoforms, and {released['jokentPocketAssessments']} BRD3 Exact working-pocket distances.</li>
<li>{released['nativeDimerModels']} homodimer coordinates from {released['nativeDimerConditions']} archived AF3, Boltz2 Exact, and OpenDDE Exact conditions. Both cohorts have ipTM, pTM and mean Cα pLDDT at all five ranks for these methods.</li></ul>
<p>No new folds or scoring calls. Native confidence and ranking are compared within each folding method.</p></section>
<section class="panel"><h2>What is still missing</h2>
<ul><li><strong>DeltaForge:</strong> off-target Kd and ΔG are missing for {pending}. BRD3 Kd and ΔG cover all 20, while selectivity and its three ratios cover 19/20. The separate PCANN scorer has 20 complete four-isoform panels.</li>
<li><strong>Core ipSAE:</strong> comparable designed-core masks are unavailable across the two cohorts. Existing core values remain in individual model evidence.</li>
<li><strong>ColabFold homodimers:</strong> no comparable structural values are available for this 20-sequence selection.</li></ul>
<p>Incomplete metrics are kept in the saved evidence, so individual values and their sources remain inspectable.</p>
</section><section class="panel"><h2>Coverage by cohort and model type</h2>
<p class="muted">Counts are metric values on existing models. Dimer counts include all five ranks. For the exact coverage of a selected view, open the comparison and expand its metric coverage.</p>
<div class="table-scroll" tabindex="0"><table><thead><tr>{''.join('<th>'+esc(k)+'</th>' for k in fields)}</tr></thead><tbody>{rows}</tbody></table></div></section>
</main></body></html>
'''
    return {'metric-gap-audit.json':json.dumps(data,indent=2)+'\n','metric-gap-matrix.csv':stream.getvalue(),'metrics-plan.html':page}


def write_or_check(check=False):
    data=build()
    for name,text in outputs(data).items():
        file=FOLDER/name
        if check:assert file.read_bytes()==text.encode(),name
        else:file.write_bytes(text.encode())
    return dict(valid=True,counts=data['counts'],PCANNPanels=20,providerCalls=0)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');print(json.dumps(write_or_check(parser.parse_args().check)))
