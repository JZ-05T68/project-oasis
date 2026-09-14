@echo off
title Project Oasis - Oasis Plan
rem ============================================
rem  Project Oasis - one-click game launcher
rem  Double-click to start the dev server and
rem  open the game in your default browser.
rem
rem  - "%~dp0" 让脚本不依赖固定盘符/目录
rem  - Vite 会自动选择一个可用端口（5173 被占用就顺延）
rem  - --open 让 Vite 用**实际选中的**端口打开浏览器，
rem    直接进入 Project Oasis 官方规则页 / 开局界面
rem  Close this window to stop the game.
rem ============================================
cd /d "%~dp0"

echo Starting Project Oasis ...
echo.
echo   (Vite will pick a free port automatically and open your browser)
echo   (Close this window to stop the game)
echo.

call npm run dev -- --open

pause
