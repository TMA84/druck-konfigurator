@echo off
rem Startet den Druck-Konfigurator ueber einen lokalen Webserver (nur auf diesem PC erreichbar).
rem Noetig fuer die Live-Abfrage der Filament-Belegung: per Doppelklick auf index.html (file://)
rem blockiert der Browser die Antworten der Drucker. Fenster schliessen = Server beenden.
setlocal
set PORT=8765
cd /d "%~dp0"
where python >nul 2>nul || (echo Python wurde nicht gefunden. Bitte Python installieren: https://www.python.org & pause & exit /b 1)
netstat -ano | findstr /r /c:"127.0.0.1:%PORT%  *0.0.0.0:0" >nul && (echo Konfigurator laeuft bereits. & start "" "http://127.0.0.1:%PORT%/index.html" & exit /b 0)
python -c "import paho.mqtt, cryptography" >nul 2>nul || echo Hinweis: Fuer die Werksfirmware (LAN-Modus) einmal ausfuehren: pip install -r requirements.txt
echo Druck-Konfigurator laeuft unter http://127.0.0.1:%PORT%/  - dieses Fenster offen lassen.
start "" "http://127.0.0.1:%PORT%/index.html"
python "%~dp0tools\serve.py" %PORT%
