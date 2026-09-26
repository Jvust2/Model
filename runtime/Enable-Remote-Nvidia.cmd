@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0remote_nvidia.ps1"
if errorlevel 1 (
  echo.
  echo Remote NVIDIA Runtime setup failed.
  pause
  exit /b 1
)
echo.
pause
