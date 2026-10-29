@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PYTHONPATH=%~dp0src"
set "PYTHON=%USERPROFILE%\.workbuddy-ai\binaries\python\envs\igv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"
set "ORBIT_HOME=%~dp0build\_orbit_home"

echo.
echo   Orbit  -  native window  (Qt / QtWebEngine)
echo   ------------------------------------------------------------
echo   The server runs in the background; closing the window stops it.
echo.
"%PYTHON%" -m igvlocal --port 8799 --debug
if errorlevel 1 (
  echo.
  echo   Window failed to start - falling back to the system browser.
  "%PYTHON%" -m igvlocal --port 8799 --browser
)
pause
