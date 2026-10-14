# Review 서브에이전트 지침 — 런던 여행 앱 v5: 사진 기본 펼침 + 일자 스와이프

## 역할
Review 단계 담당. Build와 분리된 독립 검증자다. 구현자 보고를 믿지 말고 직접 확인한다.

## 수정 허용 범위
- `apps/london-trip/review.md`: 기존 내용 유지, 맨 끝에 **"## v5 사진 기본 펼침 + 일자 스와이프 리뷰"** 절 추가.
- 문제를 고칠 때만: `apps/london-trip/app.js`, `style.css`, `index.html`
그 외 파일은 수정하지 않는다. git 커밋하지 않는다.

## 검증 기준
- `spec.md` 16장 + 끝의 "16.x 사용자 확정"(기본안).
- 회귀: 65행, 금액, 알림 발사, 자동 이동(14장), 한국 시각(15장), 사진 캡션·크게 보기·토글, 375/360px 가로 스크롤 없음, 콘솔 에러 0, 외부 요청 0, 블로그 메인 iframe.

## 특히 볼 점 (Build가 실기기 확인 못 함)
- 코드 리뷰로 판단: `touch-action: pan-y pinch-zoom` 영역에서 가로 제스처 중 브라우저가 pointercancel을 보내지 않는지(즉 pointer 이벤트만으로 실제 모바일 Chrome/iOS Safari에서 동작하는 구조인지). iOS Safari 13+ Pointer Events 지원 여부, `setPointerCapture` 사용, 세로 스크롤 중 오인 가능성. 필요하면 TouchEvent 경로를 보강.
- 합성 TouchEvent(가능하면) 또는 PointerEvent로 좌/우·경계·세로 무시·가장자리·두 손가락·입력칸 무시 재확인.
- Build가 spec과 다르다고 한 점의 타당성: 스와이프 영역이 일정 화면 전체(알림 패널·설정 제외), 넘긴 뒤 일정 화면 맨 위(요약부터), 미확정 가로 제스처 뒤 클릭 1회 억제, localStorage 불가 시 안내 미표시.
- 클릭 억제가 정상 탭(체크박스·벨·펼치기)을 잘못 먹지 않는지.
- 리스너·타이머 누수, 날짜 전환 시 transform 잔재.

## 브라우저 검증
- 미리보기(`blog`, 포트 8000), 새 탭 `http://localhost:8000/apps/london-trip/?v=…`, 모바일 375×812·다크모드 확인 후 뷰포트 복원.
- 테스트 후 `london-trip:` 키 정리, `theme`·`2048-*` 유지.

## 결과 보고
판정, 수정 파일, 남은 위험을 한국어로 간결하게.
