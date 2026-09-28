// 마크다운 → HTML 변환기 (외부 라이브러리 없이 직접 구현)
// 모든 텍스트는 이스케이프한 뒤 태그를 붙이므로 원문에 포함된 HTML은 그대로 문자로 보인다.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// ---------- 블록 문법 판별 ----------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^ {0,3}>/;
const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line) => line.trim() === '';
const leadingSpaces = (line) => line.match(/^ */)[0].length;
const isOrderedMarker = (marker) => /\d/.test(marker);

function isTableStart(lines, i) {
  return i + 1 < lines.length && lines[i].includes('|') && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-');
}

function startsBlock(lines, i) {
  const line = lines[i];
  return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) ||
    QUOTE_RE.test(line) || LIST_RE.test(line) || isTableStart(lines, i);
}

// ---------- 인라인 문법 ----------

// javascript:, vbscript:, data: 같은 위험한 URL은 막는다. url은 이미 이스케이프된 문자열이다.
function safeUrl(url) {
  const probe = url.replace(/&amp;/g, '&').replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
  return /^(javascript|vbscript|data):/.test(probe) ? '#' : url;
}

function isExternal(url) {
  return /^https?:\/\//i.test(url);
}

function applyEmphasis(text) {
  return text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?![\w])/g, '$1<strong>$2</strong>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?![\w])/g, '$1<em>$2</em>');
}

export function parseInline(text) {
  const tokens = [];
  // 이미 완성된 HTML 조각은 자리표시자로 빼 두어 이후 변환에서 건드리지 않게 한다.
  const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;

  let s = text
    // 인라인 코드: 내용은 다른 문법을 적용하지 않는다.
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code) => hold(`<code>${escapeHtml(code.trim())}</code>`))
    // 강제 줄바꿈: 줄 끝 공백 2개 이상 또는 역슬래시
    .replace(/(?: {2,}|\\)\n/g, () => hold('<br>'))
    // 역슬래시 이스케이프
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, (_, ch) => hold(escapeHtml(ch)));

  s = escapeHtml(s);

  s = s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, (_, alt, src, title) => {
      const titleAttr = title ? ` title="${title}"` : '';
      return hold(`<img src="${safeUrl(src)}" alt="${alt}"${titleAttr} loading="lazy">`);
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;(.*?)&quot;)?\)/g, (_, label, href, title) => {
      const url = safeUrl(href);
      const titleAttr = title ? ` title="${title}"` : '';
      const extAttr = isExternal(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return hold(`<a href="${url}"${titleAttr}${extAttr}>${applyEmphasis(label)}</a>`);
    })
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, url) =>
      hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));

  s = applyEmphasis(s);

  // 자리표시자 복원 (링크 안의 코드처럼 중첩될 수 있으므로 반복)
  while (/\u0000\d+\u0000/.test(s)) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => tokens[Number(n)]);
  }
  return s;
}

// ---------- 블록 파서 ----------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function dedent(lines) {
  const indents = lines.filter((l) => !isBlank(l)).map(leadingSpaces);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(Math.min(min, leadingSpaces(l))));
}

function parseFence(lines, i) {
  const [, fence, lang] = lines[i].match(FENCE_RE);
  const closeRe = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
  const body = [];
  i++;
  while (i < lines.length && !closeRe.test(lines[i])) {
    body.push(lines[i]);
    i++;
  }
  const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
  const html = `<pre><code${langAttr}>${escapeHtml(body.join('\n'))}</code></pre>`;
  return { html, next: i + 1 };
}

