# Review — 런던 여행 일정관리 (london-trip)

- 검증일: 2026-10-14 · 검증자: Review 서브에이전트(Build와 분리)
- 기준: `spec.md` 10장 완료 기준. 12.1 사용자 확정이 우선(D1: r06 주소는 원문 그대로 표시가 정상이므로 `grep "Flat 4"` 항목은 적용하지 않음)
- 방법: (1) Node 스크립트로 `data.js`와 `docs/source-dump.txt` 전체 대조 (2) 내장 브라우저(`blog` 서버 :8000)에서 375×812 모바일, 데스크톱, 다크/라이트 확인 (3) `TripTime.now`를 고정한 srcdoc iframe(360×640)으로 시간 판정 확인 (4) 블로그 메인에 임시 iframe을 DOM으로 넣어 확인(파일 수정 없음) (5) 코드 리뷰

## 요약: **수정 후 통과**

블로커는 없다. CSS 결함 2건(`hidden` 속성이 클래스의 `display`에 덮이는 문제, 터치 타깃 44px 미만)과 사소한 전역 변수 누수 1건을 고쳤다. 데이터는 65행 전부를 글자 단위로 대조했고 불일치는 0건이다.

## 체크리스트 결과

### 10.1 데이터
| 항목 | 결과 | 근거 |
|---|---|---|
| schedule 65행, 일자별 행·이동·활동·예약필요 수 | 통과 | D1~D8 = 6/14/11/2/10/10/11/1, 이동 30·활동 34·이동/활동 1(r57)·예약필요 7. 3.3 표와 같음 |
| 원본 대조(무작위 10행 이상) | 통과 | 10행만이 아니라 **65행 전부**를 A~M열(날짜·요일·시작·종료·소요·구분·내용·이동수단·예약·비고·식당·카페·비용)로 글자 단위 비교. 불일치 0 |
| 식당 21·뮤지컬 8·골프 9, 참고 안내 줄 수 | 통과 | 21/8/9개, 안내 5/6/6줄. 시트 전 필드 원문과 같음 |
| links가 3.4 표와 일치, https, 새 탭 + noopener | 통과 | 13행 URL이 표와 같음. 링크가 아닌 문구(rs05·07·08·10·20)는 `links: []`. 렌더된 외부 링크 전부 `target=_blank rel=noopener` |
| Place 파싱(★, [웨이팅], 괄호 설명) | 통과 | 모든 Place를 raw에서 다시 파싱해 대조. r11 `Dishoom Permit Room Portobello` → 웨이팅 + "인도, 브런치" |
| r06 주소 표시 수준 | 통과(D1 확정) | 원문 주소가 그대로 들어감. 지도 링크도 원문 주소로 생성 |
| TRIP_DATA 동결, 조작 후 불변 | 통과 | `Object.isFrozen`이 최상위·행·links·Place·meta.days에서 모두 true. 완료·메모·추가·숨김·예약 조작 뒤 JSON 스냅샷이 같음 |

### 10.2 기능
| 항목 | 결과 | 근거 |
|---|---|---|
| 날짜 탭 8개, `#day=` 동작, 잘못된 해시 무시 | 통과 | `#day=2026-10-21` 로드 시 선택되고 탭이 가운데로 스크롤됨. hashchange로 10/22 전환. `#day=2026-12-01`은 무시하고 기본 규칙 적용 |
| 여행 중 자동 선택 + 지금/다음 | 통과 | `now=2026-10-18T15:10Z` → 런던 16:10 BST, Day 3 선택, r29 `지금`(aria-current=true), r30 `다음 · 20분 후`. 기기 시간대는 KST인데 런던 기준으로 계산됨 |
| 여행 전·후, r02/r66 제외 | 통과 | 10/14 → `D-2`, 10/24·2027년 → `여행 종료`, 하이라이트 없음. 10/16 10:00 → r02는 제외되고 r03이 `다음`. 10/23 → r66 하이라이트 없음 |
| 자정 넘김 | 통과 | 10/17 23:59에 Day 2를 보던 중 00:00으로 바꾸고 visibilitychange 발생 → 칩은 "오늘: Day 3", 선택 탭은 10/17 그대로 |
| 완료·메모·내 일정 CRUD·숨기기가 새로고침 후 유지, 원본에 삭제 버튼 없음 | 통과 | 새로고침 뒤 모두 유지. 원본 카드에는 "숨기기"만 있고, 수정/삭제는 사용자 항목에만 있음 |
| 시간순 섞기, 종료<시작 거부, 내용 공백 거부 | 통과 | 16:20 일정이 r29(16:00)와 r30(16:30) 사이에 들어감. 오류 문구가 정상 표시됨 |
| 예약 체크 7개 → 타임라인 `예약완료 ✓` | 통과 | 0/7 → 1/7, r30 배지가 바뀜 |
| 일자 요약·전체 합계(3.5 표) | 통과 | 8일 모두 일치(10/18 교통 £14.00~£16.20, 입장 £66.00~£70.00 / 10/19 계산 불가 / 10/23 항공권 별도). 전체: 교통 £89.35~£123.00, 입장 £177.70~£301.70 |
| 식당 필터, 뮤지컬 "일정 후보", 골프 "일정 확정" | 통과 | 전체 21 / 예약 가능 17 / 워크인 4. 맘마미아·라이온킹, Richmond Park. N1 주석 박스 표시(D3) |
| 이 날 초기화·전체 초기화가 `london-trip:` 키만 삭제 | 통과 | 전체 초기화 뒤 `theme`·`2048-best`·`2048-state` 유지 |
| 손상된 localStorage | 통과 | `"abc"`, 깨진 JSON, `r99`, `25:00`, 범위 밖 날짜, `[1,2]`, 잘못된 lastDay/lastView를 넣어도 오류 없이 유효한 항목(u_a2, r25 숨김)만 반영 |
| 저장 차단 시 동작 + 안내 | 통과 | localStorage 접근 시 예외를 던지게 해도 렌더·체크가 동작하고 "저장되지 않습니다" 안내 표시 |

