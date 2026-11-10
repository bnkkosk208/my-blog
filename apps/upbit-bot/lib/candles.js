// 캔들 정렬·마감 판정·시각 계산 (DOM 없는 순수 모듈)

const MIN = 60 * 1000;
export const DAY_MS = 24 * 60 * MIN;
export const KST_OFFSET_MS = 9 * 60 * MIN;

export const CANDLE_UNITS = {
  'minutes/1': { ms: MIN, label: '1분' },
  'minutes/15': { ms: 15 * MIN, label: '15분' },
  'minutes/60': { ms: 60 * MIN, label: '60분' },
  'minutes/240': { ms: 240 * MIN, label: '240분' },
  days: { ms: DAY_MS, label: '일' }
};

export function unitMs(unit) {
  const u = CANDLE_UNITS[unit];
  if (!u) throw new Error(`알 수 없는 캔들 단위: ${unit}`);
  return u.ms;
}

function toMs(utcText) {
  // 업비트 candle_date_time_utc는 'YYYY-MM-DDTHH:mm:ss' (시간대 표기 없음)
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(utcText) ? utcText : `${utcText}Z`);
}

// 업비트 응답(최신순) → [{t,o,h,l,c,v}] 과거→최신
export function normalizeCandles(raw) {
  const list = (raw || []).map((x) => {
    if (typeof x.t === 'number') return { t: x.t, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v ?? 0 };
    return {
      t: toMs(x.candle_date_time_utc),
      o: x.opening_price,
      h: x.high_price,
      l: x.low_price,
      c: x.trade_price,
      v: x.candle_acc_trade_volume ?? 0
    };
  });
  list.sort((a, b) => a.t - b.t);
  return list;
}

// 시작 + 캔들 길이 > now 이면 미마감
export function isClosed(candle, unit, now) {
  return candle.t + unitMs(unit) <= now;
}

export function closedOnly(candles, unit, now) {
  return candles.filter((c) => isClosed(c, unit, now));
}

// 현재 형성 중인 캔들의 마감 시각 (일봉·240분봉 모두 UTC 00:00 = KST 09:00 기준 정렬)
export function nextCloseTime(now, unit) {
  const ms = unitMs(unit);
  return Math.floor(now / ms) * ms + ms;
}

// 업비트 일봉 시작(KST 09:00 = UTC 00:00)
export function dayStartUtc(now) {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

// KST 날짜 문자열 YYYY-MM-DD (자정 기준)
export function kstDateKey(now) {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// KST 시각 표시
export function formatKst(ms, style = 'time') {
  const d = new Date(ms + KST_OFFSET_MS);
  const date = `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (style === 'date') return date;
  if (style === 'hm') return hm;
  if (style === 'datetime') return `${date} ${hm}`;
  if (style === 'full') return `${d.getUTCFullYear()}-${date.replace('/', '-')} ${hm}:${pad(d.getUTCSeconds())}`;
  return `${hm}:${pad(d.getUTCSeconds())}`;
}
