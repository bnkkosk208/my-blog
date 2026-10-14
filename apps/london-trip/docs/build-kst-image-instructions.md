# Build 서브에이전트 지침 — 런던 여행 앱 v4: 한국 시간 + 장소 이미지

## 역할
Build 단계 담당. `apps/london-trip/spec.md` **15장**과 끝의 **"15.x 사용자 확정"**(15장 본문보다 우선)을 구현한다. 1~14장 기존 기능(알림, 자동 이동 포함)을 깨뜨리지 않는다.

## 수정 허용 범위
- 수정: `apps/london-trip/app.js`, `style.css`, `index.html`, `time.js`(필요 시)
- 생성: `apps/london-trip/places.js`, `apps/london-trip/img/` 아래 이미지 파일과 `img/CREDITS.md`
- 그 외(블로그 루트, `apps/2048/`, `data.js`, `store.js`, `alarm.js`, `sw.js`, `spec.md`, `review.md`, `docs/`, `.claude/`)는 수정하지 않는다. git 커밋하지 않는다.

## 이미지 수집 규칙 (중요)
- 출처는 Wikimedia Commons / Wikipedia만. API 요청에는 `User-Agent: london-trip-blog/1.0 (bnk.kosk208 personal blog)` 같은 식별 헤더를 붙인다.
- 절차 예: `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=name&titles=<Title>&format=json` 로 대표 파일명 → `https://commons.wikimedia.org/w/api.php?action=query&titles=File:<name>&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=960&format=json` 로 `thumburl`, `Artist`, `LicenseShortName`, `LicenseUrl`, `descriptionurl` 획득.
- 자유 라이선스(CC BY*, CC BY-SA*, CC0, Public domain)만 저장. 비자유·확인 불가면 건너뛰고 places.js에 이미지 없음으로 표기.
- 위키 문서 제목은 실제 존재하는 것만(API 응답으로 확인). 이미지 내용이 장소와 맞는지(로고·지도·평면도 아님) 파일명/설명으로 확인하고, 부적절하면 같은 문서의 다른 사진이나 Commons 카테고리에서 적절한 사진을 고른다.
- `Artist` 값의 HTML 태그는 제거해 평문으로 저장. 내려받은 파일은 확장자·크기 확인, 장당 약 250KB 이하(960px 썸네일 사용), 총 5MB 이하.
- 다운로드 스크립트는 OS 임시 폴더에 두고 프로젝트에 남기지 않는다. 네트워크가 막혀 있으면 중단하고 보고한다(가짜 이미지·추측 URL 금지).

## UI
- spec 15장 UI(펼친 영역 16:9 썸네일, 크게 보기, 캡션: `사진: {저작자} · {라이선스}`, 출처 링크) + 접힌 카드 🖼 표시, 한국 시각 줄 토글, 이미지 표시 토글.
- 이미지 `<img>`는 상대 경로 `img/...`, `loading="lazy"`, `alt`(장소명), `width/height` 지정으로 레이아웃 흔들림 방지.

## 자체 검증
- 미리보기(`blog`, 포트 8000) `http://localhost:8000/apps/london-trip/?v=…`. `TripTime.now` 고정으로 헤더 한국 시각·시차(+8h, 10/25 이후 +9h), 카드 한국 시각(+1일 표기), r02·r66 처리 확인.
- 모든 매핑 행의 이미지 로드(404 없음), 캡션·출처 링크, 외부 요청 0(링크 클릭 전).
- 회귀: 65행, 금액, 알림 발사, 자동 이동, 375px 가로 스크롤 없음, 콘솔 에러 0.
- 테스트 후 `london-trip:` 키 정리, `theme`·`2048-*` 유지, 뷰포트 복원.

## 결과 보고
변경/생성 파일(이미지 개수·총 용량), 장소별 이미지·라이선스 표, 이미지 없는 장소와 이유, spec과 다른 점, 확인 결과, 확인 못 한 항목을 한국어로 간결하게.
