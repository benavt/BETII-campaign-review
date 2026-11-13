"""Predicted BRD3 preference from complete, compatible, model-bound Exact panels."""
import json
import math
import re

TARGETS=['BRD3','BRD2','BRD4','BRDT']
CALIBRATION=['scorer_version','affinity_scorer_version','score_model_sha256','scaler_sha256','calibration_head']
def calibration_identity(value):
 if isinstance(value,dict) and 'score_model_sha256' not in value and 'model_sha256' in value:value=dict(value,score_model_sha256=value['model_sha256'])
 if not isinstance(value,dict) or not all(isinstance(value.get(k),str) and value[k] for k in CALIBRATION):return None
 if not all(re.fullmatch('[0-9a-f]{64}',value[k]) for k in ['score_model_sha256','scaler_sha256']):return None
 return json.dumps({k:value[k] for k in CALIBRATION},sort_keys=True,separators=(',',':'))
def score_calibration(observation,method):
 if method=='DeltaForge':return calibration_identity(observation.get('calibration'))
 if method!='PCANN' or observation.get('provenance',{}).get('temperatureK')!=298:return None
 try:value=json.loads(observation['version']);runtime=dict(value['runtime']);runtime.pop('embeddingCache',None)
 except (KeyError,ValueError,TypeError):return None
 if value.get('recipe')!='affinity-v1' or len(runtime.get('checkpoints',{}))!=25:return None
 return json.dumps(dict(method='PCANN',recipe=value['recipe'],runtime=runtime,temperatureK=298),sort_keys=True,separators=(',',':'))
def predicted_selectivity(subject,method='DeltaForge'):
 result=dict(candidateId=subject['id'],method=method,foldingEngine='boltz2-exact',constructVariant='untagged',status='pending',missingTargets=[],reason='A complete compatible four-isoform Exact panel is required.')
 selected={};scores={}
 for target in TARGETS:
  models=[m for m in subject.get('modelCoverage',{}).get('models',[]) if m.get('target')==target and m.get('foldingEngine')=='boltz2-exact' and m.get('constructVariant')=='untagged']
  if not models:result['missingTargets'].append(target);continue
  if len(models)!=1:return dict(result,status='incompatible',reason='Multiple selected Exact models for one isoform.')
  model=models[0]
  if model.get('status')!='verified' or model.get('nativeCompletion')!='validated' or model.get('resourceVerification')!='verified':result['missingTargets'].append(target);continue
  observations=[o for o in model.get('observations',[]) if o.get('method')==method and o.get('metric')=='Kd_nM']
  if not observations:result['missingTargets'].append(target);continue
  if len(observations)!=1:return dict(result,status='incompatible',reason='Multiple affinity observations for one Exact model and scoring method.')
  score=observations[0];value=score.get('value');source=score.get('source',{})
  if not (type(value) in [int,float] and math.isfinite(value) and value>0 and score.get('unit')=='nM' and score.get('modelId')==model['id'] and score.get('modelSha256')==model['modelSha256'] and all(score.get(k)==model.get(k) for k in ['target','foldingEngine','constructVariant']) and isinstance(source.get('path'),str) and re.fullmatch('[0-9a-f]{64}',source.get('sha256','')) and score_calibration(score,method)):
   return dict(result,status='incompatible',reason='Affinity is not positively valued and bound to the selected native coordinate and calibration.')
  selected[target]=model;scores[target]=score
 if result['missingTargets']:return result
 calibrations={score_calibration(o,method) for o in scores.values()}
 if len(calibrations)!=1:return dict(result,status='incompatible',reason='Four-isoform scorer calibrations differ; predicted selectivity is not calculated.')
 values={target:scores[target]['value'] for target in TARGETS};ratios={target:values[target]/values['BRD3'] for target in TARGETS[1:]}
 if not all(math.isfinite(v) and v>0 for v in ratios.values()):return dict(result,status='incompatible',reason='Predicted affinity ratios exceed finite positive numeric representation.')
 limiting=min(TARGETS[1:],key=lambda target:ratios[target])
 return dict(result,status='complete',reason='Predicted affinity ratios from four exact native models and one compatible '+method+' calibration.',Kd_nM=values,ratiosOverBRD3=ratios,minimumPredictedSelectivity=ratios[limiting],limitingIsoform=limiting,calibrationIdentity=next(iter(calibrations)),modelIds={t:selected[t]['id'] for t in TARGETS},modelSha256s={t:selected[t]['modelSha256'] for t in TARGETS},observationIds={t:scores[t]['id'] for t in TARGETS},responseSha256s={t:scores[t]['source']['sha256'] for t in TARGETS})
