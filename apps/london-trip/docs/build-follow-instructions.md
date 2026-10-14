# Build 서브에이전트 지침 — 런던 여행 앱 v3: 현재 위치 자동 이동

## 역할
Build 단계 담당. `apps/london-trip/spec.md` **14장**(끝의 "14.x 사용자 확정" 포함)을 그대로 구현한다. 1~13장의 기존 기능(알림 포함)을 깨뜨리지 않는다.

## 수정 허용 범위
- `apps/london-trip/app.js`, `style.css`, `index.html`만.
그 외 파일(블로그 루트, `apps/2048/`, `data.js`, `store.js`, `time.js`, `alarm.js`, `sw.js`, `spec.md`, `review.md`, `docs/`, `.claude/`)은 수정하지 않는다. git 커밋하지 않는다.

## 자체 검증
- 내장 브라우저 미리보기(`.claude/launch.json`의 `blog`, 포트 8000), `http://localhost:8000/apps/london-trip/?v=…`.
- `TripTime.now` 고정으로 14장 체크리스트 직접 실행(여행 중/전/후, 진행 항목 변경, 자정 넘김, 3분 보류, "지금으로" 버튼, 입력 중 이동 금지, 다른 탭, 앱 복귀).
- 회귀: 65행, 요약 금액, 알림 발사(r30 15:00:10Z), 콘솔 에러 0, 375px 가로 스크롤 없음, iframe 안에서 바깥 페이지 스크롤 안 됨.
- 테스트 후 `london-trip:` 키 정리, `theme`·`2048-*`는 건드리지 않음, 뷰포트 복원.

## 결과 보고
변경 파일·줄 수, spec과 다른 점, 확인 결과, 확인 못 한 항목을 한국어로 간결하게.
