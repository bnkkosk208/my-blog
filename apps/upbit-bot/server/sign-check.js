// 실 키 없이 JWT 서명 규격을 검증한다 (spec 8.4). 실행: node server/sign-check.js
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { buildQuery, queryHash, makeJwt, decodeJwtUnsigned } from './upbit-auth.js';

const accessKey = 'test-access';
const secretKey = 'test-secret';
const nonce = '00000000-0000-0000-0000-000000000000';
const params = { market: 'KRW-BTC', side: 'bid', ord_type: 'price', price: '10000' };

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '통과' : '실패'}  ${name}${detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed += 1;
}

function openssl(args, input) {
  try {
    return execFileSync('openssl', args, { input });
  } catch (e) {
    return null;
  }
}

// 1. 쿼리 문자열
const qs = buildQuery(params);
check('1. 쿼리 문자열', qs === 'market=KRW-BTC&side=bid&ord_type=price&price=10000', qs);

// 2. SHA-512
const hash = queryHash(qs);
const sslHash = openssl(['dgst', '-sha512', '-r'], qs);
if (sslHash) {
  check('2. query_hash = openssl sha512', sslHash.toString().split(' ')[0].trim() === hash, hash.slice(0, 32) + '…');
} else {
  const ref = crypto.createHash('sha512').update(Buffer.from(qs)).digest('hex');
  check('2. query_hash (openssl 없음 — Node crypto로 대조)', ref === hash);
}

// 3. 서명부
const jwt = makeJwt({ accessKey, secretKey, qs, nonce });
const [h, p, sig] = jwt.split('.');
const sslSig = openssl(['dgst', '-sha512', '-hmac', secretKey, '-binary'], `${h}.${p}`);
const expected = sslSig
  ? sslSig.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  : crypto.createHmac('sha512', Buffer.from(secretKey)).update(`${h}.${p}`).digest('base64url');
check(`3. JWT 서명 = ${sslSig ? 'openssl' : 'Node crypto'} HMAC-SHA512`, expected === sig, sig.slice(0, 32) + '…');

// 4. 헤더·페이로드
const { header, payload } = decodeJwtUnsigned(jwt);
check('4. alg=HS512, query_hash_alg=SHA512, access_key=test-access',
  header.alg === 'HS512' && header.typ === 'JWT' && payload.query_hash_alg === 'SHA512' &&
  payload.access_key === accessKey && payload.nonce === nonce && payload.query_hash === hash,
  JSON.stringify({ header, payload: { ...payload, query_hash: payload.query_hash.slice(0, 16) + '…' } }));

// 5. 파라미터 없는 요청
const noParam = decodeJwtUnsigned(makeJwt({ accessKey, secretKey, qs: buildQuery({}), nonce })).payload;
check('5. 파라미터 없는 요청(/v1/accounts)에는 query_hash 없음', !('query_hash' in noParam) && !('query_hash_alg' in noParam));

console.log(failed ? `\n${failed}개 실패` : '\n모두 통과');
process.exit(failed ? 1 : 0);
