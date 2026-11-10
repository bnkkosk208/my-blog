// .env 파서 (dotenv 미사용). KEY=VALUE, # 주석, 따옴표 제거
import fs from 'node:fs';

export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    const key = s.slice(0, i).trim();
    let val = s.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

// 파일 값보다 실제 환경변수를 우선한다
export function loadEnv(file) {
  let fromFile = {};
  try {
    fromFile = parseEnv(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fromFile = {};
  }
  return { ...fromFile, ...process.env };
}
