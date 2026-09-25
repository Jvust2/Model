@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_model.ps1" %*
if errorlevel 1 (
  echo.
  echo Model launcher failed. Review the error above.
  pause
)
endlocal
