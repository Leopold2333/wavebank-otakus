$ErrorActionPreference = "Stop"

$msysBash = "${env:MSYSTEM_ROOT}\usr\bin\bash.exe"
if (-not (Test-Path $msysBash)) {
    $msysBash = "C:\msys64\usr\bin\bash.exe"
}

if (-not (Test-Path $msysBash)) {
    Write-Error "未找到 MSYS2 bash，请先安装 MSYS2：https://www.msys2.org/"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$posixScriptDir = ($scriptDir -replace '\\', '/') -replace '^([A-Za-z]):', '/$1'
& $msysBash -lc "cd '$posixScriptDir' && ./build-ffmpeg.sh"
