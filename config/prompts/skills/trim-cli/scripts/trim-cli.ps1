$Target = Join-Path $PSScriptRoot "..\bin\trim-cli-windows-x64.exe"

if (-not (Test-Path $Target)) {
  Write-Error "Missing packaged binary: $Target"
  exit 1
}

& $Target @args
exit $LASTEXITCODE
