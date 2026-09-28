import { createGame, move, serialize, deserialize } from './game.js';

const BEST_KEY = '2048-best';
const STATE_KEY = '2048-state';
const THEME_KEY = 'theme';
const SWIPE_MIN = 24;
const SLIDE_MS = 100;

const KEY_DIRS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right'
};

// 한글 입력 상태에서도 WASD가 동작하도록 물리 키 코드도 본다
const CODE_DIRS = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right'
};

const els = {
  board: document.getElementById('board'),
  tiles: document.getElementById('tiles'),
  score: document.getElementById('score'),
  scoreBox: document.getElementById('score-box'),
  best: document.getElementById('best'),
  undoBtn: document.getElementById('undo-btn'),
  newBtn: document.getElementById('new-btn'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  winActions: document.getElementById('win-actions'),
  overActions: document.getElementById('over-actions'),
  continueBtn: document.getElementById('continue-btn'),
  winNewBtn: document.getElementById('win-new-btn'),
  retryBtn: document.getElementById('retry-btn'),
  overUndoBtn: document.getElementById('over-undo-btn'),
  live: document.getElementById('live')
};

let state = null;
let prevState = null;
let best = 0;
let overlayMode = null;
const tileEls = new Map();
const ghosts = new Set();

/* ---------- 저장소 (모두 try/catch) ---------- */

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (e) {
    // 저장 불가 환경에서는 메모리 값만 사용
  }
}