### 10.3 UI/환경
| 항목 | 결과 | 근거 |
|---|---|---|
| 360·375px 가로 스크롤 없음 | 통과 | scrollWidth == clientWidth (360 iframe, 375 모바일, 데스크톱) |
| 터치 타깃 44px, 키보드, 포커스 링 | **수정 후 통과** | `지도에서 보기`(32px)와 `예약방법 보기`(20px)를 44px로 고침. 체크박스는 44×44 label 안에 있음. 탭은 ←/→/Home/End 지원, `:focus-visible` 3px 링. 문장 속 인라인 링크(비고 도메인)는 WCAG 2.5.8 인라인 예외로 그대로 둠 |
| 라이트/다크 대비 4.5:1, 색 외 구분 | 통과 | 배지 16종과 주요 텍스트를 계산. 최저값은 라이트 `지금`/`다음` 4.62, 다크 최저 5.95. 이동은 "→ 이동" 텍스트, 예약은 "예약필요" 텍스트로도 구분됨. 블로그 `theme` 값(dark/light)이 시스템 설정보다 우선 적용됨 |
| iframe 360×640 동작, "새 창에서 열기" | **수정 후 통과** | 블로그 메인에 임시 iframe을 넣어 확인. 잘림 없고 자동 스크롤해도 부모 페이지는 움직이지 않음(scrollY 0). 단, 수정 전에는 **최상위 창에서도** "새 창에서 열기"가 보였음(아래 P1) |
| file:// / 하위 경로 | 부분 확인 | 모든 경로가 상대 경로이고, 일반 `<script defer>`만 쓰며 fetch가 없음(정적 확인). 미리보기 창이 file://을 스냅샷으로만 열어 실제 실행은 확인하지 못함 |
| XSS(`<img src=x onerror=…>`) | 통과 | 메모·제목·이동수단에 넣어도 실행되지 않고 글자 그대로 표시됨. 코드 전체에 `innerHTML`·`insertAdjacentHTML`·`document.write`가 없음 |
| 콘솔 에러·외부 요청 없음 | 통과 | 앱의 에러 0건(콘솔의 에러 1건은 검증용 하네스 첫 시도에서 난 것). 외부 리소스 요청 0건 |
| `apps/london-trip/` 밖 변경 없음 | 통과 | `git status`에서 `?? apps/london-trip/`만 보임 |

## 발견한 문제와 조치
| # | 심각도 | 문제 | 조치 |
|---|---|---|---|
| P1 | 중 | `.open-new { display:inline-flex }`, `.hidden-list { display:flex }`, `.chip { display:inline-block }`이 `hidden` 속성(UA의 `display:none`)을 덮음. 그래서 **iframe이 아닌 일반 페이지에서도 "새 창에서 열기"가 보였고**, "숨긴 항목 n개 보기"를 누르기 전에도 숨긴 목록이 펼쳐져 있었음 | `style.css`에 `[hidden] { display: none !important; }` 추가. 수정 후 최상위 창에서는 링크가 숨겨지고(iframe에서는 보임), 숨긴 목록은 접힌 상태로 시작함을 확인 |
| P2 | 하 | 터치 타깃 44px 미만: `.map-links a` 32px, `.places a`(예약방법 보기) 20px | `style.css`: 두 링크에 `min-height:44px; display:inline-flex` 적용 |
| P3 | 하 | `index.html` head의 테마 스크립트가 전역 `var t`를 만듦(전역 3개 제한 위반) | `index.html`: IIFE로 감쌈. 이후 `'t' in window` → false |

## Build가 spec과 다르게 했다고 보고한 점에 대한 판단
1. 스크립트 순서 data → time → store → app: **타당**. 의존 관계가 없고, time을 먼저 두면 테스트 때 now를 덮어쓰기 좋음.
2. 진행 중 항목이 있어도 다음 항목에 "다음" 배지: **타당**. 정보가 늘 뿐 혼동은 없음. spec보다 유용함.
3. `addresses` 파생 필드: **타당**. r43처럼 주소가 2개인 경우를 처리할 수 있음. 원문 필드는 바뀌지 않음.
4. scrollIntoView 대신 window.scrollTo/scrollLeft: **타당**. iframe 안에서 부모 페이지가 스크롤되는 것을 막음(부모 scrollY 0 확인).
5. 여행 전에도 lastDay가 있으면 그 날 우선: **타당**. spec 2.1의 우선순위(③ lastDay)와도 맞음. 7.4의 "여행 전 Day 1"은 lastDay가 없을 때로 해석.
6. `#day=` 해시를 읽기만 함: **타당**. 히스토리가 쌓이지 않음.
7. 사용자 일정 종료 시간 선택 입력: **타당**. 종료가 없으면 시작 시점만 판정함(status의 e=s).
8. 테마 인라인 스크립트를 head에 둠: **타당**(FOUC 방지). P3의 전역 누수는 수정함.

## 남은 위험 / 확인하지 못한 항목
- **file:// 직접 실행**은 미리보기 도구 한계로 실행 확인을 못 함(정적 분석상 문제 없음). GitHub Pages 하위 경로도 실제 배포 전이라 미확인.
- 기기 시간대를 실제로 Asia/Seoul이 아닌 값으로 바꿔 보는 테스트는 못 함. 검증 환경 자체가 KST였고, 런던 시각이 정확히 계산되는 것은 확인함.
- 실제 터치 기기, iOS Safari(`<dialog>`, `-webkit-line-clamp`)에서는 확인하지 않음.
- 내보내기(파일 다운로드)·가져오기(파일 선택)는 코드 리뷰만 함. 다운로드를 피하려고 브라우저에서 실행하지 않았음. 검증 로직은 손상 데이터 테스트와 같은 함수(cleanFlagMap/cleanMemo/cleanCustom)를 씀.
- 사소한 점(수정 안 함): 전체 초기화 직후 `switchView`가 `london-trip:lastView`를 다시 씀(접두사 키라 영향 없음). `TripTime.fromMin`·`isISODate`, CSS `.summary .sep`·`.link-list`는 쓰이지 않는 죽은 코드. 일자 요약의 활동/이동 수는 숨긴 원본을 빼고 셈(설계상 의도로 봄).
- 원본 불일치(spec 9장 N1~N17)는 원문 유지 원칙에 따라 그대로 둠. N1만 뮤지컬 탭 주석 박스로 안내함.
- `docs/source-dump.txt`는 `.gitignore`에 들어 있음(D2). 커밋할 때 실제로 제외되는지 Embed 단계에서 확인이 필요함.

