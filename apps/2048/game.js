// 2048 순수 게임 로직. DOM·전역 객체·저장소에 접근하지 않는다.

export const SIZE = 4;
export const WIN_VALUE = 2048;
const DIRECTIONS = ['up', 'down', 'left', 'right'];
const MAX_VALUE = 2 ** 30;

function emptyState() {
  return {
    size: SIZE,
    tiles: [],
    score: 0,
    won: false,
    keepPlaying: false,
    over: false,
    nextId: 1
  };
}

// 타일 목록 → (Tile|null)[4][4]
export function toGrid(state) {
  const grid = [];
  for (let r = 0; r < state.size; r++) {
    grid.push(new Array(state.size).fill(null));
  }
  for (const tile of state.tiles) {
    grid[tile.row][tile.col] = tile;
  }
  return grid;
}

export function createGame(rng = Math.random) {
  let state = emptyState();
  state = addRandomTile(state, rng);
  state = addRandomTile(state, rng);
  return state;
}

// 한 줄을 왼쪽으로 밀고 합친다
export function slideLine(values) {
  const nums = values.filter((v) => v !== 0);
  const line = [];
  let gained = 0;
  let i = 0;
  while (i < nums.length) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      const merged = nums[i] * 2;
      line.push(merged);
      gained += merged;
      i += 2; // 합쳐진 타일은 다시 합치지 않는다
    } else {
      line.push(nums[i]);
      i += 1;
    }
  }
  while (line.length < values.length) {
    line.push(0);
  }
  return { line, gained };
}

// 이동 방향 쪽 끝이 인덱스 0이 되도록 i번째 줄의 좌표를 만든다
function lineCoords(dir, index, size) {
  const coords = [];
  for (let k = 0; k < size; k++) {
    if (dir === 'left') coords.push([index, k]);
    else if (dir === 'right') coords.push([index, size - 1 - k]);
    else if (dir === 'up') coords.push([k, index]);
    else coords.push([size - 1 - k, index]);
  }
  return coords;
}

export function move(state, dir, rng = Math.random) {
  if (!DIRECTIONS.includes(dir)) {
    return { state, moved: false, gained: 0 };
  }
  const grid = toGrid(state);
  const tiles = [];
  let nextId = state.nextId;
  let gained = 0;
  let moved = false;

  for (let i = 0; i < state.size; i++) {
    const coords = lineCoords(dir, i, state.size);
    const line = coords.map(([r, c]) => grid[r][c]).filter(Boolean);
    let k = 0;
    let out = 0;
    while (k < line.length) {
      const [row, col] = coords[out];
      const a = line[k];
      const b = line[k + 1];
      if (b && a.value === b.value) {
        const value = a.value * 2;
        tiles.push({ id: nextId++, value, row, col, mergedFrom: [a.id, b.id] });
        gained += value;
        moved = true;
        k += 2;
      } else {
        if (a.row !== row || a.col !== col) moved = true;
        tiles.push({ id: a.id, value: a.value, row, col });
        k += 1;
      }
      out += 1;
    }
  }

  if (!moved) {
    return { state, moved: false, gained: 0 };
  }

  let next = { ...state, tiles, score: state.score + gained, nextId };
  next = addRandomTile(next, rng);
  next = { ...next, won: state.won || hasWon(next), over: !canMove(next) };
  return { state: next, moved: true, gained };
}

export function addRandomTile(state, rng = Math.random) {
  const grid = toGrid(state);
  const empty = [];
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      if (!grid[r][c]) empty.push([r, c]);
    }
  }
  if (empty.length === 0) return state;
  const index = Math.min(empty.length - 1, Math.floor(rng() * empty.length));
  const [row, col] = empty[index];
  const value = rng() < 0.9 ? 2 : 4;
  const tile = { id: state.nextId, value, row, col, isNew: true };
  return { ...state, tiles: [...state.tiles, tile], nextId: state.nextId + 1 };
}

export function canMove(state) {
  if (state.tiles.length < state.size * state.size) return true;
  const grid = toGrid(state);
  for (let r = 0; r < state.size; r++) {
    for (let c = 0; c < state.size; c++) {
      const value = grid[r][c].value;
      if (c + 1 < state.size && grid[r][c + 1].value === value) return true;
      if (r + 1 < state.size && grid[r + 1][c].value === value) return true;
    }
  }
  return false;
}

export function hasWon(state) {
  return state.tiles.some((tile) => tile.value >= WIN_VALUE);
}

export function serialize(state) {
  const grid = toGrid(state).map((row) => row.map((tile) => (tile ? tile.value : 0)));
  return {
    size: state.size,
    grid,
    score: state.score,
    won: state.won,
    keepPlaying: state.keepPlaying,
    over: state.over
  };
}

function isTileValue(v) {
  return Number.isInteger(v) && v >= 2 && v <= MAX_VALUE && (v & (v - 1)) === 0;
}

function readFlag(v) {
  if (v === undefined) return false;
  return typeof v === 'boolean' ? v : null;
}

// 저장값 검증 후 State로 복원. 형식이 맞지 않으면 null
export function deserialize(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (obj.size !== SIZE) return null;
  const { grid } = obj;
  if (!Array.isArray(grid) || grid.length !== SIZE) return null;
  if (!Number.isSafeInteger(obj.score) || obj.score < 0) return null;
  const won = readFlag(obj.won);
  const keepPlaying = readFlag(obj.keepPlaying);
  if (won === null || keepPlaying === null || readFlag(obj.over) === null) return null;

  const state = emptyState();
  for (let r = 0; r < SIZE; r++) {
    const row = grid[r];
    if (!Array.isArray(row) || row.length !== SIZE) return null;
    for (let c = 0; c < SIZE; c++) {
      const v = row[c];
      if (v === 0) continue;
      if (!isTileValue(v)) return null;
      state.tiles.push({ id: state.nextId++, value: v, row: r, col: c });
    }
  }
  if (state.tiles.length === 0) return null;

  state.score = obj.score;
  state.won = won || hasWon(state);
  state.keepPlaying = keepPlaying;
  // over는 저장값 대신 보드에서 다시 계산한다
  state.over = !canMove(state);
  return state;
}
