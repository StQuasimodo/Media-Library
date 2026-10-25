# Exercise the actual NSIS UI and retained shortcut preference on a disposable Windows runner.
param([string]$Installer = '')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This check requires a Windows desktop.' }
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run this installation check only on a clean disposable GitHub runner.' }
$root = (Get-Location).Path
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Installer) { $Installer = Join-Path $root "release/My-Cinema-$version-Setup.exe" }
$Installer = (Resolve-Path $Installer).Path
if ((Split-Path $Installer -Leaf) -match '^My-Cinema-(.+)-Setup\.exe$') { $version = $Matches[1] }
$output = Join-Path $root ('.harness/nsis-shortcut-' + [Guid]::NewGuid().ToString('N'))
$destination = Join-Path $output 'My Cinema'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'My Cinema.lnk'
$startLink = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs/My Cinema.lnk'
# Never reuse or remove an existing application/shortcut on a non-disposable machine.
if ((Test-Path $desktopLink) -or (Test-Path $startLink)) { throw 'Existing My Cinema shortcuts found; use a clean disposable runner.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CinemaInstallerButtons {
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
$script:ownedPids = [System.Collections.Generic.HashSet[int]]::new()
$checks = [System.Collections.Generic.List[string]]::new()
function Assert-True([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
function Find-Control($window, $property, $value) {
  $condition = [System.Windows.Automation.PropertyCondition]::new($property, $value)
  return $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}
function Get-InstallerWindow {
  $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
  foreach ($window in $windows) {
    if ($window.Current.Name -like '*My Cinema*') {
      [void]$script:ownedPids.Add($window.Current.ProcessId)
      return $window
    }
  }
  return $null
}
function Click-Control($control) {
  Assert-True ($null -ne $control) 'Required installer control not found.'
  Assert-True $control.Current.IsEnabled 'Installer control is disabled.'
  $handle = [IntPtr]$control.Current.NativeWindowHandle
  $parent = [CinemaInstallerButtons]::GetAncestor($handle, 2)
  $id = [CinemaInstallerButtons]::GetDlgCtrlID($handle)
  Assert-True ($id -eq 1) 'Expected the actual Next/Install/Finish button.'
  # The Win32 UIA Invoke proxy can silently lose this notification on an
  # nsDialogs custom page. Send the same BN_CLICKED command to its real dialog.
  Assert-True ([CinemaInstallerButtons]::PostMessage($parent, 0x0111, [IntPtr]$id, $handle)) 'Installer button command was not delivered.'
}
function Get-InstallerDiagnostics {
  $result = [System.Collections.Generic.List[object]]::new()
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($window in $windows) {
    if ($window.Current.Name -notlike '*My Cinema*' -and -not $script:ownedPids.Contains($window.Current.ProcessId)) { continue }
    $controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($control in $controls) {
      if ($items.Count -ge 100) { break }
      $items.Add(@{ name=$control.Current.Name; id=$control.Current.AutomationId; enabled=$control.Current.IsEnabled; type=$control.Current.ControlType.ProgrammaticName })
    }
    $result.Add(@{ name=$window.Current.Name; controls=$items.ToArray() })
  }
  return $result.ToArray()
}
function Run-Silent([string]$flags) {
  $process = Start-Process -FilePath $Installer -ArgumentList "/S $flags /D=$destination" -PassThru
  [void]$script:ownedPids.Add($process.Id)
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250; $process.Refresh() }
  Assert-True $process.HasExited 'Silent installer timed out.'
  Assert-True ($process.ExitCode -eq 0) "Silent installer failed with exit $($process.ExitCode)."
  Assert-True (Test-Path (Join-Path $destination 'My Cinema.exe')) 'Installed executable missing.'
}
try {
  $process = Start-Process -FilePath $Installer -ArgumentList "/D=$destination" -PassThru
  [void]$script:ownedPids.Add($process.Id)
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  $checkbox = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $window = Get-InstallerWindow
    if ($window) {
      $checkbox = Find-Control $window ([System.Windows.Automation.AutomationElement]::NameProperty) '创建桌面快捷方式'
      if ($checkbox) { break }
      $next = Find-Control $window ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) '1'
      if ($next -and $next.Current.IsEnabled) {
        # Refuse to begin installation unless the actual optional-shortcut page has appeared.
        Assert-True ($next.Current.Name -notmatch 'Install|安装') 'Install button appeared before shortcut options page.'
        Click-Control $next
      }
    }
    Start-Sleep -Milliseconds 300
  }
  Assert-True ($null -ne $checkbox) 'Desktop shortcut checkbox was not exposed by the actual installer.'
  $toggle = $checkbox.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  if ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { $toggle.Toggle() }
  Assert-True ($toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::Off) 'Checkbox could not be unchecked.'
  $checks.Add('actual installer checkbox can be unchecked')
  Click-Control (Find-Control (Get-InstallerWindow) ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) '1')
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  $finished = $false
  while ([DateTime]::UtcNow -lt $deadline) {
    $window = Get-InstallerWindow
    if ($window) {
      $finish = Find-Control $window ([System.Windows.Automation.AutomationElement]::AutomationIdProperty) '1'
      if ($finish -and $finish.Current.IsEnabled -and $finish.Current.Name -match 'Next|下一步' -and (Test-Path (Join-Path $destination 'My Cinema.exe'))) {
        Click-Control $finish
        Start-Sleep -Milliseconds 300
        continue
      }
      if ($finish -and $finish.Current.IsEnabled -and $finish.Current.Name -match 'Finish|完成') {
        $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::CheckBox)
        foreach ($box in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)) {
          $pattern = $box.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
          if ($pattern.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On) { $pattern.Toggle() }
        }
        Click-Control $finish; $finished = $true; break
      }
    }
    Start-Sleep -Milliseconds 300
  }
  Assert-True $finished 'Installer did not reach its finish page.'
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200; $process.Refresh() }
  Assert-True ($process.HasExited -and $process.ExitCode -eq 0) 'GUI installer did not exit successfully.'
  Assert-True (Test-Path (Join-Path $destination 'My Cinema.exe')) 'GUI install did not produce the app.'
  Assert-True (-not (Test-Path $desktopLink)) 'Unchecked GUI option still created a desktop shortcut.'
  Assert-True (Test-Path $startLink) 'Start-menu access should remain available after desktop opt-out.'
  $checks.Add('GUI opt-out creates no desktop link and keeps Start menu')
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $portable = Join-Path (Split-Path $Installer) "My-Cinema-$version-portable-win64.zip"
  $zip = [System.IO.Compression.ZipFile]::OpenRead($portable)
  try {
    $entry = $zip.Entries | Where-Object { $_.FullName.Replace('\','/') -eq 'resources/app.asar' } | Select-Object -First 1
    Assert-True ($null -ne $entry) 'Portable app archive missing.'
    $stream = $entry.Open()
    try { $expected = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $destination 'resources/app.asar')).Hash
    Assert-True ($actual -eq $expected) 'Installed application differs from the verified portable archive.'
  } finally { $zip.Dispose() }
  $checks.Add('installed app archive matches verified portable build')
  Run-Silent ''
  Assert-True (-not (Test-Path $desktopLink)) 'Reinstallation forgot the saved opt-out.'
  $checks.Add('reinstallation preserves opt-out')
  Run-Silent '--desktop-shortcut'
  Assert-True (Test-Path $desktopLink) 'Explicit opt-in did not create the shortcut.'
  $shell = New-Object -ComObject WScript.Shell
  Assert-True ($shell.CreateShortcut($desktopLink).TargetPath -eq (Join-Path $destination 'My Cinema.exe')) 'Desktop shortcut targets a different app.'
  $checks.Add('explicit opt-in creates a link to the installed app')
  Run-Silent '--no-desktop-shortcut'
  Assert-True (-not (Test-Path $desktopLink)) 'Opt-out failed to remove the previous managed link.'
  $checks.Add('opt-out removes retained desktop link')
  @{ version=$version; result='passed'; actualInstallerUi=$true; checks=$checks.ToArray() } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $output 'report.json')
  Write-Host '[installer] PASS: GUI checkbox, preference persistence, opt-in and opt-out.'
} catch {
  @{ version=$version; result='failed'; checks=$checks.ToArray(); error=$_.Exception.Message;
    installedExecutable=(Test-Path (Join-Path $destination 'My Cinema.exe')); desktopLink=(Test-Path $desktopLink);
    startLink=(Test-Path $startLink); windows=@(Get-InstallerDiagnostics)
  } | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $output 'report.json')
  throw
} finally {
  foreach ($id in $script:ownedPids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  $uninstaller = Join-Path $destination 'Uninstall My Cinema.exe'
  if (Test-Path $uninstaller) {
    $cleanup = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru
    if (-not $cleanup.WaitForExit(30000)) { Stop-Process -Id $cleanup.Id -Force -ErrorAction SilentlyContinue }
  }
}
