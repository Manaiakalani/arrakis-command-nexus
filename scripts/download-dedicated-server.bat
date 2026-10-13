@echo off
setlocal EnableExtensions
REM Download the Dune: Awakening dedicated server (AppID 4754530) as Linux
REM artifacts for this repository. Without the platform force, Windows
REM SteamCMD fetches the Hyper-V edition instead of the Docker tarballs.
REM
REM Usage:
REM   scripts\download-dedicated-server.bat
REM   scripts\download-dedicated-server.bat D:\dune-dedicated
REM
REM SteamCMD is taken from STEAMCMD, then the default SteamCMD install, then PATH.
REM Copy the resulting folder to the Linux or WSL2 host yourself.

set "DEST=%~1"
if "%DEST%"=="" set "DEST=%CD%\dedicated-server"

set "STEAMCMD_EXE=%STEAMCMD%"
if not defined STEAMCMD_EXE if exist "%ProgramFiles(x86)%\Steam\steamcmd\steamcmd.exe" (
  set "STEAMCMD_EXE=%ProgramFiles(x86)%\Steam\steamcmd\steamcmd.exe"
)
if not defined STEAMCMD_EXE set "STEAMCMD_EXE=steamcmd"

if not exist "%DEST%" mkdir "%DEST%"
if errorlevel 1 (
  echo Could not create "%DEST%".
  exit /b 1
)

echo Downloading AppID 4754530 for linux into "%DEST%"
"%STEAMCMD_EXE%" +@sSteamCmdForcePlatformType linux +force_install_dir "%DEST%" +login anonymous +app_update 4754530 validate +quit
exit /b %ERRORLEVEL%
