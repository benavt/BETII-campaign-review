from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from jokent_selectivity import predicted_selectivity

class PredictedSelectivityTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.campaign=json.loads((Path(__file__).resolve().parents[1]/'docs/jokent/data/local-workspace.json').read_bytes())['campaigns'][0]
  cls.subject=next(s for s in cls.campaign['subjects'] if predicted_selectivity(s)['status']=='complete')
 def test_real_saved_predictions_reproduce_all_three_ratios_and_limiting_isoform(self):
  s=self.subject;result=predicted_selectivity(s);values={m['target']:next(o['value'] for o in m['observations'] if o['method']=='DeltaForge' and o['metric']=='Kd_nM') for m in s['modelCoverage']['models'] if m['foldingEngine']=='boltz2-exact'}
  for target in ['BRD2','BRD4','BRDT']:self.assertEqual(result['ratiosOverBRD3'][target],values[target]/values['BRD3'])
  self.assertEqual(result['minimumPredictedSelectivity'],min(result['ratiosOverBRD3'].values()))
  self.assertEqual(result['ratiosOverBRD3'][result['limitingIsoform']],result['minimumPredictedSelectivity'])
 def test_missing_isoform_is_pending_without_partial_ratio(self):
  s=deepcopy(self.subject)
  for m in s['modelCoverage']['models']:
   if m['target']=='BRDT' and m['foldingEngine']=='boltz2-exact':m['observations']=[o for o in m['observations'] if o['method']!='DeltaForge']
  r=predicted_selectivity(s);self.assertEqual(r['status'],'pending');self.assertEqual(r['missingTargets'],['BRDT']);self.assertNotIn('ratiosOverBRD3',r)
 def test_incompatible_calibration_or_wrong_native_model_never_produces_selectivity(self):
  for changed in ['calibration','modelSha256']:
   s=deepcopy(self.subject);m=next(m for m in s['modelCoverage']['models'] if m['target']=='BRD4' and m['foldingEngine']=='boltz2-exact');o=next(o for o in m['observations'] if o['method']=='DeltaForge' and o['metric']=='Kd_nM')
   if changed=='calibration':o['calibration']['scaler_sha256']='0'*64
   else:o['modelSha256']='0'*64
   with self.subTest(changed=changed):r=predicted_selectivity(s);self.assertEqual(r['status'],'incompatible');self.assertNotIn('ratiosOverBRD3',r)
if __name__=='__main__':unittest.main()
