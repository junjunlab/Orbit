from pathlib import Path
import re
from babel.messages.pofile import read_po,write_po
r=Path(__file__).resolve().parents[1]/'docs/locale/zh_CN/LC_MESSAGES'
for n in ['quickstart','interface','sequence','navigation','data-import','data-export','faq']:
 p=r/(n+'.po')
 with p.open(encoding='utf-8') as f:c=read_po(f)
 for m in c:
  if not m.id or not m.string:continue
  # Preserve roles and markups but enforce whitespace boundaries in CJK prose.
  s=m.string
  s=re.sub(r'(?<!\w)(:[\w-]+:`[^`]+`)',r' \1 ',s)
  s=re.sub(r'\*\*([^*]+)\*\*',r' \1 ',s)
  s=s.replace('**\\***','终止符 *')
  if m.id=='With Aa on, find the frame containing that triplet. It shows green **M**.':s='开启 Aa 后，找到包含该三联体的阅读框。该位置显示绿色 M。'
  if m.id.startswith('A green **M** marks ATG;'):s='绿色 M 表示 ATG；红色星号表示在所选密码表中为终止密码子。其它字母为氨基酸单字母符号，DNA 行仍显示 A/C/G/T。'
  if m.id in (':kbd:`+` / :kbd:`=`',':kbd:`-` / :kbd:`_`'):s=m.id
  m.string=s
 with p.open('wb') as f:write_po(f,c)
print('Corrected RST delimiters and restored complete M/stop descriptions.')
