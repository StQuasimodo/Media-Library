#!/usr/bin/env node
/**
 * Writes double-clickable launchers next to the build artifacts.
 *
 * The NSIS installer extracts itself into %TEMP% before it shows anything, so a
 * machine whose temp folder is redirected, unwritable for the launching process,
 * or inherited from a restricted host fails with
 *   "error writing temporary file, please make sure your temp folder is valid"
 *
 * Both launchers therefore put their working directory *next to the artifact*
 * (same volume, writable by whoever can open the file), verify it with a probe
 * write, and only then start. Nothing depends on %LOCALAPPDATA% or the machine
 * wide TEMP setting.
 *
 * Called by scripts/package.mjs after packaging; safe to run on its own.
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const release = join(root, 'release');

function find(prefix, suffix) {
  if (!existsSync(release)) return null;
  return readdirSync(release).find((name) => name.startsWith(prefix) && name.endsWith(suffix)) ?? null;
}

const setup = find('My-Cinema-', 'Setup.exe');
const portable = find('My-Cinema-', 'portable-win64.zip');

// cmd.exe reads batch files in the OEM codepage, so keep these bodies ASCII.
// Chinese guidance is printed by PowerShell so it is always readable.
const installBat = `@echo off
setlocal
title My Cinema Setup

rem Work next to the installer: same volume, writable by whoever opened it.
set "MC_TEMP=%~dp0mc-temp"
if not exist "%MC_TEMP%" mkdir "%MC_TEMP%" >nul 2>&1

rem Verify before blaming the installer: an unwritable folder fails the probe.
>"%MC_TEMP%\\probe.txt" echo ok 2>nul
if not exist "%MC_TEMP%\\probe.txt" (
  echo.
  echo [My Cinema] Cannot write to: %MC_TEMP%
  echo             This folder is not writable for the current user.
  echo             Copy the release folder to a writable place and retry.
  echo.
  pause
  exit /b 1
)
del "%MC_TEMP%\\probe.txt" >nul 2>&1

set "TEMP=%MC_TEMP%"
set "TMP=%MC_TEMP%"

echo.
echo   My Cinema installer
echo   temporary folder : %MC_TEMP%
echo.
echo   Keep this window open until the installer finishes.
echo.

rem Call directly: a blocking call keeps this window (and its environment) alive,
rem and surfaces the exit code instead of silently detaching.
"%~dp0${setup ?? 'My-Cinema-Setup.exe'}"

set "MC_CODE=%ERRORLEVEL%"
echo.
if "%MC_CODE%"=="0" (
  echo [My Cinema] Install finished. User data stays in %%APPDATA%%\\My Cinema.
) else (
  echo [My Cinema] Installer exited with code %MC_CODE%.
  echo             If it reported a temporary-file problem, use the portable build:
  echo               RUN-PORTABLE.cmd
)
echo.
pause
exit /b %MC_CODE%
`;

const portableBat = `@echo off
setlocal
title My Cinema (portable)

set "MC_TEMP=%~dp0mc-temp"
if not exist "%MC_TEMP%" mkdir "%MC_TEMP%" >nul 2>&1
set "TEMP=%MC_TEMP%"
set "TMP=%MC_TEMP%"

rem Extract beside the package, not into %LOCALAPPDATA%: the same folder we were
rem opened from is the one we know is writable.
set "MC_DEST=%~dp0portable"
if not exist "%MC_DEST%" mkdir "%MC_DEST%" >nul 2>&1

if not exist "%MC_DEST%\\My Cinema.exe" (
  echo.
  echo   Extracting to: %MC_DEST%
  echo   This takes a few seconds...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~dp0${portable ?? 'My-Cinema-portable-win64.zip'}' -DestinationPath '%MC_DEST%' -Force"
)

if not exist "%MC_DEST%\\My Cinema.exe" (
  echo.
  echo [My Cinema] Extraction failed.
  echo             Unzip the portable package manually and run "My Cinema.exe".
  echo.
  pause
  exit /b 1
)

echo [My Cinema] Starting: %MC_DEST%\\My Cinema.exe
start "" "%MC_DEST%\\My Cinema.exe"
endlocal
`;

if (setup) {
  writeFileSync(join(release, 'INSTALL.cmd'), installBat, 'ascii');
  console.log(`[launchers] INSTALL.cmd -> ${setup}`);
}
if (portable) {
  writeFileSync(join(release, 'RUN-PORTABLE.cmd'), portableBat, 'ascii');
  console.log(`[launchers] RUN-PORTABLE.cmd -> ${portable}`);
}
if (!setup && !portable) console.log('[launchers] no artifacts found; run packaging first');