## v2 알림 기능 리뷰

검증일 2026-10-14 · 검증자: Review 서브에이전트(Build와 분리) · 기준: spec 13장(13.9 체크리스트, 13.10 사용자 확정), 10장 회귀
환경: 내장 브라우저(Chromium), `http://localhost:8000/apps/london-trip/?v=rv1`, **기기 시간대 Asia/Seoul**, 알림 권한 `denied` 상태

### 판정: 수정 후 통과

### 13.9 체크리스트 결과
| 항목 | 결과 | 근거 |
|---|---|---|
| 시간 고정 발사 | 통과 | `14:59:30Z`에서 r30(30분 전) `check()` → 0개. `15:00:10Z` → 토스트 1개 "16:30 런던아이 탑승 · 30분 후 시작", `alarmFired.r30 = "1792335600000"`. 다시 `check()` → 0개 |
| 놓친 알림 | 통과 | `15:10:00Z` → "알림 시각 10분 지남". `15:20:00Z`(15분 초과) → 울리지 않고 기록만(토스트 증가 0). visibilitychange 경로는 코드로 확인(미리보기 창이 hidden 상태라 이벤트 경로는 `visibilityState==='visible'` 분기에서 멈춤 — 정상 동작) |
| 시점 변경·사용자 일정 | 통과 | 10분 전으로 바꾸면 알림 시각 `15:20:00Z`(런던 16:20), `15:19:50Z` 0개 → `15:20:05Z` 1개. 사용자 일정 시작 18:00→18:30 수정 시 알림 시각 +30분, 삭제 시 `items`·`alarmFired`에서 제거 |
| 기기 시간대 KST | 통과 | 검증 환경 자체가 Asia/Seoul. r02 알림 시각 `2026-10-15T23:15:00Z`. r66 `canAlarm=false`, 벨 `disabled` |
| 전역 끄기·숨김·완료 / 일괄 개수 | 통과 | 전역 끄기 → targets 0. 숨김 r29·완료 r31 제외. 예약필요 **7**, 이동 **30**(이동/이동·활동 31행 중 시작 없는 r66 제외 — 지침대로 30이 맞음), 이 날(10/18) 6 |
| 시스템 알림 | 일부 확인 | 권한이 `denied`라 "거부됨(브라우저 설정에서 변경)" 안내 + 토스트만 확인. iframe(블로그 메인 카드) 안에서는 `permission()='iframe'`, 허용 버튼 없음, "새 창에서 열기 ↗"(`./index.html`, `_blank`, `noopener`) 안내 확인. **허용 상태의 실제 표시·클릭 이동은 미확인** |
| 두 탭 동시 | 통과(모의) | 다른 탭이 같은 firedKey를 먼저 기록한 상황을 localStorage에 재현 → `claimFired` false(재발사 없음) |
| .ics | 통과 | CRLF만 사용(단독 LF 없음), 최대 줄 길이 75옥텟, 접기 해제 후 깨진 글자 없음. r30 `DTSTART:20261018T153000Z` + `TRIGGER:-PT30M`, r02 `DTSTART:20261015T234500Z`/`DTEND:20261016T162000Z`, r66 없음, 메모 없음, `\ ; ,` 이스케이프 확인, UID `{id}@london-trip`, DTSTAMP 있음. 캘린더 앱 가져오기는 미확인 |
| 저장값 검증·백업·초기화 | 통과 | `enabled:'x', lead:7, r99, u_nope, r29:'abc', __proto__` → 기본값 + r29·r30(lead 30)만 남음. `alarmFired` 숫자 아닌 값 제거. export에 `alarm` 포함·`alarmFired` 없음, import는 `items`만 병합(전역 enabled/lead 유지), `alarm` 없는 옛 파일도 ok. 전체 초기화 시 알림 키 삭제, `theme`·`2048-*` 유지 |
| UI·접근성 | 통과 | 벨 44×44, `aria-pressed`, 배지 "🔔 30분 전", 토스트 버튼 64×44, `#liveAlert` assertive. 대비(라이트/다크): 토스트 16.5/14.6, 놓침 배지 4.62/6.62, 알림 배지 5.34/5.95, 모두 끄기 5.46/7.09 — 모두 4.5:1 이상. 360px·375px 5개 뷰 가로 스크롤 없음. 사용자 일정 제목 `<img onerror>` 실행 안 됨(카드·패널·.ics 모두 텍스트) |
| `apps/london-trip/` 밖 변경 | 통과 | `git status` 결과 앱 폴더 안만 변경 |

### 10장 회귀
- `schedule.length === 65`, 10/18 요약 "교통비 £14.00 ~ £16.20 / 입장·이용료 £66.00 ~ £70.00" 일치.
- 완료·메모·내 일정·숨기기 새로고침 후 유지, 백업 필드 유지.
- 콘솔: 이번 검증 중 새 에러 0. (콘솔에 남아 있던 `navigator.vibrate` 차단 에러 4건은 이전 세션 기록이며, 사용자 활성화 전 발사 시 재현되지 않음 — `userActivation.hasBeenActive` 확인이 동작함.)

