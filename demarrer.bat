@echo off
rem Demarre le serveur de developpement PokeBroc et ouvre le navigateur.
rem A double-cliquer depuis l'explorateur Windows.

title PokeBroc - serveur local
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js est introuvable. Installez-le depuis https://nodejs.org
    echo puis relancez ce fichier.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Premiere utilisation : installation des dependances...
    echo.
    call npm install
    echo.
)

rem Le navigateur s'ouvre en differe : le serveur met quelques secondes a repondre.
start "" /min cmd /c "timeout /t 8 /nobreak >nul && start "" http://localhost:3000"

echo Demarrage du serveur... la page s'ouvrira toute seule.
echo Pour arreter : fermez cette fenetre, ou Ctrl+C.
echo.
call npm run dev

echo.
echo Le serveur s'est arrete.
pause
