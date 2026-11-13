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
        pocket=sum(any(o['key']=='mean_residue_min_A' for o in s['explorerMetrics']) for s in subjects)
        matrix.append(dict(group=group['id'],kind='complex',engine='boltz2-exact',metric='BRD3 working pocket distance',available=pocket,modelsPresent=10,expectedModels=10,missingValues=10-pocket,missingModels=0,classification='BRD3 geometry'))
    scalar=[g for g in gaps if g['metric'] in ['ipTM','pTM','mean_pLDDT']]
    ipsae=[g for g in gaps if g['kind']=='complex' and g['metric']=='ipSAE_full']
    pending=[dict(candidateId=s['id'],missingIsoforms=s['panels']['DeltaForge']['missingTargets']) for s in data['subjects'] if s['panels']['DeltaForge']['status']!='complete']
    counts=dict(nativeConfidenceValues=len(scalar),openfoldComplexIpSAE=len(ipsae),jokentPocketAssessments=sum(r['missingValues'] for r in matrix if r['metric']=='BRD3 working pocket distance'),missingDimerConditions=len(missing_models),missingDimerModels=sum(r['missingNativeModels'] for r in missing_models),pendingDeltaForgeKd=sum(len(p['missingIsoforms']) for p in pending))
    return dict(schemaVersion=1,scope='Exactly 20 untagged sequences on the comparison page. Each complex engine has 40 cells per group; each monomer engine has 10; each homodimer engine has 50 native-rank slots.',comparisonSha256=hashlib.sha256(raw).hexdigest(),groups=data['groups'],matrix=matrix,gapsOnExistingModels=gaps,missingModelConditions=missing_models,pendingDeltaForge=pending,counts=counts,
        completedThisUpdate=dict(recoveredOurPCANNKds=40,recoveredPCANNDeltaG=80,completePCANNSelectivityPanels=20,newPredictions=0,providerCalls=0,creditsSpent=0),
        stages=[
            dict(order=1,title='Recover native confidence before refolding',status='planned',quantity=len(scalar),unit='metric values',action='Recover pTM, ipTM and mean pLDDT from matching native confidence files. Our complexes: 40 Boltz2 Exact, 4 AF3 and 4 OpenDDE cells lack each of the three metrics (144 values). Monomers: six mean pLDDT gaps in our panel and 30 in Jokent. Verify native model/rank hashes, actual units and averaging basis. Compute Cα means from native coordinates only when their pLDDT encoding is documented.',cost='No external credits expected; bounded local validation/calculation. If a native scalar was never retained, label it not reported and assess an explicit successor fold only after archive recovery is exhausted.'),
            dict(order=2,title='Calculate full-chain OpenFold ipSAE',status='planned',quantity=len(ipsae),unit='complexes',action='Use the exact selected native models and their matched PAE tensors for all 40 models in each group, with one pinned ipSAE recipe and common full-chain directional-minimum definition. Validate PAE sequence/residue order and cutoff settings. If a matched PAE is absent, record that dependency; coordinate-only estimates do not substitute for ipSAE.',cost='No external credits expected for saved-PAE calculation; a missing PAE may require a separately scoped native successor.'),
            dict(order=3,title='Add the same working-pocket assessment to Jokent',status='planned',quantity=counts['jokentPocketAssessments'],unit='BRD3 Exact complexes',action='Reuse the existing documented 12-residue working-pocket mask, verify its mapping onto the canonical BRD3 receptor and calculate the same mean nearest binder heavy-atom distance in Å. Bind each result to its native coordinate hash. A working pocket is a geometric assessment, not an inferred original design-hotspot mask.',cost='Local coordinate calculation; no external credits.'),
            dict(order=4,title='Complete remaining selected DeltaForge comparisons',status='planned, spending not authorized by this plan',quantity=counts['pendingDeltaForgeKd'],unit='Exact Kds',action='miniprotein_879 needs BRD2, BRD4 and BRDT. Reconcile the previous halted approved run using free account/ledger reads and check for saved results before any submission. Retain the existing BRD3 Kd and use only its three selected Exact comparator models. Obtain a current exact quote and explicit batch approval before any paid operation; no automatic retries.',cost='Planning estimate: 75 credits for 3 × the previously verified 25-credit unit charge. This is not a current provider quote or approval.'),
            dict(order=5,title='Recover missing native dimer conditions',status='planned; recover first',quantity=counts['missingDimerConditions'],unit='conditions / '+str(counts['missingDimerModels'])+' native rank slots',action='Our ten sequences have public OpenFold dimers, while Jokent has all four native dimer methods. Locate and validate our 10 × 3 missing Boltz2 Exact, AF3 and OpenDDE conditions, retaining all five native ranks. Publish saved results first. If absent, prepare 30 explicit homodimer conditions (150 native outputs) through the native folding adapters, with a separate resource/cost review.',cost='Saved-result recovery uses no credits. New folds depend on the actual native route and require a scoped plan and any applicable paid quote.'),
            dict(order=6,title='Resolve scope-specific and engine-specific blanks',status='definition / provenance review',action='Retain the eight designed-core ipSAE observations separately; do not copy full-chain ipSAE into core fields. A core metric needs an explicitly documented residue mask. Recover native confidence ranking scores only where each engine reports its exact definition. Mark monomer interface metrics not applicable. Kds from Exact coordinates are never transferred to another folding method. NetSolP-D is already complete for both groups.',cost='No external credits for definitions and source recovery. Extending PCANN to all three additional complex methods would be a separate optional 240-model local batch, outside the Exact-only parity scope.'),
            dict(order=7,title='Validate and publish the completed matrix',status='planned',action='Require complete sequence/construct/isoform/rank identities, native and metric-source hashes, matching scorer calibration, finite values, unit/PAE checks and unchanged human review records. Recalculate selectivity separately for each compatible scorer/method, keep missing values explicit, then refresh the comparison page, source JSON and CSVs.',cost='No scientific/provider requests during publication checks.')],
        cautions=['Computational predictions do not establish experimental affinity, selectivity or inhibition.','A missing metric differs from a missing native model or a metric that is not applicable.','The plan does not start folding, paid scoring or a background monitor.'])

