// 봇 보유 수량 장부: 서버가 "봇이 산 수량만 매도"를 강제하기 위해 마켓별 수량을 기록한다
// 수량은 1e-8 단위 정수로 저장해 부동소수 오차를 없앤다. live(실주문)와 dry(DRY-RUN)는 장부를 나눈다
import fs from 'node:fs';
import path from 'node:path';

export const UNIT = 1e8;

export function toUnits(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * UNIT) : 0;
}

export function fromUnits(u) {
  return (u / UNIT).toFixed(8).replace(/\.?0+$/, '') || '0';
}

function empty() {
  return { version: 1, live: {}, dry: {}, pending: {} };
}

export function createLedger(file, { log = () => {} } = {}) {
  let data = empty();
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && raw.version === 1) data = { ...empty(), ...raw };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // 깨진 장부는 보관해 두고 빈 장부로 시작한다(빈 장부 = 매도 불가 쪽으로 안전)
      try { fs.renameSync(file, `${file}.bad-${Date.now()}`); } catch (e2) { /* 무시 */ }
      log('경고: 보유 수량 장부를 읽지 못해 빈 장부로 시작합니다');
    }
  }

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch (e) { /* Windows 등 */ }
  }

  const book = (name) => data[name === 'dry' ? 'dry' : 'live'];

  return {
    file,
    get(name, market) {
      return book(name)[market] || 0;
    },
    add(name, market, units) {
      if (!(units > 0)) return;
      const b = book(name);
      b[market] = (b[market] || 0) + units;
      save();
    },
    sub(name, market, units) {
      const b = book(name);
      const left = units === Infinity ? 0 : Math.max(0, (b[market] || 0) - Math.max(0, units));
      if (left > 0) b[market] = left;
      else delete b[market];
      save();
    },
    // DRY-RUN에서 수량을 추정하지 못했을 때 표시용(-1)
    setUnknown(name, market) {
      book(name)[market] = -1;
      save();
    },
    addPending(uuid, info) {
      data.pending[uuid] = info;
      save();
    },
    hasPending(uuid) {
      return !!data.pending[uuid];
    },
    takePending(uuid) {
      const info = data.pending[uuid];
      if (!info) return null;
      delete data.pending[uuid];
      save();
      return info;
    },
    snapshot() {
      const fmt = (b) => Object.fromEntries(Object.entries(b).map(([m, u]) => [m, u < 0 ? '알 수 없음' : fromUnits(u)]));
      return { live: fmt(data.live), dry: fmt(data.dry), pending: Object.keys(data.pending).length };
    }
  };
}
