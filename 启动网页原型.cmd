@echo off
cd /d "%~dp0"
start "" "http://localhost:4173"
"C:\Users\35338\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.mjs