function loadBest() {
  const n = Number.parseInt(readStorage(BEST_KEY), 10);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function loadState() {
  const raw = readStorage(STATE_KEY);
  if (!raw) return null;
  try {
    return deserialize(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function saveState() {
  writeStorage(STATE_KEY, JSON.stringify(serialize(state)));
}

function applyTheme(value) {
  if (value === 'light' || value === 'dark') {
    document.documentElement.setAttribute('data-theme', value);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

/* ---------- 렌더링 ---------- */

function valueClass(value) {
  return value > 2048 ? 'tile-super' : `tile-${value}`;
}

function setPosition(el, tile) {
  el.style.setProperty('--x', String(tile.col));
  el.style.setProperty('--y', String(tile.row));
}

function createTileEl(tile, extraClass) {
  const el = document.createElement('div');
  const len = String(tile.value).length;
  el.className = `tile ${valueClass(tile.value)}`;
  if (len >= 3) el.classList.add(`tile-len-${Math.min(len, 5)}`);
  if (extraClass) el.classList.add(extraClass);
  setPosition(el, tile);
  const inner = document.createElement('div');
  inner.className = 'tile-inner';
  inner.textContent = String(tile.value);
  el.appendChild(inner);
  els.tiles.appendChild(el);
  tileEls.set(tile.id, el);
  return el;
}

function clearGhosts() {
  for (const el of ghosts) el.remove();
  ghosts.clear();
}

// 진행 중인 애니메이션을 끝난 상태로 정리
function snapAnimations() {
  clearGhosts();
  els.tiles.classList.add('snap');
  for (const el of tileEls.values()) {
    el.classList.remove('tile-new', 'tile-merged');
  }
  void els.tiles.offsetWidth; // 리플로우로 스냅 확정
  els.tiles.classList.remove('snap');
}

// 애니메이션 없이 전체를 다시 그림(새 게임·되돌리기·로드)
function renderFull(animateNew) {
  clearGhosts();
  els.tiles.textContent = '';
  tileEls.clear();
  for (const tile of state.tiles) {
    createTileEl(tile, animateNew && tile.isNew ? 'tile-new' : null);
  }
}

// 이동 결과를 기존 DOM 요소를 옮기며 그림
function renderMove() {
  snapAnimations();
  const alive = new Set(state.tiles.map((t) => t.id));

  for (const tile of state.tiles) {
    if (tile.mergedFrom) {
      for (const srcId of tile.mergedFrom) {
        const src = tileEls.get(srcId);
        if (!src) continue;
        tileEls.delete(srcId);
        src.classList.add('tile-ghost');
        setPosition(src, tile);
        ghosts.add(src);
        window.setTimeout(() => {
          if (ghosts.delete(src)) src.remove();
        }, SLIDE_MS + 20);
      }
      createTileEl(tile, 'tile-merged');
    } else if (tileEls.has(tile.id)) {
      setPosition(tileEls.get(tile.id), tile);
    } else {
      createTileEl(tile, tile.isNew ? 'tile-new' : null);
    }
  }

  // 남은 요소 정리(정상이라면 없음)
  for (const [id, el] of tileEls) {
    if (!alive.has(id)) {
      el.remove();
      tileEls.delete(id);
    }
  }
}

function renderScore(gained) {
  els.score.textContent = String(state.score);
  els.best.textContent = String(best);
  if (gained > 0) {
    const add = document.createElement('span');
    add.className = 'score-add';
    add.setAttribute('aria-hidden', 'true');
    add.textContent = `+${gained}`;
    const remove = () => add.remove();
    add.addEventListener('animationend', remove);
    window.setTimeout(remove, 700);
    els.scoreBox.appendChild(add);
  }
}

function renderUndo() {
  const disabled = prevState === null;
  els.undoBtn.disabled = disabled;
  els.overUndoBtn.hidden = disabled;
}

function updateOverlay(moveFocus = true) {
  let mode = null;
  if (state.won && !state.keepPlaying) mode = 'win';
  else if (state.over) mode = 'over';

  if (mode === overlayMode) {
    if (mode === 'over') els.overlayText.textContent = `최종 점수 ${state.score}`;
    return;
  }
  overlayMode = mode;

  if (!mode) {
    const hadFocus = els.overlay.contains(document.activeElement);
    els.overlay.hidden = true;
    if (hadFocus && moveFocus) els.board.focus({ preventScroll: true });
    return;
  }

  els.overlay.hidden = false;
  els.winActions.hidden = mode !== 'win';
  els.overActions.hidden = mode !== 'over';
  if (mode === 'win') {
    els.overlayTitle.textContent = '2048 달성!';
    els.overlayText.textContent = '계속 플레이하거나 새 게임을 시작하세요.';
    if (moveFocus) els.continueBtn.focus({ preventScroll: true });
    announce(`2048 달성! 점수 ${state.score}. 계속하기 또는 새 게임을 선택하세요.`);
  } else {
    els.overlayTitle.textContent = '게임 오버';
    els.overlayText.textContent = `최종 점수 ${state.score}`;
    if (moveFocus) els.retryBtn.focus({ preventScroll: true });
    announce(`게임 오버. 최종 점수 ${state.score}.`);
  }
}

function announce(message) {
  els.live.textContent = message;
}

function updateBest() {
  if (state.score > best) {
    best = state.score;
    writeStorage(BEST_KEY, String(best));
  }
}

/* ---------- 게임 동작 ---------- */

function handleMove(dir) {
  if (overlayMode) return;
  const result = move(state, dir);
  if (!result.moved) return;
  prevState = state;
  state = result.state;
  updateBest();
  renderMove();
  renderScore(result.gained);
  renderUndo();
  saveState();
  if (result.gained > 0) announce(`점수 ${state.score}, 이동 +${result.gained}`);
  updateOverlay();
}

function newGame() {
  state = createGame();
  prevState = null;
  renderFull(true);
  renderScore(0);
  renderUndo();
  saveState();
  updateOverlay();
  announce('새 게임을 시작했습니다. 점수 0');
}

function undo() {
  if (!prevState) return;
  // 버튼이 비활성·숨김 처리되기 전에 포커스 위치를 기억한다
  const hadUndoFocus = document.activeElement === els.undoBtn
    || els.overlay.contains(document.activeElement);
  // 계속하기를 이미 선택했다면 승리 오버레이가 다시 뜨지 않게 유지
  state = { ...prevState, keepPlaying: prevState.keepPlaying || state.keepPlaying };
  prevState = null;
  renderFull(false);
  renderScore(0);
  renderUndo();
  saveState();
  updateOverlay();
  announce(`이동을 되돌렸습니다. 점수 ${state.score}`);
  // 비활성화된 버튼에서 포커스가 빠지지 않게 보드로 옮긴다
  if (hadUndoFocus && !overlayMode) els.board.focus({ preventScroll: true });
}

function continuePlaying() {
  state = { ...state, keepPlaying: true };
  if (prevState) prevState = { ...prevState, keepPlaying: true };
  saveState();
  updateOverlay();
  if (!overlayMode) els.board.focus({ preventScroll: true });
}

/* ---------- 입력 ---------- */

function onKeyDown(event) {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (overlayMode) return;
  const key = event.key && event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const dir = KEY_DIRS[key] || CODE_DIRS[event.code];
  if (!dir) return;
  event.preventDefault();
  handleMove(dir);
}

// 오버레이가 열려 있는 동안 Tab 포커스를 오버레이 버튼 안에서만 순환
function onOverlayKeyDown(event) {
  if (!overlayMode || event.key !== 'Tab') return;
  const buttons = Array.from(els.overlay.querySelectorAll('button'))
    .filter((btn) => !btn.disabled && btn.offsetParent !== null);
  if (buttons.length === 0) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  const index = buttons.indexOf(document.activeElement);
  if (event.shiftKey && (index <= 0)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (index === -1 || index === buttons.length - 1)) {
    event.preventDefault();
    first.focus();
  }
}

let swipe = null;

function onPointerDown(event) {
  if (overlayMode || els.overlay.contains(event.target)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  els.board.focus({ preventScroll: true });
  swipe = { id: event.pointerId, x: event.clientX, y: event.clientY };
  try {
    els.board.setPointerCapture(event.pointerId);
  } catch (e) {
    // 캡처 불가 시 무시
  }
}

function onPointerUp(event) {
  if (!swipe || event.pointerId !== swipe.id) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  swipe = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
  if (Math.abs(dx) > Math.abs(dy)) handleMove(dx > 0 ? 'right' : 'left');
  else handleMove(dy > 0 ? 'down' : 'up');
}

function onPointerCancel() {
  swipe = null;
}

/* ---------- 시작 ---------- */

function init() {
  best = loadBest();
  const saved = loadState();
  state = saved || createGame();
  prevState = null;
  // 저장된 점수로 최고 점수를 올리지 않는다(실제 이동으로만 갱신)
  renderFull(true);
  renderScore(0);
  renderUndo();
  saveState();
  updateOverlay(false);

  // 리스너는 init에서 한 번만 등록한다
  document.addEventListener('keydown', onOverlayKeyDown);
  document.addEventListener('keydown', onKeyDown);
  els.board.addEventListener('pointerdown', onPointerDown);
  els.board.addEventListener('pointerup', onPointerUp);
  els.board.addEventListener('pointercancel', onPointerCancel);
  // 구형 iOS에서 보드 위 스크롤 방지
  els.board.addEventListener('touchmove', (event) => {
    if (!els.overlay.contains(event.target)) event.preventDefault();
  }, { passive: false });

  els.newBtn.addEventListener('click', newGame);
  els.winNewBtn.addEventListener('click', newGame);
  els.retryBtn.addEventListener('click', newGame);
  els.undoBtn.addEventListener('click', undo);
  els.overUndoBtn.addEventListener('click', undo);
  els.continueBtn.addEventListener('click', continuePlaying);

  // 블로그에서 테마를 바꾸면 따라간다
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY) applyTheme(event.newValue);
  });
}

init();