### 코드 리뷰
- **시간대**: `toEpoch`는 Intl `formatToParts`로 오프셋을 구하고 `Date.UTC`만 사용(로컬 시간 함수 미사용). 서머타임 경계 2차 보정 있음. Intl 미지원 시 고정 오프셋(BST+1/KST+9) — 여행 기간이 모두 BST라 타당.
- **중복 발사**: `check()`가 `getFired`(저장소 재읽기) → `claimFired`(다시 읽고 기록) 순. 시스템 알림 `tag`로 OS 단 합침. localStorage는 탭 간 원자적이지 않아 극히 짧은 경쟁 구간은 남음(허용 수준).
- **타이머 누수**: `reschedule()`이 매번 `clearTimeout` 후 1개만 설정, 24시간 초과는 생략. 1분 `setInterval`은 1개.
- **sw.js 범위**: install/activate/notificationclick만. fetch·캐시·push 없음. 열 주소는 스코프 안으로 제한.
- **XSS**: 알림 관련 DOM은 모두 `el(..., {text})`/textContent. innerHTML 사용 없음.

### 수정한 내용
1. `sw.js` — 알림 클릭 시 `clients.matchAll`이 블로그 메인의 iframe(nested) 안 앱 창도 찾아 그 창에 메시지·focus를 보냈음. iframe 앱은 `inIframe`이라 SW 메시지 리스너가 없어서, 단독 탭은 닫혀 있고 블로그 메인만 열려 있으면 **알림을 눌러도 카드로 이동하지 않는** 문제. `c.frameType !== 'nested'` 조건을 추가해 최상위 창만 재사용하고, 없으면 `openWindow`로 새 창을 열게 함.

### Build 보고 차이 판단
1. 이동 일괄 30개(r66 제외): **타당**. 시작 없는 행은 알림 불가(13.2).
2. 토스트·시스템 알림은 시작 시각, 패널은 알림 시각: **타당**. 토스트 문구가 "16:30 … · 30분 후 시작"이라 시작 시각이 더 자연스러움. 패널은 "언제 울리는지"가 목적.
3. 시작 시각이 지난 항목을 켜면 기록만: **타당**(13.4 "이미 지난 일정은 울리지 않고 안내"와 일치, aria-live 안내 확인).
4. 꺼진 항목의 시점 select 변경 시 켜짐: **타당**. "(바꾸면 알림이 켜집니다)" 안내가 있어 혼동 적음.
5. SW는 권한 granted + top 창 + https/localhost에서만 등록: **타당**. 불필요한 등록 방지, `file://` 제외(13.6).
6. VALARM은 알림 켜고 미완료 항목에만: **타당**(A8과 일관).
7. 진동은 사용자 활성화 후에만: **타당**. Chrome 콘솔 에러를 막음(콘솔 에러 0 기준 충족).

### 남은 위험 / 확인하지 못한 항목
- **시스템 알림 허용 상태**(데스크톱 `new Notification`, SW `showNotification`, 알림 클릭 → 카드 이동)는 검증 브라우저 권한이 `denied`라 실행 확인 못 함. 코드 리뷰만 함. 실제 데스크톱/Android Chrome에서 1회 확인 권장.
- **.ics 실제 가져오기**(iOS 캘린더·Google/Outlook)는 미확인. 생성 텍스트의 형식만 검증함. 다운로드 버튼도 파일 저장을 피하려고 누르지 않음(같은 `downloadBlob` 경로는 v1 백업에서 사용 중).
- 알림 시점이 지났지만 아직 시작 전인 항목을 **켠 시점이 알림 시각 +15분을 넘으면**(예: 120분 전으로 켰는데 이미 1시간 전) 안내 없이 기록만 되어 울리지 않음. 사양 범위 안이지만 사용자 입장에선 조용히 무시됨(사소).
- `reschedule`의 `setTimeout`으로 깨어났는데 울릴 것이 없으면 패널 요약은 다음 1분 틱에 갱신됨(최대 1분 지연, 사소).
- 실제 터치 기기·iOS Safari·백그라운드 탭 지연은 미확인(spec 13.7 허용 범위).
- 테스트 후 `london-trip:` 키 삭제, 서비스 워커 등록 없음(권한 denied), 뷰포트 데스크톱 복원.

## v3 현재 위치 자동 이동 리뷰

검증일 2026-10-14. Build와 분리된 독립 검증. 내장 브라우저(`blog`, 포트 8000) 새 탭에서 `?v=r3a`~`r3g`로 확인하고, `TripTime.now`를 고정한 뒤 `TripApp.tick('return'|'timer')`로 복귀·타이머를 재현했다.

### 판정
**통과 (수정 2건 반영)**. spec 14.10 체크리스트와 14.x 사용자 확정(B1~B5 기본안)을 모두 만족한다. 회귀도 없다.

### 14.10 체크리스트
| 항목 | 결과 | 근거 |
|---|---|---|
| 15:59(런던) visibilitychange → Day 3, 진행/다음 카드 | 통과 | `2026-10-18T14:59:30Z` → Day 3, r28 `지금`, 카드 top 125px(sticky 하단 117px 바로 아래). "지금으로" 숨김 |
| 다른 날 탭 → 3분 보류 → 복귀 | 통과 | 10/20 클릭 → 버튼 표시. +2분 timer → 그대로. +4분 timer → Day 3 r29로 복귀, 버튼 숨김 |
| 메모 포커스·바텀시트·알림 패널 | 통과(패널은 수정) | textarea 포커스 중 timer·return 모두 이동 없음. dialog 열림 중 이동 없음. 알림 패널은 아래 수정 1 참고: 패널 안 select 포커스 중엔 이동 없음, 열어만 둔 상태에선 이동함 |
| 대상 전환 / 같은 대상 재스크롤 없음 | 통과 | 15:29:30Z r29 → 15:30:30Z r30으로 이동(top 125). 같은 대상에서 timer 반복 시 scrollY 변화 없음 |
| 런던 자정 | 통과 | `22:59:30Z` Day 3 → `23:00:30Z` Day 4(10/19) r33, 헤더 "런던 00:00 BST · 오늘: Day 4" |
| 여행 전/후 | 통과 | 실제 시각(10/14) 첫 로드 → Day 1, r02 top 125. 여행 후(10/25) → Day 8 맨 위(y=0), 다른 날 탭으로 가도 버튼 없음. 여행 전 다른 날 탭 → 버튼 표시 |
| 해시 진입 | 통과 | `#day=2026-10-20&item=r45` → r45(실제 날짜 10/21) 카드 top 125, +1분 timer 유지, +4분 timer → Day 1 r02 복귀 + 해시 제거 |
| 지금으로 버튼 | 통과 | 48px 높이, `aria-label="현재 일정으로 이동"`, button 요소라 키보드 사용 가능. 클릭 → 즉시 이동, 카드 flash, 토글 버튼에 포커스. reduced-motion은 `matchMedia` 분기 + 기존 CSS `scroll-behavior:auto`로 코드 확인(에뮬레이션은 미실시) |
| 블로그 메인 iframe | 통과 | iframe 안에서 return·버튼 이동 시 부모 scroll 이벤트 0회, 부모 scrollY 0 유지 |
| 375px / 콘솔 / 범위 | 통과 | 375×812에서 scrollWidth 375, 버튼 우측 16px·하단 12px, 하단 패딩 88px로 마지막 내용 안 가림. 콘솔 메시지 없음. 변경은 `apps/london-trip/`만 |

