from pathlib import Path
import sys,tempfile,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import build_review as b
class PublicExportTests(unittest.TestCase):
 def test_assets_are_confined_to_selected_coordinate_confidence_types(self):
  for value in ['https://host/x.cif','//host/x.cif','/data/assets/a.cif','./data/assets/../a.cif','./data/assets/%2e%2e/a.pdb','./data/assets/a.cif?token=x','./data/assets/a.html']:
   with self.subTest(value=value),self.assertRaises(ValueError):b.asset_path(value)
  for ext in ['pdb','cif','json']:self.assertEqual(b.asset_path('./data/assets/a.'+ext),Path('data/assets/a.'+ext))
 def test_selected_sources_cannot_follow_symlinks(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);(root/'source').write_bytes(b'bytes');(root/'link').symlink_to(root/'source')
   with self.assertRaises(ValueError):b.checked(root,Path('link'))
 def test_redacts_embedded_source_paths_without_changing_original(self):
  source={'label':'Source /Users/example/private/model.pdb | original hash','path':'/scratch/example/file.json','sha256':'a'*64,'session_id':'secret','command':['private']};result=b.sanitize(source)
  self.assertNotIn('/Users/',str(result));self.assertNotIn('/scratch/',str(result));self.assertNotIn('session_id',result);self.assertNotIn('command',result);self.assertEqual(result['sha256'],source['sha256']);self.assertTrue(source['path'].startswith('/scratch/'))
if __name__=='__main__':unittest.main()
