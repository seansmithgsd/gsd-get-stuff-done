@echo off
REM One file: pulls the latest world server from GitHub and deploys it to Cloudflare.
REM Uses the wrangler login already on this PC. Run it again any time the world server changes.
set D=%USERPROFILE%\gsd-world
if not exist "%D%" mkdir "%D%"
cd /d "%D%"
set R=https://raw.githubusercontent.com/seansmithgsd/gsd-get-stuff-done/main/world
curl -fsSL -o index.js %R%/index.js || goto fail
curl -fsSL -o shared.js %R%/shared.js || goto fail
curl -fsSL -o wrangler.jsonc %R%/wrangler.jsonc || goto fail
call npx --yes wrangler@4 deploy
pause
exit /b
:fail
echo Download from GitHub failed.
pause
