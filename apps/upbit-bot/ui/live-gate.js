// 실거래 진입 관문: 로컬 서버 상태 칩, 토큰 확인, 3단계 진입 모달
const CONFIRM_PHRASE = '실거래 시작';

export function isServedLocally(loc = window.location) {
  return loc.protocol === 'http:' && (loc.hostname === '127.0.0.1' || loc.hostname === 'localhost') && !!loc.port;
}

export function isTopWindow() {
  try {
    return window.top === window.self;
  } catch (e) {
    return false;
  }
}

/**
 * /health를 주기적으로 확인한다. 3회 연속 실패하면 onLost 호출
 * state: { reachable, dryRun, keyConfigured, allowPagesOrigin, version, failCount }
 */
export function createServerMonitor({ getBase, onChange, onLost, intervalMs = 10000 }) {
  let timer = null;
  let state = { reachable: false, failCount: 0, checked: false };

  async function check() {
    const base = getBase();
    if (base == null) {
      state = { reachable: false, failCount: 0, checked: true, disabled: true };
      onChange(state);
      return state;
    }
    try {
      const res = await fetch(`${base}/health`, { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined });
      const h = await res.json();
      if (!res.ok || !h.ok) throw new Error('health');
      state = { ...h, reachable: true, failCount: 0, checked: true };
    } catch (e) {
      const failCount = (state.failCount || 0) + 1;
      state = { reachable: false, failCount, checked: true };
      if (failCount === 3) onLost();
    }
    onChange(state);
    return state;
  }

  return {
    get state() { return state; },
    start() {
      if (timer) return;
      check();
      timer = setInterval(check, intervalMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    check
  };
}

export async function verifyToken(base, token) {
  try {
    const res = await fetch(`${base}/api/session`, { headers: { 'X-Local-Token': token }, cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) return { ok: true };
    return { ok: false, message: d.message || '토큰 인증 실패' };
  } catch (e) {
    return { ok: false, message: '로컬 서버에 연결할 수 없습니다' };
  }
}

export function chipText(state, authFailed) {
  if (state.disabled) return { text: '○ 서버 없음', cls: 'off' };
  if (!state.reachable) return { text: state.checked ? '○ 서버 없음' : '○ 서버 확인 중', cls: 'off' };
  if (authFailed) return { text: '⚠ 인증 실패', cls: 'warn' };
  if (!state.keyConfigured) return { text: '⚠ 서버 키 미설정', cls: 'warn' };
  return state.dryRun ? { text: '● 서버 연결됨(DRY-RUN)', cls: 'ok' } : { text: '● 서버 연결됨(실주문)', cls: 'live' };
}

/**
 * 3단계 진입 모달. dialog 안 요소 id: live-step-1..3, live-risk, live-next-1, live-next-2,
 * live-check-*, live-phrase, live-token, live-error, live-confirm, live-cancel
 * @returns {Promise<string|null>} 확인한 토큰 또는 null(취소)
 */
export function openLiveDialog(dialog, { base, savedToken = '' }) {
  const $ = (id) => dialog.querySelector(`#${id}`);
  const steps = [$('live-step-1'), $('live-step-2'), $('live-step-3')];
  const risk = $('live-risk');
  const next1 = $('live-next-1');
  const next2 = $('live-next-2');
  const checks = [...dialog.querySelectorAll('input[type="checkbox"][data-live-check]')];
  const phrase = $('live-phrase');
  const token = $('live-token');
  const error = $('live-error');
  const confirm = $('live-confirm');

  const show = (i) => {
    steps.forEach((s, j) => { s.hidden = j !== i; });
    const focusable = steps[i].querySelector('input, button, [tabindex]');
    if (focusable) focusable.focus();
  };

  next1.disabled = true;
  checks.forEach((c) => { c.checked = false; });
  next2.disabled = true;
  phrase.value = '';
  token.value = savedToken;
  error.textContent = '';
  confirm.disabled = true;
  risk.scrollTop = 0;

  const atEnd = () => risk.scrollTop + risk.clientHeight >= risk.scrollHeight - 4;
  const onScroll = () => { if (atEnd()) next1.disabled = false; };
  const onCheck = () => { next2.disabled = !checks.every((c) => c.checked); };
  const onInput = () => { confirm.disabled = phrase.value.trim() !== CONFIRM_PHRASE || !token.value.trim(); };

  return new Promise((resolve) => {
    const cleanup = (result) => {
      risk.removeEventListener('scroll', onScroll);
      checks.forEach((c) => c.removeEventListener('change', onCheck));
      phrase.removeEventListener('input', onInput);
      token.removeEventListener('input', onInput);
      next1.onclick = next2.onclick = confirm.onclick = $('live-cancel').onclick = null;
      dialog.oncancel = null;
      if (dialog.open) dialog.close();
      resolve(result);
    };
    risk.addEventListener('scroll', onScroll);
    checks.forEach((c) => c.addEventListener('change', onCheck));
    phrase.addEventListener('input', onInput);
    token.addEventListener('input', onInput);
    next1.onclick = () => show(1);
    next2.onclick = () => show(2);
    $('live-cancel').onclick = () => cleanup(null);
    // Esc = 취소
    dialog.oncancel = (e) => {
      e.preventDefault();
      cleanup(null);
    };
    confirm.onclick = async () => {
      confirm.disabled = true;
      error.textContent = '토큰 확인 중…';
      const t = token.value.trim();
      const r = await verifyToken(base, t);
      if (r.ok) cleanup(t);
      else {
        error.textContent = r.message;
        onInput();
      }
    };
    if (!dialog.open) dialog.showModal();
    show(0);
    // 내용이 짧아 스크롤이 없으면 바로 활성화
    requestAnimationFrame(() => { if (atEnd()) next1.disabled = false; });
  });
}