뷰 탭(B3·B5): 식당 탭에서 timer → 탭 유지 + 버튼만. 여행 전 return → 탭 유지(lastView 유지 규칙). 여행 중 return → 일정 탭으로 전환, Day 3 r29 top 125.

### 회귀
- `TRIP_DATA.schedule` 65행. 10/18 요약 교통 £14.00~£16.20 / 입장 £66.00~£70.00, 전체 교통 £89.35~£123.00 / 입장 £177.70~£301.70 — 이전 리뷰와 같음.
- 알림: r30(30분 전) `14:59:30Z` check 0개 → `15:00:10Z` tick → 토스트 1개 "16:30 런던아이 탑승 · 30분 후 시작", `alarmFired.r30="1792335600000"`, 재확인 0개. 토스트가 생겨도 `#nowRow`는 유지되고(토스트만 3개 제한 대상) 토스트 위에 놓임.
- 완료 체크(r29) 저장, 메모 저장, 내 일정 16:20 추가 → r29와 r30 사이 정렬. 정상.

### 코드 리뷰
- 리스너·타이머: 모두 `bind()`에서 1회 등록, `setInterval` 1개, `updateNowBtnSoon`은 rAF로 합쳐짐. 누수 없음.
- 스크롤 루프: 조작 감지는 wheel/touchmove/키/클릭/input/change만이고 scroll 이벤트는 버튼 표시 갱신에만 쓴다. 자동 스크롤이 보류를 걸지 않음을 확인(이동 후 다음 timer에서도 정상 이동).
- 성능: scroll마다 rAF 1회 `currentTarget()`(하루 항목 수십 개 상태 계산) — 문제없는 수준.
- 참고: 백그라운드 탭에서는 rAF가 돌지 않아 이동이 실행되지 않는다. 실제 사용에서는 `visibilitychange(visible)` 뒤에 실행되므로 문제없다(검증 중 탭을 앞으로 가져와 재확인).

### 수정
1. **알림 패널 열림만으로 자동 이동이 영구 차단되던 문제** (`app.js` `isBlocked`). 패널은 `<details>`라 사용자가 열어 둔 채 두면 세션 내내 "항상 현재 위치" 요구가 깨졌다. 열림 검사를 빼고, 패널 안 select·입력 포커스(기존 입력 검사)와 클릭·변경(기존 `markInteract` 3분 보류)으로만 막도록 했다. 열어 둔 상태에서 15:30:30Z timer → r30으로 이동 확인.
2. **닫힌 dialog 안에 포커스가 남으면 계속 "입력 중"으로 판정되던 문제** (`app.js` `isBlocked`). 포커스 복원이 안 되면(프로그램 호출 close 등) `fStart`가 activeElement로 남아 자동 이동이 멈췄다. `dialog:not([open])` 안의 포커스는 무시하도록 했다. 재현 시나리오에서 이동 확인.

### Build가 spec과 다르게 한 점 — 판단
1. 복귀 시 일정 탭 전환은 여행 중에만: **타당**. 14.5의 "lastView는 여행 전·후 유지"와 맞다.
2. 체크박스·버튼 포커스는 입력 중 아님: **타당**. 체크 후 포커스가 남아 영구 차단되는 것을 막는다.
3. "지금으로"는 보류·금지 무시: **타당**. 명시적 사용자 요청이다.
4. lastDay는 Intl 미지원 시에만: **타당**. 14.1(여행 전 Day 1, 여행 후 Day 8)을 따르면 결과가 같다.
5. r02 숨김 시 대체 항목, 여행 후·대상 없음은 맨 위: **타당**.
6. 보류 후 위치를 벗어나 있으면 timer가 복귀: **타당**. 14.3 "보류가 끝난 다음 이동 시점에 복귀"와 같다.
7. 버튼을 토스트 컨테이너 맨 위에: **타당**. 겹침 없이 토스트 위에 놓이고 토스트 정리 로직도 `.toast`만 지우도록 고쳐져 있다.
8. `window.TripApp`: **허용**. `TripTime`·`TripAlarm`과 같은 수준의 검증용 전역이고 상태를 바꾸는 API는 tick/syncToNow뿐이다.

### 콘솔 `about:srcdoc ... TripTime is not defined`
새 탭(앱 단독, 블로그 메인 iframe)에서 콘솔 메시지 0건. 저장소에 `srcdoc` 사용처가 없다. 이전 리뷰의 임시 iframe 잔재로 확정, 앱 원인 아님.

### 남은 위험
- textarea·select에 포커스를 둔 채 화면을 끄거나 방치하면, 포커스가 풀릴 때까지 자동 이동이 멈춘다(spec 14.3 "입력 중 절대 금지" 그대로). "지금으로" 버튼과 다른 곳 탭으로 풀린다.
- reduced-motion·bfcache(`pageshow` persisted)·실기기 터치 스크롤 중 자동 이동 충돌은 코드로만 확인했다.
- 테스트 후 `london-trip:` 키를 모두 지웠다(`theme`·`2048-*` 유지).

