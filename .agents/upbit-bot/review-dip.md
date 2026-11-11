# Review 지침 — "조정 매수"(dip) 전략 + 시세 끊김 대응

## 역할
Build와 분리된 검증자. 현재 작업 트리의 `apps/upbit-bot/` 변경(조정 매수 전략 추가, 커밋 79da2d3의 시세 끊김 대응)을 검증하고 `apps/upbit-bot/review.md` 끝에 "## 추가 리뷰: 조정 매수 전략" 절을 덧붙인다.

## 범위
- 수정은 `apps/upbit-bot/` 안(spec.md 제외)만. 큰 설계 변경은 고치지 말고 보고. 커밋·push 금지. 실 키·실주문 금지.
- 임시 파일·스크린샷은 `/tmp/claude-0/-home-user-my-blog/205c47af-dd7c-51c0-90d8-a5f13645e727/scratchpad/`에. 기존 도구 `scratchpad/tools/fake-upbit.cjs`(Playwright 가짜 업비트 응답) 재사용 가능.

## 기준
`.agents/upbit-bot/build-dip.md`의 규격: 전일 종가 대비 dropPct% 하락 시 매수(같은 일봉 1회), 매수가 대비 risePct% 상승 익절, stopPct% 하락 손절, 기본 10/10/10, 기본 전략 dip, 기존 전략 유지.

## 검증
1. `cd apps/upbit-bot && npm test`, 모든 JS `node --check`.
2. 코드 리딩: dip 경계 계산, 같은 날 재진입 금지, vb 전용 로직(다음날 청산)이 dip에 새지 않는지, isPriceBased 변경이 vb 동작을 바꾸지 않았는지, 설정 탭 손절·익절과 겹칠 때, 실거래(LiveBroker) 경로에서 dip 매도 수량이 봇 보유 수량을 넘지 않는지, 백테스트 체결 가정이 낙관적이지 않은지.
3. 브라우저(Playwright + 가짜 시세): 기본 전략이 조정 매수로 선택됨, 파라미터 입력·검증, 상태 줄, 차트 점선(미보유 매수가격선/보유 시 익절·손절선)과 범례, 가짜 가격을 전일 종가 −10% 아래로 내려 모의 매수 → +10% 올려 익절, 다시 내려 손절 흐름(fake-upbit의 setPrice나 route 교체 활용), 백테스트 실행·체결 가정 표시, 기존 전략 전환 정상, 375px 가로 스크롤 없음, 콘솔 오류 0. 시세 칩 원인 표시·칩 클릭 재연결.
4. 문제를 찾으면 고치고 테스트 추가.

## 보고
결과(통과/조건부/실패), 고친 것(파일:줄), 남은 위험을 한국어로.
