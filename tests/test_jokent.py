from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build_jokent as b
from verify_jokent import verify

ROOT=Path(__file__).resolve().parents[1]
class JokentPublicationTests(unittest.TestCase):
 def test_full_package_and_original_workspace_are_verified(self):
  result=verify(ROOT/'docs')
  self.assertEqual(result['candidates'],18)
  self.assertEqual(result['expectedConditions'],432)
  self.assertTrue(result['originalWorkspaceUnchanged'])
 def test_swapped_isoform_metadata_is_rejected(self):
  c=json.loads((ROOT/'docs/jokent/data/local-workspace.json').read_bytes())['campaigns'][0]
  s=next(s for s in c['subjects'] if s['modelCoverage']['models']);m=deepcopy(s['modelCoverage']['models'][0]);m['target']='BRDT' if m['target']!='BRDT' else 'BRD3'
  with self.assertRaisesRegex(ValueError,'frozen ET isoform'):b.verify_model(s,'complex',m,ROOT/'docs/jokent')
 def test_incomplete_native_proof_cannot_be_published(self):
  s=json.loads((ROOT/'docs/jokent/data/local-workspace.json').read_bytes())['campaigns'][0]['subjects'];s=next(s for s in s if s['monomerModels']);m=deepcopy(s['monomerModels'][0]);m['nativeEvidence'].pop('resourceReceipt')
  with self.assertRaisesRegex(ValueError,'proof hashes'):b.verify_model(s,'monomer',m,ROOT/'docs/jokent')
 def test_scientific_assets_reject_external_or_escaping_references(self):
  for url in ['https://example.org/model.cif','./data/assets/%2e%2e/model.cif','./data/assets/model.cif?token=secret','./data/assets/model.html']:
   with self.subTest(url=url),self.assertRaises(ValueError):b.asset_path(url)
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);(root/'model.cif').write_text('placeholder');(root/'link.cif').symlink_to(root/'model.cif')
   with self.assertRaisesRegex(ValueError,'unsafe'):b.checked(root,Path('link.cif'))
 def test_different_model_metric_cannot_attach_to_selected_coordinate(self):
  c=json.loads((ROOT/'docs/jokent/data/local-workspace.json').read_bytes())['campaigns'][0]
  s=next(s for s in c['subjects'] if s['modelCoverage']['models']);m=deepcopy(s['modelCoverage']['models'][0]);m['observations'][0]['modelSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'selected coordinate'):b.verify_model(s,'complex',m,ROOT/'docs/jokent')
 def test_homodimer_scores_must_match_the_exact_ranked_native_model(self):
  c=json.loads((ROOT/'docs/jokent/data/local-workspace.json').read_bytes())['campaigns'][0]
  s=next(s for s in c['subjects'] if s.get('dimerModels'));m=deepcopy(s['dimerModels'][0]);m['nativeConfidence']['modelSha256']='0'*64
  with self.assertRaisesRegex(ValueError,'native confidence'):b.verify_model(s,'homodimer',m,ROOT/'docs/jokent')
if __name__=='__main__':unittest.main()
