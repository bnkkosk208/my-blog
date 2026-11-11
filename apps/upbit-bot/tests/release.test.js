// 배포 점검: 브라우저 캐시 때문에 예전 스크립트와 섞이지 않도록 모든 모듈이 같은 버전으로 묶였는지 확인
// 실행: node --test tests/release.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const version = mainSrc.match(/APP_VERSION = '([^']+)'/)[1];

test('importmap이 lib·ui의 모든 모듈을 APP_VERSION으로 묶는다', () => {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(m, 'importmap 없음');
  const { imports } = JSON.parse(m[1]);
  for (const dir of ['lib', 'ui']) {
    for (const f of fs.readdirSync(path.join(root, dir)).filter((x) => x.endsWith('.js'))) {
      const key = `./${dir}/${f}`;
      assert.equal(imports[key], `${key}?v=${version}`, `${key} 버전 누락/불일치`);
    }
  }
});

test('main.js·style.css 링크와 package.json 버전이 APP_VERSION과 같다', () => {
  assert.ok(html.includes(`src="./main.js?v=${version}"`));
  assert.ok(html.includes(`href="./style.css?v=${version}"`));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, version);
});
