// localStorage 래퍼: 모든 접근 try/catch, 실패하면 메모리로 동작
// Node에서 import해도 즉시 에러가 나지 않도록 전역 객체는 함수 안에서만 접근한다
export const PREFIX = 'upbit-bot:v1:';
export const TOKEN_KEY = 'upbit-bot:token';

function probe(kind) {
  try {
    const s = globalThis[kind];
    if (!s) return null;
    const k = '__upbit_bot_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch (e) {
    return null;
  }
}

export function createStore({ storage, prefix = PREFIX } = {}) {
  const backend = storage === undefined ? probe('localStorage') : storage;
  const mem = new Map();
  const api = {
    available: !!backend,
    get(key, fallback = null) {
      let raw = null;
      try {
        raw = backend ? backend.getItem(prefix + key) : null;
      } catch (e) {
        raw = null;
      }
      if (raw == null && mem.has(key)) raw = mem.get(key);
      if (raw == null) return fallback;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      mem.set(key, raw);
      if (!backend) return false;
      try {
        backend.setItem(prefix + key, raw);
        return true;
      } catch (e) {
        api.available = false;
        return false;
      }
    },
    remove(key) {
      mem.delete(key);
      try {
        if (backend) backend.removeItem(prefix + key);
      } catch (e) {
        // 무시
      }
    },
    clearAll() {
      mem.clear();
      if (!backend) return;
      try {
        const keys = [];
        for (let i = 0; i < backend.length; i++) {
          const k = backend.key(i);
          if (k && k.startsWith(prefix)) keys.push(k);
        }
        keys.forEach((k) => backend.removeItem(k));
      } catch (e) {
        // 무시
      }
    },
    // 블로그 공통 키(theme 등) 접두사 없이 읽기/쓰기
    getRaw(name) {
      try {
        return backend ? backend.getItem(name) : null;
      } catch (e) {
        return null;
      }
    },
    setRaw(name, value) {
      try {
        if (backend) backend.setItem(name, value);
      } catch (e) {
        // 무시
      }
    }
  };
  return api;
}

// 로컬 서버 토큰은 sessionStorage에만 (탭을 닫으면 사라짐)
let memToken = '';
export const tokenStore = {
  get() {
    const s = probe('sessionStorage');
    try {
      return (s && s.getItem(TOKEN_KEY)) || memToken;
    } catch (e) {
      return memToken;
    }
  },
  set(token) {
    memToken = token;
    const s = probe('sessionStorage');
    try {
      if (s) s.setItem(TOKEN_KEY, token);
    } catch (e) {
      // 메모리에만 보관
    }
  },
  clear() {
    memToken = '';
    const s = probe('sessionStorage');
    try {
      if (s) s.removeItem(TOKEN_KEY);
    } catch (e) {
      // 무시
    }
  }
};
