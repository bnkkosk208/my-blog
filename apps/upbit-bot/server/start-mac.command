#!/bin/bash
# 업비트 자동매매 봇 로컬 서버 실행 (macOS) - Finder에서 더블클릭하세요.
# "실행 권한이 없습니다"가 나오면 터미널에서 한 번만 실행:  chmod +x start-mac.command
# "확인되지 않은 개발자" 경고가 나오면 파일을 우클릭 → 열기를 선택하세요.
cd "$(dirname "$0")" || exit 1

pause_exit() {
  echo
  read -r -n 1 -p "아무 키나 누르면 창을 닫습니다..."
  exit "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않습니다."
  echo "https://nodejs.org 에서 LTS 버전을 설치한 뒤 이 파일을 다시 실행하세요."
  pause_exit 1
fi

if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"; then
  echo "Node.js 18 이상이 필요합니다. https://nodejs.org 에서 LTS 버전으로 업데이트하세요."
  pause_exit 1
fi

node server.js
echo "서버가 종료되었습니다."
pause_exit 0