## v4 한국 시간 + 장소 이미지 리뷰
검증일 2026-10-14 · 독립 Review 서브에이전트(Build와 분리) · 기준: spec 15장 + **15.x 사용자 확정**(사진 파일 앱 포함, 외부 요청 0 유지, 15.x 우선).

**판정: 통과 (경미 2건 수정).**

### 장소별 라이선스 확인 (Commons API 독립 조회)
`commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata|size` (User-Agent 헤더 포함)로 23개 파일 전수 조회. 네트워크 정상. 모든 파일이 존재하고 `LicenseShortName`이 places.js 기록과 일치, `NonFree` 없음 → 전부 자유 라이선스(CC BY / CC BY-SA). 이미지는 Read로 직접 열어 장소 일치·로고/지도/부적절 여부 확인.

| 장소 키 | 위키 제목 | Commons 파일 | 저작자(API Artist) | 라이선스 | 일치 | 내용 확인 | 행 |
|---|---|---|---|---|---|---|---|
| notting-hill | Notting_Hill | London_110.jpg | Urban | CC BY-SA 2.5 | O | 노팅힐 Dunworth Mews 골목(설명 "London : Notting Hill") | r09 |
| portobello | Portobello_Road | Portobello_market.jpg | Alexrk2 | CC BY-SA 3.0 | O | 포토벨로 시장 거리 | r11 |
| british-museum | British_Museum | British_Museum_from_NE_2.JPG | Ham | CC BY-SA 3.0 | O | 대영박물관 정면 | r13 |
| national-gallery | National_Gallery | Galería_Nacional,_Londres,…_DD_036.JPG | Diego Delso | CC BY-SA 4.0 | O | 트라팔가 광장 쪽 정면 | r15 |
| piccadilly | Piccadilly_Circus | Open_Happiness_Piccadilly_Circus_…jpg | Jimmy Baikovicius | CC BY-SA 2.0 | O (Restrictions=trademarked) | 광장 전경(광고판 상표 노출, 로고 이미지 아님) | r17, r21 |
| soho | Soho | Soho_(1877979497).jpg | Leandro Neumann Ciuffo | CC BY 2.0 | O | 소호 스퀘어 야경 | r19, r34 |
| borough-market | Borough_Market | London_2018_March_IMG_0663.jpg | Øyvind Holmstad | CC BY-SA 4.0 | O | 시장 내부 | r23 |
| tower-bridge | Tower_Bridge | Tower_Bridge_at_Dawn.jpg | Fuzzypiggy | CC BY-SA 3.0 | O | 타워브리지 새벽 | r25 |
| tower-of-london | Tower_of_London | Tower_of_London_from_the_Shard_(8515883950).jpg | [Duncan] from Nottingham, UK | CC BY 2.0 | O | 런던탑 항공 시점 | r26 |
| tate-modern | Tate_Modern | Tate_Modern_-_Bankside_Power_Station.jpg | Acabashi | CC BY-SA 4.0 | O | 템스강 건너 전경 | r28 |
| london-eye | London_Eye | London-Eye-2009.JPG | Khamtran | CC BY-SA 3.0 | O | 런던아이 | r30 |
| covent-garden | Covent_Garden | Covent_Garden_Interior_May_2006_crop.jpg | Diliff (파생: SilkTork) | CC BY 2.5 | O | 마켓 홀 내부 | r32 |
| richmond-park | Richmond_Park | Ham_Bottom_in_late_November_-_geograph…5214113.jpg | Stefan Czapski | CC BY-SA 2.0 | O | 공원 풍경(골프장 아님, spec대로) | r36 |
| west-end | West_End_theatre | London_(44761485915).jpg | Pedro Szekely from Los Angeles, USA | CC BY-SA 2.0 | O | 샤프츠베리 애비뉴 극장가 | r43 |
| big-ben | Big_Ben | Elizabeth_Tower_and_the_north_front_…jpg | Christian David | CC BY-SA 4.0 | O | 엘리자베스 타워 (세로, `pos center 20%`) | r46 |
| buckingham | Buckingham_Palace | Buckingham_Palace_London_Morning_2020_01_(cropped).jpg | Julian Herzog | CC BY 4.0 | O | 궁전 정면 | r48 |
| sky-garden | 20_Fenchurch_Street | The_Sky_Garden.jpg | Colin → **© User:Colin / Wikimedia Commons** | CC BY-SA 4.0 | O (수정) | 스카이가든 내부 | r51 |
| st-pauls | St_Paul's_Cathedral | St_Pauls_aerial_(cropped).jpg | Mark Fosh | CC BY 2.0 | O | 대성당 항공 시점 | r53 |
| brick-lane | Brick_Lane | Brick_Lane.JPG | ahisgett | CC BY 2.0 | O | 브릭레인 야경 | r54 |
| kensington-palace | Kensington_Palace | Kensington_Palace,_the_South_Front_-_geograph…287402.jpg | Colin Smith | CC BY-SA 2.0 | O | 남쪽 정면 | r56 |
| chinatown | Chinatown,_London | London,_China_Town_--_2016_--_4868.jpg | Dietmar Rabich | CC BY-SA 4.0 | O | 차이나타운 패루 | r57 |
| regent-street | Regent_Street | Regent_Street_2011-04-25.jpg | aurélien. | CC BY-SA 2.0 | O | 리전트 스트리트 | r59 |
| heathrow | Heathrow_Airport | Heathrow_Airport_010.jpg | Panhard | CC BY 2.5 | O | 공항 항공 시점 | r63, r65 |

- 저작자 지정 표기(`Attribution` 필드)가 있는 파일: national-gallery(Diego Delso), kensington-palace(Colin Smith), chinatown(Dietmar Rabich) → 기록과 동일. sky-garden만 `© User:Colin / Wikimedia Commons`를 요구해 places.js·CREDITS.md를 그 값으로 보정. richmond-park의 Attribution은 "제목 by Stefan Czapski" 형식이라 저작자명 표기로 충분.
- buckingham의 API Artist는 "Julian Herzog (Website)" — 링크 텍스트 잔여물 정리로 타당.
- 파일 크기 = places.js `w×h` 23개 모두 일치(JPEG 헤더 직접 파싱). 총 4,237,043 B(4.04 MiB) ≤ 5MB. 장당 최대 253 KB.
- 매핑 26행 모두 data.js에 존재, 행 제목과 장소 일치(r57 '켄싱턴궁전→차이나타운 이동 및 자유시간'은 활동성 행으로 spec 표대로 매핑).