def outputs(data):
    fields=['group','kind','engine','metric','available','modelsPresent','expectedModels','missingValues','missingModels','classification']
    stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fields,lineterminator='\n');writer.writeheader();writer.writerows(data['matrix'])
    esc=html.escape
    cards=''.join('<article class="group-card"><h3>'+str(r['order'])+'. '+esc(r['title'])+'</h3><p class="muted">'+esc(r['status'])+(' · '+str(r['quantity'])+' '+esc(r['unit']) if 'quantity' in r else '')+'</p><p>'+esc(r['action'])+'</p><p class="muted">'+esc(r['cost'])+'</p></article>' for r in data['stages'])
    rows=''.join('<tr>'+''.join('<td>'+esc(str(r[k]))+'</td>' for k in fields)+'</tr>' for r in data['matrix'])
    page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Metric completion plan · BETII</title><link rel="stylesheet" href="./style.css"></head><body><header><nav><a href="./">← Twenty-sequence comparison</a><a href="./pcann-selectivity.csv" download>PCANN selectivity CSV ↓</a></nav><h1>Metric completion plan</h1><p class="intro">Our ten sequences, including AP2-9, and the ten modified Adaptyv sequences. Exact sequence and coordinate identity are retained throughout.</p><p class="notice"><strong>Completed now:</strong> all 80 selected Exact complexes have saved PCANN Kd and ΔG values, giving <strong>20 complete PCANN BRD3 selectivity panels</strong>. Forty Kds for our panel were recovered from validated saved runs. No new predictions or credits were needed.</p><p>Remaining common gaps: 180 native confidence values, 80 OpenFold complex ipSAE values, ten Jokent working-pocket assessments, three DeltaForge Kds, and 30 unpublished dimer conditions in our panel. These are planned tasks, not launched jobs.</p><div class="downloads"><a href="./metric-gap-audit.json" download>Full audit + plan JSON ↓</a><a href="./metric-gap-matrix.csv" download>Coverage matrix CSV ↓</a><a href="./pcann-selectivity.json" download>PCANN panel provenance JSON ↓</a></div></header><main>'''+cards+'''<section class="panel"><h2>Complete current coverage matrix</h2><p class="muted">Counts are metric values on existing models. Missing model slots are listed separately; scope-specific core metrics and engine-specific ranking scores are not interchangeable with the common metrics.</p><div class="table-scroll" tabindex="0"><table><thead><tr>'''+''.join('<th>'+esc(k)+'</th>' for k in fields)+'</tr></thead><tbody>'+rows+'''</tbody></table></div></section><p class="muted">All affinities and selectivities are computational predictions. This plan does not authorize paid requests or establish experimental binding.</p></main></body></html>'''
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
