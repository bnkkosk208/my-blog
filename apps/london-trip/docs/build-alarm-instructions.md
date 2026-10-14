# Build 서브에이전트 지침 — 런던 여행 앱 v2: 알림 기능

## 역할
Build 단계 담당. `apps/london-trip/spec.md` **13장**(특히 13.10 사용자 확정)을 그대로 구현한다. 1~12장의 기존 기능은 깨뜨리지 않는다.

## 수정 허용 범위 (이 파일들만)
- 수정: `apps/london-trip/index.html`, `style.css`, `app.js`, `store.js`, `time.js`
- 생성: `apps/london-trip/alarm.js`, `apps/london-trip/sw.js`
- `data.js`는 수정하지 않는다(필요한 파생값은 런타임 계산).

그 외 파일(블로그 루트 `index.html`, `css/`, `js/`, `posts/`, `apps/2048/`, `spec.md`, `review.md`, `docs/`, `.gitignore`, `.claude/`)은 **절대 수정하지 않는다**. git 커밋하지 않는다.

## 요구
- 13장의 UI·저장 키·스케줄링·.ics·엣지 케이스를 모두 구현.
- 확정값: 기본 30분 전, 선택지 5·10·15·30·60·90·120분, 처음엔 모두 꺼짐, 소리 끔·진동 켬, r02는 한국 시각 기준 지원·r66 제외, .ics는 알림 켠 항목 + 내 일정 포함·메모 제외, 완료 항목은 알림 건너뜀.
- sw.js: 알림 표시(`showNotification`)와 알림 클릭 시 앱 창 포커스/열기만. fetch 가로채기·캐시·push 없음. 스코프는 `apps/london-trip/`.
- 순수 HTML/CSS/JS, 외부 라이브러리 없음, 사용자 입력은 textContent로 렌더.
- 블로그 메인 iframe 안에서는 권한 요청/SW 등록을 시도하지 말고 토스트로 대체(새 창 열기 안내).

## 자체 검증
- 내장 브라우저 미리보기(`.claude/launch.json`의 `blog`, 포트 8000)로 `http://localhost:8000/apps/london-trip/` 확인.
- spec 13.9 체크리스트 중 가능한 것 직접 실행(`TripTime.now` 고정). 기존 10장 핵심(65행, 요약 금액, 콘솔 에러 0) 회귀 확인.
- 테스트 후 `london-trip:` 키 정리. `theme`, `2048-*` 키는 건드리지 않는다.

## 결과 보고
변경/생성 파일과 줄 수, spec과 다르게 구현한 점, 직접 확인한 결과, 확인 못 한 항목을 한국어로.
