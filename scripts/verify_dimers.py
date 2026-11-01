"""Verify every published homodimer's complete native chains and confidence bindings."""
import hashlib,json,math,re,shlex
from pathlib import Path
AA=dict(zip('ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL'.split(),'ARNDCQEGHILKMFPSTWYV'))
METHODS={'boltz2-exact','af3','opendde-exact','openfold','colabfold'}
def coordinate_sequences(path):
 residues={};headers=[];models=0
 def add(chain,residue,name,xyz,b,atom):
  assert name in AA and all(math.isfinite(float(x)) for x in xyz)
  if atom!='CA':return
  assert math.isfinite(float(b)) and 0<=float(b)<=100
  target=residues.setdefault(chain,{});assert residue not in target,'Duplicate native CA';target[residue]=AA[name]
 raw=path.read_text()
 if path.suffix=='.pdb':
  for line in raw.splitlines():
   if line.startswith('MODEL'):models+=1
   if line.startswith('HETATM'):raise AssertionError('Only declared standard protein chains are allowed')
   if line.startswith('ATOM  '):add(line[21].strip(),line[22:27].strip(),line[17:20].strip(),[line[30:38],line[38:46],line[46:54]],line[60:66],line[12:16].strip())
  assert models<=1
 else:
  for line in raw.splitlines():
   line=line.strip()
   if line.startswith('_atom_site.'):headers.append(line.split()[0].split('.',1)[1])
   elif line.startswith(('ATOM ','HETATM ')):
    fields=shlex.split(line);assert headers and len(fields)==len(headers);d=dict(zip(headers,fields));assert d['group_PDB']=='ATOM'
    add(d.get('auth_asym_id',d['label_asym_id']),d.get('auth_seq_id',d['label_seq_id']),d.get('auth_comp_id',d['label_comp_id']),[d['Cartn_x'],d['Cartn_y'],d['Cartn_z']],d['B_iso_or_equiv'],d['label_atom_id'])
 assert residues
 return {chain:''.join(values.values()) for chain,values in residues.items()}
def verify_dimers(site,workspace,manifest):
 c=workspace['campaigns'][0];count=conditions=0
 for s in c['subjects']:
  variants={v['id']:v for v in s['constructVariants']};groups={}
  for m in s.get('dimerModels',[]):
   assert m['foldingEngine'] in METHODS and m['constructVariant'] in variants and m['copies']==2 and m['status']=='verified'
   v=variants[m['constructVariant']];assert m['constructSequence']==v['sequence'] and m['constructSequenceSha256']==v['sequenceSha256']==hashlib.sha256(v['sequence'].encode()).hexdigest()
   assert type(m['ipTM']) in [int,float] and math.isfinite(m['ipTM']) and 0<=m['ipTM']<=1
   assert type(m['pTM']) in [int,float] and math.isfinite(m['pTM']) and 0<=m['pTM']<=1
   a=m['molecularModel'];assert a['kind']=='binder_homodimer' and a['roles']=={'binder':'A'} and a['binderCopies']==['B'] and not a.get('contextChains') and not a.get('hotspots')
   assert a['sha256']==m['modelSha256'] and re.fullmatch('[0-9a-f]{64}',m['modelSha256']);p=Path(a['url'].removeprefix('./'));assert str(p) in manifest['files'];assert hashlib.sha256((site/p).read_bytes()).hexdigest()==m['modelSha256']
   assert coordinate_sequences(site/p)=={'A':v['sequence'],'B':v['sequence']},'Homodimer native chain sequence mismatch'
   session=a['pymolSession'];assert session['modelSha256']==m['modelSha256'] and session['renderingStyle']=='betii-binder-homodimer-v1' and session['hotspotCount']==0
   assert m['nativeConfidence']['ipTM']==m['ipTM'] and m['nativeConfidence']['pTM']==m['pTM'] and m['nativeConfidence']['modelSha256']==m['modelSha256']
   groups.setdefault((m['constructVariant'],m['foldingEngine']),[]).append(m);count+=1
  for rows in groups.values():
   assert len(rows)==5 and {m['nativeRank'] for m in rows}=={1,2,3,4,5} and len({m['id'] for m in rows})==5;conditions+=1
 if count:assert manifest['verifiedDimerModels']==count and manifest['verifiedDimerConditions']==conditions and count==conditions*5
 return {'dimerModels':count,'dimerConditions':conditions}
