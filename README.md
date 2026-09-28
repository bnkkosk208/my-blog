# My Blog

프레임워크 없이 **HTML, CSS, JavaScript**만으로 만든 마크다운 블로그입니다.
`posts/` 폴더의 마크다운 파일을 브라우저가 직접 읽어 글로 보여줍니다.

**사이트**: https://bnkkosk208.github.io/my-blog/

## 특징

- **빌드 없음**: 파일을 그대로 정적 호스팅에 올리면 동작합니다.
- **직접 만든 마크다운 파서**: 외부 라이브러리 없이 제목, 목록(중첩), 인용문, 코드 블록, 표, 링크, 이미지를 지원합니다.
- **안전한 출력**: 본문의 HTML은 이스케이프되고 `javascript:` 같은 위험한 링크는 차단됩니다.
- **다크 모드**: 시스템 설정을 따르고, 오른쪽 위 버튼으로 직접 바꿀 수 있습니다(선택은 브라우저에 저장).
- **반응형**: 휴대폰부터 데스크톱까지 읽기 편한 레이아웃입니다.

## 로컬에서 실행

마크다운 파일을 `fetch`로 읽기 때문에 HTML 파일을 더블클릭해 열면 동작하지 않습니다. 로컬 서버로 실행하세요.

```bash
python -m http.server 8000
```

그다음 브라우저에서 http://localhost:8000 에 접속합니다.

## 새 글 쓰기

1. `posts/` 폴더에 마크다운 파일을 만듭니다. 파일 이름은 영문 소문자·숫자·하이픈만 사용합니다(예: `my-first-post.md`).
2. 파일 맨 위에 글 정보를 적습니다.

   ```markdown
   ---
   title: 글 제목
   date: 2026-09-28
   tags: [태그1, 태그2]
   description: 목록에 보일 한두 문장 요약
   ---

   본문 내용...
   ```

3. `posts/index.json`에 파일 이름을 추가합니다.

   ```json
   ["hello-world.md", "my-first-post.md"]
   ```

4. 커밋하고 푸시하면 1분쯤 뒤 사이트에 반영됩니다.

글 목록은 `date` 기준 최신순이며, 날짜가 같으면 `index.json`에 나중에 추가한 글이 위에 옵니다.

## 폴더 구조

```
my-blog/
├── index.html          # 글 목록 페이지
├── post.html           # 글 상세 페이지 (post.html?slug=파일이름)
├── css/style.css       # 스타일 (색상 변수, 다크 모드, 반응형)
├── js/
│   ├── markdown.js     # 마크다운 → HTML 변환기
│   ├── frontmatter.js  # 글 상단 정보(front matter) 읽기
│   ├── posts.js        # 글 목록·본문 불러오기
│   ├── theme.js        # 다크 모드 토글
│   ├── list.js         # 목록 페이지 스크립트
│   └── post.js         # 글 페이지 스크립트
├── posts/
│   ├── index.json      # 글 파일 목록
│   └── *.md            # 글
└── .nojekyll           # GitHub Pages가 .md 파일을 변환하지 않도록 설정
```

## 배포

`main` 브랜치의 루트 폴더를 GitHub Pages로 배포합니다. `.nojekyll` 파일은 GitHub Pages가 글 파일을 HTML로 바꾸지 않고 원본 그대로 제공하게 하므로 지우지 마세요.
