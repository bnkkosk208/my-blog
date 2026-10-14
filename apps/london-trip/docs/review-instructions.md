# Review 서브에이전트 지침 — 런던 여행 일정관리 웹앱

## 역할
너는 Review 단계 담당이다. Build 단계와 분리된 독립 검증자다. 구현자의 보고를 믿지 말고 직접 확인한다.

## 수정 허용 범위
- 생성: `apps/london-trip/review.md`
- 문제를 발견해 고칠 때만 수정 가능: `apps/london-trip/index.html`, `style.css`, `data.js`, `store.js`, `time.js`, `app.js`

그 외 파일(블로그 `index.html`, `css/`, `js/`, `posts/`, `apps/2048/`, `spec.md`, `docs/`, `.gitignore`, `.claude/`)은 **수정하지 않는다**. git 커밋하지 않는다.

## 검증 기준
- `apps/london-trip/spec.md` 10장 완료 기준 체크리스트 전부. 단 **12.1 사용자 확정**이 우선한다(D1: 숙소 주소는 원문 그대로 표시가 정상 — "Flat 4" grep 항목은 적용하지 않음).
- 원본 대조: `apps/london-trip/docs/source-dump.txt`에서 무작위 10행 이상을 data.js와 글자 단위로 대조.
- 코드 리뷰: 버그, 예외 처리, XSS(innerHTML 사용처), 메모리/타이머 누수, 접근성, 죽은 코드.

## 브라우저 검증 방법
- 내장 브라우저 미리보기 도구로 `.claude/launch.json`의 `blog` 서버(포트 8000)를 사용해 `http://localhost:8000/apps/london-trip/`을 연다(이미 켜져 있을 수 있음).
- 모바일(375×812)과 데스크톱 폭에서 확인. 다크 모드(colorScheme dark)도 확인.
- iframe 동작: 브라우저 콘솔에서 임시 iframe(폭 360, 높이 640)을 about:blank 같은 페이지에 동적으로 만들어 확인하거나, 블로그 메인에서 DOM으로 임시 삽입해 확인(파일 수정 없이).
- 시간 판정은 `TripTime.now`를 고정해 확인(spec 10.2).
- 테스트 후 `london-trip:` localStorage 키는 정리한다. `theme`, `2048-*` 키는 건드리지 않는다.

## build 보고에서 spec과 달라졌다고 한 점 (타당한지 판단할 것)
1. 스크립트 순서 data → time → store → app
2. 진행 중 항목이 있어도 다음 항목에 "다음" 배지
3. schedule에 `addresses` 파생 필드 추가
4. scrollIntoView 대신 window.scrollTo/scrollLeft
5. 여행 전에도 lastDay가 있으면 그 날 우선
6. #day= 해시를 읽기만 함
7. 사용자 일정 종료 시간 선택 입력
8. 테마 읽기 인라인 스크립트를 head에 둠

## review.md 형식
- 요약(통과/수정 후 통과/실패)
- 체크리스트 결과 표(항목 · 결과 · 근거)
- 발견한 문제와 조치(수정했다면 파일·내용)
- 남은 위험/확인 못 한 항목

## 결과 보고
review.md 요약, 수정한 파일 목록, 남은 문제를 한국어로 보고하라.
