@echo off
setlocal
set "ROOT=%~dp0"
set "CARGO=%USERPROFILE%\.cargo\bin"

start "Aura watcher" powershell.exe -NoExit -Command "$host.UI.RawUI.WindowTitle = 'Aura watcher'; Set-Location -LiteralPath '%ROOT:~0,-1%'; python -m bridge.watch"
start "Aura HUD" powershell.exe -NoExit -Command "$host.UI.RawUI.WindowTitle = 'Aura HUD'; $env:PATH = '%CARGO%;' + $env:PATH; Set-Location -LiteralPath '%ROOT%hud'; npm run tauri dev"