function parseHeading(line, ctx) {
  const [, hashes, raw = ''] = line.match(HEADING_RE);
  const level = hashes.length;
  const inner = parseInline(raw.replace(/\s+#+$/, ''));
  let id = slugify(inner) || 'section';
  const count = ctx.ids.get(id) || 0;
  ctx.ids.set(id, count + 1);
  if (count) id = `${id}-${count}`;
  return `<h${level} id="${escapeHtml(id)}">${inner}</h${level}>`;
}

function parseQuote(lines, i, ctx) {
  const body = [];
  while (i < lines.length && !isBlank(lines[i])) {
    body.push(lines[i].replace(/^ {0,3}> ?/, ''));
    i++;
  }
  return { html: `<blockquote>\n${parseBlocks(body, ctx)}\n</blockquote>`, next: i };
}

// 빈 줄 뒤에 조건을 만족하는 줄이 이어지는지 확인한다.
function nextNonBlank(lines, i) {
  while (i < lines.length && isBlank(lines[i])) i++;
  return i;
}

function parseList(lines, i, ctx) {
  const first = lines[i].match(LIST_RE);
  const indent = first[1].length;
  const ordered = isOrderedMarker(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const items = [];

  while (i < lines.length) {
    const m = lines[i].match(LIST_RE);
    if (!m || m[1].length !== indent || isOrderedMarker(m[2]) !== ordered) break;

    const children = [];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        const j = nextNonBlank(lines, i);
        if (j < lines.length && leadingSpaces(lines[j]) > indent) {
          children.push('');
          i++;
          continue;
        }
        break;
      }
      if (leadingSpaces(line) <= indent) break;
      children.push(line);
      i++;
    }

    const childHtml = children.length ? `\n${parseBlocks(dedent(children), ctx)}\n` : '';
    items.push(`<li>${parseInline(m[3])}${childHtml}</li>`);

    // 빈 줄을 사이에 둔 같은 목록의 다음 항목은 이어 붙인다.
    const j = nextNonBlank(lines, i);
    const nextItem = j < lines.length && lines[j].match(LIST_RE);
    if (j > i && nextItem && nextItem[1].length === indent && isOrderedMarker(nextItem[2]) === ordered) {
      i = j;
    }
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
  return { html: `<${tag}${startAttr}>\n${items.join('\n')}\n</${tag}>`, next: i };
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function parseTable(lines, i) {
  const headers = splitRow(lines[i]);
  const aligns = splitRow(lines[i + 1]).map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
  const cell = (tag, text, col) => {
    const align = aligns[col] ? ` style="text-align:${aligns[col]}"` : '';
    return `<${tag}${align}>${parseInline(text || '')}</${tag}>`;
  };

  const rows = [];
  i += 2;
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
    const cells = splitRow(lines[i]);
    rows.push(`<tr>${headers.map((_, col) => cell('td', cells[col], col)).join('')}</tr>`);
    i++;
  }

  const head = `<thead><tr>${headers.map((h, col) => cell('th', h, col)).join('')}</tr></thead>`;
  const body = rows.length ? `<tbody>\n${rows.join('\n')}\n</tbody>` : '';
  return { html: `<div class="table-wrap"><table>\n${head}\n${body}\n</table></div>`, next: i };
}

function parseParagraph(lines, i) {
  const body = [lines[i]];
  i++;
  while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) {
    body.push(lines[i]);
    i++;
  }
  const text = body.map((l) => l.replace(/^\s+/, '')).join('\n').replace(/\s+$/, '');
  return { html: `<p>${parseInline(text)}</p>`, next: i };
}

function parseBlocks(lines, ctx) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let result;
    if (isBlank(line)) {
      i++;
      continue;
    } else if (FENCE_RE.test(line)) {
      result = parseFence(lines, i);
    } else if (HEADING_RE.test(line)) {
      result = { html: parseHeading(line, ctx), next: i + 1 };
    } else if (HR_RE.test(line)) {
      result = { html: '<hr>', next: i + 1 };
    } else if (QUOTE_RE.test(line)) {
      result = parseQuote(lines, i, ctx);
    } else if (LIST_RE.test(line)) {
      result = parseList(lines, i, ctx);
    } else if (isTableStart(lines, i)) {
      result = parseTable(lines, i);
    } else {
      result = parseParagraph(lines, i);
    }
    out.push(result.html);
    i = result.next;
  }
  return out.join('\n');
}

export function parseMarkdown(text) {
  const lines = String(text)
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n');
  return parseBlocks(lines, { ids: new Map() });
}
