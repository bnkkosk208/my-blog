# Build 서브에이전트 지침 — 업비트 자동매매 (upbit-bot)

## 역할
승인된 계획서 `apps/upbit-bot/spec.md`대로 앱을 구현한다.

## 사용자 승인 내용
- spec 12장 D1~D10은 **모두 기본안(추천)대로** 승인되었다.
- D11: 업비트 공식 문서는 이 환경에서 접근이 막혀 있다. 11장 항목은 spec 기본값으로 구현하되, 값은 상수/설정으로 분리하고 코드 주석에 "공식 문서 확인 필요"를 짧게 남긴다.

## 수정 가능한 범위
- `apps/upbit-bot/` 아래에 spec 3장 파일 구조의 파일만 새로 만든다.
- **수정 금지**: `apps/upbit-bot/spec.md`, 블로그 파일 전부(`index.html`, `post.html`, `css/`, `js/`, `posts/`, `README.md`, `CLAUDE.md`, 루트 `.gitignore`), 다른 앱, `.agents/`, `.claude/`, `.git`.
- `review.md`, 미리보기 이미지는 만들지 않는다. git 커밋·push 하지 않는다.

## 먼저 읽을 것
1. `CLAUDE.md`
2. `apps/upbit-bot/spec.md` — **기준 문서.** 모든 필수 기능을 구현한다.
3. `css/style.css` — 색상 톤 참고(import 금지)

## 구현 기준
- 브라우저: 순수 HTML/CSS/JS(ES 모듈), 외부 라이브러리·CDN 없음(차트는 canvas).
- `lib/`는 DOM·window·localStorage를 참조하지 않는 순수 모듈(단, `upbit-public.js`·`store.js`는 예외로 브라우저 API 사용 가능하되 Node import 시 즉시 에러 나지 않게).
- 서버: Node 18+, 외부 의존성 0개(내장 `http`, `crypto`, `fs`, 전역 `fetch`). `127.0.0.1`에만 바인딩. `DRY_RUN=true` 기본. API 키는 `.env`에서만 읽고 로그·응답에 절대 출력하지 않는다. `server/.gitignore`에 `.env`.
- 실 키·실제 주문 요청을 만들거나 보내지 않는다. 실제 업비트 서버로 주문 API 호출 테스트를 하지 않는다.
- localStorage 접근은 try/catch. 외부 데이터·사용자 입력을 `innerHTML`에 넣지 않는다.
- 상대 경로만. 들여쓰기 2칸, 세미콜론, 작은따옴표, 한국어 UI·주석(필요한 곳만).
- 모바일 375px 가로 스크롤 없음, 터치 영역 44px, 다크 모드, 상승 빨강·하락 파랑.
- 위험 고지 문구(spec 9장)를 화면에 표시한다.
- 이 환경은 api.upbit.com 접근이 막혀 있을 수 있다. 네트워크 실패 시 앱이 깨지지 말고 상태 표시("시세 연결 실패, 재시도 중")를 해야 한다.

## 스스로 확인할 것
- `node --test apps/upbit-bot/tests/` 로 spec 8장 계산 케이스(지표, 전략, 수수료, 호가, 모의 체결, 백테스트) 전부 통과.
- `node apps/upbit-bot/server/sign-check.js` 로 서명 검증 통과.
- 서버를 `DRY_RUN=true`, 가짜 키로 잠깐 띄워 정적 서빙과 `/api/health`(또는 spec의 상태 엔드포인트)가 응답하는지, 토큰 없는 요청·외부 Origin이 거부되는지 curl로 확인 후 종료.
- 모든 JS 파일 `node --check` 문법 확인.
- 브라우저 확인과 review.md는 하지 않는다(Review 단계 담당).

## 보고
- 만든 파일 목록과 줄 수
- spec과 다르게 구현한 부분과 이유
- 자체 확인 결과(통과/실패)
- 못 한 것·막힌 점