### 캡션 · CREDITS
- 펼친 카드·크게 보기 dialog 모두 `사진: {저작자} · {라이선스 링크} · 출처 ↗(Commons 파일 페이지)` 표시. `rel="noopener noreferrer"`, 새 탭. CC BY/BY-SA 표기 요건(저작자·라이선스·출처) 충족.
- CREDITS.md 23행과 places.js 값(저작자·라이선스·URL·크기·행) 일치.

### 한국 시각
- `TripTime.now = 2026-10-18T14:59:30Z` → 헤더 `런던 15:59 BST · 한국 23:59 (+8h)`; `2026-10-26T12:00:00Z` → `런던 12:00 GMT+0 · 한국 21:00 (+9h)`(시차는 두 format 결과 차로 계산, 하드코딩 없음).
- 기기 TZ(Asia/Seoul) 브라우저에서 위 값이 런던 기준으로 정확 → 모든 계산이 `T.format/toEpoch`에 tz를 명시하므로 기기 TZ 무관(코드 확인).
- 카드: r32 `🇰🇷 01:50–04:30 +1일`, r21 `06:00–07:00 +1일`, r36 `17:00–22:00`(당일), r02 `한국 08:45 출발 · 도착 시 한국 01:20 +1일`, r66 `런던 10:20`(10/23 BST 역변환). 65행 모두 시간 있음 → 65개 보조 줄.
- 다가오는 알림 목록 `10/21 08:20 (한국 16:20)`. 토스트 본문 불변.
- 설정 스위치 2종: 끄면 보조 줄 0·사진 0·🖼 배지 0, 펼친 카드엔 `사진 표시 꺼짐 · 이미지 검색 ↗`만(이미지 요청 0). `london-trip:showKst/showImg` '0'/'1' 저장, 다시 켜면 복원.

### 회귀 · 브라우저
- **새 탭**에서 앱·블로그 메인 iframe 모두 콘솔 0건 → 이전 `about:srcdoc … TripTime is not defined`는 이전 리뷰 잔재로 확정(앱 원인 아님).
- 일정 8개 탭 합계 65행. data.js·time.js·alarm.js·store.js·sw.js 무변경(git diff) → 금액 불변.
- 알림: r46 bell 켬 → `alarmAt+20s` tick → 토스트 "08:50 빅벤 & 국회의사당 관람 · 30분 후 시작". 자동 이동: `2026-10-21T11:00Z` → Day 6 · r50 선택. 정상.
- 사진: 펼치기 전 이미지 요청 0, 펼칠 때 로컬 `img/*.jpg` 1건. 26개 카드 전부 펼쳐 로드 실패 0, **외부 요청 0**. 크게 보기 dialog: 열면 닫기 버튼 포커스, Esc로 닫힘·확대 버튼으로 포커스 복귀, 카드 유지.
- 375×812 다크모드, 360×780: `scrollWidth = innerWidth`(가로 스크롤 없음), 360px에서 헤더 한국 시각이 둘째 줄로 줄바꿈. 뷰포트·테마 복원.
- 테스트 후 `london-trip:` 키 삭제, `theme`·`2048-*` 유지.

### 수정 내역 (Review)
1. `places.js`, `img/CREDITS.md`: sky-garden 저작자를 Commons Attribution 지정값 `© User:Colin / Wikimedia Commons`로 보정(CREDITS 하단에 근거 1줄 추가).
2. `app.js`: 헤더 한국 시각 텍스트 앞에 공백 추가(`' · 한국 '`) — textContent/스크린리더에서 `BST· 한국`이 붙어 읽히던 문제. 화면 표시는 동일(플렉스 항목 앞 공백은 접힘).

### 남은 위험(경미)
- piccadilly 사진은 Commons `Restrictions=trademarked`(광고판 상표 노출). 저작권 라이선스와 별개의 상표 고지로, 비상업 여행 앱 장면 사진 용도에서는 문제 없음.
- 헤더 GMT 표기는 기존 time.js 형식 `GMT+0`을 그대로 씀(spec 예시는 BST만 명시) — 기존 동작, 변경 안 함.

## v5 사진 기본 펼침 + 일자 스와이프 리뷰

**판정: 통과 (Review 수정 2건 반영)** — 기준: spec 16장 + 16.x 사용자 확정(D1~D6 기본안). 검증: 새 탭 `http://localhost:8000/apps/london-trip/?v=rv5b`, 375×812 다크모드 · 360×780, 합성 `PointerEvent`(pointerType `touch`) 디스패치.

### 코드 리뷰 — 실제 모바일 동작 구조
- `touch-action: pan-y`면 가로 이동은 브라우저가 패닝하지 않으므로 pointercancel 없이 pointermove/up이 이어진다(Chrome Android·iOS Safari 13+ 모두 Pointer Events·`pan-y` 지원). 세로 이동은 브라우저가 스크롤하며 pointercancel → 앱도 이미 세로로 판정해 `sw=null`이므로 충돌 없음. TouchEvent 경로 보강은 불필요하다고 판단.
- **문제(수정)**: Build 선언 `touch-action: pan-y pinch-zoom` 한 줄만 있었음. Safari(iOS 포함)는 `pinch-zoom` 값을 지원하지 않아 선언 전체가 무효 → `auto`로 떨어져 가로 제스처 중 pointercancel이 날 수 있음. `touch-action: pan-y; touch-action: pan-y pinch-zoom;` 폴백 순서로 수정(Chrome은 핀치 허용, Safari는 `pan-y` 적용 — iOS에서 패널 위 핀치 확대는 막히지만 spec 16.2 원안이 `pan-y`).
- `setPointerCapture` 미사용: 터치 포인터는 대상 요소에 암묵 캡처되므로 손가락이 패널 밖으로 나가도 move가 이어짐. pointerup/cancel은 window에서 받아 정리 → 문제 없음.
- **문제(수정)**: `swPointers` 카운터가 up/cancel 유실(앱 전환 등) 시 1로 굳으면 이후 모든 스와이프가 "두 번째 손가락"으로 판정돼 영구 무시됨. `pointerdown`에서 `e.isPrimary`(화면에 다른 터치 없음)면 0으로 재설정하도록 1줄 추가.
- 리스너 passive, `preventDefault` 미사용, 리스너는 `bindSwipe()`에서 1회 등록(누수 없음). 타이머는 애니메이션 단발 `setTimeout`만.
- 클릭 억제: 수평 잠금된 제스처의 up 뒤 400ms 내 첫 click 1회만 먹고, 기한 지나면 첫 click에서 해제만 함 → 정상 탭(10px 미만)은 잠금이 없어 억제 대상 아님.

