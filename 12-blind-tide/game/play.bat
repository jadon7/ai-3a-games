@echo off
cd /d "%~dp0"
if not exist "godot\Godot_v4.7-stable_win64.exe" (
  echo Godot not found in the godot folder.
  pause
  exit /b 1
)
start "" "godot\Godot_v4.7-stable_win64.exe" --path "blind-tide-godot"
