; Orbit — Windows 安装包（Inno Setup 6）
; 构建前先跑：python build/make_exe.py --no-genomes --windowed
; 编译：  ISCC.exe installer\orbit.iss
; 产物：  dist\installer\Orbit-<version>-Windows-x64-Setup.exe

#define MyAppName "Orbit"
#define MyAppVersion "1.0.1"
#define MyAppPublisher "junjunlab"
#define MyAppURL "https://github.com/junjunlab/Orbit"
#define MyAppExeName "Orbit.exe"

[Setup]
AppId={{6C1B9E44-3A62-4F0D-9B7A-2D5E8C41F0B3}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist\installer
OutputBaseFilename=Orbit-{#MyAppVersion}-Windows-x64-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; 每用户安装：不需要管理员权限，且程序可以往自己的 data\loaded 里写导入的轨道
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}
; 安装程序本身的图标（由 build/make_icons.py 生成的 assets/orbit.ico）
SetupIconFile=..\assets\orbit.ico

[Languages]
; 简体中文不是 Inno Setup 自带的语言（安装目录 Languages\ 下只有几十种，没有中文），
; 所以把官方翻译 ChineseSimplified.isl 随仓库放在本文件旁边一起带上。
; 相对路径按「脚本所在目录」解析（Inno 文档 Source Directory），CI 里同样成立。
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\Orbit\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
