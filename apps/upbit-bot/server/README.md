# 업비트 자동매매 봇 — 실거래용 로컬 서버

블로그(GitHub Pages)에서는 **모의투자만** 동작합니다. 실거래는 내 PC에서 이 서버를 실행하고,
서버가 열어 주는 주소(`http://127.0.0.1:8787/`)에서 앱을 열어야 쓸 수 있습니다.

> **투자 위험 고지** — 이 앱은 학습·실험용 도구이며 투자 권유가 아닙니다. 가상자산은 원금 전액을 잃을 수 있고,
> 전략과 백테스트는 미래 수익을 보장하지 않습니다. 실거래에서 생기는 모든 주문과 손실의 책임은 사용자에게 있습니다.
> 이 앱은 업비트(두나무)와 관련 없는 비공식 도구입니다.

## 왜 로컬 서버인가
- 업비트 주문(Exchange) API는 브라우저에서 직접 호출할 수 없습니다(CORS 미지원).
- API 키마다 허용 IP를 등록해야 하므로 내 PC(공인 IP)에서 호출해야 합니다.
- 키를 공개 페이지·브라우저 저장소에 두면 유출됩니다. 키는 이 폴더의 `.env`에만 둡니다(`.gitignore`로 커밋 제외).

## 준비물
- Node.js **18 이상** (`node -v`로 확인). `npm install`은 필요 없습니다(외부 의존성 0개).

## 1. 업비트 API 키 발급
1. 업비트 웹 → 마이페이지 → Open API 관리에서 키를 발급합니다.
2. 권한은 **자산조회 · 주문조회 · 주문하기**만 체크합니다. **출금 권한은 절대 체크하지 마세요.**
3. 허용 IP에 내 PC의 공인 IP를 등록합니다(검색창에 "내 IP 확인"). 공유기·통신사에 따라 IP가 바뀌면 다시 등록해야 합니다.

## 2. 설정과 실행
```bash
cd apps/upbit-bot/server
cp .env.example .env      # Windows: copy .env.example .env
# .env를 열어 UPBIT_ACCESS_KEY, UPBIT_SECRET_KEY 입력
node server.js            # 또는 npm start
```
콘솔에 나온 주소(`http://127.0.0.1:8787/`)를 브라우저로 열고, 같이 출력된 **로컬 토큰**을 실거래 진입 화면에 입력합니다.
토큰은 `.env`의 `LOCAL_TOKEN`을 비워 두면 실행할 때마다 새로 만들어집니다.

## 3. 처음에는 DRY_RUN으로
`.env`의 `DRY_RUN=true`(기본값)이면 주문(POST)·취소(DELETE)를 업비트로 **보내지 않고**, 서명된 요청 내용만 돌려줍니다.
잔고·주문 조회(GET)는 실제로 호출하므로 키와 IP 설정이 맞는지 확인할 수 있습니다.
화면의 서버 칩이 `서버 연결됨(DRY-RUN)`으로 보이고 로그에 `[DRY-RUN]`이 붙습니다.
충분히 확인한 뒤에만 `DRY_RUN=false`로 바꾸고 서버를 다시 시작하세요.

## 설정값 (.env)
| 키 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 8787 | 서버 포트(127.0.0.1에만 열림) |
| `DRY_RUN` | true | false일 때만 실제 주문 |
| `MAX_ORDER_KRW` | 50000 | 서버가 막는 1회 최대 매수 금액 |
| `DAILY_MAX_ORDERS` | 20 | 서버가 막는 일일 주문 횟수(KST 자정 초기화, 서버 재시작 시 초기화) |
| `ALLOWED_MARKETS` | KRW-BTC,KRW-ETH | 주문 가능한 마켓(쉼표 구분) |
| `LOCAL_TOKEN` | (비움) | 브라우저 인증용 토큰. 비우면 실행마다 무작위 생성 |
| `ALLOW_PAGES_ORIGIN` | false | true면 블로그(GitHub Pages) 출처의 요청도 허용. 브라우저마다 막힐 수 있어 권장하지 않음 |

## 보안 동작
- `127.0.0.1`에만 바인딩, `Host` 헤더가 `127.0.0.1:포트`/`localhost:포트`가 아니면 403.
- 다른 사이트 `Origin`이 붙은 요청은 403. `/api/*`는 로컬 토큰(`X-Local-Token`) 필요, 5회 연속 실패 시 1분 잠금.
- 시장가 매수(`ord_type=price`)·시장가 매도(`ord_type=market`)만 받습니다. 지정가는 거부합니다.
- 허용 마켓·1회 한도·일일 횟수·중복 `identifier`를 서버에서 다시 검사합니다.
- `server/` 폴더와 숨김 파일은 정적 서빙하지 않습니다(`.env` 노출 방지). 키 값은 로그·응답에 출력하지 않습니다.

## 서명 확인 (실 키 없이)
```bash
node sign-check.js        # 또는 npm run sign-check
```
고정된 테스트 키로 쿼리 문자열·`query_hash`(SHA-512)·JWT 서명(HMAC-SHA512)을 `openssl` 결과와 비교합니다.

## 엔드포인트
| 경로 | 업비트 호출 | 비고 |
|---|---|---|
| `GET /health` | — | 토큰 불필요. 키 값은 포함하지 않음 |
| `GET /api/session` | — | 토큰 확인용 |
| `GET /api/accounts` | `GET /v1/accounts` | 잔고 |
| `GET /api/chance?market=` | `GET /v1/orders/chance` | 수수료·최소 주문 |
| `POST /api/orders` | `POST /v1/orders` | 시장가 매수/매도만 |
| `GET /api/order?uuid=` | `GET /v1/order` | 단건 조회 |
| `DELETE /api/order?uuid=` | `DELETE /v1/order` | 취소 |
| `GET /api/orders/open?market=` | `GET /v1/orders/open` | 미체결 목록 |

## 확인 필요 사항
업비트 공식 문서(docs.upbit.com)를 직접 확인하지 못한 상태에서 만든 값이 있습니다. 실거래 전에 확인하세요.
- JWT 알고리즘(HS512)과 `query_hash` 문자열 규칙(`upbit-auth.js`)
- 미체결 주문 조회 경로(`server.js`의 `OPEN_ORDERS_PATH`), 시장가 매수 체결 후 주문 `state` 값
- 수수료율·최소 주문금액·호가 단위(`../lib/market-rules.js`)

## 한계
- 봇은 **브라우저 탭 안에서** 돕니다. 탭을 닫거나 PC가 절전되면 멈춥니다.
- 이 서버는 HTTPS·원격 접속·다중 사용자를 지원하지 않습니다.
