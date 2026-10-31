from pathlib import Path
import re
from babel.messages.pofile import read_po,write_po
ROOT=Path(__file__).resolve().parents[1]
changes={
'how-it-works':[
('The backend is a single-threaded HTTP server from the standard library. It\nserves three things:', 'The backend uses the standard library ThreadingHTTPServer, bound to localhost\nby default. It serves the frontend and JSON APIs; the frontend composes exports.', '后端采用标准库 ThreadingHTTPServer，默认绑定本机地址。它提供前端页面与 JSON API；导出由前端合成。'),
('   * - ``/export/...``\n     - Rendered exports','   * - Frontend export\n     - ``composePlot`` / ``composeVector`` generate the downloadable files',None),
],
'assemblies':[
('     - Current\n     - Previous','     - Bundled newer build\n     - Bundled older build',None),
('     - UCSC refGene\n   * - Frog','     - UCSC ncbiRefSeq / sgdGene\n   * - Frog',None),
('* First visit to a chromosome: about one second\n* Subsequent moves within it: about 0.3 seconds\n* Nothing is written to disk; the range cache is in memory and per session','* Response time depends on the network and reference index.\n* The range cache is in memory and per session, not a persistent offline genome.\n* Local 2bit takes priority over the remote source.',None),
('Set ``ORBIT_OFFLINE=1`` before launching to forbid network access. Combined\nwith a local FASTA or 2bit, this gives a fully air-gapped browser::','Set ``ORBIT_OFFLINE=1`` before launching to disable remote 2bit fallback.\nA local matching 2bit supplies built-in reference operations offline. Imported\nFASTA remains an independent sequence track; see :doc:`sequence`::','启动前设置 ``ORBIT_OFFLINE=1`` 可禁用远程 2bit 回退。匹配的本地 2bit 支持内置参考序列操作离线工作。导入 FASTA 仍是独立序列轨道；详见 :doc:`sequence` 。'),
],
'installation':[
('Example — two instances, separate state, different ports::\n\n   set ORBIT_HOME=%TEMP%\\orbit-b\n   Orbit.exe --port 8766\n\n``ORBIT_HOME`` moves the settings and cache directory, so instances do not\nshare preferences.','For a second instance, use a different port. To isolate imported data too,\nprepare a separate compatible data folder and pass it with ``--data``::\n\n   Orbit.exe --port 8766 --data C:/Orbit-test/data\n\nChanging the port alone does not isolate data. Do not rely on an unsupported\n``ORBIT_HOME`` setting to separate research files.',None),
('User data in ``%LOCALAPPDATA%\\Orbit`` is left in place; delete it manually if\nyou want a clean slate.','User data may remain in ``%LOCALAPPDATA%/Orbit`` or the application data folder.\nBack up imported research files before uninstalling. Do not delete an entire\nuser-data folder merely to reset colours or another display preference.',None),
]
}
translated={
'Frontend export':'前端导出',
'``composePlot`` / ``composeVector`` generate the downloadable files':'``composePlot`` / ``composeVector`` 生成可下载的导出文件',
'Bundled newer build':'内置较新版本',
'Bundled older build':'内置较旧版本',
'UCSC ncbiRefSeq / sgdGene':'UCSC ncbiRefSeq / sgdGene',
'Response time depends on the network and reference index.':'响应时间取决于网络状况和参考索引。',
'The range cache is in memory and per session, not a persistent offline genome.':'区间缓存位于内存中，仅在本次会话有效，不是持久保存的离线基因组。',
'Local 2bit takes priority over the remote source.':'本地 2bit 优先于远程序列源。',
'For a second instance, use a different port. To isolate imported data too, prepare a separate compatible data folder and pass it with ``--data``:':'第二个实例应使用不同端口。如需同时隔离导入数据，请准备独立且结构兼容的数据目录，并通过 ``--data`` 指定：',
'Changing the port alone does not isolate data. Do not rely on an unsupported ``ORBIT_HOME`` setting to separate research files.':'只更换端口不会隔离数据。不要依赖未支持的 ``ORBIT_HOME`` 设置来隔离科研文件。',
'User data may remain in ``%LOCALAPPDATA%/Orbit`` or the application data folder. Back up imported research files before uninstalling. Do not delete an entire user-data folder merely to reset colours or another display preference.':'用户数据可能仍保存在 ``%LOCALAPPDATA%/Orbit`` 或应用数据目录中。卸载前请备份导入的科研文件，不要仅为了重置颜色等显示偏好而删除整个用户数据目录。',
}
for name,items in changes.items():
 p=ROOT/'docs'/f'{name}.rst';text=p.read_text(encoding='utf-8')
 po=ROOT/'docs/locale/zh_CN/LC_MESSAGES'/f'{name}.po'
 with po.open(encoding='utf-8') as f:cat=read_po(f)
 for old,new,tr in items:
  assert old in text,(name,old[:50]);text=text.replace(old,new)
  if tr:translated[' '.join(new.split())]=tr
 p.write_text(text,encoding='utf-8')
 for en,zh in translated.items():cat.add(en,string=zh)
 with po.open('wb') as f:write_po(f,cat)
print('Patched technical/assembly/installation inaccuracies with matching translations.')
