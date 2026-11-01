import unittest,sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from verify_dimers import coordinate_sequences
class NativeCoordinateParser(unittest.TestCase):
 def test_actual_native_pdb_and_cif_chain_sequences(self):
  c=json.loads((ROOT/'docs/data/local-workspace.json').read_bytes())['campaigns'][0];models=c['subjects'][0]['modelCoverage']['models'];seen=set()
  for m in models:
   a=m['molecularModel'];key=m['foldingEngine']
   if key in seen:continue
   seen.add(key);self.assertEqual(coordinate_sequences(ROOT/'docs'/a['url'].removeprefix('./')),{a['roles']['binder']:m['constructSequence'],a['roles']['receptor']:m['targetSequence']})
  self.assertEqual(len(seen),4)
if __name__=='__main__':unittest.main()
