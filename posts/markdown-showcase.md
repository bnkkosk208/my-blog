---
title: 마크다운 문법 모아보기
date: 2026-09-27
tags: [마크다운, 가이드]
description: 이 블로그가 지원하는 마크다운 문법을 한 페이지에 모았습니다. 새 글을 쓸 때 참고하세요.
---

이 글은 블로그에서 지원하는 마크다운 문법이 실제로 어떻게 보이는지 보여 줍니다.

## 텍스트 꾸미기

**굵게**, *기울임*, ~~취소선~~, 그리고 `인라인 코드`를 쓸 수 있습니다.
줄 끝에 공백 두 칸을 넣으면  
이렇게 줄이 바뀝니다.

[외부 링크](https://developer.mozilla.org/ko/)와 [내부 링크](./)도 지원합니다.

## 목록

- 순서 없는 목록
- 두 번째 항목
  - 중첩된 항목
  - 또 다른 중첩 항목
- 세 번째 항목

1. 순서 있는 목록
2. 두 번째 단계
   1. 세부 단계 A
   2. 세부 단계 B
3. 세 번째 단계

## 인용문

> 좋은 글은 쉽게 읽힌다.
> 쉽게 읽히는 글은 어렵게 쓰인다.
>
> — 어느 편집자

## 코드 블록

```javascript
async function getPost(slug) {
  const res = await fetch(`posts/${slug}.md`);
  if (!res.ok) throw new Error('글을 찾을 수 없습니다.');
  return res.text();
}
```

```css
:root[data-theme="dark"] {
  --bg: #16181c;
  --text: #e6e8eb;
}
```

## 표

| 문법 | 표기 | 지원 |
| :--- | :--- | :---: |
| 굵게 | `**텍스트**` | ✅ |
| 기울임 | `*텍스트*` | ✅ |
| 표 | GFM 형식 | ✅ |

## 이미지

![산과 해가 있는 풍경 그림](posts/images/landscape.svg "샘플 이미지")

---

## 안전한 출력

본문에 HTML을 적어도 태그로 실행되지 않고 글자 그대로 보입니다: <script>alert('xss')</script>

위험한 링크도 막습니다: [눌러도 아무 일 없는 링크](javascript:alert%28document.cookie%29)
