// 다크 모드 토글. 초기 테마는 각 HTML <head>의 인라인 스크립트가 먼저 적용한다.

const STORAGE_KEY = 'theme';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

const ICONS = {
  // 현재 라이트 모드일 때 보여줄 아이콘(달) — 누르면 다크로 전환
  moon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>',
  // 현재 다크 모드일 때 보여줄 아이콘(해) — 누르면 라이트로 전환
  sun: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g></svg>',
};

function currentTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark' || forced === 'light') return forced;
  return darkQuery.matches ? 'dark' : 'light';
}

function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 이번 방문에만 적용된다.
  }
}

export function initThemeToggle(button) {
  if (!button) return;

  const render = () => {
    const isDark = currentTheme() === 'dark';
    button.innerHTML = isDark ? ICONS.sun : ICONS.moon;
    button.setAttribute('aria-label', isDark ? '라이트 모드로 전환' : '다크 모드로 전환');
    button.title = button.getAttribute('aria-label');
  };

  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    saveTheme(next);
    render();
  });

  darkQuery.addEventListener('change', render);
  render();
}
