@echo off
cd /d %~dp0

if exist .venv\Scripts\activate.bat (
    call .venv\Scripts\activate.bat
) else if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else (
    echo No encontre el entorno virtual ^(.venv o venv^).
    pause
    exit /b 1
)

pip install -q cryptography
if not exist cert.pem python gen_cert.py

uvicorn main:app --host 0.0.0.0 --port 8443 --ssl-keyfile key.pem --ssl-certfile cert.pem
pause