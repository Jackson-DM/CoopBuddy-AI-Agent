@echo off
title CoopBuddy AI Agent
echo ============================================
echo   CoopBuddy AI Agent — Startup
echo ============================================
echo.

:: ── Check prerequisites ─────────────────────────────────────────────────

where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python not found on PATH.
    echo Install Python 3.11+ and check "Add to PATH" during install.
    pause
    exit /b 1
)

where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found on PATH.
    echo Install Node.js 18+ from https://nodejs.org
    pause
    exit /b 1
)

if not exist ".env" (
    echo [ERROR] .env file not found.
    echo Copy .env.example to .env and fill in your API keys.
    pause
    exit /b 1
)

:: ── Python venv + deps ──────────────────────────────────────────────────

if not exist "venv" (
    echo [Setup] Creating Python virtual environment...
    python -m venv venv
)

echo [Setup] Installing Python dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt --quiet

:: ── Node deps ───────────────────────────────────────────────────────────

if not exist "bot\node_modules" (
    echo [Setup] Installing Node dependencies...
    cd bot
    call npm install
    cd ..
)

:: ── Launch ──────────────────────────────────────────────────────────────

echo.
echo [Launch] Starting Python brain + voice...
start "CoopBuddy Brain" cmd /k "call venv\Scripts\activate.bat && python -m server.main"

echo [Launch] Starting Minecraft bot...
timeout /t 3 /nobreak >nul
start "CoopBuddy Bot" cmd /k "cd bot && node bot.js"

echo.
echo ============================================
echo   Both processes launched!
echo   - Brain: check "CoopBuddy Brain" window
echo   - Bot:   check "CoopBuddy Bot" window
echo   - Hold V to talk
echo ============================================
echo.
pause
