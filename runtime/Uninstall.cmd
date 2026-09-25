@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall_runtime.ps1" %*
if errorlevel 1 (
  echo.
  echo Model Runtime uninstall failed. Review the error above.
  pause
)
endlocal
