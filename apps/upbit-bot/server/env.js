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

// .env의 KEY=값 한 줄을 바꾸거나(없으면) 끝에 추가한다
export function setEnvValue(file, key, value) {
  const text = fs.readFileSync(file, 'utf8');
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  const next = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\n?$/, '\n')}${key}=${value}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
}
