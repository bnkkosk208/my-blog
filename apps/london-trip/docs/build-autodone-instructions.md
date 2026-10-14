# Build 서브에이전트 지침 — 런던 여행 앱 v6: 시간 경과 자동 완료

## 역할
Build 단계 담당. `apps/london-trip/spec.md` **17장**과 끝의 **"17.x 사용자 확정"**(E5 변경: 이 날 초기화 시 done·undone 모두 삭제 → 지난 일정 다시 자동 완료)을 구현한다. 1~16장 기존 기능을 깨뜨리지 않는다.

## 수정 허용 범위
- `apps/london-trip/store.js`, `app.js`, `alarm.js`, `style.css`, `index.html`만.
그 외(블로그 루트 `index.html` 포함, `apps/2048/`, `data.js`, `places.js`, `img/`, `time.js`, `sw.js`, `spec.md`, `review.md`, `docs/`, `.claude/`)는 수정하지 않는다. git 커밋하지 않는다.

## 자체 검증
- 미리보기(`blog`, 포트 8000), `http://localhost:8000/apps/london-trip/?v=…`, 모바일 375×812.
- `TripTime.now` 고정으로 spec 17장 체크리스트 실행: 10/15 0건, 10/16 18:00 r02만, 10/24 65행 전체, 해제 유지, 사용자 일정 시간 변경, 토글 끄기, 이 날 초기화 후 지난 일정 자동 완료 복귀, 전체 초기화, 백업 내보내기/가져오기, 요약·날짜 탭 진행 수.
- 회귀: 65행, 금액, 알림 발사, 자동 이동, 한국 시각, 사진, 스와이프, 375/360px 가로 스크롤 없음, 콘솔 에러 0.
- 테스트 후 `london-trip:` 키 정리, `theme`·`2048-*` 유지, 뷰포트 복원.

## 결과 보고
변경 파일·줄 수, spec과 다른 점, 확인 결과, 확인 못 한 항목을 한국어로 간결하게.
