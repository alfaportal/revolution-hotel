@echo off
echo Duke rikompilar better-sqlite3...
npx electron-rebuild -f -w better-sqlite3
echo Duke ndertuar aplikacionin...
npm run build
echo Gati!
pause
