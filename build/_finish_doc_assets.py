from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,html
ROOT=Path(__file__).resolve().parents[1]; OUT=ROOT/'docs/examples'
data=json.loads((ROOT/'build/_genetic-code.json').read_text())
# Standard 64-codon table, generated from the application's own mapping.
parts=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1160 620" width="1160" height="620">', '<rect width="1160" height="620" fill="#ffffff"/>','<g font-family="Segoe UI,Microsoft YaHei,Arial,sans-serif" fill="#172b3a">','<text x="32" y="42" font-size="25" font-weight="700">Standard DNA genetic code / 标准 DNA 密码表 (#1)</text>','<text x="32" y="73" font-size="15" fill="#526779">Read each codon 5′→3′ · T/C/A/G = third base · M = methionine · * = stop</text>']
for r,a in enumerate('TCAG'):
 for c,b in enumerate('TCAG'):
  x=32+c*282;y=96+r*116
  parts.append(f'<rect x="{x}" y="{y}" width="270" height="104" rx="9" fill="#f5f8fb" stroke="#d7e1ea"/>')
  parts.append(f'<text x="{x+12}" y="{y+23}" font-size="17" font-weight="700">{a+b}N</text>')
  for n,d in enumerate('TCAG'):
   codon=a+b+d;aa=data['aa'][codon];xx=x+12+(n%2)*131;yy=y+51+(n//2)*27
   color='#b74343' if aa=='*' else '#247b43' if codon=='ATG' else '#243b53'
   parts.append(f'<text x="{xx}" y="{yy}" font-size="16" fill="{color}" font-family="Consolas,monospace">{codon} → {aa}</text>')
parts+=['<text x="32" y="585" font-size="15" fill="#526779">Code #2 example / 脊椎动物线粒体表：TGA → W · ATA → M · AGA/AGG → *</text>','</g></svg>']
(OUT/'genetic-code-standard.svg').write_text('\n'.join(parts),encoding='utf-8')
# Add readable directional banners without altering the underlying captures.
font_path='C:/Windows/Fonts/msyh.ttc';f=ImageFont.truetype(font_path,45);small=ImageFont.truetype(font_path,32)
notes={
'genes-collapsed':('EGFR · COLLAPSED / 折叠','Click + beside the label to expand / 点击基因标签旁的 + 展开'),
'genes-expanded':('EGFR · EXPANDED / 已展开','Separate transcript rows; click − to collapse / 每行一个转录本，点 − 收起'),
'panels-two':('2 PANELS / 双基因对照','ACTB (−) | EGFR (+) · independent coordinates and zoom / 各屏独立坐标与缩放'),
'panels-four':('4 PANELS / 四基因对照','ACTB | EGFR | TP53 | MYC · loci are independent / 每屏独立定位'),
'sequence-egfr-start-reference':('EGFR (+) · START / 起始','chr7:55,019,278–55,019,280 · ATG · coding 5′ → 3′ (left to right / 从左向右)'),
'sequence-egfr-stop-reference':('EGFR (+) · STOP / 终止','chr7:55,205,615–55,205,617 · TGA → * · Standard table #1 / 标准表'),
'sequence-actb-start-reference':('ACTB (−) · BEFORE FLIP / 翻转前','chr7:5,529,655–5,529,657 · reference + strand: CAT / 参考正链：CAT'),
'sequence-actb-start-flipped':('ACTB (−) · AFTER FLIP / 翻转后','Displayed GTA → read RIGHT TO LEFT = ATG / 屏幕 GTA，右→左读为 ATG'),
'sequence-actb-stop-reference':('ACTB (−) · STOP BEFORE FLIP / 翻转前','chr7:5,527,748–5,527,750 · reference + strand: CTA / 参考正链：CTA'),
'sequence-actb-stop-flipped':('ACTB (−) · STOP AFTER FLIP / 翻转后','Displayed GAT → read RIGHT TO LEFT = TAG / 屏幕 GAT，右→左读为 TAG'),
 'translation-table-1':('TABLE #1 / 标准核遗传密码表','EGFR TGA → * (stop / 终止) · same bases and position as table #2 example'),
 'translation-table-2':('TABLE #2 / 脊椎动物线粒体表','TGA → W · demonstration only: do NOT use code #2 for nuclear EGFR / 仅作对照'),
}
for name,(title,sub) in notes.items():
 p=OUT/(name+'.png');im=Image.open(p).convert('RGB');dst=Image.new('RGB',(im.width,im.height+155),'#f3f7fb');dst.paste(im,(0,155));d=ImageDraw.Draw(dst);d.text((42,18),title,font=f,fill='#173b56');d.text((44,88),sub,font=small,fill='#35536b');dst.save(p,dpi=(300,300))
for p in OUT.glob('*.png'):
 im=Image.open(p);im.save(p,dpi=(300,300))
# RST heading rules must be at least the title length.
for name in ['navigation','sequence','data-export','faq']:
 p=ROOT/'docs'/f'{name}.rst';lines=p.read_text(encoding='utf-8').splitlines()
 for i,line in enumerate(lines):
  if i and len(line)>2 and len(set(line))==1 and line[0] in '=-~':lines[i]=line[0]*max(len(lines[i-1])+4,len(line))
 p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('Generated code table; annotated',len(notes),'figures; 300-DPI metadata on all PNGs.')
