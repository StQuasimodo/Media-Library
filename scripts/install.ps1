# Install My Cinema with a guaranteed-writable temp folder.
#
# NSIS (the installer shell) extracts itself into %TEMP% before it starts doing
# anything useful. On machines where TEMP points at a redirected, missing or
# unwritable folder, the installer aborts with
#   "error writing temporary file, please make sure your temp folder is valid"
# This script pins TEMP/TMP to a folder next to the project for the duration of
# the install, so the installer never depends on the machine-wide setting.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -TargetDir "D:\Apps\My Cinema"
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Silent -TargetDir "D:\Temp\install-check"

param(
  [string]$TargetDir = '',
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$setup = Get-ChildItem (Join-Path $root 'release') -Filter '*Setup.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) {
  Write-Host '[install] 找不到安装包，请先运行 pnpm package' -ForegroundColor Red
  exit 1
}

$tempDir = Join-Path $root '.tmp'
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

# Verify the folder really is writable before blaming the installer.
$probe = Join-Path $tempDir 'probe.tmp'
try {
  Set-Content -LiteralPath $probe -Value 'ok' -ErrorAction Stop
  Remove-Item -LiteralPath $probe -Force
} catch {
  Write-Host "[install] 临时目录不可写：$tempDir" -ForegroundColor Red
  Write-Host '          换一个可写目录后重试，例如 -TempDir D:\Temp' -ForegroundColor Yellow
  exit 1
}

$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:TEMP = $tempDir
$env:TMP = $tempDir

Write-Host "[install] installer : $($setup.FullName)"
Write-Host "[install] TEMP      : $tempDir"

$arguments = @()
if ($Silent) { $arguments += '/S' }
if ($TargetDir) {
  if (-not (Test-Path -LiteralPath $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
  }
  # NSIS requires /D last and unquoted.
  $arguments += "/D=$TargetDir"
}

try {
  $process = Start-Process -FilePath $setup.FullName -ArgumentList $arguments -PassThru
  $process.WaitForExit()
  $code = $process.ExitCode
  Write-Host "[install] exit code : $code"
  if ($code -ne 0) {
    Write-Host '[install] 安装器返回非 0。NSIS 常见的初始化失败码为 2/3：' -ForegroundColor Yellow
    Write-Host '          先用免安装版：解压 release\My-Cinema-*-portable-win64.zip 后运行 “My Cinema.exe”' -ForegroundColor Yellow
    Write-Host '          再运行 pnpm doctor 查看 TEMP 与数据目录状态。' -ForegroundColor Yellow
  } else {
    Write-Host '[install] 安装完成。用户数据保存在 %APPDATA%\My Cinema，卸载不会删除。' -ForegroundColor Green
  }
} finally {
  $env:TEMP = $previousTemp
  $env:TMP = $previousTmp
}

exit $code
