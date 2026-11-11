# Build 보강 지침 — 다른 사용자 배포(각자 설치형)

## 배경 (사용자 결정)
앱 소유자가 이 프로그램을 **다른 업비트 계좌 소유자에게 배포**해 쓰게 한다. 방식은 **각자 설치형**:
각 사용자가 자기 PC에서 `server/`를 실행하고 **자기 API 키를 자기 `.env`에만** 넣는다. 배포자는 남의 키·자산을 절대 다루지 않는다. 중앙 서버·회원가입·키 보관 기능은 만들지 않는다.

## 수정 가능한 범위
- `apps/upbit-bot/` 아래 파일(spec.md 제외)만 수정·추가. 그 밖은 수정 금지. 커밋·push 하지 않는다.
- 추가 허용 파일: `apps/upbit-bot/package.json`(`"type":"module"`, 테스트 스크립트, Node 18+ 테스트용), `server/start-windows.bat`, `server/start-mac.command`, `apps/upbit-bot/DISCLAIMER.md`(또는 README 안 섹션).

## 해야 할 일
1. **개인 정보·소유자 종속 제거**: `server/server.js`의 `PAGES_ORIGIN = 'https://bnkkosk208.github.io'` 같은 하드코딩을 `.env`의 `ALLOWED_PAGES_ORIGIN`(기본 빈 값 = 끔)으로 옮긴다. 앱 전체에서 특정 사람의 계정명·이메일·URL·마켓 선호가 박힌 곳이 없게 grep으로 확인한다.
2. **첫 실행 자동 설정**: `.env`가 없으면 `.env.example`을 복사해 만들고 키 입력 안내 후 종료. 로컬 토큰(`LOCAL_TOKEN`)이 비어 있으면 서버가 `crypto.randomBytes`로 생성해 `.env`에 저장하고 콘솔에 한 번만 보여 준다. 키 값은 절대 출력하지 않는다. `.env` 파일 권한을 가능하면 0600으로.
3. **키 권한 점검**: 서버 시작 시(DRY_RUN이 아니고 키가 있을 때) 업비트 `GET /v1/api_keys`(키 목록·만료일 조회, 공식 문서 확인 필요 주석)로 만료일을 확인해 경고. 서버는 **출금·입금 관련 엔드포인트를 절대 구현하지 않으며**, README에 "API 키 발급 시 '자산조회'와 '주문하기'만 체크, 출금 권한 절대 체크 금지, 허용 IP는 본인 PC 공인 IP"를 강조.
4. **사용자별 설정은 모두 `.env`**: PORT, DRY_RUN, 허용 마켓, 1회 최대 금액, 일일 횟수 등. 코드 기본값은 보수적으로(DRY_RUN=true, 1회 50,000원, 일 10회). `.env.example`에 한국어 주석으로 각 항목 설명.
5. **간편 실행 스크립트**: `start-windows.bat`(node 설치 여부 확인 → `node server.js`), `start-mac.command`(실행 권한 안내 포함). Node 미설치 시 nodejs.org LTS 설치 안내 문구.
6. **비개발자용 설치 안내**: `server/README.md`를 처음 쓰는 사람 기준으로 재작성 — ① Node LTS 설치 ② 저장소 ZIP 다운로드 후 `apps/upbit-bot` 폴더만 꺼내기 ③ 업비트 Open API 키 발급(권한·IP) ④ `.env` 작성 ⑤ 실행 → 브라우저에서 `http://127.0.0.1:8787/` ⑥ 처음엔 DRY_RUN으로 충분히 시험 ⑦ 실거래 전환 방법 ⑧ 키 유출 시 즉시 업비트에서 키 삭제 ⑨ 업데이트 방법(`.env`만 보존하고 덮어쓰기) ⑩ 자주 묻는 문제(포트 사용 중, IP 불일치 오류, 시계 오차).
7. **면책/책임 고지**: 각 사용자 본인 계좌·본인 판단·본인 책임, 배포자는 투자 손실·키 관리에 책임지지 않음, 수익 보장 없음, 투자 권유 아님. 실거래 진입 확인창과 README·DISCLAIMER에 표시. 앱 화면 하단에 버전 번호 표시(상수 `APP_VERSION = '1.0.0'`).
8. **데이터 분리**: localStorage 키 prefix 유지, 화면에 "이 브라우저에만 저장됨" 안내. 설정 초기화 버튼이 있으면 그대로 두고, 없으면 추가.
9. **Node 18+ 테스트 지원**: `apps/upbit-bot/package.json` 추가 후 `npm test`(= `node --test tests/lib.test.js`)가 동작하게.

## 확인
- `node --test apps/upbit-bot/tests/lib.test.js` 전부 통과, `node server/sign-check.js` 통과, 모든 JS `node --check`.
- 임시 폴더에 `apps/upbit-bot` 사본을 만들어 `.env` 없이 서버 실행 → `.env` 생성·토큰 생성·키 미노출 확인, 가짜 키+DRY_RUN으로 기동 후 `/health` 200, 토큰 없는 요청 401, `ALLOWED_PAGES_ORIGIN` 미설정 시 Pages 출처 403 확인. 사본은 지운다. 실 키·실주문 금지.
- `grep -rn 'bnkkosk\|bnk.kosk' apps/upbit-bot --exclude=spec.md` 결과 0건.

## 보고
바뀐/추가된 파일과 줄 수, 확인 결과, 못 한 것을 한국어로 반환.
