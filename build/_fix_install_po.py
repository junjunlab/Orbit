from pathlib import Path
from babel.messages.pofile import read_po,write_po
p=Path(__file__).resolve().parents[1]/'docs/locale/zh_CN/LC_MESSAGES/installation.po'
with p.open(encoding='utf-8') as f:c=read_po(f)
c.add('For a second instance, use a different port. To isolate imported data too, prepare a separate compatible data folder and pass it with ``--data``::',string='第二个实例应使用不同端口。如需同时隔离导入数据，请准备独立且结构兼容的数据目录，并通过 ``--data`` 指定：')
c.add('Use *Add or remove programs* on Windows, or move the app to the Bin on macOS. User data may remain in ``%LOCALAPPDATA%/Orbit`` or the application data folder. Back up imported research files before uninstalling. Do not delete an entire user-data folder merely to reset colours or another display preference.',string='Windows 可通过“添加或删除程序”卸载，macOS 可将应用移到废纸篓。用户数据可能仍保存在 ``%LOCALAPPDATA%/Orbit`` 或应用数据目录中。卸载前请备份导入的科研文件，不要仅为了重置颜色等显示偏好而删除整个用户数据目录。')
with p.open('wb') as f:write_po(f,c)
print('installation missing translations fixed')
