@echo off
rem Double-click to start Harry AI FILM STUDIO, then use it at http://127.0.0.1:4517
rem Keep this window open while you work; close it (or press Ctrl+C) to stop the studio.
title Harry AI FILM STUDIO
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js was not found on PATH. & pause & exit /b 1)
start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://127.0.0.1:4517"
node server\index.js
echo.
echo The studio stopped. If it said EADDRINUSE, it is already running - just open http://127.0.0.1:4517
pause
