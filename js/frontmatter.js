// 글 상단의 front matter(--- 로 감싼 key: value 블록)를 읽는다.

const FRONT_MATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function unquote(value) {
  const m = value.match(/^(['"])(.*)\1$/);
  return m ? m[2] : value;
}

function parseValue(raw) {
  const value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter(Boolean);
  }
  return unquote(value);
}

export function parseFrontMatter(text) {
  const match = text.match(FRONT_MATTER_RE);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (m) meta[m[1]] = parseValue(m[2]);
  }
  return { meta, body: text.slice(match[0].length) };
}
