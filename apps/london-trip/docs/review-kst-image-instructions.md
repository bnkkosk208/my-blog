# Review 서브에이전트 지침 — 런던 여행 앱 v4: 한국 시간 + 장소 이미지

## 역할
Review 단계 담당. Build와 분리된 독립 검증자다. 구현자 보고를 믿지 말고 직접 확인한다.

## 수정 허용 범위
- `apps/london-trip/review.md`: 기존 내용 유지, 맨 끝에 **"## v4 한국 시간 + 장소 이미지 리뷰"** 절 추가. 여기에 장소별 위키 제목·Commons 파일·저작자·라이선스 확인 결과 표를 포함(spec 15.3 요구).
- 문제를 고칠 때만: `apps/london-trip/app.js`, `style.css`, `index.html`, `time.js`, `places.js`, `img/CREDITS.md`, `img/` 이미지(교체·삭제)
그 외 파일은 수정하지 않는다. git 커밋하지 않는다.

## 검증 기준
- `spec.md` 15장 + 끝의 **"15.x 사용자 확정"**(사진 파일을 앱에 포함, 외부 요청 없음 유지, 15.x가 15장 본문보다 우선).
- **라이선스 독립 확인**: places.js의 각 이미지에 대해 Commons API(`prop=imageinfo&iiprop=extmetadata`, User-Agent 헤더 포함)로 저작자·라이선스가 기록과 일치하는지, 자유 라이선스인지 전수 확인. 네트워크가 막히면 그 사실을 기록.
- **이미지 내용 확인**: 각 이미지 파일을 직접 열어(Read로 이미지 보기) 장소와 맞는지, 로고·지도·부적절한 이미지가 아닌지 확인.
- 캡션에 저작자·라이선스·출처 링크가 표시되는지(CC BY/BY-SA 표기 의무), CREDITS.md와 places.js 일치.
- 한국 시각: `TripTime.now` 고정, 기기 TZ 무관, +8h/+9h 전환, +1일 표기, r02·r66.
- 회귀: 65행, 금액, 알림 발사, 자동 이동, 375/360px 가로 스크롤 없음, 외부 요청 0, iframe.
- 콘솔의 `about:srcdoc ... TripTime is not defined`는 이전 리뷰 잔재로 확인된 바 있다. **새 탭**에서 다시 확인해 앱 원인이 아님을 확정.
- 용량: img 총 5MB 이하.

## 브라우저 검증
- 미리보기(`blog`, 포트 8000), 새 탭에서 `http://localhost:8000/apps/london-trip/?v=…`. 모바일 375×812·다크모드 확인 후 뷰포트 복원.
- 테스트 후 `london-trip:` 키 정리, `theme`·`2048-*` 유지.

## 결과 보고
판정, 수정 파일, 남은 위험을 한국어로 간결하게.
