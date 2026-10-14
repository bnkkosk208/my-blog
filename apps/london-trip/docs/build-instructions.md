# Build 서브에이전트 지침 — 런던 여행 일정관리 웹앱

## 역할
너는 Build 단계 담당이다. 승인된 계획 `apps/london-trip/spec.md`를 그대로 구현한다.

## 수정 허용 범위 (이 파일들만 생성/수정)
- `apps/london-trip/index.html`
- `apps/london-trip/style.css`
- `apps/london-trip/data.js`
- `apps/london-trip/store.js`
- `apps/london-trip/time.js`
- `apps/london-trip/app.js`

그 외 파일(블로그 `index.html`, `css/`, `js/`, `posts/`, `apps/2048/`, `spec.md`, `docs/`, `.gitignore`, `review.md`)은 **절대 수정하지 않는다**. git 커밋도 하지 않는다.

## 입력
- 계획서: `apps/london-trip/spec.md` — 특히 **12.1 사용자 확정** 절이 다른 절보다 우선한다.
  - D1: 숙소 주소는 원문 그대로 표시(마스킹 없음).
  - D3: 뮤지컬 탭에 "일정표상 관람일 10/20(화)" 주석 박스 표시.
  - D4: S1(원본 항목 숨기기), S2(내보내기/가져오기) 모두 구현.
- 원본 데이터: `apps/london-trip/docs/source-dump.txt` (엑셀 5개 시트 전체). 텍스트는 원문 그대로 옮긴다.

## 구현 요구
- spec 2~7장 전부 구현. 파일 구조는 4장, localStorage 키는 5장, 디자인은 6장을 따른다.
- 순수 HTML/CSS/JS, 외부 라이브러리·CDN·웹폰트 없음, 일반 `<script defer>` (ES module 아님).
- 사용자 입력·원문은 `textContent`로 렌더(innerHTML에 넣지 않음).
- `data.js` 작성 후 spec 3.3(행 수), 3.4(링크), 3.5(비용 합계) 표와 직접 대조해 일치시킬 것.
- 개발 검증: Node가 있으면 `node -e`로 data.js를 로드해 65행·합계를 확인해도 된다(파일을 추가로 만들지 말 것, 스크래치 용도의 임시 스크립트는 OS 임시 폴더에).

## 결과 보고
- 만든 파일 목록과 각 줄 수
- spec과 다르게 구현한 점(있다면 이유)
- 직접 확인한 검증 결과(65행, 일자 요약 금액 등)
