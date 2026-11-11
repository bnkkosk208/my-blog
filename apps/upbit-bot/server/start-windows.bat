@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 업비트 자동매매 봇 로컬 서버 실행 (Windows) - 이 파일을 더블클릭하세요
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 18 이상이 필요합니다. https://nodejs.org 에서 LTS 버전으로 업데이트하세요.
  pause
  exit /b 1
)
node server.js
echo.
echo 서버가 종료되었습니다.
pause
