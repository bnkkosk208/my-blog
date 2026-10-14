# Build 서브에이전트 지침 — 런던 여행 앱 v7: 날짜별 날씨 예보

## 역할
Build 단계 담당. `apps/london-trip/spec.md` **18장**과 끝의 **"18.x 사용자 확정"**을 구현한다. 1~17장 기존 기능을 깨뜨리지 않는다.

## 수정 허용 범위
- 생성: `apps/london-trip/weather.js`
- 수정: `apps/london-trip/app.js`, `style.css`, `index.html`, `store.js`(초기화·백업 연동이 필요할 때만)
그 외(블로그 루트, `apps/2048/`, `data.js`, `places.js`, `img/`, `time.js`, `alarm.js`, `sw.js`, `spec.md`, `review.md`, `docs/`, `.claude/`)는 수정하지 않는다. git 커밋하지 않는다.

## 필수
- 먼저 실제 Open-Meteo 요청을 보내(curl 또는 브라우저) 응답 필드·단위·날짜 범위를 확인하고 그대로 구현. 추측한 필드명 금지. 네트워크가 막히면 중단하고 보고.
- 외부 요청은 Open-Meteo 한 곳만. 사용자 위치·개인정보 전송 없음. 응답 값은 textContent로 렌더.
- 출처 표기 "Weather data by Open-Meteo.com" (링크, CC BY 4.0).
- 날씨 실패가 다른 기능을 막지 않을 것(try/catch, 타임아웃, AbortController).

## 자체 검증
- 미리보기(`blog`, 포트 8000), `http://localhost:8000/apps/london-trip/?v=…`, 모바일 375×812·360px.
- 실제 예보 표시(날짜 탭·요약), 캐시 3시간 재사용(요청 1회), fetch 실패(오프라인/에러 모킹) 시 캐시·숨김, 토글 끄면 요청 없음, 예보 범위 밖 숨김, `TripTime.now` 고정으로 지난 날짜 흐림.
- 회귀: 65행, 금액, 알림, 자동 이동, 한국 시각, 사진, 스와이프, 자동 완료, 가로 스크롤 없음, 콘솔 에러 0, 블로그 메인 iframe.
- 테스트 후 `london-trip:` 키 정리, `theme`·`2048-*` 유지, 뷰포트 복원.

## 결과 보고
변경 파일·줄 수, 실제 API 요청 URL과 확인한 응답 필드, spec과 다른 점, 확인 결과, 확인 못 한 항목을 한국어로 간결하게.
