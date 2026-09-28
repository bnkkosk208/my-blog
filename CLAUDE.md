# CLAUDE.md

이 파일은 이 저장소에서 작업할 때 Claude Code가 따라야 할 지침입니다.

## 프로젝트 개요

마크다운(`.md`) 파일로 작성한 글을 읽어 블로그 웹사이트로 보여주는 정적 사이트입니다.
**프레임워크와 빌드 도구 없이** 순수 HTML, CSS, JavaScript(ES 모듈)만으로 구현합니다.

## 기술 원칙

- **프레임워크·라이브러리 금지**: React, Vue, Tailwind, jQuery, 번들러(Webpack/Vite 등)를 쓰지 않습니다. 마크다운 파서도 직접 구현합니다.
- **빌드 단계 없음**: 저장소의 파일을 그대로 정적 서버에 올리면 동작해야 합니다.
- **모던 브라우저 기준**: ES2020+, `fetch`, ES 모듈(`<script type="module">`), CSS 변수, `prefers-color-scheme`를 사용합니다.
- `package.json`이나 `node_modules`를 추가하지 않습니다.

## 디렉터리 구조

```
my-blog/
├── index.html          # 글 목록 페이지
├── post.html           # 글 상세 페이지 (post.html?slug=파일이름)
├── css/
│   └── style.css       # 테마 변수, 레이아웃, 본문 타이포그래피
├── js/
│   ├── markdown.js     # 마크다운 → HTML 파서 (직접 구현)
│   ├── frontmatter.js  # 글 상단 메타데이터 파싱
│   ├── posts.js        # 글 목록/본문 불러오기
│   ├── theme.js        # 다크 모드 토글
│   ├── list.js         # index.html 진입점
│   └── post.js         # post.html 진입점
└── posts/
    ├── index.json      # 글 파일 목록 (브라우저는 폴더를 나열할 수 없으므로 필요)
    └── *.md            # 글 파일
```

## 글 작성 규칙

각 글은 `posts/` 폴더의 `.md` 파일이며, 상단에 front matter를 둡니다.

```markdown
---
title: 글 제목
date: 2026-09-28
tags: [javascript, css]
description: 목록에 보일 한두 문장 요약
---

본문 내용...
```

- 파일 이름(확장자 제외)이 곧 slug이며 URL에 쓰입니다. 영문 소문자, 숫자, 하이픈만 사용합니다(예: `hello-world.md`).
- 새 글을 추가하면 **반드시 `posts/index.json`에 파일 이름을 추가**합니다. 예: `["hello-world.md", "second-post.md"]`
- 목록은 `date` 기준 최신순으로 정렬합니다.

## 마크다운 파서 (`js/markdown.js`)

직접 구현하며, 다음 문법을 지원합니다.

- 제목 `#` ~ `######`, 문단, 줄바꿈
- 굵게 `**`, 기울임 `*`, 취소선 `~~`, 인라인 코드 `` ` ``
- 링크 `[텍스트](url)`, 이미지 `![alt](src)`
- 순서 없는/있는 목록 (중첩 포함), 인용문 `>`, 수평선 `---`
- 코드 블록 ```` ```언어 ```` (클래스 `language-언어` 부여)
- 표 (GFM 형식)

**보안**: 변환 전에 원문 텍스트의 `<`, `>`, `&`, `"`를 이스케이프합니다. 링크·이미지 URL은 `javascript:` 등 위험한 스킴을 차단합니다. `innerHTML`에 넣는 모든 값은 이 파서나 `escapeHtml`을 거친 결과여야 합니다.

파서는 순수 함수(`parseMarkdown(text) → string`)로 유지해 DOM 없이도 테스트할 수 있게 합니다.

## 디자인 가이드

**목표: 깔끔하고 읽기 좋은 디자인.** 장식보다 가독성을 우선합니다.

- **본문 폭**: 최대 `68ch` 안팎, 가운데 정렬
- **글꼴**: 시스템 글꼴 스택 사용 (한글 포함)
  `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", system-ui, sans-serif`
  코드는 `ui-monospace, SFMono-Regular, Consolas, monospace`
- **본문**: `font-size` 17~18px, `line-height` 1.75, 한글 가독성을 위해 `word-break: keep-all`
- **여백**: 문단·제목 간 간격을 넉넉히, 간격 값은 CSS 변수로 통일
- **색상**: 배경/글자/보조 글자/경계선/강조색/코드 배경을 모두 CSS 변수로 정의하고, 하드코딩된 색을 쓰지 않습니다
- 이미지는 `max-width: 100%`, 코드 블록과 표는 가로 스크롤(`overflow-x: auto`)

## 다크 모드

- 색상 변수를 `:root`에 라이트 테마로 정의하고, 다크 테마는 두 가지 방식으로 적용합니다.
  1. 사용자가 선택하지 않았으면 `@media (prefers-color-scheme: dark)`로 시스템 설정을 따름
  2. 토글 버튼으로 선택하면 `<html data-theme="dark|light">`로 강제하고 `localStorage`에 저장
- 화면 깜빡임(FOUC)을 막기 위해 테마 적용 스크립트는 `<head>` 안에 **인라인으로** 두어 CSS 렌더 전에 실행합니다.
- `localStorage` 접근은 `try/catch`로 감쌉니다.
- 다크 모드 색은 순수 검정(`#000`)보다 약간 밝은 어두운 회색 계열을 쓰고, 대비는 WCAG AA(4.5:1) 이상을 유지합니다.

## 반응형 (모바일)

- 모바일 우선(mobile-first)으로 작성하고, 넓은 화면은 `min-width` 미디어 쿼리로 확장합니다.
- 모든 페이지에 `<meta name="viewport" content="width=device-width, initial-scale=1">`
- 좌우 여백 최소 16px, 가로 스크롤이 생기지 않아야 합니다.
- 터치 대상(버튼·링크)은 최소 44×44px.
- 375px(모바일), 768px(태블릿), 1280px(데스크톱) 폭에서 확인합니다.

## 코딩 컨벤션

- 들여쓰기 2칸, 세미콜론 사용, 문자열은 작은따옴표
- `const`/`let`만 사용 (`var` 금지), `async/await` 사용
- 함수·변수는 camelCase, CSS 클래스는 kebab-case
- 전역 변수를 만들지 않고 ES 모듈의 `import`/`export`로 나눕니다
- 시맨틱 HTML 사용: `<header>`, `<main>`, `<article>`, `<nav>`, `<footer>`, `<time datetime="...">`
- 글을 불러오지 못하면 빈 화면 대신 사용자에게 오류 메시지를 보여줍니다

## 로컬 실행

`fetch`로 마크다운을 읽기 때문에 `file://`로 열면 동작하지 않습니다. 로컬 서버로 실행합니다.

```bash
python -m http.server 8000
```

그다음 브라우저에서 `http://localhost:8000` 접속.

## 작업 시 확인 사항

- 새 글 추가 시 `posts/index.json` 업데이트
- 라이트/다크 모드 양쪽에서 화면 확인
- 모바일 폭(375px)에서 가로 스크롤이 없는지 확인
- 브라우저 콘솔에 오류가 없는지 확인
