# Extract and run My Cinema without the NSIS installer.
#
# Use this when the installer cannot start (NSIS needs a writable %TEMP%) or when
# you simply prefer not to install. The portable build shares the same userData
# (%APPDATA%\My Cinema) as the installed build, so collections are identical.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\run-portable.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\run-portable.ps1 -Destination "D:\Apps"

param(
  [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$zip = Get-ChildItem (Join-Path $root 'release') -Filter '*portable*.zip' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) {
  Write-Host '[portable] 找不到免安装包，请先运行 pnpm package' -ForegroundColor Red
  exit 1
}

if (-not $Destination) { $Destination = Join-Path $root 'portable' }
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

$exe = Join-Path $Destination 'My Cinema.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Host "[portable] 解压 $($zip.Name) -> $Destination"
  Expand-Archive -LiteralPath $zip.FullName -DestinationPath $Destination -Force
} else {
  Write-Host "[portable] 已解压：$Destination"
}

if (-not (Test-Path -LiteralPath $exe)) {
  Write-Host '[portable] 解压后找不到 “My Cinema.exe”，压缩包可能不完整' -ForegroundColor Red
  exit 1
}

# Keep Chromium's temp away from a possibly broken machine TEMP.
$tempDir = Join-Path $root '.tmp'
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:TEMP = $tempDir
$env:TMP = $tempDir

Write-Host "[portable] 启动：$exe"
try {
  $process = Start-Process -FilePath $exe -WorkingDirectory $Destination -PassThru
  Write-Host "[portable] 进程已启动（PID $($process.Id)）。关闭窗口即退出应用。"
  $process.WaitForExit()
  Write-Host "[portable] 退出码：$($process.ExitCode)"
  exit $process.ExitCode
} finally {
  $env:TEMP = $previousTemp
  $env:TMP = $previousTmp
}
