from pathlib import Path
import gzip,json,urllib.request
ROOT=Path(__file__).resolve().parents[1]
src=ROOT/'dist/Orbit/data/loaded/Homo_sapiens.GRCh38.dna.primary_assembly.fa.gz'
out=ROOT/'build/_human_GRCh38_chr7.fa'
if not out.exists():
    active=False
    with gzip.open(src,'rb') as f, out.open('wb') as dst:
        for line in f:
            if line.startswith(b'>'):
                if active: break
                active=line[1:].split()[0]==b'7'
            if active: dst.write(line)
    assert out.stat().st_size>150_000_000
seq=b''.join(out.read_bytes().splitlines()[1:]).decode('ascii').upper()
comp=str.maketrans('ACGTN','TGCAN')
cases=[('EGFR','NM_005228','+',55019277,55205617),('ACTB','NM_001101','-',5527747,5529657)]
verified=[]
for gene,tx,strand,cs,ce in cases:
    for label,s,e in [('start',cs,cs+3),('stop',ce-3,ce)] if strand=='+' else [('start',ce-3,ce),('stop',cs,cs+3)]:
        ref=seq[s:e]; coding=ref if strand=='+' else ref.translate(comp)[::-1]
        assert coding=='ATG' if label=='start' else coding in ('TAA','TAG','TGA'),(gene,label,ref,coding)
        verified.append(dict(gene=gene,tx=tx,strand=strand,kind=label,start=s,end=e,reference=ref,coding=coding,display=f'chr7:{s+1:,}-{e:,}',window=f'chr7:{s-28+1}-{e+28}'))
print(json.dumps(verified,ensure_ascii=False,indent=2))
(ROOT/'build/_codons.json').write_text(json.dumps(verified,indent=2),encoding='utf-8')
print('FASTA:',out,'length',len(seq))
