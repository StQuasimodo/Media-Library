# Exercise the actual NSIS UI and retained shortcut preference on a disposable Windows runner.
param([string]$Installer = '')
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This check requires a Windows desktop.' }
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run this installation check only on a clean disposable GitHub runner.' }
$root = (Get-Location).Path
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Installer) { $Installer = Join-Path $root "release/My-Cinema-$version-Setup.exe" }
$Installer = (Resolve-Path $Installer).Path
$output = Join-Path $root ('.harness/nsis-shortcut-' + [Guid]::NewGuid().ToString('N'))
$destination = Join-Path $output 'My Cinema'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'My Cinema.lnk'
$startLink = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs/My Cinema.lnk'
# Never reuse or remove an existing application/shortcut on a non-disposable machine.
if ((Test-Path $desktopLink) -or (Test-Path $startLink)) { throw 'Existing My Cinema shortcuts found; use a clean disposable runner.' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
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
  $control.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
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
  Assert-True (Test-Path (Join-Path $destination 'My Cinema.exe')) 'GUI install did not produce the app.'
  Assert-True (-not (Test-Path $desktopLink)) 'Unchecked GUI option still created a desktop shortcut.'
  Assert-True (Test-Path $startLink) 'Start-menu access should remain available after desktop opt-out.'
  $checks.Add('GUI opt-out creates no desktop link and keeps Start menu')
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
  @{ version=$version; result='failed'; checks=$checks.ToArray(); error=$_.Exception.Message } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $output 'report.json')
  throw
} finally {
  foreach ($id in $script:ownedPids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  $uninstaller = Join-Path $destination 'Uninstall My Cinema.exe'
  if (Test-Path $uninstaller) {
    $cleanup = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru
    if (-not $cleanup.WaitForExit(30000)) { Stop-Process -Id $cleanup.Id -Force -ErrorAction SilentlyContinue }
  }
}
