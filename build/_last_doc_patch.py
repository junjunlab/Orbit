from pathlib import Path
from babel.messages.pofile import read_po,write_po
r=Path(__file__).resolve().parents[1]/'docs'
p=r/'locale/zh_CN/LC_MESSAGES/assemblies.po'
with p.open(encoding='utf-8') as f:cat=read_po(f)
cat.add('Assembly selector listing human and model-organism reference builds',string='装配选择菜单，列出人类与模式物种的参考版本')
cat.add('Choose the reference build before searching or importing. The bundled annotation list is not a claim that these are the newest available assemblies.',string='搜索或导入前先选择参考装配。内置注释列表并不表示这些是目前可获得的最新装配版本。')
with p.open('wb') as f:write_po(f,cat)
from PIL import Image
p=r/'examples/assembly-menu.png';im=Image.open(p);im.save(p,dpi=(300,300))
print('Assembly figure translated; 300 DPI saved.')
