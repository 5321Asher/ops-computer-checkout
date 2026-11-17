@echo off
rem Starts Equipment Checkout and opens it in the web browser.
rem Keep this window open while the program is in use; closing it stops the program.
title Equipment Checkout
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is not installed on this computer. Install the LTS version from https://nodejs.org and try again.
    pause
    exit /b 1
)

rem Open the browser after a couple of seconds, once the program has started.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:3000"

node --disable-warning=ExperimentalWarning server.js

rem Only reached if the program stopped by itself, e.g. with an error: keep the message on screen.
pause
