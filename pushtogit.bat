@echo off
title Auto Push to GitHub - WebPageAbhinaba
color 0A

echo ============================================
echo   Auto Push to GitHub - abhinaba75/abhinaba.webpage
echo ============================================
echo.

cd /d "%~dp0"

:: Check if git is initialized, if not, set it up
if not exist ".git" (
    echo [*] Initializing Git repository...
    git init
    git remote add origin https://github.com/abhinaba75/email-maker-main.git
    git branch -M main
    echo [+] Git initialized and remote added.
    echo.
)

:: Stage all files
echo [*] Staging all changes...
git add -A
echo [+] All files staged.
echo.

:: Ask for custom commit message
set "USER_MSG="
set /p "USER_MSG=[?] Enter commit message (Leave blank for auto-timestamp): "

:: Handle timestamp generation
for /f "tokens=1-5 delims=/:. " %%a in ("%date% %time%") do (
    set "TIMESTAMP=%%a-%%b-%%c %%d:%%e"
)

:: Assign message based on user input
if not defined USER_MSG (
    set "MSG=Update %TIMESTAMP%"
) else (
    set "MSG=%USER_MSG%"
)

:: Commit
echo.
echo [*] Committing: "%MSG%"
git commit -m "%MSG%"
echo.

:: Push
echo [*] Pushing to GitHub...
git push -u origin main
echo.

echo ============================================
echo   [+] Done! Changes pushed successfully.
echo ============================================
pause