### Build가 spec과 다르다고 한 점 — 타당성
- 스와이프 영역이 일정 패널 전체(요약 포함, 알림 패널·설정 제외): 요약 위 스와이프도 자연스럽고, 자체 상호작용 영역은 `SWIPE_IGNORE`로 제외 → 타당. 날짜 탭 줄은 패널 밖 sticky 헤더라 원래 대상 아님.
- 넘긴 뒤 일정 화면 맨 위(요약부터): D6 "새 날짜 맨 위"와 부합, 요약이 그 날 개요라 타당.
- 미확정 가로 제스처 뒤에도 클릭 1회 억제: 손을 뗀 위치의 버튼이 잘못 눌리는 것을 막음. 400ms 기한이라 부작용 작음 → 타당.
- localStorage 불가 시 안내 미표시: 매 진입마다 토스트가 뜨는 것보다 낫다 → 타당.

### 브라우저 검증 (합성 PointerEvent)
| 시나리오 | 결과 |
|---|---|
| dx=-120 / dx=+120 | 다음 날 / 이전 날 |
| Day 1에서 오른쪽, Day 8에서 왼쪽 | 이동 없음(순환 없음) |
| dx=40·dy=120(세로 우세) | 불변 |
| dx=-40 빠르게(2스텝) | 속도 조건으로 확정 |
| 시작 x=10(가장자리 20px) | 불변 |
| 두 포인터 동시 / 수평 잠금 후 두 번째 손가락 | 불변, transform 잔재 없음, 이후 단일 스와이프 정상 |
| `pointerType: mouse` | 무시(D3) |
| 수평 잠금 후 pointercancel | 불변, transform·`is-swiping` 원복 |
| 메모 textarea·알림 패널·설정 위 | 무시 |
| dx=8 탭 후 펼치기 클릭 | 펼쳐짐, 날짜 불변 |
| 미확정 가로 제스처 직후 체크박스 click | 1회 억제, 다음 click 정상 / 450ms 뒤 click 정상 |
| reduced-motion(matchMedia 대체) | 따라오기 transform 없음, 즉시 전환 |
| scrollY 2000에서 스와이프 | 패널 top = sticky 높이+8(125px)로 이동 |
| 따라오는 중 | `translateX(-96px)`, `scrollWidth = innerWidth`(가로 스크롤 없음) |
| 안내 토스트 | 첫 진입 1회 `← 좌우로 밀어 날짜 이동 →`, `london-trip:swipeHint='1'`, 재진입 시 미표시 |
- 날짜 전환 뒤 `#timeline`·`#daySummary` inline transform/opacity 빈 값, 패널 class `panel`만 → 잔재 없음. 날짜 탭 aria-selected 동기화(`selectDay` 재사용).

### 사진 (16.1)
- Day 6: 접힌 카드 5장에 사진 상시 표시, `width/height`·`loading=lazy`·`aspect-ratio 16/9` → 로드 전후 높이 고정. 캡션 `사진: … · CC BY-SA 4.0 · 출처 ↗` 유지. 펼쳐도 `.place-media` 1개(중복 없음). 🖼 배지 0. 크게 보기 dialog 열림/닫힘 정상.
- 토글 끔 → 사진·검색 링크 0, 켬 → 복원. 완료 체크 시 사진 opacity .55(카드 본문과 동일).

### 회귀
- 8개 탭 합계 65행, 여행 전체 금액 문구 동일, data.js·time.js·alarm.js·store.js·places.js·sw.js 무변경.
- 자동 이동: `2026-10-21T11:00Z` → Day 6 · r50 is-now. 한국 시각 보조 줄 표시.
- 알림: r46 bell 켬 + `07:20:20Z` → 토스트 "08:50 빅벤 & 국회의사당 관람 · 30분 후 시작".
- 375/360px `scrollWidth = innerWidth`, 콘솔 에러 0, 외부 요청 0. 블로그 메인 iframe(360px) 로드·가로 스크롤 없음·콘솔 0.
- 테스트 후 `london-trip:` 키 삭제, `theme`·`2048-*` 유지. 뷰포트·테마 복원.

### 수정 내역 (Review)
1. `style.css`: `#panel-schedule { touch-action: pan-y; touch-action: pan-y pinch-zoom; }` — Safari 폴백.
2. `app.js` `onSwipeDown`: `if (e.isPrimary) swPointers = 0;` — 포인터 카운터 고착 방지.

### 남은 위험
- 실기기(iOS Safari·Android Chrome) 터치 미확인 — 합성 이벤트는 브라우저의 touch-action/pointercancel 판단을 재현하지 못함. 코드상 구조는 표준 패턴.
- iOS에서는 일정 패널 위 핀치 확대가 막힘(`pan-y`만 적용). 패널 밖·다른 탭은 그대로.
- 가로/세로 비율 1~1.5 사이 대각선 제스처는 앱도 브라우저도 처리하지 않는 무반응 구간(의도된 보수적 판정).
- 미확정 가로 제스처 직후 400ms 안의 다른 탭 1회는 억제됨(설계상).
