# Build 서브에이전트 지침 — 2048 게임

## 역할
승인된 계획서 `apps/2048/spec.md`대로 2048 게임을 구현한다.

## 수정 가능한 범위
- `apps/2048/` 폴더 안에 아래 파일만 새로 만든다.
  - `index.html`, `style.css`, `game.js`, `main.js`
- **수정 금지**: `apps/2048/spec.md`, 블로그 파일 전부(`index.html`, `post.html`, `css/`, `js/`, `posts/`, `README.md`, `CLAUDE.md`), `.agents/`, `.claude/`, `.git`.
- `preview.png`, `review.md`는 만들지 않는다(다른 단계 담당).
- git 커밋·push 하지 않는다.

## 먼저 읽을 것
1. `CLAUDE.md` — 프로젝트 규칙
2. `apps/2048/spec.md` — **이 문서가 기준이다.** 모든 필수 기능(F1~F14)을 구현한다.
3. `css/style.css` — 블로그 색상 톤·글꼴 참고(읽기만, import 금지)

## 구현 기준
- 순수 HTML/CSS/JavaScript(ES 모듈). 외부 라이브러리·CDN 사용하지 않는다.
- `game.js`는 DOM·`window`·`localStorage`를 참조하지 않는 순수 함수만 export한다. spec 4.2의 함수 이름과 시그니처를 따른다.
- 모든 경로는 상대 경로(`./style.css`, `./main.js`). GitHub Pages 하위 경로(`/my-blog/apps/2048/`)에서도 동작해야 한다.
- `localStorage` 접근(최고 점수 `2048-best`, 진행 상태 `2048-state`, 블로그 테마 `theme` 읽기)은 모두 try/catch.
- 사용자 입력이나 저장값을 `innerHTML`에 넣지 않는다(숫자는 `textContent`).
- 코드 스타일: 들여쓰기 2칸, 세미콜론, 작은따옴표, `const`/`let`, camelCase. 주석은 한국어로, 필요한 곳에만 짧게.
- UI 문구는 한국어.
- 모바일: 375px 폭에서 가로 스크롤 없음, 버튼 터치 영역 최소 44px, 보드 위 스와이프 시 페이지 스크롤 없음.

## 스스로 확인할 것 (구현 후)
- Node가 있으면 `node --input-type=module`로 `game.js`를 import해 spec 7.1의 `slideLine` 케이스와 7.2의 게임 오버 케이스, `deserialize` 검증 케이스를 실행해 모두 통과하는지 확인한다. Node가 없으면 이 단계는 건너뛰고 그렇다고 보고한다.
- 문법 오류가 없는지 확인한다.
- 브라우저 확인과 review.md 작성은 **하지 않는다**(Review 단계 담당).

## 보고
작업이 끝나면 다음을 반환한다.
- 만든 파일 목록과 각 파일 줄 수
- spec과 다르게 구현한 부분이 있으면 그 내용과 이유
- 자체 확인 결과(통과/실패 케이스)
- 구현하지 못한 것이나 막힌 점
