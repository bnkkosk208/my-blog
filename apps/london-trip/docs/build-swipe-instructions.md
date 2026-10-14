# Build 서브에이전트 지침 — 런던 여행 앱 v5: 사진 기본 펼침 + 일자 스와이프

## 역할
Build 단계 담당. `apps/london-trip/spec.md` **16장**과 끝의 **"16.x 사용자 확정"**을 구현한다. 1~15장 기존 기능(알림, 자동 이동, 한국 시각, 사진 캡션)을 깨뜨리지 않는다.

## 수정 허용 범위
- `apps/london-trip/app.js`, `style.css`, `index.html`만.
그 외(블로그 루트, `apps/2048/`, `data.js`, `places.js`, `img/`, `store.js`, `time.js`, `alarm.js`, `sw.js`, `spec.md`, `review.md`, `docs/`, `.claude/`)는 수정하지 않는다. git 커밋하지 않는다.

## 자체 검증
- 미리보기(`blog`, 포트 8000), `http://localhost:8000/apps/london-trip/?v=…`, 모바일 375×812.
- 사진: 접힌 카드에 사진·캡션 표시, 레이아웃 밀림 없음(width/height), 사진 토글 끄면 사라짐, 크게 보기 동작.
- 스와이프: 합성 PointerEvent(pointerType 'touch')/TouchEvent로 좌→다음 날, 우→전날, Day 1/8 경계, 세로 이동은 무시, 입력칸·날짜 탭 줄·dialog·가장자리 20px 무시, 두 손가락 무시, 넘긴 뒤 날짜 탭·맨 위 스크롤·3분 보류, 첫 사용 안내 1회.
- 회귀: 65행, 금액, 알림 발사, 자동 이동, 한국 시각, 375/360px 가로 스크롤 없음, 콘솔 에러 0, 외부 요청 0.
- 테스트 후 `london-trip:` 키 정리, `theme`·`2048-*` 유지, 뷰포트 복원.

## 결과 보고
변경 파일·줄 수, spec과 다른 점, 확인 결과, 확인 못 한 항목을 한국어로 간결하게.
