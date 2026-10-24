# My Cinema environment check
#
# Verifies the things that most often break installs or builds on this kind of
# machine: a redirected/unwritable temp folder, a missing Electron binary, and a
# missing pnpm shim for packaging. It only writes one throwaway probe file per
# checked folder and removes it again.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\check-environment.ps1

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$failures = 0

function Write-Check([string]$Label, [bool]$Ok, [string]$Detail) {
  $mark = if ($Ok) { 'OK  ' } else { 'FAIL' }
  if (-not $Ok) { $script:failures++ }
  Write-Host ("[{0}] {1,-22} {2}" -f $mark, $Label, $Detail)
}

function Test-Writable([string]$Path, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    Write-Check $Label $false '路径为空'
    return
  }
  $expanded = [Environment]::ExpandEnvironmentVariables($Path)
  if (-not (Test-Path -LiteralPath $expanded)) {
    Write-Check $Label $false "不存在：$expanded"
    return
  }
  $probe = Join-Path $expanded ("mycinema-probe-{0}.tmp" -f [guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    Set-Content -LiteralPath $probe -Value 'ok' -ErrorAction Stop
    Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
    Write-Check $Label $true "可写：$expanded"
  } catch {
    Write-Check $Label $false "不可写：$expanded（$($_.Exception.Message)）"
  }
}

Write-Host '== My Cinema 环境检查 =='
Write-Host ''

Write-Host '-- 临时目录（安装包与系统组件依赖）--'
Test-Writable $env:TEMP 'TEMP'
Test-Writable $env:TMP 'TMP'
Test-Writable ([System.IO.Path]::GetTempPath()) '系统默认临时目录'

Write-Host ''
Write-Host '-- 应用数据目录 --'
$userData = Join-Path $env:APPDATA 'My Cinema'
if (-not (Test-Path -LiteralPath $userData)) {
  try { New-Item -ItemType Directory -Path $userData -Force | Out-Null }
  catch { Write-Host ("[WARN] {0,-22} {1}" -f 'userData', "无法创建：$($_.Exception.Message)") }
}
if (Test-Path -LiteralPath $userData) {
  Test-Writable $userData 'userData'
} else {
  Write-Check 'userData' $false "不存在且无法创建：$userData"
}
$appTemp = Join-Path $userData 'tmp'
Write-Host ("[INFO] {0,-22} {1}" -f '应用自带临时目录', $appTemp)

Write-Host ''
Write-Host '-- 构建链 --'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
Write-Check 'Electron 二进制' (Test-Path -LiteralPath $electron) $(if (Test-Path -LiteralPath $electron) { $electron } else { '缺失，运行 node scripts/fetch-electron.mjs' })
$pnpmShim = Join-Path $root '.tools\pnpm.cmd'
Write-Check 'pnpm shim' (Test-Path -LiteralPath $pnpmShim) $(if (Test-Path -LiteralPath $pnpmShim) { $pnpmShim } else { '缺失，需要 pnpm install 生成的 .tools\pnpm.cmd' })
$dist = Join-Path $root 'dist\index.html'
Write-Check '构建产物 dist' (Test-Path -LiteralPath $dist) $(if (Test-Path -LiteralPath $dist) { $dist } else { '缺失，运行 pnpm build' })
$setup = Get-ChildItem (Join-Path $root 'release') -Filter '*Setup.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
$portable = Get-ChildItem (Join-Path $root 'release') -Filter '*portable*.zip' -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host ("[INFO] {0,-22} {1}" -f '安装包', $(if ($setup) { "$($setup.Name)（$([math]::Round($setup.Length/1MB,1)) MB）" } else { '未生成' }))
Write-Host ("[INFO] {0,-22} {1}" -f '免安装版', $(if ($portable) { "$($portable.Name)（$([math]::Round($portable.Length/1MB,1)) MB）" } else { '未生成' }))

Write-Host ''
if ($failures -eq 0) {
  Write-Host '结论：环境正常。'
} else {
  Write-Host "结论：$failures 项需要处理，见下方建议。"
  Write-Host ''
  Write-Host '如果 TEMP/TMP 不可写：'
  Write-Host '  1) 新建一个可写目录，例如 D:\Temp'
  Write-Host '  2) 设置当前用户的环境变量（新开的窗口才会生效）：'
  Write-Host '       setx TEMP "D:\Temp"'
  Write-Host '       setx TMP  "D:\Temp"'
  Write-Host '  3) 如果安装包仍然报 “error writing temporary file”，请改用免安装版：'
  Write-Host '       解压 release\My-Cinema-*-portable-win64.zip 后直接运行 “My Cinema.exe”'
  Write-Host ''
  Write-Host '注意：My Cinema 应用本身会把 Chromium 的临时文件放进 userData\tmp，'
  Write-Host '      因此系统 TEMP 有问题时应用仍可运行，仅安装包（NSIS）会受影响。'
}

exit $failures
