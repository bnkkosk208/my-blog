---
title: 오늘 배운 것
date: 2026-09-28
tags: [TIL, HTML, CSS, JavaScript]
description: 클로드 코드로 블로그를 만들면서 배운 HTML, CSS, JavaScript의 역할을 정리했습니다.
---

오늘은 클로드 코드와 함께 프레임워크 없이 블로그를 만들었습니다. 만들면서 웹 페이지를 이루는 세 가지 기술이 각자 어떤 일을 하는지 알게 되어 정리해 둡니다.

> 한 줄 요약: **HTML은 뼈대, CSS는 옷, JavaScript는 움직임**

## HTML — 구조와 의미

HTML은 페이지에 **무엇이 있는지**를 정합니다. 제목, 본문, 목록, 버튼 같은 요소를 배치하는 뼈대입니다.

- `<header>`, `<main>`, `<article>`, `<footer>` 같은 **시맨틱 태그**를 쓰면 사람과 검색엔진, 스크린 리더가 페이지 구조를 이해하기 쉽습니다.
- `<meta name="viewport">` 한 줄이 있어야 모바일에서 화면이 제대로 보입니다.
- 이 블로그에서는 `index.html`(목록)과 `post.html`(글) 두 파일이 모든 페이지의 틀이 됩니다.

```html
<article>
  <h1>글 제목</h1>
  <time datetime="2026-09-28">2026년 9월 28일</time>
</article>
```

## CSS — 모양과 배치

CSS는 요소가 **어떻게 보일지**를 정합니다. 색, 글꼴, 여백, 레이아웃을 담당합니다.

- **CSS 변수**로 색을 한곳에 모아 두면, 변수 값만 바꿔서 다크 모드를 만들 수 있습니다.
- `@media (prefers-color-scheme: dark)`로 운영체제의 다크 모드 설정을 따라갈 수 있습니다.
- `@media (min-width: 768px)`처럼 화면 폭에 따라 스타일을 바꾸면 모바일과 데스크톱 모두 보기 좋아집니다.
- 헤더를 파란색으로 바꿀 때도 `--header-bg` 변수 하나만 고치면 됐습니다.

```css
:root {
  --bg: #ffffff;
  --text: #1f2328;
}

:root[data-theme="dark"] {
  --bg: #16181c;
  --text: #e6e8eb;
}
```

## JavaScript — 동작과 데이터

JavaScript는 페이지가 **무엇을 할지**를 정합니다. 사용자의 행동에 반응하고, 데이터를 불러와 화면을 바꿉니다.

- `fetch`로 마크다운 파일을 불러오고, 직접 만든 파서로 HTML로 바꿔 화면에 넣습니다.
- 테마 버튼을 누르면 `data-theme` 속성을 바꾸고 `localStorage`에 저장해서, 다시 방문해도 선택이 유지됩니다.
- ES 모듈(`import`/`export`)로 파일을 기능별로 나누면 코드를 관리하기 쉽습니다.

```javascript
const res = await fetch(`posts/${slug}.md`);
const text = await res.text();
article.innerHTML = parseMarkdown(text);
```

## 세 가지가 함께 일하는 방식

| 기술 | 역할 | 이 블로그에서 한 일 |
| :--- | :--- | :--- |
| HTML | 구조 | 헤더, 목록, 글 영역의 틀 |
| CSS | 표현 | 읽기 좋은 글꼴·여백, 다크 모드, 반응형 |
| JavaScript | 동작 | 글 불러오기, 마크다운 변환, 테마 전환 |

## 느낀 점

- 역할을 분리해 두니 **디자인을 바꿀 때는 CSS만**, **기능을 바꿀 때는 JavaScript만** 고치면 되어서 편했습니다.
- 프레임워크 없이도 생각보다 많은 것을 만들 수 있다는 것을 알게 되었습니다.
- 사용자가 입력한 내용을 화면에 넣을 때는 HTML 이스케이프 같은 **보안**도 함께 신경 써야 한다는 점을 배웠습니다.
