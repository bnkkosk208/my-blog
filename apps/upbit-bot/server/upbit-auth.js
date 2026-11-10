// 업비트 JWT(HS512) 인증 — 외부 의존성 없음
// 공식 문서 확인 필요(spec 11장 4번): 알고리즘, query_hash 문자열 인코딩 규칙
import crypto from 'node:crypto';

export function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

// {a:1, b:[x,y]} → 'a=1&b[]=x&b[]=y' (순서 유지, URL 인코딩하지 않음)
export function buildQuery(params = {}) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => parts.push(`${k}[]=${x}`));
    else parts.push(`${k}=${v}`);
  }
  return parts.join('&');
}

export function queryHash(qs) {
  return crypto.createHash('sha512').update(qs, 'utf8').digest('hex');
}

export function makeJwt({ accessKey, secretKey, qs = '', nonce = crypto.randomUUID() }) {
  const header = { alg: 'HS512', typ: 'JWT' };
  const payload = { access_key: accessKey, nonce };
  if (qs) {
    payload.query_hash = queryHash(qs);
    payload.query_hash_alg = 'SHA512';
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac('sha512', secretKey).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

// 서명을 제외한 헤더·페이로드 (DRY-RUN 응답과 검증용)
export function decodeJwtUnsigned(jwt) {
  const [h, p] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
  };
}
