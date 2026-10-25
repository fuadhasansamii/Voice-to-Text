@echo off
setlocal
cd /d "%~dp0"
python desktop\launcher.py
if errorlevel 1 (
  echo.
  echo Kotha could not start. Run "python desktop\launcher.py" in a terminal for details.
  pause
)
