@echo off
rem Releve les offres Cardmarket des cartes suivies, une fois.
rem
rem Pense a etre lance toutes les 15 minutes par le Planificateur de taches
rem Windows (voir README, section Cardmarket) : le collecteur pilote un
rem navigateur, qui ne peut tourner que sur cette machine a IP residentielle,
rem pas sur le serveur Linux du site.
rem
rem Premier usage / apres un durcissement de Cloudflare : lancer une fois a la
rem main, fenetre visible, pour lever le defi :
rem     python collect\cardmarket.py --visible --resolve

cd /d "%~dp0"

rem Interpreteur Python. Le Planificateur ne charge pas .env.local ; on vise donc
rem d'abord l'installation connue, puis "python" du PATH en secours.
set "PY=C:\Users\wassi\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"

"%PY%" collect\cardmarket.py --quiet
