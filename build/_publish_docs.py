"""Publish only documentation over an existing Git tree; leave source and data untouched."""
from pathlib import Path
import importlib.util,base64,hashlib,json
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('push',ROOT/'build/push_github.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
tok=p.token();repo='/repos/junjunlab/Orbit'
def api(method,url,payload=None):
 st,obj=p.api(method,url,payload,tok=tok)
 if st not in (200,201):raise RuntimeError(f'{method} {url}: {st} {obj}')
 return obj
ref=api('GET',repo+'/git/ref/heads/main');base=ref['object']['sha'];commit=api('GET',repo+'/git/commits/'+base)
files=[f for f in p.collect() if f.relative_to(ROOT).as_posix().startswith('docs/')]
assert files and all(not any(x in f.parts for x in ['_build','loaded','genomes']) for f in files)
cache_path=ROOT/'build/.push_cache.json';cache=json.loads(cache_path.read_text()) if cache_path.exists() else {}
entries=[]
for f in files:
 rel=f.relative_to(ROOT).as_posix();raw=f.read_bytes();dig=hashlib.sha1(raw).hexdigest();hit=cache.get(rel)
 if hit and hit[0]==dig:sha=hit[2]
 else:sha=api('POST',repo+'/git/blobs',{'content':base64.b64encode(raw).decode(),'encoding':'base64'})['sha']
 entries.append({'path':rel,'mode':'100644','type':'blob','sha':sha});cache[rel]=[dig,'100644',sha]
 print(rel,len(raw))
tree=api('POST',repo+'/git/trees',{'base_tree':commit['tree']['sha'],'tree':entries})
new=api('POST',repo+'/git/commits',{'message':'docs: illustrated workflows, local FASTA strand/codon guide and genetic-code tables [skip ci]','tree':tree['sha'],'parents':[base]})
api('PATCH',repo+'/git/refs/heads/main',{'sha':new['sha'],'force':False})
cache_path.write_text(json.dumps(cache))
print('PUBLISHED',new['sha'],'documentation files',len(entries),'preserved other repository paths')
