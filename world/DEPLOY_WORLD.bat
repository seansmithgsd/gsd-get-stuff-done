@echo off
REM Deploys the live world server (gsd-world) to Cloudflare. Uses the wrangler login already on this PC.
cd /d %~dp0
call npx --yes wrangler@4 deploy
pause
