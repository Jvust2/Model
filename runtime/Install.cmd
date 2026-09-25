@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_runtime.ps1" %*
if errorlevel 1 (
  echo.
  echo Model Runtime install failed. Review the error above.
  pause
)
endlocal
