@echo off
title Project Oasis - Oasis Plan
cd /d "D:\Games\project-oasis"

rem ============================================
rem  Project Oasis - one-click game launcher
rem  Double-click to start the dev server and
rem  open the game in your default browser.
rem  (vite picks a free port automatically and
rem   opens the browser itself via --open)
rem  Close this window to stop the game.
rem ============================================

echo Starting Project Oasis ...
npm run dev -- --open

pause
