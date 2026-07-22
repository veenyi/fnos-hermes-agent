@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "TARGET=%SCRIPT_DIR%..\bin\trim-cli-windows-x64.exe"

if not exist "%TARGET%" (
  echo Missing packaged binary: %TARGET% 1>&2
  exit /b 1
)

"%TARGET%" %*
