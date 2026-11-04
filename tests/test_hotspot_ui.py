from pathlib import Path
import sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from hotspot_ui import adapt_hotspots,adapt_molecule
class HotspotAdapter(unittest.TestCase):
 def test_refresh_is_idempotent(self):
  source=Path(__file__).resolve().parents[1]/'docs'
  app=(source/'app.js').read_text();self.assertEqual(adapt_hotspots(app,source),app)
  molecule=(source/'molecule.mjs').read_text();self.assertEqual(adapt_molecule(molecule,molecule),molecule)
